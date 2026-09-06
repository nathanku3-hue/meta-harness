"use strict";

const { findExecutionClosureForOrigin, recoverExecutionClosure } = require("./execution-closure");
const {
  createExternalProposalRunner,
  extractInternalDevSpaceProposalHost,
  reconcileProposalDispatch,
} = require("./devspace-proposal-host");
const { createDelegationRound4Driver } = require("./delegation-round4-driver");
const { runDelegationRound3 } = require("./delegation-round3-orchestrator");
const { ConfigError } = require("./errors");
const { currentOwnerObjectiveRevision } = require("./owner-objective-state");
const { readOutcome } = require("./outcome");
const {
  listActiveOutcomeClaims,
  readOutcomeClaim,
  readOutcomeClaimRelease,
} = require("./outcome-claim");
const { appendRunEvent, listRunSessions, readRunJournal, runIdForSession } = require("./run-journal");
const { landOutcomeClosure, MAX_LANDING_ATTEMPTS, REPO_CLOSURE_LANDING_INPUT_SCHEMA } = require("./repo-outcome-landing");
const { runRepositoryClosureInterpreter } = require("./repo-closure-interpreter");
const { ensureLinearProductHead } = require("./repo-product-integration");
const { runLogicalPlanner } = require("./repo-logical-planner");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
  validatePlannerCandidateBatch,
} = require("./repo-planner-admission");
const { AUTONOMOUS_CONTINUATION_DISPOSITIONS, compileRepoPlannerInput } = require("./repo-planner-input");
const { ensureCurrentResearchPromotions } = require("./repo-research-promotion");
const {
  assertProposalDispatchReceiptBinding,
  assertProposalDispatchResultBinding,
  assertRecoveredProposalDispatchBinding,
  readProposalDispatchIntent,
  readProposalDispatchReceipt,
  readProposalDispatchResult,
} = require("./proposal-dispatch");
const {
  captureWorkspaceBoundary,
  claimWorkSessionState,
  commonGitDirectory,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  runWorkSessionState,
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
function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function recoveredSnapshotSignature(entries) {
  return JSON.stringify(entries.map((entry) => [
    runKey(entry),
    entry.claim?.claimDigest || null,
    entry.type,
    entry.closure?.closureDigest || null,
    entry.intent?.intentDigest || null,
    entry.workspaceId || null,
    entry.continuation || null,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function quiescenceSnapshotOptimistic({ repositoryPath, now }) {
  const current = readCurrentWorldState(repositoryPath, { now: now() });
  const objectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
  const recovered = recoverPlannerContext(repositoryPath, now);
  if (recovered.some((entry) => ["CLOSURE", "EXECUTABLE"].includes(entry.type))) {
    return Object.freeze({ retry: true });
  }
  const plannerInput = compileRepoPlannerInput({ repositoryPath, current, recovered });
  const autonomousHandoffs = plannerInput.unresolvedHandoffs
    .filter((handoff) => AUTONOMOUS_CONTINUATION_DISPOSITIONS.has(handoff.disposition));
  const endgameCoverage = terminalEndgameCoverage(repositoryPath, current);

  const verifiedCurrent = readCurrentWorldState(repositoryPath, { now: now() });
  const verifiedObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
  const verifiedRecovered = recoverPlannerContext(repositoryPath, now);
  if (verifiedCurrent.head.headDigest !== current.head.headDigest
      || verifiedObjectiveRevision !== objectiveRevision
      || recoveredSnapshotSignature(verifiedRecovered) !== recoveredSnapshotSignature(recovered)) {
    return Object.freeze({ retry: true });
  }
  return Object.freeze({
    retry: false,
    current,
    recovered,
    plannerInput,
    autonomousHandoffs: Object.freeze(autonomousHandoffs),
    endgameCoverage,
  });
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
    const registryDir = workspaceRegistryDirectory(repositoryPath);
    const custody = readWorkspaceCustody(registryDir, state.workspaceId);
    const continuation = resolveActiveWorkspaceContinuation(repositoryPath, state.session, custody);
    if (continuation.kind === "ENTERED_NO_SEAL") {
      const intent = readProposalDispatchIntent({
        workspaceRegistryDir: registryDir,
        workspaceId: state.workspaceId,
        generation: custody.generation,
        optional: true,
      });
      if (intent) {
        const boundary = captureWorkspaceBoundary(custody.workspacePath, state.session.allowedPaths);
        const validatedIntent = assertRecoveredProposalDispatchBinding({
          intent,
          session: state.session,
          custody,
          attemptEntry: continuation.attemptEntry,
          boundary,
        });
        const receipt = readProposalDispatchReceipt({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
        const result = readProposalDispatchResult({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        if (result) {
          assertProposalDispatchResultBinding(validatedIntent, validatedReceipt, result);
          return Object.freeze({
            type: "EXECUTABLE",
            claim,
            session: state.session,
            continuation: "EXTERNAL_RESULT_READY",
          });
        }
        return Object.freeze({
          type: "EXTERNAL_OPEN",
          claim,
          session: state.session,
          workspaceId: state.workspaceId,
          intent: validatedIntent,
          receipt: validatedReceipt,
        });
      }
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

function runKey(entry) {
  return entry.runKey || entry.session?.sessionDigest || entry.claim?.claimDigest || entry.closure?.sessionDigest || null;
}

function recoverRunCommitment(repositoryPath, session, { now = new Date() } = {}) {
  if (session?.origin?.type !== "REPO_RUN") {
    fail("MH_RUN_RECOVERY", "claimless run recovery requires a REPO_RUN session");
  }
  const key = session.sessionDigest;
  const outcomeDigest = session.origin.outcomeDigest;
  const existingClosure = findExecutionClosureForOrigin(repositoryPath, session.origin);
  if (existingClosure) {
    return Object.freeze({
      type: "CLOSURE",
      runKey: key,
      claim: null,
      session,
      outcomeDigest,
      continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
      closure: existingClosure,
    });
  }
  const state = runWorkSessionState(repositoryPath, session);
  if (state.state === "PENDING") {
    return Object.freeze({
      type: "EXECUTABLE",
      runKey: key,
      claim: null,
      session: state.session,
      outcomeDigest,
      continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
      continuation: "PENDING_WORKSPACE",
    });
  }
  if (state.state === "ACTIVE") {
    if (workspaceExecutionLeaseAppearsActive(repositoryPath, state.workspaceId, now)) {
      return Object.freeze({
        type: "RUNNING_ELSEWHERE",
        runKey: key,
        claim: null,
        session: state.session,
        outcomeDigest,
        continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
        workspaceId: state.workspaceId,
      });
    }
    const registryDir = workspaceRegistryDirectory(repositoryPath);
    const custody = readWorkspaceCustody(registryDir, state.workspaceId);
    const continuation = resolveActiveWorkspaceContinuation(repositoryPath, state.session, custody);
    if (continuation.kind === "ENTERED_NO_SEAL") {
      const intent = readProposalDispatchIntent({
        workspaceRegistryDir: registryDir,
        workspaceId: state.workspaceId,
        generation: custody.generation,
        optional: true,
      });
      if (intent) {
        const boundary = captureWorkspaceBoundary(custody.workspacePath, state.session.allowedPaths);
        const validatedIntent = assertRecoveredProposalDispatchBinding({
          intent,
          session: state.session,
          custody,
          attemptEntry: continuation.attemptEntry,
          boundary,
        });
        const receipt = readProposalDispatchReceipt({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        const validatedReceipt = assertProposalDispatchReceiptBinding(validatedIntent, receipt);
        const result = readProposalDispatchResult({
          workspaceRegistryDir: registryDir,
          workspaceId: state.workspaceId,
          generation: custody.generation,
          optional: true,
        });
        if (result) {
          assertProposalDispatchResultBinding(validatedIntent, validatedReceipt, result);
          return Object.freeze({
            type: "EXECUTABLE",
            runKey: key,
            claim: null,
            session: state.session,
            outcomeDigest,
            continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
            continuation: "EXTERNAL_RESULT_READY",
          });
        }
        return Object.freeze({
          type: "EXTERNAL_OPEN",
          runKey: key,
          claim: null,
          session: state.session,
          outcomeDigest,
          continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
          workspaceId: state.workspaceId,
          intent: validatedIntent,
          receipt: validatedReceipt,
        });
      }
      const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult: null });
      if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "entered claimless run has no recoverable execution closure");
      return Object.freeze({
        type: "CLOSURE",
        runKey: key,
        claim: null,
        session: state.session,
        outcomeDigest,
        continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
        closure,
      });
    }
    return Object.freeze({
      type: "EXECUTABLE",
      runKey: key,
      claim: null,
      session: state.session,
      outcomeDigest,
      continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
      continuation: continuation.kind,
    });
  }
  if (state.state === "TERMINAL") {
    const workResult = recoverBankedExecutionResult({
      repositoryPath,
      sessionDigest: state.session.sessionDigest,
      workspaceId: state.workspaceId,
    });
    const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult });
    if (!closure) fail("MH_EXECUTION_CLOSURE_MISSING", "terminal claimless run has no recoverable execution closure");
    return Object.freeze({
      type: "CLOSURE",
      runKey: key,
      claim: null,
      session: state.session,
      outcomeDigest,
      continuesFromTransitionDigests: session.origin.continuesFromTransitionDigests,
      closure,
    });
  }
  fail("MH_RUN_RECOVERY", `unsupported claimless run state: ${state.state}`);
}

function aggregateOutcome(states, { noFreshCandidates, deferredExecutable }) {
  const landed = states.filter((entry) => entry.state === "LANDED").length;
  const needsReplan = states.filter((entry) => [
    "REPLAN_REQUIRED",
    "EXECUTION_ABORTED",
    "BLOCKED", // legacy execution label; never owner/product-terminal authority.
    "OWNER_REQUIRED", // legacy proof-derived label; deterministic owner gates live elsewhere.
  ].includes(entry.state)).length;
  const running = states.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
  const externalOpen = states.filter((entry) => entry.state === "EXTERNAL_OPEN").length;
  if (noFreshCandidates && states.length === 0) return "REPLAN_REQUIRED";
  const unresolved = deferredExecutable > 0 || needsReplan > 0 || running > 0 || externalOpen > 0;
  if (landed > 0) return unresolved ? "PARTIAL" : "DONE";
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
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const claimless = [];
  const legacyClaims = [];
  const seenClaims = new Set();
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type === "REPO_RUN") {
      const events = readRunJournal({
        gitCommonDirectory,
        runId: runIdForSession(session.sessionDigest),
      });
      if (events.some((event) => event.type === "integration/result"
          && ["APPLIED", "ALREADY_APPLIED", "LANDED"].includes(event.data?.status))) continue;
      claimless.push(recoverRunCommitment(repositoryPath, session, { now: now() }));
      continue;
    }
    if (session.origin?.type !== "REPO_OUTCOME") continue;
    let claim;
    try {
      claim = readOutcomeClaim(repositoryPath, session.origin.claimDigest);
    } catch (error) {
      if (error?.code === "MH_OUTCOME_CLAIM_READ" && /ENOENT/u.test(String(error.message || ""))) continue;
      throw error;
    }
    if (claim.outcomeDigest !== session.origin.outcomeDigest) {
      fail("MH_RUN_SESSION_CONFLICT", "legacy run session disagrees with its retained Outcome provenance");
    }
    if (readOutcomeClaimRelease(repositoryPath, claim.claimDigest, { optional: true })) continue;
    legacyClaims.push(claim);
    seenClaims.add(claim.claimDigest);
  }
  for (const claim of listActiveOutcomeClaims(repositoryPath)) {
    if (!seenClaims.has(claim.claimDigest)) legacyClaims.push(claim);
  }
  const legacy = orderedClaims(legacyClaims)
    .map((claim) => recoverClaimCommitment(repositoryPath, claim, { now: now() }));
  return Object.freeze([...claimless, ...legacy].sort((left, right) => String(runKey(left)).localeCompare(String(runKey(right)))));
}

function recoverRepositoryCommitments(repositoryPath, { now = () => new Date() } = {}) {
  return Object.freeze(recoverPlannerContext(repositoryPath, now));
}

async function waitForWorkOrDelegation(running, delegationDriver, signal) {
  if (!delegationDriver?.hasPendingLanes()) {
    await Promise.race([...running.values()]);
    return;
  }
  const watch = new AbortController();
  const abortWatch = () => watch.abort();
  if (signal) signal.addEventListener("abort", abortWatch, { once: true });
  try {
    await Promise.race([
      ...running.values(),
      delegationDriver.waitForRelevantChange(watch.signal),
    ]);
  } finally {
    watch.abort();
    if (signal) signal.removeEventListener("abort", abortWatch);
  }
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
  proposalIdByRun,
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
    const key = runKey(entry);
    if (entry.type !== "EXECUTABLE" || !key || running.has(key)) continue;
    const proposalId = proposalIdByRun.get(key) || null;
    const source = proposalId ? "NEW" : "RECOVERED";
    const item = {
      runKey: key,
      claim: entry.claim || null,
      outcomeDigest: entry.outcomeDigest || entry.claim?.outcomeDigest || entry.session.origin.outcomeDigest,
      session: entry.session,
      source,
      proposalId,
    };
    const launched = launchSessionExecution(repositoryPath, item, { ...workOptions, telemetryClock, onSettlement });
    running.set(key, launched.promise);
    if (source === "RECOVERED") recoveredStarted += 1;
    const released = pendingReleasedSlots.shift();
    if (released) {
      refillTelemetry.push({
        releasedRunKey: released.runKey,
        releasedClaimDigest: released.claimDigest || null,
        releasedAt: isoTime(released.releasedMs),
        redispatchedRunKey: key,
        redispatchedClaimDigest: entry.claim?.claimDigest || null,
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

function appendRunEventOnce({ gitCommonDirectory, runId, type, matches, data, now }) {
  const existing = readRunJournal({ gitCommonDirectory, runId })
    .find((event) => event.type === type && matches(event));
  if (existing) return existing;
  return appendRunEvent({ gitCommonDirectory, runId, type, data, now });
}

function directRepairCandidate(predecessorSession, outcome, transitionDigest) {
  return {
    id: outcome.id,
    productResult: predecessorSession.productResult,
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: predecessorSession.journeyState,
    doNow: predecessorSession.doNow,
    newlyTrueBehavior: predecessorSession.newlyTrueBehavior,
    doneWhen: predecessorSession.doneWhen,
    stopOnlyIf: [...predecessorSession.stopOnlyIf],
    expectedWritePaths: [...predecessorSession.allowedPaths],
    continuesFromTransitionDigests: [transitionDigest],
  };
}

function sessionMatchesDirectRepair(session, predecessorSession, intent) {
  return session?.origin?.type === "REPO_RUN"
    && session.origin.outcomeDigest === predecessorSession.origin.outcomeDigest
    && session.origin.objectiveRevision === predecessorSession.origin.objectiveRevision
    && JSON.stringify(session.origin.continuesFromTransitionDigests) === JSON.stringify([intent.data.transitionDigest])
    && session.productResult === predecessorSession.productResult
    && session.journeyState === predecessorSession.journeyState
    && session.doNow === predecessorSession.doNow
    && session.newlyTrueBehavior === predecessorSession.newlyTrueBehavior
    && session.doneWhen === predecessorSession.doneWhen
    && JSON.stringify(session.stopOnlyIf) === JSON.stringify(predecessorSession.stopOnlyIf)
    && JSON.stringify(session.allowedPaths) === JSON.stringify(predecessorSession.allowedPaths);
}

function recordDirectRepairResolution({ gitCommonDirectory, predecessorRunId, intent, status, successorSessionDigest = null, code = null, now }) {
  return appendRunEventOnce({
    gitCommonDirectory,
    runId: predecessorRunId,
    type: "integration/repair-resolution",
    matches: (event) => event.data?.intentEventDigest === intent.eventDigest,
    data: {
      intentEventDigest: intent.eventDigest,
      transitionDigest: intent.data.transitionDigest,
      status,
      successorSessionDigest,
      code,
    },
    now,
  });
}

function ensureDirectRepairFromIntent({ repositoryPath, predecessorSession, intent, now }) {
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const predecessorRunId = runIdForSession(predecessorSession.sessionDigest);
  const predecessorEvents = readRunJournal({ gitCommonDirectory, runId: predecessorRunId });
  const resolved = predecessorEvents.find((event) => event.type === "integration/repair-resolution"
    && event.data?.intentEventDigest === intent.eventDigest);
  if (resolved) return null;

  if (currentOwnerObjectiveRevision(repositoryPath) !== predecessorSession.origin.objectiveRevision) {
    recordDirectRepairResolution({
      gitCommonDirectory,
      predecessorRunId,
      intent,
      status: "FALLBACK",
      code: "MH_OWNER_OBJECTIVE_STALE",
      now: now(),
    });
    return null;
  }

  const sessions = listRunSessions({ gitCommonDirectory });
  let repairSession = sessions.find((session) => sessionMatchesDirectRepair(session, predecessorSession, intent)) || null;
  let admission = null;
  if (repairSession) {
    admission = Object.freeze({
      runId: runIdForSession(repairSession.sessionDigest),
      outcome: readOutcome(repositoryPath, repairSession.origin.outcomeDigest),
      session: repairSession,
      relation: null,
    });
  } else {
    const current = readCurrentWorldState(repositoryPath, { now: now() });
    const outcome = readOutcome(repositoryPath, predecessorSession.origin.outcomeDigest);
    try {
      const prepared = preparePlannerCandidate(
        repositoryPath,
        current,
        directRepairCandidate(predecessorSession, outcome, intent.data.transitionDigest),
      );
      admission = admitPreparedPlannerCandidate(repositoryPath, current, prepared, {
        now: now(),
        objectiveRevision: predecessorSession.origin.objectiveRevision,
      });
      repairSession = admission.session;
    } catch (error) {
      if (candidateCompilationRejected(error)
          || error?.code === "MH_OWNER_OBJECTIVE_STALE"
          || error?.code === "MH_PLANNER_CANDIDATE_CONTINUATION") {
        recordDirectRepairResolution({
          gitCommonDirectory,
          predecessorRunId,
          intent,
          status: "FALLBACK",
          code: String(error.code),
          now: now(),
        });
        return null;
      }
      throw error;
    }
  }

  const repairRunId = runIdForSession(repairSession.sessionDigest);
  appendRunEventOnce({
    gitCommonDirectory,
    runId: repairRunId,
    type: "integration/repair-context",
    matches: (event) => event.data?.intentEventDigest === intent.eventDigest,
    data: {
      intentEventDigest: intent.eventDigest,
      predecessorSessionDigest: predecessorSession.sessionDigest,
      transitionDigest: intent.data.transitionDigest,
      outcomeDigest: predecessorSession.origin.outcomeDigest,
      reason: intent.data.reason,
      detail: intent.data.detail,
      productCommit: repairSession.base.commit,
    },
    now: now(),
  });
  recordDirectRepairResolution({
    gitCommonDirectory,
    predecessorRunId,
    intent,
    status: "ADMITTED",
    successorSessionDigest: repairSession.sessionDigest,
    now: now(),
  });
  return admission;
}

function recoverPendingDirectIntegrationRepairs({ repositoryPath, now }) {
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const recovered = [];
  for (const predecessorSession of listRunSessions({ gitCommonDirectory })) {
    if (predecessorSession.origin?.type !== "REPO_RUN") continue;
    const predecessorRunId = runIdForSession(predecessorSession.sessionDigest);
    const events = readRunJournal({ gitCommonDirectory, runId: predecessorRunId });
    const resolvedIntents = new Set(events
      .filter((event) => event.type === "integration/repair-resolution")
      .map((event) => event.data?.intentEventDigest)
      .filter(Boolean));
    for (const intent of events.filter((event) => event.type === "integration/repair-intent")) {
      if (resolvedIntents.has(intent.eventDigest)) continue;
      const admission = ensureDirectRepairFromIntent({ repositoryPath, predecessorSession, intent, now });
      if (admission) recovered.push(admission);
    }
  }
  return Object.freeze(recovered);
}

function scheduleDirectIntegrationRepair({ repositoryPath, entry, landing, now }) {
  if (entry.claim || entry.session?.origin?.type !== "REPO_RUN" || !landing?.repairContext) return null;

  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const predecessorRunId = runIdForSession(entry.session.sessionDigest);
  const predecessorEvents = readRunJournal({ gitCommonDirectory, runId: predecessorRunId });
  if (predecessorEvents.some((event) => event.type === "integration/repair-context")) return null;
  if (currentOwnerObjectiveRevision(repositoryPath) !== entry.session.origin.objectiveRevision) return null;

  const intent = appendRunEventOnce({
    gitCommonDirectory,
    runId: predecessorRunId,
    type: "integration/repair-intent",
    matches: (event) => event.data?.transitionDigest === landing.transitionDigest,
    data: {
      predecessorSessionDigest: entry.session.sessionDigest,
      transitionDigest: landing.transitionDigest,
      outcomeDigest: entry.session.origin.outcomeDigest,
      objectiveRevision: entry.session.origin.objectiveRevision,
      reason: landing.repairContext.reason,
      detail: landing.repairContext.detail,
    },
    now: now(),
  });
  return ensureDirectRepairFromIntent({
    repositoryPath,
    predecessorSession: entry.session,
    intent,
    now,
  });
}

function collectSettledExecutions({
  repositoryPath,
  running,
  executionByRun,
  recordedExecutionRuns,
  executions,
  now,
}) {
  let collected = 0;
  for (const key of [...running.keys()]) {
    const settlement = executionByRun.get(key);
    if (!settlement) continue;
    running.delete(key);
    if (!recordedExecutionRuns.has(key)) {
      recordedExecutionRuns.add(key);
      executions.push(settlement);
      assertRejectedExecutionHasDurableResolution(repositoryPath, settlement, now);
    }
    collected += 1;
  }
  return collected;
}

function assertRejectedExecutionHasDurableResolution(repositoryPath, settlement, now) {
  if (settlement.status !== "rejected") return;
  if (settlement.item.session?.origin?.type === "REPO_RUN") {
    const recovered = recoverRunCommitment(repositoryPath, settlement.item.session, { now: now() });
    if (recovered.type === "CLOSURE") return;
    throw settlement.error;
  }
  const claimDigest = settlement.item.claim?.claimDigest;
  if (!claimDigest) throw settlement.error;
  const claim = activeClaim(repositoryPath, claimDigest);
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
  executionByRun,
  outcomeStates,
  landingTelemetry,
  pendingReleasedSlots,
  onRepairAdmitted = () => {},
}) {
  let landedCount = 0;
  while (true) {
    const recovered = recoverPlannerContext(repositoryPath, now);
    const ready = recovered.filter((entry) => entry.type === "CLOSURE");
    if (ready.length === 0) return landedCount;
    let observedProgress = false;
    for (const entry of ready) {
      const key = runKey(entry);
      if (!key) fail("MH_RUN_RECOVERY", "landing-ready execution has no stable run key");
      if (entry.claim && !activeClaim(repositoryPath, entry.claim.claimDigest)) {
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
      const repairAdmission = scheduleDirectIntegrationRepair({ repositoryPath, entry, landing, now });
      if (repairAdmission) onRepairAdmitted(repairAdmission, landing);
      const landingCompletedMs = telemetryClock();
      const localExecution = executionByRun.get(key);
      outcomeStates.set(key, landing);
      landingTelemetry.push({
        runKey: key,
        claimDigest: entry.claim?.claimDigest || null,
        outcomeDigest: entry.outcomeDigest || entry.claim?.outcomeDigest || entry.closure.origin.outcomeDigest,
        startedAt: isoTime(landingStartedMs),
        completedAt: isoTime(landingCompletedMs),
        elapsedMs: Math.max(0, landingCompletedMs - landingStartedMs),
        completionToLandingMs: localExecution
          ? Math.max(0, landingStartedMs - localExecution.completedMs)
          : null,
        state: landing.state,
        transitionDigest: landing.transitionDigest || null,
      });
      pendingReleasedSlots.push({ runKey: key, claimDigest: entry.claim?.claimDigest || null, releasedMs: landingCompletedMs });
      landedCount += 1;
      observedProgress = true;
    }
    if (!observedProgress) return landedCount;
  }
}

function activeDirectRepairOutcomeDigests(repositoryPath, recovered) {
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const outcomeDigests = new Set();
  for (const entry of recovered) {
    const session = entry.session || null;
    if (session?.origin?.type !== "REPO_RUN") continue;
    const events = readRunJournal({
      gitCommonDirectory,
      runId: runIdForSession(session.sessionDigest),
    });
    if (events.some((event) => event.type === "integration/repair-context")) {
      outcomeDigests.add(session.origin.outcomeDigest);
    }
  }
  return outcomeDigests;
}

async function planCurrentHead({
  repositoryPath,
  current,
  recovered,
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
  const input = compileRepoPlannerInput({ repositoryPath, current, recovered });
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
  const autonomousSnapshotTransitions = new Set(input.unresolvedHandoffs
    .filter((handoff) => AUTONOMOUS_CONTINUATION_DISPOSITIONS.has(handoff.disposition))
    .map((handoff) => handoff.transitionDigest));
  for (const candidate of batch.proposals) {
    const invalid = candidate.continuesFromTransitionDigests
      .filter((digest) => !autonomousSnapshotTransitions.has(digest));
    if (invalid.length > 0) {
      fail(
        "MH_PLANNER_CANDIDATE_CONTINUATION",
        "planner candidate continuation references were not present as autonomous handoffs in the exact planner input",
        { candidateId: candidate.id, invalidTransitionDigests: invalid },
      );
    }
  }
  const objectiveRevision = input.ownerIntent.activeDirective?.revision || 0;
  const epochKey = planningEpochKey(current.head.headDigest, objectiveRevision);
  const activeRepairOutcomeDigests = activeDirectRepairOutcomeDigests(repositoryPath, recovered);
  let staleObjective = false;
  const candidateRejections = [];
  const admitted = [];

  for (const candidate of batch.proposals) {
    if (signal?.aborted) throw new ConfigError("controlled drain requested", { code: "MH_DRAIN_REQUESTED" });
    try {
      const prepared = preparePlannerCandidate(repositoryPath, current, candidate);
      if (activeRepairOutcomeDigests.has(prepared.outcome.outcomeDigest)) {
        candidateRejections.push({ candidateId: candidate.id, code: "MH_PLANNER_CANDIDATE_ACTIVE_REPAIR" });
        continue;
      }
      const admission = admitPreparedPlannerCandidate(repositoryPath, current, prepared, {
        now: now(),
        objectiveRevision,
      });
      admitted.push({ candidate, admission });
    } catch (error) {
      if (candidateCompilationRejected(error)) {
        candidateRejections.push({ candidateId: candidate.id, code: String(error.code) });
        continue;
      }
      if (error?.code === "MH_OWNER_OBJECTIVE_STALE") {
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
    admittedCount: admitted.length,
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
  delegationRound3 = null,
  delegationRound3Runner = runDelegationRound3,
  delegationPollIntervalMs,
  proposalHost = null,
  onProgress = () => {},
  now = () => new Date(),
  telemetryClock = Date.now,
  signal,
} = {}) {
  if (signal?.aborted) return DRAIN_COMPLETE;
  const internalProposalCapability = extractInternalDevSpaceProposalHost(env);
  if (proposalHost && internalProposalCapability.proposalHost) {
    fail("MH_PROPOSAL_HOST_CONFLICT", "repo work received both an injected proposal host and an internal DevSpace bridge capability");
  }
  proposalHost = proposalHost || internalProposalCapability.proposalHost;
  env = internalProposalCapability.modelEnv;
  const reconciliationStartedMs = telemetryClock();
  ensureLinearProductHead(repositoryPath, { now, env });
  let delegationReconciliation = null;
  let delegationDriver = null;
  if (delegationRound3 !== null) {
    if (!delegationRound3 || typeof delegationRound3 !== "object" || Array.isArray(delegationRound3)) {
      fail("MH_DELEGATION_R3_PRODUCTION", "delegationRound3 production reconciliation must be a retained delegation request object");
    }
    delegationDriver = createDelegationRound4Driver({
      repositoryPath,
      request: delegationRound3,
      runner: delegationRound3Runner,
      env,
      model,
      timeoutSeconds,
      signal,
      ...(delegationPollIntervalMs === undefined ? {} : { pollIntervalMs: delegationPollIntervalMs }),
    });
    delegationReconciliation = await delegationDriver.reconcile();
  }
  const bound = localExecutionBound(env);
  const commandEntryHead = readCurrentWorldState(repositoryPath, { now: now() }).head;
  const running = new Map();
  const plannedEpochs = new Set();
  const plannerResultsByEpoch = new Map();
  const proposalIdByRun = new Map();
  const executions = [];
  const executionByRun = new Map();
  const recordedExecutionRuns = new Set();
  const outcomeStates = new Map();
  const plannerBoots = [];
  const candidateRejections = [];
  const landingTelemetry = [];
  const refillTelemetry = [];
  const pendingReleasedSlots = [];
  const reconciledExternalIntentDigests = new Set();
  let admittedCount = 0;
  let recoveredStarted = 0;
  let plannerCandidateCount = 0;
  let stalePlanner = false;
  let maxLocalConcurrency = 0;

  const effectiveRunner = proposalHost ? createExternalProposalRunner(proposalHost) : runner;
  const workOptions = { env, model, timeoutSeconds, runner: effectiveRunner, onProgress, signal };

  while (true) {
    for (const admission of recoverPendingDirectIntegrationRepairs({ repositoryPath, now })) {
      admittedCount += 1;
      proposalIdByRun.set(admission.session.sessionDigest, `integration-repair:${admission.outcome.id}`);
    }
    collectSettledExecutions({
      repositoryPath,
      running,
      executionByRun,
      recordedExecutionRuns,
      executions,
      now,
    });
    for (const execution of executions) {
      if (execution.status === "fulfilled" && execution.result?.control === "EXTERNAL_OPEN" && execution.result.intentDigest) {
        reconciledExternalIntentDigests.add(execution.result.intentDigest);
      }
    }
    drainLandingReadyClosures({
      repositoryPath,
      interpret,
      now,
      env,
      telemetryClock,
      executionByRun,
      outcomeStates,
      landingTelemetry,
      pendingReleasedSlots,
      onRepairAdmitted: (admission) => {
        admittedCount += 1;
        proposalIdByRun.set(admission.session.sessionDigest, `integration-repair:${admission.outcome.id}`);
      },
    });
    if (delegationDriver) {
      const delegationCurrent = readCurrentWorldState(repositoryPath, { now: now() });
      if (delegationDriver.shouldReconcile(delegationCurrent.head.headDigest)) {
        delegationReconciliation = await delegationDriver.reconcile();
      }
    }

    let recovered = recoverPlannerContext(repositoryPath, now);
    if (proposalHost) {
      for (const entry of recovered) {
        const key = runKey(entry);
        if (entry.type !== "EXTERNAL_OPEN"
            || !key
            || running.has(key)
            || reconciledExternalIntentDigests.has(entry.intent.intentDigest)) continue;
        reconciledExternalIntentDigests.add(entry.intent.intentDigest);
        await reconcileProposalDispatch({
          proposalHost,
          workspaceRegistryDir: workspaceRegistryDirectory(repositoryPath),
          intent: entry.intent,
          signal,
        });
      }
      // Host reconciliation may have captured a durable result. Recompute before
      // dispatch so RESULT_READY becomes executable in this same wave even while
      // local execution slots are occupied.
      recovered = recoverPlannerContext(repositoryPath, now);
    }
    recoveredStarted += startRecoverableCommitments({
      repositoryPath,
      recovered,
      running,
      bound,
      proposalIdByRun,
      pendingReleasedSlots,
      refillTelemetry,
      telemetryClock,
      onSettlement: (settlement) => {
        executionByRun.set(settlement.item.runKey, settlement);
      },
      workOptions,
      signal,
    });
    maxLocalConcurrency = Math.max(maxLocalConcurrency, running.size);

    recovered = recoverPlannerContext(repositoryPath, now);
    const current = readCurrentWorldState(repositoryPath, { now: now() });
    const currentObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
    const currentEpochKey = planningEpochKey(current.head.headDigest, currentObjectiveRevision);
    if (!signal?.aborted && !plannedEpochs.has(currentEpochKey)) {
      let planning;
      try {
        planning = await planCurrentHead({
          repositoryPath,
          current,
          recovered,
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
      stalePlanner = stalePlanner || planning.staleObjective;
      candidateRejections.push(...planning.candidateRejections);
      for (const entry of planning.admitted) {
        admittedCount += 1;
        proposalIdByRun.set(entry.admission.session.sessionDigest, entry.candidate.id);
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
      const quiescence = quiescenceSnapshotOptimistic({ repositoryPath, now });
      if (!quiescence || quiescence.retry) continue;
      if (delegationDriver?.hasPendingLanes()) {
        const changed = await delegationDriver.waitForRelevantChange(signal);
        if (changed || signal?.aborted) continue;
      }
      const finalRecovered = quiescence.recovered;
      const finalCurrent = quiescence.current;
      const finalObjectiveRevision = currentOwnerObjectiveRevision(repositoryPath);
      const finalEpochKey = planningEpochKey(finalCurrent.head.headDigest, finalObjectiveRevision);
      const finalPlanning = plannerResultsByEpoch.get(finalEpochKey) || null;
      const runningElsewhere = finalRecovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");
      const externalOpen = finalRecovered.filter((entry) => entry.type === "EXTERNAL_OPEN");
      for (const entry of runningElsewhere) {
        const key = runKey(entry);
        if (key && !outcomeStates.has(key)) {
          outcomeStates.set(key, {
            runKey: key,
            claimDigest: entry.claim?.claimDigest || null,
            outcomeDigest: entry.outcomeDigest || entry.claim?.outcomeDigest || entry.session.origin.outcomeDigest,
            state: "RUNNING_ELSEWHERE",
          });
        }
      }
      for (const entry of externalOpen) {
        const key = runKey(entry);
        if (key && !outcomeStates.has(key)) {
          outcomeStates.set(key, {
            runKey: key,
            claimDigest: entry.claim?.claimDigest || null,
            outcomeDigest: entry.outcomeDigest || entry.claim?.outcomeDigest || entry.session.origin.outcomeDigest,
            state: "EXTERNAL_OPEN",
          });
        }
      }
      const deferredExecutable = finalRecovered.filter((entry) => entry.type === "EXECUTABLE").length;
      const autonomousHandoffs = quiescence.autonomousHandoffs;
      const autonomousByTransition = new Map(autonomousHandoffs.map((handoff) => [handoff.transitionDigest, handoff]));
      const uncoveredAutonomousHandoffs = autonomousHandoffs
        .filter((handoff) => handoff.activeContinuationOutcomeDigests.length === 0);
      const states = [...outcomeStates.values()].filter((entry) => {
        if (!AUTONOMOUS_CONTINUATION_DISPOSITIONS.has(entry.state)) return true;
        const handoff = autonomousByTransition.get(entry.transitionDigest);
        return Boolean(handoff && handoff.activeContinuationOutcomeDigests.length === 0);
      });
      const noPositiveValueProposal = Boolean(finalPlanning && finalPlanning.candidateCount === 0);
      const terminallySettled = states.every((entry) => entry.state === "LANDED");
      const quiescentNoWork = noPositiveValueProposal
        && finalRecovered.length === 0
        && terminallySettled
        && uncoveredAutonomousHandoffs.length === 0;
      const endgameCoverage = quiescentNoWork ? terminalEndgameCoverage(repositoryPath, finalCurrent) : null;
      const finalOutcome = quiescentNoWork
        ? endgameCoverage.complete ? "USE_PRODUCT" : "REPLAN_REQUIRED"
        : aggregateOutcome(states, { noFreshCandidates: noPositiveValueProposal, deferredExecutable });
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
        externalOpen: externalOpen.length,
        deferredExecutable,
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
        externalOpen: externalOpen.length,
        deferredExecutable,
        plannerInvoked: plannerBoots.length > 0,
        plannerRetryCount: 0,
        plannerCandidateCount,
        stalePlanner,
        orchestrationTelemetry: telemetryPersistence.record,
        orchestrationTelemetryPersistence: telemetryPersistence.persistence,
        delegationGate: delegationReconciliation?.worldHeadDigest === finalCurrent.head.headDigest
          ? delegationReconciliation.surfacedGate
          : null,
        delegationWorldHeadDigest: delegationReconciliation?.worldHeadDigest || null,
        outcomes: states.map((entry) => ({
          runKey: entry.runKey || null,
          claimDigest: entry.claimDigest || null,
          outcomeDigest: entry.outcomeDigest,
          desiredState: readOutcome(repositoryPath, entry.outcomeDigest).desiredState,
          state: entry.state,
          transitionDigest: entry.transitionDigest || null,
          ownerRequest: entry.ownerRequest || null,
        })),
      });
    }

    await waitForWorkOrDelegation(running, delegationDriver, signal);
    // Settlement or retained-lane change is only a wake signal. The next loop iteration consumes telemetry
    // and recomputes execution from durable product Head, run journals, and historical compatibility records.
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
  recoverRunCommitment,
  recoverRepositoryCommitments,
  runRepoWorkWave,
};
