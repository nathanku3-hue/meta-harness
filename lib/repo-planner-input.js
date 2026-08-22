"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { validateExecutionClosure, validateExecutionWorkResult } = require("./execution-closure");
const { readOutcome } = require("./outcome");
const { readOutcomeClaim } = require("./outcome-claim");
const { readOwnerObjectiveState } = require("./owner-objective-state");
const { compileSemanticAuthority } = require("./semantic-authority");
const { pinProductDirection, projectProductDirectionForPlanner } = require("./product-direction");
const { projectCurrentPromotedResearch } = require("./repo-research-promotion");
const { readForwardMotionProof, readWorkerStop } = require("./work-forward-motion-record");
const { readImmutableBytes, readImmutableJson } = require("./world-authority");
const { validateWorldHead, validateWorldTransition } = require("./world-transition");

const REPO_PLANNER_INPUT_SCHEMA = "repo-planner-input/v3";
const REPO_CHARTER_DOMAIN = "meta-harness-repo-charter-bytes/v2";
const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");
const MAX_CONTROL_BYTES = 512 * 1024;
const AUTONOMOUS_CONTINUATION_DISPOSITIONS = new Set(["REPLAN_REQUIRED", "INVALIDATED_REPLAN", "EXECUTION_ABORTED"]);
const UNRESOLVED_DISPOSITIONS = new Set([...AUTONOMOUS_CONTINUATION_DISPOSITIONS, "BLOCKED", "OWNER_REQUIRED"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function readRegularBytes(repositoryPath, relativePath, { optional = false, maxBytes = MAX_CONTROL_BYTES } = {}) {
  const filePath = path.resolve(repositoryPath, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_PLANNER_INPUT_READ", `${relativePath} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    fail("MH_PLANNER_INPUT_READ", `${relativePath} must be a regular non-symlink file no larger than ${maxBytes} bytes`);
  }
  return fs.readFileSync(filePath);
}

function repoPlannerEnabled(repositoryPath) {
  const charterPath = path.resolve(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  try {
    const stat = fs.lstatSync(charterPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("MH_PLANNER_INPUT_READ", `repo charter is unreadable: ${error.message}`);
  }
}

function repoCharterDigest(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, REPO_CHARTER_RELATIVE_PATH);
  return domainDigest(REPO_CHARTER_DOMAIN, { content: bytes.toString("utf8") });
}

function ownerIntent(repositoryPath, productDirection) {
  const objective = readOwnerObjectiveState(repositoryPath, { optional: true });
  return Object.freeze({
    productFrame: projectProductDirectionForPlanner(productDirection),
    activeDirective: objective ? Object.freeze({
      revision: objective.revision,
      content: objective.content,
      contentDigest: objective.contentDigest,
    }) : null,
  });
}

function commitmentState(entry) {
  if (entry.type === "CLOSURE") return "closure_awaiting_landing";
  if (entry.type === "RUNNING_ELSEWHERE") return "running_elsewhere";
  if (entry.type === "EXECUTABLE" && entry.continuation === "PENDING_WORKSPACE") return "pending";
  return "executable";
}

function projectConstraintImpact(repositoryPath, current) {
  const source = current?.world?.payload?.constraints || [];
  if (!Array.isArray(source)) return Object.freeze([]);
  return Object.freeze(source.map((constraint) => Object.freeze({
    id: constraint.id || null,
    blocks: Object.freeze([...(constraint.blocks || [])]),
    doesNotBlock: Object.freeze([...(constraint.doesNotBlock || [])]),
    valueOfWaiting: constraint.valueOfWaiting || null,
  })));
}

function projectObjectMaturity(current) {
  const frozenObjectDigest = current?.world?.payload?.frozenObjectDigest || null;
  return Object.freeze({
    frozen: typeof frozenObjectDigest === "string" && frozenObjectDigest.length > 0,
    frozenObjectDigest,
  });
}

function projectActiveCommitments(repositoryPath, recovered) {
  return Object.freeze(recovered.map((entry) => {
    const outcome = readOutcome(repositoryPath, entry.claim.outcomeDigest);
    return Object.freeze({
      outcomeDigest: outcome.outcomeDigest,
      claimDigest: entry.claim.claimDigest,
      outcome: Object.freeze({
        id: outcome.id,
        desiredState: outcome.desiredState,
        preconditions: Object.freeze([...outcome.preconditions]),
        evidenceRequirement: outcome.evidenceRequirement,
      }),
      grantedWritePaths: Object.freeze([...entry.claim.executionBoundary.writePaths]),
      continuesFromTransitionDigests: Object.freeze([...entry.claim.continuesFromTransitionDigests]),
      state: commitmentState(entry),
      relevantPreconditions: Object.freeze([...outcome.preconditions]),
    });
  }));
}

function interpretationForTransition(repositoryPath, transition) {
  if (transition.cause.type !== "ATTEMPT_LEARNING") return null;
  try {
    return JSON.parse(readImmutableBytes(repositoryPath, "interpretations", transition.cause.interpretationDigest).toString("utf8"));
  } catch (error) {
    fail("MH_PLANNER_INPUT_INTERPRETATION", `authoritative interpretation is unreadable: ${error.message}`);
  }
}

function workResultForClosure(repositoryPath, closure) {
  if (!closure.workResultDigest) return null;
  const result = validateExecutionWorkResult(readImmutableJson(repositoryPath, "work-results", closure.workResultDigest));
  if (result.workResultDigest !== closure.workResultDigest) {
    fail("MH_PLANNER_INPUT_WORK_RESULT", "work-result digest does not match immutable identity");
  }
  return result;
}

function learningDisposition(transition, workResult, interpretation) {
  if (transition.cause.type === "ATTEMPT_ABORTED") return "EXECUTION_ABORTED";
  if (!workResult) return "BLOCKED";
  if (interpretation?.disposition === "INVALIDATED_REPLAN") return "INVALIDATED_REPLAN";
  const outcome = workResult.result?.outcome;
  if (outcome === "DONE" && interpretation?.disposition === "APPLIED") return "LANDED";
  if (UNRESOLVED_DISPOSITIONS.has(outcome)) return outcome;
  return "BLOCKED";
}

function projectHandoff(repositoryPath, transition, closure, workResult, interpretation) {
  const outcome = readOutcome(repositoryPath, closure.origin.outcomeDigest);
  const proofDigest = workResult?.result?.forwardMotionProofDigest || null;
  const proof = proofDigest ? readForwardMotionProof(repositoryPath, proofDigest) : null;
  const stop = proof ? readWorkerStop(repositoryPath, proof.workerStopDigest) : null;
  return Object.freeze({
    outcomeDigest: outcome.outcomeDigest,
    outcome: Object.freeze({
      id: outcome.id,
      desiredState: outcome.desiredState,
      preconditions: Object.freeze([...outcome.preconditions]),
      evidenceRequirement: outcome.evidenceRequirement,
    }),
    disposition: learningDisposition(transition, workResult, interpretation),
    observableResult: workResult?.result?.observableResult || null,
    unsatisfiedRequirement: stop?.workerResult?.stop?.unsatisfiedRequirement || null,
    failedMeans: Object.freeze((proof?.failedMeans || []).map((entry) => Object.freeze({
      means: entry.means,
      evidence: Object.freeze([...entry.evidence]),
    }))),
    viableAlternatives: Object.freeze((proof?.alternatives || [])
      .filter((entry) => entry.disposition === "AVAILABLE")
      .map((entry) => Object.freeze({
        means: entry.means,
        evidence: Object.freeze([...entry.evidence]),
        requiredPaths: Object.freeze([...entry.requiredPaths]),
      }))),
    disprovedAssertions: Object.freeze([...(proof?.disprovedAssertions || [])]),
    validatedOwnerRequiredFact: proof?.disposition === "OWNER_REQUIRED" ? proof.ownerRequest : null,
    closureDigest: closure.closureDigest,
    workResultDigest: closure.workResultDigest,
    forwardMotionProofDigest: proof?.proofDigest || null,
    interpretationDigest: transition.cause.interpretationDigest || null,
    transitionDigest: transition.transitionDigest,
  });
}

function latestUnresolvedHandoffs(repositoryPath, current, activeOutcomeDigests = new Set()) {
  const seen = new Set();
  const handoffs = [];
  const advancedContinuationTransitions = new Set();
  let head = current.head;
  while (head) {
    const transition = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (transition.transitionDigest !== head.lastTransitionDigest) {
      fail("MH_PLANNER_INPUT_LINEAGE", "WorldHead transition identity does not match immutable transition");
    }
    if (["ATTEMPT_LEARNING", "ATTEMPT_ABORTED"].includes(transition.cause.type)) {
      const closure = validateExecutionClosure(
        readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
      );
      if (closure.origin.type === "REPO_OUTCOME") {
        const claim = readOutcomeClaim(repositoryPath, closure.origin.claimDigest);
        for (const digest of claim.continuesFromTransitionDigests) advancedContinuationTransitions.add(digest);
        if (!seen.has(closure.origin.outcomeDigest)) {
          seen.add(closure.origin.outcomeDigest);
          if (!activeOutcomeDigests.has(closure.origin.outcomeDigest)
              && !advancedContinuationTransitions.has(transition.transitionDigest)) {
            const workResult = workResultForClosure(repositoryPath, closure);
            const interpretation = interpretationForTransition(repositoryPath, transition);
            const projected = projectHandoff(repositoryPath, transition, closure, workResult, interpretation);
            if (UNRESOLVED_DISPOSITIONS.has(projected.disposition)) handoffs.push(projected);
          }
        }
      }
    }
    if (transition.predecessorHeadDigest === null) break;
    head = validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
    if (head.headDigest !== transition.predecessorHeadDigest) {
      fail("MH_PLANNER_INPUT_LINEAGE", "predecessor WorldHead identity does not match immutable lineage");
    }
  }
  return Object.freeze(handoffs);
}

function compileRepoPlannerInput({
  repositoryPath,
  current,
  recovered,
  localBound,
  localRunningCount = 0,
  localRunningClaimDigests = [],
}) {
  if (!current?.head || current.head.schemaVersion !== "world-head/v2") {
    fail("MH_PLANNER_INPUT_WORLD", "logical planning requires authoritative world-head/v2");
  }
  const productDirection = pinProductDirection(repositoryPath);
  if (current.world.productDirectionDigest !== productDirection.digest) {
    fail("MH_PLANNER_PRODUCT_DIRECTION_STALE", "authoritative World does not match live owner-authored PRODUCT.md");
  }
  const semanticAuthority = compileSemanticAuthority({ productDirection });
  const activeCommitments = projectActiveCommitments(repositoryPath, recovered);
  const activeOutcomeDigests = new Set(activeCommitments.map((entry) => entry.outcomeDigest));
  const activeContinuationClaims = new Map();
  for (const commitment of activeCommitments) {
    for (const transitionDigest of commitment.continuesFromTransitionDigests) {
      if (!activeContinuationClaims.has(transitionDigest)) activeContinuationClaims.set(transitionDigest, []);
      activeContinuationClaims.get(transitionDigest).push(commitment.claimDigest);
    }
  }
  const unresolvedHandoffs = latestUnresolvedHandoffs(repositoryPath, current, activeOutcomeDigests)
    .map((handoff) => Object.freeze({
      ...handoff,
      activeContinuationClaimDigests: Object.freeze([...(activeContinuationClaims.get(handoff.transitionDigest) || [])].sort()),
    }));
  if (!Number.isInteger(localRunningCount) || localRunningCount < 0 || localRunningCount > localBound) {
    fail("MH_PLANNER_INPUT_CAPACITY", "localRunningCount must be an integer within localBound");
  }
  if (!Array.isArray(localRunningClaimDigests)) {
    fail("MH_PLANNER_INPUT_CAPACITY", "localRunningClaimDigests must be an array");
  }
  const localRunningClaims = new Set(localRunningClaimDigests);
  if (localRunningClaims.size !== localRunningClaimDigests.length || localRunningClaims.size !== localRunningCount) {
    fail("MH_PLANNER_INPUT_CAPACITY", "localRunningClaimDigests must uniquely identify every local running slot");
  }
  const occupiedSlots = localRunningCount + recovered.filter((entry) => (
    entry.type === "EXECUTABLE" && !localRunningClaims.has(entry.claim.claimDigest)
  )).length;
  return Object.freeze({
    schemaVersion: REPO_PLANNER_INPUT_SCHEMA,
    ownerIntent: ownerIntent(repositoryPath, productDirection),
    semanticAuthority,
    head: Object.freeze({
      headDigest: current.head.headDigest,
      productCommit: current.head.productCommit,
    }),
    currentWorld: current.world,
    objectMaturity: projectObjectMaturity(current),
    constraintImpact: projectConstraintImpact(repositoryPath, current),
    activeCommitments,
    unresolvedHandoffs: Object.freeze(unresolvedHandoffs),
    promotedResearch: projectCurrentPromotedResearch({
      repositoryPath,
      productCommit: current.head.productCommit,
    }),
    capacity: Object.freeze({
      localBound,
      occupiedSlots,
      availableSlots: Math.max(0, localBound - occupiedSlots),
    }),
    repoCharterDigest: repoCharterDigest(repositoryPath),
  });
}

module.exports = {
  AUTONOMOUS_CONTINUATION_DISPOSITIONS,
  REPO_CHARTER_RELATIVE_PATH,
  REPO_PLANNER_INPUT_SCHEMA,
  compileRepoPlannerInput,
  latestUnresolvedHandoffs,
  ownerIntent,
  projectActiveCommitments,
  projectConstraintImpact,
  projectObjectMaturity,
  repoCharterDigest,
  repoPlannerEnabled,
};
