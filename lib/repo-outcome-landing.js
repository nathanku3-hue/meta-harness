"use strict";

const { findExecutionWorkResultForOrigin } = require("./execution-closure");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const { readForwardMotionProof, readWorkerStop } = require("./work-forward-motion-record");
const {
  REPO_CLOSURE_INTERPRETATION_SCHEMA,
  runRepositoryClosureInterpreter,
  validateRepositoryInterpretation,
} = require("./repo-closure-interpreter");
const {
  discardProductIntegration,
  finalizeProductIntegration,
  prepareProductIntegration,
  repairProductHeadRef,
} = require("./repo-product-integration");
const { persistImmutableBytes, persistImmutableJson } = require("./world-authority");
const { computeRepoWorldDigest } = require("./world-attestation");
const {
  WORLD_TRANSITION_SCHEMA,
  commitTransition,
  computeInterpretationDigest,
  computeWorldTransitionDigest,
  readCurrentWorldState,
  validateWorldTransition,
} = require("./world-transition");

const REPO_CLOSURE_LANDING_INPUT_SCHEMA = "repo-closure-landing-input/v1";
const MAX_LANDING_ATTEMPTS = 3;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function landingInput(repositoryPath, current, claim, closure, { integrationFailure = null } = {}) {
  const outcome = readOutcome(repositoryPath, claim.outcomeDigest);
  const workResult = closure.workResultDigest === null
    ? null
    : findExecutionWorkResultForOrigin(repositoryPath, closure.origin);
  if (closure.workResultDigest !== null
      && (!workResult || workResult.workResultDigest !== closure.workResultDigest)) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "Closure durable work result cannot be resolved exactly for current-World interpretation");
  }
  const proofDigest = workResult?.result?.forwardMotionProofDigest || null;
  const forwardMotionProof = proofDigest ? readForwardMotionProof(repositoryPath, proofDigest) : null;
  if (forwardMotionProof) {
    const workerStop = readWorkerStop(repositoryPath, forwardMotionProof.workerStopDigest);
    if (workerStop.sessionDigest !== closure.sessionDigest
        || !closure.attemptEntries.includes(workerStop.attemptEntryDigest)) {
      fail("MH_FORWARD_MOTION_REFERENCE", "forward-motion proof does not belong to the exact admitted Closure/session");
    }
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
    forwardMotionProof,
    integrationFailure,
  });
}

function interpretationBytes(interpretation) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: REPO_CLOSURE_INTERPRETATION_SCHEMA,
    disposition: interpretation.disposition,
    interpretation: interpretation.interpretation,
  }, null, 2)}\n`, "utf8");
}

function learningTransition(repositoryPath, current, closure, interpretation, {
  integrationDigest = null,
  successorProductCommit = current.head.productCommit,
} = {}) {
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
    schemaVersion: WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: current.head.headDigest,
    cause: {
      type: "ATTEMPT_LEARNING",
      executionClosureDigest: closure.closureDigest,
      interpretationDigest,
      integrationDigest,
    },
    successorWorldDigest: worldDigest,
    successorAttestationDigest: interpretation.successorAttestation.attestationDigest,
    successorProductCommit,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function abortedTransition(current, closure) {
  const body = {
    schemaVersion: WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: current.head.headDigest,
    cause: { type: "ATTEMPT_ABORTED", executionClosureDigest: closure.closureDigest },
    successorWorldDigest: current.head.worldDigest,
    successorAttestationDigest: current.head.attestationDigest,
    successorProductCommit: current.head.productCommit,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

function outcomeStateForLearning(workResult, interpretation) {
  if (interpretation.disposition === "INVALIDATED_REPLAN") return "INVALIDATED_REPLAN";
  if (workResult?.result?.outcome === "DONE") return "LANDED";
  if (workResult?.result?.outcome === "OWNER_REQUIRED") return "OWNER_REQUIRED";
  if (workResult?.result?.outcome === "REPLAN_REQUIRED") return "REPLAN_REQUIRED";
  return "BLOCKED";
}

function validatedInterpretation(repositoryPath, current, produced, now) {
  return validateRepositoryInterpretation({
    schemaVersion: produced?.schemaVersion,
    disposition: produced?.disposition,
    interpretation: produced?.interpretation,
    successorWorld: produced?.successorWorld,
    successorAttestation: produced?.successorAttestation,
  }, { repositoryPath, currentWorld: current.world, now });
}

function integrationReplan({ repositoryPath, current, claim, closure, candidate, interpret, now }) {
  const failureInput = landingInput(repositoryPath, current, claim, closure, {
    integrationFailure: {
      reason: candidate.reason,
      detail: candidate.detail || "cumulative product integration was rejected",
    },
  });
  discardProductIntegration(candidate);
  const replanned = validatedInterpretation(
    repositoryPath,
    current,
    interpret({ repositoryPath, input: failureInput, now }),
    now,
  );
  if (replanned.disposition !== "INVALIDATED_REPLAN") {
    fail("MH_PRODUCT_INTEGRATION_REPLAN", "repository interpreter must classify controller-proven integration failure as INVALIDATED_REPLAN");
  }
  return replanned;
}

function landOutcomeClosure({
  repositoryPath,
  claim,
  closure,
  interpret = runRepositoryClosureInterpreter,
  now = () => new Date(),
  maxAttempts = MAX_LANDING_ATTEMPTS,
  env = process.env,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    if (current.head.schemaVersion !== "world-head/v2") {
      fail("MH_PRODUCT_HEAD_REQUIRED", "Outcome landing requires current world-head/v2 product authority");
    }
    const input = landingInput(repositoryPath, current, claim, closure);
    let interpretation = null;
    let integrationCandidate = null;
    let transition;

    if (input.workResult === null) {
      transition = abortedTransition(current, closure);
    } else {
      interpretation = validatedInterpretation(
        repositoryPath,
        current,
        interpret({ repositoryPath, input, now: currentNow }),
        currentNow,
      );
      if (input.workResult.result?.outcome === "DONE" && interpretation.disposition === "APPLIED") {
        integrationCandidate = prepareProductIntegration({
          repositoryPath,
          predecessorProductCommit: current.head.productCommit,
          currentHead: current.head,
          claim,
          closure,
          workResult: input.workResult,
          now: currentNow,
          env,
        });
        if (integrationCandidate.status === "ACCEPTED") {
          transition = learningTransition(repositoryPath, current, closure, interpretation, {
            integrationDigest: integrationCandidate.receipt.integrationDigest,
            successorProductCommit: integrationCandidate.receipt.integratedCommit,
          });
        } else {
          interpretation = integrationReplan({
            repositoryPath, current, claim, closure, candidate: integrationCandidate, interpret, now: currentNow,
          });
          integrationCandidate = null;
          transition = learningTransition(repositoryPath, current, closure, interpretation);
        }
      } else {
        transition = learningTransition(repositoryPath, current, closure, interpretation);
      }
    }

    try {
      const committed = commitTransition(repositoryPath, transition);
      if (integrationCandidate) finalizeProductIntegration(integrationCandidate, committed.head.productCommit);
      else repairProductHeadRef(repositoryPath, committed.head.productCommit);
      return Object.freeze({
        claimDigest: claim.claimDigest,
        outcomeDigest: claim.outcomeDigest,
        closureDigest: closure.closureDigest,
        state: input.workResult === null ? "EXECUTION_ABORTED" : outcomeStateForLearning(input.workResult, interpretation),
        transitionDigest: transition.transitionDigest,
        integrationDigest: transition.cause.integrationDigest || null,
        productCommit: committed.head.productCommit,
        headDigest: committed.head.headDigest,
        disposition: interpretation?.disposition || "ABORTED",
        ownerRequest: input.forwardMotionProof?.disposition === "OWNER_REQUIRED"
          ? input.forwardMotionProof.ownerRequest
          : null,
        attempts: attempt,
      });
    } catch (error) {
      if (integrationCandidate) discardProductIntegration(integrationCandidate);
      if (error?.code !== "MH_WORLD_CONFLICT" || attempt === maxAttempts) throw error;
    }
  }
  fail("MH_WORLD_CONFLICT", "Closure landing exhausted bounded current-World/product-head CAS retries");
}

module.exports = {
  MAX_LANDING_ATTEMPTS,
  REPO_CLOSURE_LANDING_INPUT_SCHEMA,
  landOutcomeClosure,
};
