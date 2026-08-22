"use strict";

const { findExecutionClosureForOrigin, recoverExecutionClosure } = require("./execution-closure");
const { ConfigError } = require("./errors");
const { currentOwnerObjectiveRevision } = require("./owner-objective-state");
const { listActiveOutcomeClaims } = require("./outcome-claim");
const { landOutcomeClosure, MAX_LANDING_ATTEMPTS, REPO_CLOSURE_LANDING_INPUT_SCHEMA } = require("./repo-outcome-landing");
const { runRepositoryClosureInterpreter } = require("./repo-closure-interpreter");
const { ensureLinearProductHead } = require("./repo-product-integration");
const { runLogicalPlanner } = require("./repo-logical-planner");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
  validatePlannerCandidateBatch,
} = require("./repo-planner-admission");
const { compileRepoPlannerInput } = require("./repo-planner-input");
const { ensureCurrentResearchPromotions } = require("./repo-research-promotion");
const {
  claimWorkSessionState,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  workspaceRegistryDirectory,
} = require("./work-git");
const { DRAIN_COMPLETE, runWork } = require("./work-loop");
const {
  readWorkspaceCustody,
  workspaceExecutionLeasesOwnedByPid,
} = require("./workspace-custody");
const { workspaceExecutionLeaseAppearsActive } = require("./world-authority");
const { terminalEndgameCoverage } = require("./terminal-endgame");
const { readCurrentWorldState } = require("./world-transition");
const {
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  executionTelemetry,
  isoTime,
  persistRepoWorkWaveTelemetry,
} = require("./repo-work-wave-telemetry");

const DEFAULT_LOCAL_EXECUTION_BOUND = 3;
const MAX_LOCAL_EXECUTION_BOUND = 8;
const CLAIM_COLLISION_CODES = new Set(["MH_OUTCOME_ALREADY_CLAIMED", "MH_OUTCOME_CLAIM_CONFLICT"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function localExecutionBound(env = process.env) {
  const raw = env.META_HARNESS_REPO_WORK_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_LOCAL_EXECUTION_BOUND;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LOCAL_EXECUTION_BOUND) {
    fail("MH_REPO_WORK_CONCURRENCY", `META_HARNESS_REPO_WORK_CONCURRENCY must be an integer from 1 to ${MAX_LOCAL_EXECUTION_BOUND}`);
  }
  return parsed;
}

function orderedClaims(claims) {
  return [...claims].sort((left, right) => {
    const time = Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt);
    return time || left.claimDigest.localeCompare(right.claimDigest);
  });
}

function originForClaim(claim) {
  return { type: "REPO_OUTCOME", outcomeDigest: claim.outcomeDigest, claimDigest: claim.claimDigest };
}

function closureForClaim(repositoryPath, claim) {
  return findExecutionClosureForOrigin(repositoryPath, originForClaim(claim));
}

function recoverClaimCommitment(repositoryPath, claim, { now = new Date() } = {}) {
  const existingClosure = closureForClaim(repositoryPath, claim);
  if (existingClosure) return Object.freeze({ type: "CLOSURE", claim, closure: existingClosure });
  const state = claimWorkSessionState(repositoryPath, claim.claimDigest);
  if (state.state === "NONE") {
    fail(
      "MH_OUTCOME_CLAIM_RECOVERY",
      "active legacy Outcome claim has no recoverable durable session identity; mutable proposals cannot reconstruct commitment authority",
      { claimDigest: claim.claimDigest },
    );
  }
  if (state.state === "PENDING") {
    return Object.freeze({ type: "EXECUTABLE", claim, session: state.session, continuation: "PENDING_WORKSPACE" });
  }
  if (state.state === "ACTIVE") {
    if (workspaceExecutionLeaseAppearsActive(repositoryPath, state.workspaceId, now)) {
      return Object.freeze({ type: "RUNNING_ELSEWHERE", claim, session: state.session, workspaceId: state.workspaceId });
    }
    const custody = readWorkspaceCustody(workspaceRegistryDirectory(repositoryPath), state.workspaceId);
    const continuation = resolveActiveWorkspaceContinuation(repositoryPath, state.session, custody);
    if (continuation.kind === "ENTERED_NO_SEAL") {
      const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult: null });
      if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "consumed Claim execution has no recoverable aggregate ExecutionClosure");
      return Object.freeze({ type: "CLOSURE", claim, closure });
    }
    return Object.freeze({ type: "EXECUTABLE", claim, session: state.session, continuation: continuation.kind });
  }
  if (state.state === "TERMINAL") {
    const workResult = recoverBankedExecutionResult({
      repositoryPath,
      sessionDigest: state.session.sessionDigest,
      workspaceId: state.workspaceId,
    });
    const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult });
    if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "terminal Claim workspace has no recoverable aggregate ExecutionClosure");
    return Object.freeze({ type: "CLOSURE", claim, closure });
  }
  fail("MH_OUTCOME_CLAIM_RECOVERY", `unsupported Claim work state: ${state.state}`);
}

function aggregateOutcome(states, { noFreshCandidates, deferredCapacity }) {
  const landed = states.filter((entry) => entry.state === "LANDED").length;
  const ownerRequired = states.filter((entry) => entry.state === "OWNER_REQUIRED").length;
  const hardBlocked = states.filter((entry) => entry.state === "BLOCKED").length;
  const needsReplan = states.filter((entry) => ["REPLAN_REQUIRED", "INVALIDATED_REPLAN", "EXECUTION_ABORTED"].includes(entry.state)).length;
  const running = states.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
  if (noFreshCandidates && states.length === 0) return "REPLAN_REQUIRED";
  const unresolved = deferredCapacity > 0 || ownerRequired > 0 || hardBlocked > 0 || needsReplan > 0 || running > 0;
  if (landed > 0) return unresolved ? "PARTIAL" : "DONE";
  if (ownerRequired > 0) return "OWNER_REQUIRED";
  if (deferredCapacity > 0 || needsReplan > 0 || running > 0) return "REPLAN_REQUIRED";
  if (hardBlocked > 0) return "BLOCKED";
  return "REPLAN_REQUIRED";
}

function plannerBatch(value) {
  return validatePlannerCandidateBatch(value?.batch || value);
}

function planningEpochKey(headDigest, objectiveRevision) {
  if (typeof headDigest !== "string" || !Number.isInteger(objectiveRevision) || objectiveRevision < 0) {
    fail("MH_REPO_PLANNING_EPOCH", "planning epoch requires a Head digest and non-negative objective revision");
  }
  return `${headDigest}\u001f${objectiveRevision}`;
}

function candidateCompilationRejected(error) {
  const code = String(error?.code || "");
  return code.startsWith("MH_PLANNER_CANDIDATE_")
    || code.startsWith("MH_PLANNER_BOUNDARY_")
    || code === "MH_PLANNER_VALIDATION_UNAVAILABLE";
}

function recoverPlannerContext(repositoryPath, now) {
  return orderedClaims(listActiveOutcomeClaims(repositoryPath))
    .map((claim) => recoverClaimCommitment(repositoryPath, claim, { now: now() }));
}

function launchSessionExecution(repositoryPath, item, options = {}) {
  const { telemetryClock = Date.now, onSettlement = () => {}, ...workOptions } = options;
  const dispatchedMs = telemetryClock();
  const settle = (settlement) => {
    onSettlement(settlement);
    return settlement;
  };
  const promise = (async () => {
    try {
      const result = await runWork({ repositoryPath, session: item.session, ...workOptions });
      return settle({ item, status: "fulfilled", result, dispatchedMs, completedMs: telemetryClock() });
    } catch (error) {
      return settle({ item, status: "rejected", error, dispatchedMs, completedMs: telemetryClock() });
    }
  })();
  return { promise, dispatchedMs };
}

function startRecoverableCommitments({
  repositoryPath,
  recovered,
  running,
  bound,
  proposalIdByClaim,
  pendingReleasedSlots,
  refillTelemetry,
  telemetryClock,
  onSettlement,
  workOptions,
  signal,
}) {
  let recoveredStarted = 0;
  for (const entry of recovered) {
    if (running.size >= bound || signal?.aborted) break;
    if (entry.type !== "EXECUTABLE" || running.has(entry.claim.claimDigest)) continue;
    const proposalId = proposalIdByClaim.get(entry.claim.claimDigest) || null;
    const source = proposalId ? "NEW" : "RECOVERED";
    const item = { claim: entry.claim, session: entry.session, source, proposalId };
    const launched = launchSessionExecution(repositoryPath, item, { ...workOptions, telemetryClock, onSettlement });
    running.set(entry.claim.claimDigest, launched.promise);
    if (source === "RECOVERED") recoveredStarted += 1;
    const released = pendingReleasedSlots.shift();
    if (released) {
      refillTelemetry.push({
        releasedClaimDigest: released.claimDigest,
        releasedAt: isoTime(released.releasedMs),
        redispatchedClaimDigest: entry.claim.claimDigest,
        redispatchedAt: isoTime(launched.dispatchedMs),
        releasedSlotToRedispatchMs: Math.max(0, launched.dispatchedMs - released.releasedMs),
      });
    }
  }
  return recoveredStarted;
}

function activeClaim(repositoryPath, claimDigest) {
  return listActiveOutcomeClaims(repositoryPath).find((claim) => claim.claimDigest === claimDigest) || null;
}

function collectSettledExecutions({
  repositoryPath,
  running,
  executionByClaim,
  recordedExecutionClaims,
  executions,
  now,
}) {
  let collected = 0;
  for (const claimDigest of [...running.keys()]) {
    const settlement = executionByClaim.get(claimDigest);
    if (!settlement) continue;
    running.delete(claimDigest);
    if (!recordedExecutionClaims.has(claimDigest)) {
      recordedExecutionClaims.add(claimDigest);
      executions.push(settlement);
      assertRejectedExecutionHasDurableResolution(repositoryPath, settlement, now);
    }
    collected += 1;
  }
  return collected;
}

function assertRejectedExecutionHasDurableResolution(repositoryPath, settlement, now) {
  if (settlement.status !== "rejected") return;
  const claim = activeClaim(repositoryPath, settlement.item.claim.claimDigest);
  if (!claim) return;
  const recovered = recoverClaimCommitment(repositoryPath, claim, { now: now() });
  if (recovered.type === "CLOSURE") return;
  throw settlement.error;
}

function drainLandingReadyClosures({
  repositoryPath,
  interpret,
  now,
  env,
  telemetryClock,
  executionByClaim,
  outcomeStates,
  landingTelemetry,
  pendingReleasedSlots,
}) {
  let landedCount = 0;
  while (true) {
    const recovered = recoverPlannerContext(repositoryPath, now);
    const ready = recovered.filter((entry) => entry.type === "CLOSURE");
    if (ready.length === 0) return landedCount;
    let observedProgress = false;
    for (const entry of ready) {
      if (!activeClaim(repositoryPath, entry.claim.claimDigest)) {
        observedProgress = true;
        continue;
      }
      const landingStartedMs = telemetryClock();
      let landing;
      try {
        landing = landOutcomeClosure({
          repositoryPath,
          claim: entry.claim,
          closure: entry.closure,
          interpret,
          now,
          env,
        });
      } catch (error) {
        if (error?.code === "MH_OUTCOME_CLAIM_RELEASED") {
          observedProgress = true;
          continue;
        }
        throw error;
      }
      const landingCompletedMs = telemetryClock();
      const localExecution = executionByClaim.get(entry.claim.claimDigest);
      outcomeStates.set(entry.claim.claimDigest, landing);
      landingTelemetry.push({
        claimDigest: entry.claim.claimDigest,
        outcomeDigest: entry.claim.outcomeDigest,
        startedAt: isoTime(landingStartedMs),
        completedAt: isoTime(landingCompletedMs),
        elapsedMs: Math.max(0, landingCompletedMs - landingStartedMs),
        completionToLandingMs: localExecution
          ? Math.max(0, landingStartedMs - localExecution.completedMs)
          : null,
        state: landing.state,
        transitionDigest: landing.transitionDigest || null,
      });
      pendingReleasedSlots.push({ claimDigest: entry.claim.claimDigest, releasedMs: landingCompletedMs });
      landedCount += 1;
      observedProgress = true;
    }
    if (!observedProgress) return landedCount;
  }
}

async function planCurrentHead({
  repositoryPath,
  current,
  recovered,
  localRunningCount,
  runningClaimDigests,
  availableSlots,
  bound,
  now,
  env,
  model,
  timeoutSeconds,
  plannerRunner,
  researchModelRunner,
  telemetryClock,
  signal,
}) {
  const startedMs = telemetryClock();
  if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
  await ensureCurrentResearchPromotions({
    repositoryPath,
    current,
    timeoutSeconds,
    model,
    env,
    signal,
    ...(researchModelRunner ? { modelRunner: researchModelRunner } : {}),
  });
  if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
  const input = compileRepoPlannerInput({
    repositoryPath,
    current,
    recovered,
    localBound: bound,
    localRunningCount,
    localRunningClaimDigests: runningClaimDigests,
  });
  if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
  const produced = await plannerRunner({
    repositoryPath,
    current,
    plannerInput: input,
    timeoutSeconds,
    model,
    env,
    signal,
  });
  if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
  const batch = plannerBatch(produced);
  const objectiveRevision = input.ownerIntent.activeDirective?.revision || 0;
  const epochKey = planningEpochKey(current.head.headDigest, objectiveRevision);
  let admittedCount = 0;
  let staleHead = false;
  let staleObjective = false;
  const candidateRejections = [];
  const admitted = [];

  for (const candidate of batch.proposals) {
    if (admittedCount >= availableSlots) break;
    if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
    try {
      const prepared = preparePlannerCandidate(repositoryPath, current, candidate);
      const admission = admitPreparedPlannerCandidate(repositoryPath, current, prepared, {
        now: now(),
        objectiveRevision,
      });
      admitted.push({ candidate, admission });
      admittedCount += 1;
    } catch (error) {
      if (CLAIM_COLLISION_CODES.has(error?.code) || candidateCompilationRejected(error)) {
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        continue;
      }
      if (error?.code === "MH_OUTCOME_CLAIM_STALE_HEAD") {
        staleHead = true;
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        break;
      }
      if (error?.code === "MH_OUTCOME_CLAIM_STALE_OBJECTIVE") {
        staleObjective = true;
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        break;
      }
      throw error;
    }
  }

  const completedMs = telemetryClock();
  return Object.freeze({
    headDigest: current.head.headDigest,
    productCommit: current.head.productCommit,
    objectiveRevision,
    epochKey,
    startedMs,
    completedMs,
    candidateCount: batch.proposals.length,
    admittedCount,
    staleHead,
    staleObjective,
    candidateRejections: Object.freeze(candidateRejections),
    admitted: Object.freeze(admitted),
  });
}

async function runRepoWorkWave({
  repositoryPath,
  env = process.env,
  model,
  timeoutSeconds,
  runner,
  plannerRunner = runLogicalPlanner,
  researchModelRunner,
  interpret = runRepositoryClosureInterpreter,
  onProgress = () => {},
  now = () => new Date(),
  telemetryClock = Date.now,
  signal,
} = {}) {
  if (signal?.aborted) return DRAIN_COMPLETE;
  const reconciliationStartedMs = telemetryClock();
  ensureLinearProductHead(repositoryPath, { now, env });
  const bound = localExecutionBound(env);
  const commandEntryHead = readCurrentWorldState(repositoryPath, { now: now() }).head;
  const running = new Map();
  const plannedEpochs = new Set();
  const plannerResultsByEpoch = new Map();
  const proposalIdByClaim = new Map();
  const executions = [];
  const executionByClaim = new Map();
  const recordedExecutionClaims = new Set();
  const outcomeStates = new Map();
  const plannerBoots = [];
  const candidateRejections = [];
  const landingTelemetry = [];
  const refillTelemetry = [];
  const pendingReleasedSlots = [];
  let admittedCount = 0;
  let recoveredStarted = 0;
  let plannerCandidateCount = 0;
  let stalePlanner = false;
  let maxLocalConcurrency = 0;

  const workOptions = { env, model, timeoutSeconds, runner, onProgress, signal };

  while (true) {
    collectSettledExecutions({
      repositoryPath,
      running,
      executionByClaim,
      recordedExecutionClaims,
      executions,
      now,
    });
    drainLandingReadyClosures({
      repositoryPath,
      interpret,
      now,
      env,
      telemetryClock,
      executionByClaim,
      outcomeStates,
      landingTelemetry,
      pendingReleasedSlots,
    });

    let recovered = recoverPlannerContext(repositoryPath, now);
    recoveredStarted += startRecoverableCommitments({
      repositoryPath,
      recovered,
      running,
      bound,
      proposalIdByClaim,
      pendingReleasedSlots,
      refillTelemetry,
      telemetryClock,
      onSettlement: (settlement) => {
        executionByClaim.set(settlement.item.claim.claimDigest, settlement);
      },
      workOptions,
      signal,
    });
    maxLocalConcurrency = Math.max(maxLocalConcurrency, running.size);

    recovered = recoverPlannerContext(repositoryPath, now);
    const recoverableWaiting = recovered.some((entry) => entry.type === "EXECUTABLE" && !running.has(entry.claim.claimDigest));
    const current = readCurrentWorldState(repositoryPath, { now: now() });
    const currentObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
    const currentEpochKey = planningEpochKey(current.head.headDigest, currentObjectiveRevision);
    if (!signal?.aborted && running.size < bound && !recoverableWaiting && !plannedEpochs.has(currentEpochKey)) {
      let planning;
      try {
        planning = await planCurrentHead({
          repositoryPath,
          current,
          recovered,
          localRunningCount: running.size,
          runningClaimDigests: [...running.keys()],
          availableSlots: bound - running.size,
          bound,
          now,
          env,
          model,
          timeoutSeconds,
          plannerRunner,
          researchModelRunner,
          telemetryClock,
          signal,
        });
      } catch (error) {
        if (error?.code === "MH_DRAIN_REQUESTED" && signal?.aborted) continue;
        throw error;
      }
      plannedEpochs.add(planning.epochKey);
      plannerResultsByEpoch.set(planning.epochKey, planning);
      plannerCandidateCount += planning.candidateCount;
      stalePlanner = stalePlanner || planning.staleHead || planning.staleObjective;
      candidateRejections.push(...planning.candidateRejections);
      for (const entry of planning.admitted) {
        admittedCount += 1;
        proposalIdByClaim.set(entry.admission.claim.claimDigest, entry.candidate.id);
      }
      plannerBoots.push({
        headDigest: planning.headDigest,
        productCommit: planning.productCommit,
        objectiveRevision: planning.objectiveRevision,
        startedAt: isoTime(planning.startedMs),
        completedAt: isoTime(planning.completedMs),
        elapsedMs: Math.max(0, planning.completedMs - planning.startedMs),
        candidateCount: planning.candidateCount,
        admittedCount: planning.admittedCount,
        staleHead: planning.staleHead,
        staleObjective: planning.staleObjective,
        candidateRejections: planning.candidateRejections,
      });
      continue;
    }

    if (signal?.aborted) {
      if (running.size > 0) {
        await Promise.race([...running.values()]);
        continue;
      }
      const drainRecovered = recoverPlannerContext(repositoryPath, now);
      if (drainRecovered.some((entry) => entry.type === "CLOSURE")) continue;
      const localLeases = workspaceExecutionLeasesOwnedByPid(workspaceRegistryDirectory(repositoryPath), process.pid);
      if (localLeases.length > 0) {
        fail("MH_DRAIN_QUIESCENCE", "controlled drain finished local work but controller-owned execution leases remain", {
          workspaceIds: localLeases.map((lease) => lease.workspaceId),
        });
      }
      return DRAIN_COMPLETE;
    }

    if (running.size === 0) {
      const finalRecovered = recoverPlannerContext(repositoryPath, now);
      if (finalRecovered.some((entry) => ["CLOSURE", "EXECUTABLE"].includes(entry.type))) continue;
      const finalCurrent = readCurrentWorldState(repositoryPath, { now: now() });
      const finalObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
      const finalEpochKey = planningEpochKey(finalCurrent.head.headDigest, finalObjectiveRevision);
      const finalPlanning = plannerResultsByEpoch.get(finalEpochKey) || null;
      const runningElsewhere = finalRecovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");
      for (const entry of runningElsewhere) {
        if (!outcomeStates.has(entry.claim.claimDigest)) {
          outcomeStates.set(entry.claim.claimDigest, {
            claimDigest: entry.claim.claimDigest,
            outcomeDigest: entry.claim.outcomeDigest,
            state: "RUNNING_ELSEWHERE",
          });
        }
      }
      const deferredCapacity = finalRecovered.filter((entry) => entry.type === "EXECUTABLE").length;
      const states = [...outcomeStates.values()];
      const noPositiveValueProposal = Boolean(finalPlanning && finalPlanning.candidateCount === 0);
      const terminallySettled = states.every((entry) => entry.state === "LANDED");
      const quiescentNoWork = noPositiveValueProposal && finalRecovered.length === 0 && terminallySettled;
      const endgameCoverage = quiescentNoWork ? terminalEndgameCoverage(repositoryPath, finalCurrent) : null;
      const finalOutcome = quiescentNoWork
        ? endgameCoverage.complete ? "USE_PRODUCT" : "REPLAN_REQUIRED"
        : aggregateOutcome(states, { noFreshCandidates: noPositiveValueProposal, deferredCapacity });
      const reconciliationCompletedMs = telemetryClock();
      const telemetryPersistence = persistRepoWorkWaveTelemetry(repositoryPath, {
        schemaVersion: REPO_WORK_WAVE_TELEMETRY_SCHEMA,
        authority: "NON_AUTHORITATIVE_OBSERVATION",
        schedulerPolicy: "EVENT_DRIVEN_RECONCILIATION",
        reconciliationStartedAt: isoTime(reconciliationStartedMs),
        reconciliationCompletedAt: isoTime(reconciliationCompletedMs),
        elapsedMs: Math.max(0, reconciliationCompletedMs - reconciliationStartedMs),
        originWorldHeadDigest: commandEntryHead.headDigest,
        quiescentHeadDigest: finalCurrent.head.headDigest,
        plannerInvoked: plannerBoots.length > 0,
        plannerBootCount: plannerBoots.length,
        plannerCandidateCount,
        candidateRejections,
        executionBound: bound,
        admitted: admittedCount,
        recovered: recoveredStarted,
        runningElsewhere: runningElsewhere.length,
        deferredCapacity,
        maxLocalConcurrency,
        plannerBoots,
        executions: executionTelemetry(executions),
        landings: landingTelemetry,
        refills: refillTelemetry,
      });
      return Object.freeze({
        schemaVersion: "repo-work-wave-result/v1",
        outcome: finalOutcome,
        worldHeadDigest: finalCurrent.head.headDigest,
        endgameCoverage,
        executionBound: bound,
        admitted: admittedCount,
        recovered: recoveredStarted,
        runningElsewhere: runningElsewhere.length,
        deferredCapacity,
        plannerInvoked: plannerBoots.length > 0,
        plannerRetryCount: 0,
        plannerCandidateCount,
        stalePlanner,
        orchestrationTelemetry: telemetryPersistence.record,
        orchestrationTelemetryPersistence: telemetryPersistence.persistence,
        outcomes: states.map((entry) => ({
          claimDigest: entry.claimDigest,
          outcomeDigest: entry.outcomeDigest,
          state: entry.state,
          transitionDigest: entry.transitionDigest || null,
          ownerRequest: entry.ownerRequest || null,
        })),
      });
    }

    await Promise.race([...running.values()]);
    // Settlement is only a wake signal. The next loop iteration consumes telemetry
    // and recomputes all authority from durable Head/Claim/Closure truth.
  }
}

module.exports = {
  DEFAULT_LOCAL_EXECUTION_BOUND,
  MAX_LANDING_ATTEMPTS,
  MAX_LOCAL_EXECUTION_BOUND,
  REPO_CLOSURE_LANDING_INPUT_SCHEMA,
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  landOutcomeClosure,
  localExecutionBound,
  orderedClaims,
  recoverClaimCommitment,
  runRepoWorkWave,
};
