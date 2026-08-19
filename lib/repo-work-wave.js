"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { findExecutionClosureForOrigin, recoverExecutionClosure } = require("./execution-closure");
const { ConfigError } = require("./errors");
const {
  boundariesOverlap,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
} = require("./outcome-claim");
const { readOutcome } = require("./outcome");
const { landOutcomeClosure, MAX_LANDING_ATTEMPTS, REPO_CLOSURE_LANDING_INPUT_SCHEMA } = require("./repo-outcome-landing");
const { runRepositoryClosureInterpreter } = require("./repo-closure-interpreter");
const { ensureLinearProductHead } = require("./repo-product-integration");
const {
  admitPreparedRepoProposal,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("./repo-proposal-set");
const {
  claimWorkSessionState,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  workspaceRegistryDirectory,
} = require("./work-git");
const { runWork } = require("./work-loop");
const { readWorkspaceCustody } = require("./workspace-custody");
const {
  digestStem,
  protocolRoot,
  workspaceExecutionLeaseAppearsActive,
  writeCreateOnlyJson,
} = require("./world-authority");
const { readCurrentWorldState } = require("./world-transition");

const DEFAULT_LOCAL_EXECUTION_BOUND = 3;
const MAX_LOCAL_EXECUTION_BOUND = 8;
const CLAIM_COLLISION_CODES = new Set(["MH_OUTCOME_ALREADY_CLAIMED", "MH_OUTCOME_CLAIM_CONFLICT"]);
const REPO_WORK_WAVE_TELEMETRY_SCHEMA = "repo-work-wave-telemetry/v1";
const REPO_WORK_WAVE_TELEMETRY_DOMAIN = "meta-harness-repo-work-wave-telemetry/v1";

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

function proposalBoundaryConflictsWithClaims(proposal, claims) {
  const boundary = { writePaths: proposal.allowedPaths };
  return claims.some((claim) => boundariesOverlap(claim.executionBoundary, boundary));
}

function proposalBoundaryConflicts(proposal, activeClaims) {
  return proposalBoundaryConflictsWithClaims(proposal, activeClaims);
}

function aggregateOutcome(states, { emptyProposals, staleProposalSet, deferredCapacity }) {
  const landed = states.filter((entry) => entry.state === "LANDED").length;
  const ownerRequired = states.filter((entry) => entry.state === "OWNER_REQUIRED").length;
  const hardBlocked = states.filter((entry) => entry.state === "BLOCKED").length;
  const needsReplan = states.filter((entry) => ["REPLAN_REQUIRED", "INVALIDATED_REPLAN"].includes(entry.state)).length;
  const running = states.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
  if (emptyProposals && states.length === 0) return "REPLAN_REQUIRED";
  const unresolved = staleProposalSet || deferredCapacity > 0 || ownerRequired > 0 || hardBlocked > 0 || needsReplan > 0 || running > 0;
  if (landed > 0) return unresolved ? "PARTIAL" : "DONE";
  if (ownerRequired > 0) return "OWNER_REQUIRED";
  if (staleProposalSet || deferredCapacity > 0 || needsReplan > 0 || running > 0) return "REPLAN_REQUIRED";
  if (hardBlocked > 0) return "BLOCKED";
  return "REPLAN_REQUIRED";
}

function isoTime(ms) {
  return new Date(ms).toISOString();
}

function selectedWorkEffort(result) {
  const metrics = result?.metrics;
  if (!metrics) return null;
  const attempts = Array.isArray(metrics.attempts) ? metrics.attempts : [];
  return {
    schemaVersion: metrics.schemaVersion,
    continuation: metrics.continuation,
    elapsedMs: metrics.elapsedMs,
    firstProposalMs: metrics.firstProposalMs,
    workerMs: metrics.workerMs,
    verifierMs: metrics.verifierMs,
    validationCommandMs: metrics.validationCommandMs,
    repairAttempts: metrics.repairAttempts,
    attemptCount: attempts.length,
    operationCount: attempts.reduce((sum, attempt) => sum + Number(attempt.operationCount || 0), 0),
    writeBytes: attempts.reduce((sum, attempt) => sum + Number(attempt.writeBytes || 0), 0),
    workerJsonEvents: metrics.workerJsonEvents,
    workerOutputBytes: metrics.workerOutputBytes,
  };
}

function executionTelemetry(executions) {
  return executions.map((entry) => ({
    claimDigest: entry.item.claim.claimDigest,
    outcomeDigest: entry.item.claim.outcomeDigest,
    source: entry.item.source,
    proposalId: entry.item.proposalId || null,
    dispatchedAt: isoTime(entry.dispatchedMs),
    completedAt: isoTime(entry.completedMs),
    elapsedMs: Math.max(0, entry.completedMs - entry.dispatchedMs),
    status: entry.status,
    workOutcome: entry.status === "fulfilled" ? entry.result?.outcome || null : null,
    errorCode: entry.status === "rejected" ? String(entry.error?.code || "UNCLASSIFIED") : null,
    effort: entry.status === "fulfilled" ? selectedWorkEffort(entry.result) : null,
  }));
}

function synchronousBarrierTelemetry(executions) {
  if (executions.length === 0) {
    return {
      firstLocalCompletionAt: null,
      lastLocalCompletionAt: null,
      completionSpreadMs: 0,
      cumulativePostCompletionBarrierMs: 0,
    };
  }
  const completed = executions.map((entry) => entry.completedMs).sort((left, right) => left - right);
  const first = completed[0];
  const last = completed[completed.length - 1];
  return {
    firstLocalCompletionAt: isoTime(first),
    lastLocalCompletionAt: isoTime(last),
    completionSpreadMs: Math.max(0, last - first),
    cumulativePostCompletionBarrierMs: completed.reduce((sum, value) => sum + Math.max(0, last - value), 0),
  };
}

function frozenStructuralRefillTelemetry(repositoryPath, proposalSet, claimsAtDispatch, executions) {
  if (!proposalSet || executions.length === 0) return [];
  const claimedProposalIds = new Set(claimsAtDispatch.map((claim) => readOutcome(repositoryPath, claim.outcomeDigest).id));
  const unclaimedProposals = proposalSet.value.proposals.filter((proposal) => !claimedProposalIds.has(proposal.id));
  const orderedExecutions = [...executions].sort((left, right) => {
    const time = left.completedMs - right.completedMs;
    return time || left.item.claim.claimDigest.localeCompare(right.item.claim.claimDigest);
  });
  const releasedClaims = new Set();
  return orderedExecutions.map((entry) => {
    releasedClaims.add(entry.item.claim.claimDigest);
    const remainingClaims = claimsAtDispatch.filter((claim) => !releasedClaims.has(claim.claimDigest));
    const candidateIds = unclaimedProposals
      .filter((proposal) => !proposalBoundaryConflictsWithClaims(proposal, remainingClaims))
      .map((proposal) => proposal.id)
      .sort();
    return {
      observedAt: isoTime(entry.completedMs),
      completedClaimDigest: entry.item.claim.claimDigest,
      counterfactualReleasedLocalClaimCount: releasedClaims.size,
      structurallyCompatibleFrozenProposalIds: candidateIds,
      structurallyCompatibleFrozenProposalCount: candidateIds.length,
      counterfactualFillableSlotCount: Math.min(releasedClaims.size, candidateIds.length),
      semanticEligibilityAsserted: false,
      counterfactualOnly: true,
    };
  });
}

function telemetryDigest(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.telemetryDigest;
  return domainDigest(REPO_WORK_WAVE_TELEMETRY_DOMAIN, body);
}

function persistRepoWorkWaveTelemetry(repositoryPath, telemetry) {
  const record = Object.freeze({
    ...JSON.parse(JSON.stringify(telemetry)),
    telemetryDigest: telemetryDigest(telemetry),
  });
  try {
    const filePath = path.join(
      protocolRoot(repositoryPath),
      "telemetry",
      "repo-work-waves",
      `${digestStem(record.telemetryDigest)}.json`,
    );
    writeCreateOnlyJson(filePath, record, "MH_REPO_WORK_WAVE_TELEMETRY_WRITE");
    return { record, persistence: Object.freeze({ status: "PERSISTED", errorCode: null }) };
  } catch (error) {
    return {
      record,
      persistence: Object.freeze({
        status: "FAILED",
        errorCode: String(error?.code || "MH_REPO_WORK_WAVE_TELEMETRY_WRITE"),
      }),
    };
  }
}

function loadCurrentProposals(repositoryPath, current) {
  try {
    return { proposalSet: loadRepoProposalSet(repositoryPath, current), issue: null };
  } catch (error) {
    if (!String(error?.code || "").startsWith("MH_REPO_PROPOSAL_")) throw error;
    return { proposalSet: null, issue: error };
  }
}

function fillAvailableSlots(repositoryPath, proposalSet, executable, availableSlots, now) {
  let staleProposalSet = false;
  for (const proposal of proposalSet?.value.proposals || []) {
    if (availableSlots === 0) break;
    const outcome = outcomeForProposal(repositoryPath, proposal);
    if (findActiveOutcomeClaimForOutcome(repositoryPath, outcome.outcomeDigest)) continue;
    if (proposalBoundaryConflicts(proposal, listActiveOutcomeClaims(repositoryPath))) continue;
    const prepared = prepareRepoProposal(repositoryPath, proposalSet, proposal, { outcome });
    try {
      const admitted = admitPreparedRepoProposal(repositoryPath, proposalSet, prepared, { now: now() });
      executable.push({ claim: admitted.claim, session: admitted.session, source: "NEW", proposalId: proposal.id });
      availableSlots -= 1;
    } catch (error) {
      if (CLAIM_COLLISION_CODES.has(error?.code)) continue;
      if (error?.code === "MH_OUTCOME_CLAIM_STALE_HEAD") {
        staleProposalSet = true;
        break;
      }
      throw error;
    }
  }
  return staleProposalSet;
}

async function runRepoWorkWave({
  repositoryPath,
  env = process.env,
  model,
  timeoutSeconds,
  runner,
  interpret = runRepositoryClosureInterpreter,
  onProgress = () => {},
  now = () => new Date(),
  telemetryClock = Date.now,
} = {}) {
  const waveStartedMs = telemetryClock();
  ensureLinearProductHead(repositoryPath, { now, env });
  const bound = localExecutionBound(env);
  const recovered = orderedClaims(listActiveOutcomeClaims(repositoryPath))
    .map((claim) => recoverClaimCommitment(repositoryPath, claim, { now: now() }));
  const recoveredExecutable = recovered.filter((entry) => entry.type === "EXECUTABLE");
  const selectedRecovered = recoveredExecutable.slice(0, bound);
  const deferredCapacity = Math.max(0, recoveredExecutable.length - selectedRecovered.length);
  const runningElsewhere = recovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");
  const current = readCurrentWorldState(repositoryPath, { now: now() });
  const { proposalSet, issue: proposalIssue } = loadCurrentProposals(repositoryPath, current);
  const executable = selectedRecovered.map((entry) => ({
    claim: entry.claim,
    session: entry.session,
    source: "RECOVERED",
    proposalId: null,
  }));
  let staleProposalSet = fillAvailableSlots(
    repositoryPath,
    proposalSet,
    executable,
    Math.max(0, bound - executable.length),
    now,
  );

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
  const emptyProposals = !proposalSet || proposalSet.value.proposals.length === 0;
  staleProposalSet = staleProposalSet || Boolean(proposalIssue);
  const waveCompletedMs = telemetryClock();
  const telemetryPersistence = persistRepoWorkWaveTelemetry(repositoryPath, {
    schemaVersion: REPO_WORK_WAVE_TELEMETRY_SCHEMA,
    authority: "NON_AUTHORITATIVE_OBSERVATION",
    schedulerPolicy: "STATIC_SYNCHRONOUS_WAVE_BASELINE",
    waveStartedAt: isoTime(waveStartedMs),
    executionsSettledAt: isoTime(executionsSettledMs),
    waveCompletedAt: isoTime(waveCompletedMs),
    elapsedMs: Math.max(0, waveCompletedMs - waveStartedMs),
    originWorldHeadDigest: current.head.headDigest,
    proposalSetDigest: proposalSet?.digest || null,
    proposalCount: proposalSet?.value.proposals.length || 0,
    executionBound: bound,
    activeClaimCountAtDispatch: claimsAtDispatch.length,
    admitted: executable.filter((entry) => entry.source === "NEW").length,
    recovered: executable.filter((entry) => entry.source === "RECOVERED").length,
    runningElsewhere: runningElsewhere.length,
    deferredCapacity,
    executions: executionTelemetry(executions),
    synchronousBarrier: synchronousBarrierTelemetry(executions),
    frozenProposalStructuralRefill: frozenStructuralRefillTelemetry(
      repositoryPath,
      proposalSet,
      claimsAtDispatch,
      executions,
    ),
    landings: landingTelemetry,
  });
  return Object.freeze({
    schemaVersion: "repo-work-wave-result/v1",
    outcome: aggregateOutcome(states, { emptyProposals, staleProposalSet, deferredCapacity }),
    proposalSetDigest: proposalSet?.digest || null,
    worldHeadDigest: current.head.headDigest,
    executionBound: bound,
    admitted: executable.filter((entry) => entry.source === "NEW").length,
    recovered: executable.filter((entry) => entry.source === "RECOVERED").length,
    runningElsewhere: runningElsewhere.length,
    deferredCapacity,
    staleProposalSet,
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
