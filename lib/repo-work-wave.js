"use strict";

const { findExecutionClosureForOrigin, recoverExecutionClosure } = require("./execution-closure");
const { ConfigError } = require("./errors");
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
const {
  claimWorkSessionState,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  workspaceRegistryDirectory,
} = require("./work-git");
const { runWork } = require("./work-loop");
const { readWorkspaceCustody } = require("./workspace-custody");
const { workspaceExecutionLeaseAppearsActive } = require("./world-authority");
const { readCurrentWorldState } = require("./world-transition");

const DEFAULT_LOCAL_EXECUTION_BOUND = 3;
const MAX_LOCAL_EXECUTION_BOUND = 8;
const CLAIM_COLLISION_CODES = new Set(["MH_OUTCOME_ALREADY_CLAIMED", "MH_OUTCOME_CLAIM_CONFLICT"]);
const {
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  executionTelemetry,
  frozenStructuralRefillTelemetry,
  isoTime,
  persistRepoWorkWaveTelemetry,
  synchronousBarrierTelemetry,
} = require("./repo-work-wave-telemetry");

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

async function runSessionsConcurrently(repositoryPath, items, options = {}) {
  const { telemetryClock = Date.now, ...workOptions } = options;
  const promises = items.map(async (item) => {
    const dispatchedMs = telemetryClock();
    try {
      const result = await runWork({ repositoryPath, session: item.session, ...workOptions });
      return { item, status: "fulfilled", result, dispatchedMs, completedMs: telemetryClock() };
    } catch (error) {
      return { item, status: "rejected", error, dispatchedMs, completedMs: telemetryClock() };
    }
  });
  return Promise.all(promises);
}

function aggregateOutcome(states, { noFreshCandidates, stalePlanner, deferredCapacity }) {
  const landed = states.filter((entry) => entry.state === "LANDED").length;
  const ownerRequired = states.filter((entry) => entry.state === "OWNER_REQUIRED").length;
  const hardBlocked = states.filter((entry) => entry.state === "BLOCKED").length;
  const needsReplan = states.filter((entry) => ["REPLAN_REQUIRED", "INVALIDATED_REPLAN"].includes(entry.state)).length;
  const running = states.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
  if (noFreshCandidates && states.length === 0) return "REPLAN_REQUIRED";
  const unresolved = stalePlanner || deferredCapacity > 0 || ownerRequired > 0 || hardBlocked > 0 || needsReplan > 0 || running > 0;
  if (landed > 0) return unresolved ? "PARTIAL" : "DONE";
  if (ownerRequired > 0) return "OWNER_REQUIRED";
  if (stalePlanner || deferredCapacity > 0 || needsReplan > 0 || running > 0) return "REPLAN_REQUIRED";
  if (hardBlocked > 0) return "BLOCKED";
  return "REPLAN_REQUIRED";
}

function plannerBatch(value) {
  return validatePlannerCandidateBatch(value?.batch || value);
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

async function fillAvailableSlotsFromPlanner({
  repositoryPath,
  initialCurrent,
  recovered,
  bound,
  executable,
  now,
  env,
  model,
  timeoutSeconds,
  plannerRunner,
}) {
  let current = initialCurrent;
  let plannerContext = recovered;
  let plannerInvoked = false;
  let plannerRetryCount = 0;
  let stalePlanner = false;
  let plannerCandidates = [];
  const candidateRejections = [];
  let admittedCount = 0;
  const availableSlots = () => Math.max(0, bound - executable.length);

  while (availableSlots() > 0) {
    const input = compileRepoPlannerInput({
      repositoryPath,
      current,
      recovered: plannerContext,
      localBound: bound,
    });
    const produced = await plannerRunner({
      repositoryPath,
      current,
      plannerInput: input,
      timeoutSeconds,
      model,
      env,
    });
    plannerInvoked = true;
    const batch = plannerBatch(produced);
    plannerCandidates = batch.proposals;
    let staleThisBoot = false;

    for (const candidate of batch.proposals) {
      if (availableSlots() === 0) break;
      try {
        const prepared = preparePlannerCandidate(repositoryPath, current, candidate);
        const admitted = admitPreparedPlannerCandidate(repositoryPath, current, prepared, { now: now() });
        executable.push({ claim: admitted.claim, session: admitted.session, source: "NEW", proposalId: candidate.id });
        admittedCount += 1;
      } catch (error) {
        if (CLAIM_COLLISION_CODES.has(error?.code) || candidateCompilationRejected(error)) {
          candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
          continue;
        }
        if (error?.code === "MH_OUTCOME_CLAIM_STALE_HEAD") {
          staleThisBoot = true;
          break;
        }
        throw error;
      }
    }

    if (!staleThisBoot) break;
    if (admittedCount > 0 || plannerRetryCount >= 1) {
      stalePlanner = true;
      break;
    }
    plannerRetryCount += 1;
    current = readCurrentWorldState(repositoryPath, { now: now() });
    plannerContext = recoverPlannerContext(repositoryPath, now);
  }

  return Object.freeze({
    current,
    plannerInvoked,
    plannerRetryCount,
    stalePlanner,
    plannerCandidates: Object.freeze([...plannerCandidates]),
    candidateRejections: Object.freeze(candidateRejections),
  });
}

async function runRepoWorkWave({
  repositoryPath,
  env = process.env,
  model,
  timeoutSeconds,
  runner,
  plannerRunner = runLogicalPlanner,
  interpret = runRepositoryClosureInterpreter,
  onProgress = () => {},
  now = () => new Date(),
  telemetryClock = Date.now,
} = {}) {
  const waveStartedMs = telemetryClock();
  ensureLinearProductHead(repositoryPath, { now, env });
  const bound = localExecutionBound(env);
  const recovered = recoverPlannerContext(repositoryPath, now);
  const recoveredExecutable = recovered.filter((entry) => entry.type === "EXECUTABLE");
  const selectedRecovered = recoveredExecutable.slice(0, bound);
  const deferredCapacity = Math.max(0, recoveredExecutable.length - selectedRecovered.length);
  const runningElsewhere = recovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");
  const initialCurrent = readCurrentWorldState(repositoryPath, { now: now() });
  const executable = selectedRecovered.map((entry) => ({
    claim: entry.claim,
    session: entry.session,
    source: "RECOVERED",
    proposalId: null,
  }));
  const planning = await fillAvailableSlotsFromPlanner({
    repositoryPath,
    initialCurrent,
    recovered,
    bound,
    executable,
    now,
    env,
    model,
    timeoutSeconds,
    plannerRunner,
  });

  const claimsAtDispatch = orderedClaims(listActiveOutcomeClaims(repositoryPath));
  const executions = await runSessionsConcurrently(repositoryPath, executable, {
    env, model, timeoutSeconds, runner, onProgress, telemetryClock,
  });
  const executionsSettledMs = telemetryClock();
  const executionStates = executions
    .filter((entry) => entry.status === "rejected")
    .map((entry) => ({
      claimDigest: entry.item.claim.claimDigest,
      outcomeDigest: entry.item.claim.outcomeDigest,
      state: "BLOCKED",
      error: entry.error,
    }));
  executionStates.push(...runningElsewhere.map((entry) => ({
    claimDigest: entry.claim.claimDigest,
    outcomeDigest: entry.claim.outcomeDigest,
    state: "RUNNING_ELSEWHERE",
  })));

  const landingStates = [];
  const landingTelemetry = [];
  const localExecutionByClaim = new Map(executions.map((entry) => [entry.item.claim.claimDigest, entry]));
  for (const claim of orderedClaims(listActiveOutcomeClaims(repositoryPath))) {
    let closure = closureForClaim(repositoryPath, claim);
    if (!closure) {
      const recoveredAfterExecution = recoverClaimCommitment(repositoryPath, claim, { now: now() });
      if (recoveredAfterExecution.type === "CLOSURE") closure = recoveredAfterExecution.closure;
    }
    if (!closure) continue;
    const landingStartedMs = telemetryClock();
    const landing = landOutcomeClosure({ repositoryPath, claim, closure, interpret, now, env });
    const landingCompletedMs = telemetryClock();
    landingStates.push(landing);
    const localExecution = localExecutionByClaim.get(claim.claimDigest);
    landingTelemetry.push({
      claimDigest: claim.claimDigest,
      outcomeDigest: claim.outcomeDigest,
      startedAt: isoTime(landingStartedMs),
      completedAt: isoTime(landingCompletedMs),
      elapsedMs: Math.max(0, landingCompletedMs - landingStartedMs),
      waitAfterLocalCompletionMs: localExecution
        ? Math.max(0, landingStartedMs - localExecution.completedMs)
        : null,
      state: landing.state,
      transitionDigest: landing.transitionDigest || null,
    });
  }

  const landedClaims = new Set(landingStates.map((entry) => entry.claimDigest));
  const states = [...landingStates, ...executionStates.filter((entry) => !landedClaims.has(entry.claimDigest))];
  const noFreshCandidates = planning.plannerInvoked && planning.plannerCandidates.length === 0;
  const waveCompletedMs = telemetryClock();
  const telemetryPersistence = persistRepoWorkWaveTelemetry(repositoryPath, {
    schemaVersion: REPO_WORK_WAVE_TELEMETRY_SCHEMA,
    authority: "NON_AUTHORITATIVE_OBSERVATION",
    schedulerPolicy: "ONE_SHOT_INITIAL_FRONTIER",
    waveStartedAt: isoTime(waveStartedMs),
    executionsSettledAt: isoTime(executionsSettledMs),
    waveCompletedAt: isoTime(waveCompletedMs),
    elapsedMs: Math.max(0, waveCompletedMs - waveStartedMs),
    originWorldHeadDigest: planning.current.head.headDigest,
    plannerInvoked: planning.plannerInvoked,
    plannerRetryCount: planning.plannerRetryCount,
    plannerCandidateCount: planning.plannerCandidates.length,
    candidateRejections: planning.candidateRejections,
    executionBound: bound,
    activeClaimCountAtDispatch: claimsAtDispatch.length,
    admitted: executable.filter((entry) => entry.source === "NEW").length,
    recovered: executable.filter((entry) => entry.source === "RECOVERED").length,
    runningElsewhere: runningElsewhere.length,
    deferredCapacity,
    executions: executionTelemetry(executions),
    synchronousBarrier: synchronousBarrierTelemetry(executions),
    frozenCandidateStructuralRefill: frozenStructuralRefillTelemetry(
      repositoryPath,
      planning.plannerCandidates,
      claimsAtDispatch,
      executions,
    ),
    landings: landingTelemetry,
  });
  return Object.freeze({
    schemaVersion: "repo-work-wave-result/v1",
    outcome: aggregateOutcome(states, {
      noFreshCandidates,
      stalePlanner: planning.stalePlanner,
      deferredCapacity,
    }),
    worldHeadDigest: planning.current.head.headDigest,
    executionBound: bound,
    admitted: executable.filter((entry) => entry.source === "NEW").length,
    recovered: executable.filter((entry) => entry.source === "RECOVERED").length,
    runningElsewhere: runningElsewhere.length,
    deferredCapacity,
    plannerInvoked: planning.plannerInvoked,
    plannerRetryCount: planning.plannerRetryCount,
    plannerCandidateCount: planning.plannerCandidates.length,
    stalePlanner: planning.stalePlanner,
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
