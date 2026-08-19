"use strict";

const { findExecutionClosureForOrigin, recoverExecutionClosure } = require("./execution-closure");
const { ConfigError } = require("./errors");
const {
  boundariesOverlap,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
} = require("./outcome-claim");
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
const { workspaceExecutionLeaseAppearsActive } = require("./world-authority");
const { readCurrentWorldState } = require("./world-transition");

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

async function runSessionsConcurrently(repositoryPath, items, options = {}) {
  const promises = items.map(async (item) => {
    try {
      const result = await runWork({ repositoryPath, session: item.session, ...options });
      return { item, status: "fulfilled", result };
    } catch (error) {
      return { item, status: "rejected", error };
    }
  });
  return Promise.all(promises);
}

function proposalBoundaryConflicts(proposal, activeClaims) {
  const boundary = { writePaths: proposal.allowedPaths };
  return activeClaims.some((claim) => boundariesOverlap(claim.executionBoundary, boundary));
}

function aggregateOutcome(states, { emptyProposals, staleProposalSet, deferredCapacity }) {
  const landed = states.filter((entry) => entry.state === "LANDED").length;
  const needsReplan = states.filter((entry) => ["BLOCKED", "INVALIDATED_REPLAN"].includes(entry.state)).length;
  const running = states.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
  if (emptyProposals && states.length === 0) return "REPLAN_REQUIRED";
  if (staleProposalSet || deferredCapacity > 0 || needsReplan > 0 || running > 0) {
    return landed > 0 ? "PARTIAL" : "REPLAN_REQUIRED";
  }
  return landed > 0 ? "DONE" : "REPLAN_REQUIRED";
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
      executable.push({ claim: admitted.claim, session: admitted.session, source: "NEW" });
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
} = {}) {
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
  const executable = selectedRecovered.map((entry) => ({ claim: entry.claim, session: entry.session, source: "RECOVERED" }));
  let staleProposalSet = fillAvailableSlots(
    repositoryPath,
    proposalSet,
    executable,
    Math.max(0, bound - executable.length),
    now,
  );

  const executions = await runSessionsConcurrently(repositoryPath, executable, {
    env, model, timeoutSeconds, runner, onProgress,
  });
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
  for (const claim of orderedClaims(listActiveOutcomeClaims(repositoryPath))) {
    let closure = closureForClaim(repositoryPath, claim);
    if (!closure) {
      const recoveredAfterExecution = recoverClaimCommitment(repositoryPath, claim, { now: now() });
      if (recoveredAfterExecution.type === "CLOSURE") closure = recoveredAfterExecution.closure;
    }
    if (!closure) continue;
    landingStates.push(landOutcomeClosure({ repositoryPath, claim, closure, interpret, now, env }));
  }

  const landedClaims = new Set(landingStates.map((entry) => entry.claimDigest));
  const states = [...landingStates, ...executionStates.filter((entry) => !landedClaims.has(entry.claimDigest))];
  const emptyProposals = !proposalSet || proposalSet.value.proposals.length === 0;
  staleProposalSet = staleProposalSet || Boolean(proposalIssue);
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
    outcomes: states.map((entry) => ({
      claimDigest: entry.claimDigest,
      outcomeDigest: entry.outcomeDigest,
      state: entry.state,
      transitionDigest: entry.transitionDigest || null,
    })),
  });
}

module.exports = {
  DEFAULT_LOCAL_EXECUTION_BOUND,
  MAX_LANDING_ATTEMPTS,
  MAX_LOCAL_EXECUTION_BOUND,
  REPO_CLOSURE_LANDING_INPUT_SCHEMA,
  landOutcomeClosure,
  localExecutionBound,
  orderedClaims,
  recoverClaimCommitment,
  runRepoWorkWave,
};
