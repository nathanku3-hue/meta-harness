"use strict";

const { readExecutionWorkResult, validateExecutionClosure } = require("./execution-closure");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const { readOutcomeClaim } = require("./outcome-claim");
const { readIntegrationHead } = require("./optimistic-integration");
const { readForwardMotionProof, readWorkerStop } = require("./work-forward-motion-record");
const {
  REPO_CLOSURE_INTERPRETATION_SCHEMA,
  runRepositoryClosureInterpreter,
  validateRepositoryInterpretation,
} = require("./repo-closure-interpreter");
const {
  discardProductIntegration,
  finalizeProductIntegration,
  landedProductIntegrationForClosure,
  latestIntegrationReceiptForProductCommit,
  prepareProductIntegration,
  publishProductIntegration,
} = require("./repo-product-integration");
const { runGit } = require("./work-git");
const { persistImmutableBytes, persistImmutableJson, readImmutableJson } = require("./world-authority");
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
  const outcome = readOutcome(repositoryPath, closure.origin.outcomeDigest);
  const commitment = claim || Object.freeze({
    schemaVersion: "repo-run-commitment/v1",
    claimDigest: null,
    outcomeDigest: closure.origin.outcomeDigest,
    continuesFromTransitionDigests: Object.freeze([...(closure.origin.continuesFromTransitionDigests || [])]),
  });
  const workResult = closure.workResultDigest === null
    ? null
    : readExecutionWorkResult(repositoryPath, closure.workResultDigest);
  if (closure.workResultDigest !== null
      && (!workResult || workResult.workResultDigest !== closure.workResultDigest)) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "run durable work result cannot be resolved exactly for current semantic projection interpretation");
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
    claim: commitment,
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
  if (interpretation.disposition === "REPLAN_REQUIRED") return "REPLAN_REQUIRED";
  if (workResult?.result?.outcome === "DONE") return "LANDED";
  return "REPLAN_REQUIRED";
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
  if (replanned.disposition !== "REPLAN_REQUIRED") {
    fail("MH_PRODUCT_INTEGRATION_REPLAN", "repository interpreter must classify controller-proven integration failure as REPLAN_REQUIRED");
  }
  return replanned;
}

function productCommitIsAncestor(repositoryPath, ancestor, descendant) {
  if (ancestor === descendant) return true;
  return runGit(repositoryPath, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}

function nextProductCommit(repositoryPath, projectedCommit, publishedCommit) {
  const result = String(runGit(repositoryPath, [
    "rev-list", "--first-parent", "--ancestry-path", "--reverse", `${projectedCommit}..${publishedCommit}`,
  ]).stdout || "").trim();
  return result ? result.split(/\r?\n/u)[0] : null;
}

function integrationClosure(repositoryPath, receipt) {
  const closure = validateExecutionClosure(
    readImmutableJson(repositoryPath, "execution-closures", receipt.closureDigest),
  );
  if (closure.closureDigest !== receipt.closureDigest || closure.workResultDigest !== receipt.workResultDigest) {
    fail("MH_PRODUCT_PROJECTION_EVIDENCE", "landed integration receipt does not resolve to its exact execution closure");
  }
  return closure;
}

function integrationClaim(repositoryPath, closure) {
  if (closure.origin.type !== "REPO_OUTCOME") return null;
  return readOutcomeClaim(repositoryPath, closure.origin.claimDigest);
}

function reconcileLandedProductProjection({
  repositoryPath,
  interpret = runRepositoryClosureInterpreter,
  now = () => new Date(),
  maxConflicts = MAX_LANDING_ATTEMPTS,
} = {}) {
  let projected = 0;
  let conflicts = 0;
  while (true) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    if (current.head.schemaVersion !== "world-head/v2") {
      fail("MH_PRODUCT_HEAD_REQUIRED", "landed product projection requires current world-head/v2 semantic facts");
    }
    const publishedCommit = readIntegrationHead(repositoryPath);
    if (current.head.productCommit === publishedCommit) {
      return Object.freeze({ state: "CURRENT", projected, head: current.head, productCommit: publishedCommit });
    }
    if (!productCommitIsAncestor(repositoryPath, current.head.productCommit, publishedCommit)) {
      fail("MH_PRODUCT_PROJECTION_DIVERGED", "semantic projection product commit is not an ancestor of the Git product head", {
        projectedProductCommit: current.head.productCommit,
        publishedProductCommit: publishedCommit,
      });
    }
    const nextCommit = nextProductCommit(repositoryPath, current.head.productCommit, publishedCommit);
    if (!nextCommit) {
      fail("MH_PRODUCT_PROJECTION_EVIDENCE", "Git product history advanced without a resolvable next product commit");
    }
    const receipt = latestIntegrationReceiptForProductCommit(repositoryPath, nextCommit);
    if (!receipt || receipt.predecessorProductCommit !== current.head.productCommit) {
      fail("MH_PRODUCT_PROJECTION_EVIDENCE", "landed Git product commit lacks exact integration evidence for semantic projection", {
        predecessorProductCommit: current.head.productCommit,
        integratedCommit: nextCommit,
      });
    }
    const closure = integrationClosure(repositoryPath, receipt);
    const claim = integrationClaim(repositoryPath, closure);
    const input = landingInput(repositoryPath, current, claim, closure);
    const interpretation = validatedInterpretation(
      repositoryPath,
      current,
      interpret({ repositoryPath, input, now: currentNow }),
      currentNow,
    );
    const transition = learningTransition(repositoryPath, current, closure, interpretation, {
      integrationDigest: receipt.integrationDigest,
      successorProductCommit: receipt.integratedCommit,
    });
    try {
      commitTransition(repositoryPath, transition);
      projected += 1;
      conflicts = 0;
    } catch (error) {
      if (error?.code !== "MH_WORLD_CONFLICT" || conflicts + 1 >= maxConflicts) throw error;
      conflicts += 1;
    }
  }
}

function projectedTransitionForIntegration(repositoryPath, currentHead, integrationDigest) {
  let head = currentHead;
  const seen = new Set();
  while (head) {
    if (seen.has(head.headDigest)) {
      fail("MH_PRODUCT_PROJECTION_EVIDENCE", "semantic projection lineage contains a cycle");
    }
    seen.add(head.headDigest);
    const transition = readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest);
    if (transition.cause?.integrationDigest === integrationDigest) {
      return Object.freeze({ head, transition });
    }
    if (!transition.predecessorHeadDigest) return null;
    head = readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest);
  }
  return null;
}

function settleLandedPublication({
  repositoryPath,
  claim,
  closure,
  receipt,
  input,
  interpret,
  now,
  maxAttempts,
  attempt,
}) {
  let projection = null;
  let projectionError = null;
  try {
    projection = reconcileLandedProductProjection({
      repositoryPath,
      interpret,
      now,
      maxConflicts: maxAttempts,
    });
  } catch (error) {
    projectionError = Object.freeze({
      code: String(error?.code || "ERROR"),
      message: String(error?.message || error),
    });
  }
  const semanticEvent = readCurrentWorldState(repositoryPath, { now: now() });
  const projected = projectedTransitionForIntegration(
    repositoryPath,
    semanticEvent.head,
    receipt.integrationDigest,
  );
  return Object.freeze({
    claimDigest: claim?.claimDigest || null,
    outcomeDigest: closure.origin.outcomeDigest,
    closureDigest: closure.closureDigest,
    state: "LANDED",
    transitionDigest: projected?.transition?.transitionDigest || null,
    integrationDigest: receipt.integrationDigest,
    productCommit: receipt.integratedCommit,
    headDigest: projection?.head?.headDigest || semanticEvent.head.headDigest,
    disposition: projectionError ? "PENDING_PROJECTION" : "APPLIED",
    repairContext: null,
    observableResult: input.workResult?.result?.observableResult || null,
    ownerRequest: null,
    attempts: attempt,
    semanticProjection: projectionError ? "PENDING" : "APPLIED",
    projectionError,
  });
}

function semanticOnlyLanding({ repositoryPath, claim, closure, interpret, now, maxAttempts }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    const input = landingInput(repositoryPath, current, claim, closure);
    const interpretation = input.workResult === null
      ? null
      : validatedInterpretation(repositoryPath, current, interpret({ repositoryPath, input, now: currentNow }), currentNow);
    const transition = input.workResult === null
      ? abortedTransition(current, closure)
      : learningTransition(repositoryPath, current, closure, interpretation);
    try {
      const committed = commitTransition(repositoryPath, transition);
      return Object.freeze({ current, input, interpretation, transition, committed, attempt });
    } catch (error) {
      if (error?.code !== "MH_WORLD_CONFLICT" || attempt === maxAttempts) throw error;
    }
  }
  fail("MH_WORLD_CONFLICT", "semantic-only landing exhausted bounded projection CAS retries");
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
  const initialNow = now();
  const initialCurrent = readCurrentWorldState(repositoryPath, { now: initialNow });
  if (initialCurrent.head.schemaVersion !== "world-head/v2") {
    fail("MH_PRODUCT_HEAD_REQUIRED", "Outcome landing requires current world-head/v2 semantic facts");
  }
  const initialInput = landingInput(repositoryPath, initialCurrent, claim, closure);
  const publishedHead = readIntegrationHead(repositoryPath, { optional: true });
  const alreadyLanded = publishedHead
    ? landedProductIntegrationForClosure(repositoryPath, closure.closureDigest, publishedHead)
    : null;
  if (alreadyLanded) {
    return settleLandedPublication({
      repositoryPath,
      claim,
      closure,
      receipt: alreadyLanded,
      input: initialInput,
      interpret,
      now,
      maxAttempts,
      attempt: 0,
    });
  }
  if (initialInput.workResult === null || initialInput.workResult.result?.outcome !== "DONE") {
    const landed = semanticOnlyLanding({ repositoryPath, claim, closure, interpret, now, maxAttempts });
    return Object.freeze({
      claimDigest: claim?.claimDigest || null,
      outcomeDigest: closure.origin.outcomeDigest,
      closureDigest: closure.closureDigest,
      state: landed.input.workResult === null ? "EXECUTION_ABORTED" : outcomeStateForLearning(landed.input.workResult, landed.interpretation),
      transitionDigest: landed.transition.transitionDigest,
      integrationDigest: null,
      productCommit: landed.committed.head.productCommit,
      headDigest: landed.committed.head.headDigest,
      disposition: landed.interpretation?.disposition || "ABORTED",
      repairContext: null,
      observableResult: landed.input.workResult?.result?.observableResult || null,
      ownerRequest: null,
      attempts: landed.attempt,
      semanticProjection: "APPLIED",
    });
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentNow = now();
    const current = readCurrentWorldState(repositoryPath, { now: currentNow });
    const input = landingInput(repositoryPath, current, claim, closure);
    const predecessorProductCommit = readIntegrationHead(repositoryPath);
    const integrationCandidate = prepareProductIntegration({
      repositoryPath,
      predecessorProductCommit,
      currentHead: current.head,
      claim,
      closure,
      workResult: input.workResult,
      now: currentNow,
      env,
    });

    if (integrationCandidate.status !== "ACCEPTED") {
      const integrationFailure = Object.freeze({
        reason: integrationCandidate.reason,
        detail: integrationCandidate.detail || "cumulative product integration was rejected",
      });
      const interpretation = integrationReplan({
        repositoryPath, current, claim, closure, candidate: integrationCandidate, interpret, now: currentNow,
      });
      const transition = learningTransition(repositoryPath, current, closure, interpretation);
      try {
        const committed = commitTransition(repositoryPath, transition);
        return Object.freeze({
          claimDigest: claim?.claimDigest || null,
          outcomeDigest: closure.origin.outcomeDigest,
          closureDigest: closure.closureDigest,
          state: "REPLAN_REQUIRED",
          transitionDigest: transition.transitionDigest,
          integrationDigest: null,
          productCommit: committed.head.productCommit,
          headDigest: committed.head.headDigest,
          disposition: interpretation.disposition,
          repairContext: integrationFailure,
          observableResult: input.workResult?.result?.observableResult || null,
          ownerRequest: null,
          attempts: attempt,
          semanticProjection: "APPLIED",
        });
      } catch (error) {
        if (error?.code !== "MH_WORLD_CONFLICT" || attempt === maxAttempts) throw error;
        continue;
      }
    }

    const published = publishProductIntegration(integrationCandidate);
    if (published.state === "CONFLICT") {
      discardProductIntegration(integrationCandidate);
      if (attempt === maxAttempts) {
        fail("MH_PRODUCT_HEAD_CONFLICT", "product publication exhausted bounded Git CAS retries", {
          expectedHead: published.expectedHead,
          observedHead: published.observedHead,
        });
      }
      continue;
    }

    const receipt = integrationCandidate.receipt;
    finalizeProductIntegration(integrationCandidate, receipt.integratedCommit);
    return settleLandedPublication({
      repositoryPath,
      claim,
      closure,
      receipt,
      input,
      interpret,
      now,
      maxAttempts,
      attempt,
    });
  }
  fail("MH_PRODUCT_HEAD_CONFLICT", "run landing exhausted bounded Git product-head CAS retries");
}

module.exports = {
  MAX_LANDING_ATTEMPTS,
  REPO_CLOSURE_LANDING_INPUT_SCHEMA,
  landOutcomeClosure,
  reconcileLandedProductProjection,
};
