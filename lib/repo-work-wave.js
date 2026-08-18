"use strict";

const {
  findExecutionClosureForOrigin,
  findExecutionWorkResultForOrigin,
  recoverExecutionClosure,
} = require("./execution-closure");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const {
  boundariesOverlap,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
} = require("./outcome-claim");
const {
  admitPreparedRepoProposal,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("./repo-proposal-set");
const {
  REPO_CLOSURE_INTERPRETATION_SCHEMA,
  runRepositoryClosureInterpreter,
  validateRepositoryInterpretation,
} = require("./repo-closure-interpreter");
const {
  claimWorkSessionState,
  recoverBankedExecutionResult,
  resolveActiveWorkspaceContinuation,
  workspaceRegistryDirectory,
} = require("./work-git");
const { runWork } = require("./work-loop");
const { readWorkspaceCustody } = require("./workspace-custody");
const {
  persistImmutableBytes,
  persistImmutableJson,
  workspaceExecutionLeaseAppearsActive,
} = require("./world-authority");
const {
  commitTransition,
  computeInterpretationDigest,
  computeWorldTransitionDigest,
  readCurrentWorldState,
  validateWorldTransition,
} = require("./world-transition");
const { computeRepoWorldDigest } = require("./world-attestation");

const REPO_CLOSURE_LANDING_INPUT_SCHEMA = "repo-closure-landing-input/v1";
const DEFAULT_LOCAL_EXECUTION_BOUND = 3;
const MAX_LOCAL_EXECUTION_BOUND = 8;
const MAX_LANDING_ATTEMPTS = 3;
const CLAIM_COLLISION_CODES = new Set([
  "MH_OUTCOME_ALREADY_CLAIMED",
  "MH_OUTCOME_CLAIM_CONFLICT",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function localExecutionBound(env = process.env) {
  const raw = env.META_HARNESS_REPO_WORK_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_LOCAL_EXECUTION_BOUND;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LOCAL_EXECUTION_BOUND) {
    fail(
      "MH_REPO_WORK_CONCURRENCY",
      `META_HARNESS_REPO_WORK_CONCURRENCY must be an integer from 1 to ${MAX_LOCAL_EXECUTION_BOUND}`,
    );
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
  return {
    type: "REPO_OUTCOME",
    outcomeDigest: claim.outcomeDigest,
    claimDigest: claim.claimDigest,
  };
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
      "active legacy Outcome claim has no recoverable durable session identity; mutable proposals cannot be used to reconstruct commitment authority",
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
      const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult: null });
      if (!closure) {
        fail("MH_EXECUTION_CLOSURE_MISSING", "consumed Claim execution has no recoverable aggregate ExecutionClosure");
      }
      return Object.freeze({ type: "CLOSURE", claim, closure });
    }
    return Object.freeze({ type: "EXECUTABLE", claim, session: state.session, continuation: continuation.kind });
  }
  if (state.state === "TERMINAL") {
    const recoveredWorkResult = recoverBankedExecutionResult({
      repositoryPath,
      sessionDigest: state.session.sessionDigest,
      workspaceId: state.workspaceId,
    });
    const closure = recoverExecutionClosure(repositoryPath, state.session, now, { workResult: recoveredWorkResult });
    if (!closure) {
      fail("MH_EXECUTION_CLOSURE_MISSING", "terminal Claim workspace has no recoverable aggregate ExecutionClosure");
    }
    return Object.freeze({ type: "CLOSURE", claim, closure });
  }
  fail("MH_OUTCOME_CLAIM_RECOVERY", `unsupported Claim work state: ${state.state}`);
}

function landingInput(repositoryPath, current, claim, closure) {
  const outcome = readOutcome(repositoryPath, claim.outcomeDigest);
  const workResult = closure.workResultDigest === null
    ? null
    : findExecutionWorkResultForOrigin(repositoryPath, closure.origin);
  if (closure.workResultDigest !== null
      && (!workResult || workResult.workResultDigest !== closure.workResultDigest)) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "Closure durable work result cannot be resolved exactly for current-World interpretation");
  }
  return Object.freeze({
    schemaVersion: REPO_CLOSURE_LANDING_INPUT_SCHEMA,
    currentHead: current.head,
    currentWorld: current.world,
    currentAttestation: current.attestation,
    outcome,
    claim,
    closure,
    workResult,
  });
}

function interpretationBytes(interpretation) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: REPO_CLOSURE_INTERPRETATION_SCHEMA,
    disposition: interpretation.disposition,
    interpretation: interpretation.interpretation,
  }, null, 2)}\n`, "utf8");
}

function learningTransition(repositoryPath, current, closure, interpretation) {
  const worldDigest = computeRepoWorldDigest(interpretation.successorWorld);
  if (worldDigest !== interpretation.successorWorldDigest) {
    fail("MH_REPO_INTERPRETER_WORLD", "validated repository interpretation World digest changed before persistence");
  }
  persistImmutableJson(repositoryPath, "worlds", worldDigest, interpretation.successorWorld, "MH_REPO_INTERPRETER_WORLD");
  persistImmutableJson(
    repositoryPath,
    "attestations",
    interpretation.successorAttestation.attestationDigest,
    interpretation.successorAttestation,
    "MH_REPO_INTERPRETER_ATTESTATION",
  );
  const bytes = interpretationBytes(interpretation);
  const interpretationDigest = computeInterpretationDigest(bytes);
  persistImmutableBytes(repositoryPath, "interpretations", interpretationDigest, bytes, "MH_REPO_INTERPRETER_INTERPRETATION");
  const body = {
    schemaVersion: "world-transition/v1",
    predecessorHeadDigest: current.head.headDigest,
    cause: {
      type: "ATTEMPT_LEARNING",
      executionClosureDigest: closure.closureDigest,
      interpretationDigest,
    },
    successorWorldDigest: worldDigest,
    successorAttestationDigest: interpretation.successorAttestation.attestationDigest,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function abortedTransition(current, closure) {
  const body = {
    schemaVersion: "world-transition/v1",
    predecessorHeadDigest: current.head.headDigest,
    cause: {
      type: "ATTEMPT_ABORTED",
      executionClosureDigest: closure.closureDigest,
    },
    successorWorldDigest: current.head.worldDigest,
    successorAttestationDigest: current.head.attestationDigest,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function outcomeStateForLearning(closure, workResult, interpretation) {
  if (interpretation.disposition === "INVALIDATED_REPLAN") return "INVALIDATED_REPLAN";
  return workResult?.result?.outcome === "DONE" ? "LANDED" : "BLOCKED";
}

function landOutcomeClosure({
  repositoryPath,
  claim,
  closure,
  interpret = runRepositoryClosureInterpreter,
  now = () => new Date(),
  maxAttempts = MAX_LANDING_ATTEMPTS,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    const input = landingInput(repositoryPath, current, claim, closure);
    let transition;
    let interpretation = null;
    if (input.workResult === null) {
      transition = abortedTransition(current, closure);
    } else {
      const produced = interpret({ repositoryPath, input, now: currentNow });
      interpretation = validateRepositoryInterpretation({
        schemaVersion: produced?.schemaVersion,
        disposition: produced?.disposition,
        interpretation: produced?.interpretation,
        successorWorld: produced?.successorWorld,
        successorAttestation: produced?.successorAttestation,
      }, {
        repositoryPath,
        currentWorld: input.currentWorld,
        now: currentNow,
      });
      transition = learningTransition(repositoryPath, current, closure, interpretation);
    }
    try {
      const committed = commitTransition(repositoryPath, transition);
      return Object.freeze({
        claimDigest: claim.claimDigest,
        outcomeDigest: claim.outcomeDigest,
        closureDigest: closure.closureDigest,
        state: input.workResult === null
          ? "BLOCKED"
          : outcomeStateForLearning(closure, input.workResult, interpretation),
        transitionDigest: transition.transitionDigest,
        headDigest: committed.head.headDigest,
        disposition: interpretation?.disposition || "ABORTED",
        attempts: attempt,
      });
    } catch (error) {
      if (error?.code !== "MH_WORLD_CONFLICT" || attempt === maxAttempts) throw error;
      // The semantic candidate was bound to the lost predecessor. Discard it completely and
      // re-run repository interpretation from a fresh authoritative World on the next iteration.
    }
  }
  fail("MH_WORLD_CONFLICT", "Closure landing exhausted bounded current-World CAS retries");
}

async function runSessionsConcurrently(repositoryPath, items, {
  env,
  model,
  timeoutSeconds,
  runner,
  onProgress,
} = {}) {
  const promises = items.map(async (item) => {
    try {
      const result = await runWork({
        repositoryPath,
        session: item.session,
        env,
        model,
        timeoutSeconds,
        runner,
        onProgress,
      });
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
  if (staleProposalSet || deferredCapacity > 0 || needsReplan > 0 || running > 0) return landed > 0 ? "PARTIAL" : "REPLAN_REQUIRED";
  return landed > 0 ? "DONE" : "REPLAN_REQUIRED";
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
  const bound = localExecutionBound(env);
  const recovered = orderedClaims(listActiveOutcomeClaims(repositoryPath))
    .map((claim) => recoverClaimCommitment(repositoryPath, claim, { now: now() }));
  const recoveredExecutable = recovered.filter((entry) => entry.type === "EXECUTABLE");
  const selectedRecovered = recoveredExecutable.slice(0, bound);
  const deferredCapacity = Math.max(0, recoveredExecutable.length - selectedRecovered.length);
  const runningElsewhere = recovered.filter((entry) => entry.type === "RUNNING_ELSEWHERE");

  const current = readCurrentWorldState(repositoryPath, { now: now() });
  let proposalSet = null;
  let proposalIssue = null;
  try {
    proposalSet = loadRepoProposalSet(repositoryPath, current);
  } catch (error) {
    if (!String(error?.code || "").startsWith("MH_REPO_PROPOSAL_")) throw error;
    // Mutable proposals are refill input, never continuity authority. Missing/stale/invalid
    // proposal bytes cannot cancel already-durable Claim commitments.
    proposalIssue = error;
  }
  const executable = selectedRecovered.map((entry) => ({
    claim: entry.claim,
    session: entry.session,
    source: "RECOVERED",
  }));
  let availableSlots = Math.max(0, bound - executable.length);
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

  const executions = await runSessionsConcurrently(repositoryPath, executable, {
    env,
    model,
    timeoutSeconds,
    runner,
    onProgress,
  });

  const executionStates = [];
  for (const execution of executions) {
    if (execution.status === "rejected") {
      executionStates.push({
        claimDigest: execution.item.claim.claimDigest,
        outcomeDigest: execution.item.claim.outcomeDigest,
        state: "BLOCKED",
        error: execution.error,
      });
    }
  }
  for (const running of runningElsewhere) {
    executionStates.push({
      claimDigest: running.claim.claimDigest,
      outcomeDigest: running.claim.outcomeDigest,
      state: "RUNNING_ELSEWHERE",
    });
  }

  const landingClaims = orderedClaims(listActiveOutcomeClaims(repositoryPath));
  const landingStates = [];
  for (const claim of landingClaims) {
    let closure = closureForClaim(repositoryPath, claim);
    if (!closure) {
      const recoveredAfterExecution = recoverClaimCommitment(repositoryPath, claim, { now: now() });
      if (recoveredAfterExecution.type === "CLOSURE") closure = recoveredAfterExecution.closure;
    }
    if (!closure) continue;
    landingStates.push(landOutcomeClosure({
      repositoryPath,
      claim,
      closure,
      interpret,
      now,
    }));
  }

  const landedClaims = new Set(landingStates.map((entry) => entry.claimDigest));
  const states = [
    ...landingStates,
    ...executionStates.filter((entry) => !landedClaims.has(entry.claimDigest)),
  ];
  const emptyProposals = !proposalSet || proposalSet.value.proposals.length === 0;
  staleProposalSet = staleProposalSet || Boolean(proposalIssue);
  const outcome = aggregateOutcome(states, { emptyProposals, staleProposalSet, deferredCapacity });
  return Object.freeze({
    schemaVersion: "repo-work-wave-result/v1",
    outcome,
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
