"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { validateExecutionClosure, validateExecutionWorkResult } = require("./execution-closure");
const { readOutcome } = require("./outcome");
const { pinProductDirection } = require("./product-direction");
const { readForwardMotionProof, readWorkerStop } = require("./work-forward-motion-record");
const { readImmutableBytes, readImmutableJson } = require("./world-authority");
const { validateWorldHead, validateWorldTransition } = require("./world-transition");

const REPO_PLANNER_INPUT_SCHEMA = "repo-planner-input/v1";
const REPO_CHARTER_DOMAIN = "meta-harness-repo-charter-bytes/v2";
const REPO_CHARTER_RELATIVE_PATH = path.join(".meta-harness", "repo-charter.json");
const OWNER_DIRECTIVE_RELATIVE_PATH = path.join(".meta-harness", "owner-directive.md");
const MAX_CONTROL_BYTES = 512 * 1024;
const MAX_OWNER_DIRECTIVE_BYTES = 128 * 1024;
const UNRESOLVED_DISPOSITIONS = new Set(["REPLAN_REQUIRED", "INVALIDATED_REPLAN", "BLOCKED", "OWNER_REQUIRED"]);

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

function ownerDirective(repositoryPath) {
  const bytes = readRegularBytes(repositoryPath, OWNER_DIRECTIVE_RELATIVE_PATH, {
    optional: true,
    maxBytes: MAX_OWNER_DIRECTIVE_BYTES,
  });
  if (!bytes) return null;
  return Object.freeze({
    content: bytes.toString("utf8"),
    digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  });
}

function commitmentState(entry) {
  if (entry.type === "CLOSURE") return "closure_awaiting_landing";
  if (entry.type === "RUNNING_ELSEWHERE") return "running_elsewhere";
  if (entry.type === "EXECUTABLE" && entry.continuation === "PENDING_WORKSPACE") return "pending";
  return "executable";
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
  if (transition.cause.type === "ATTEMPT_ABORTED" || !workResult) return "BLOCKED";
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
      if (closure.origin.type === "REPO_OUTCOME" && !seen.has(closure.origin.outcomeDigest)) {
        seen.add(closure.origin.outcomeDigest);
        if (!activeOutcomeDigests.has(closure.origin.outcomeDigest)) {
          const workResult = workResultForClosure(repositoryPath, closure);
          const interpretation = interpretationForTransition(repositoryPath, transition);
          const projected = projectHandoff(repositoryPath, transition, closure, workResult, interpretation);
          if (UNRESOLVED_DISPOSITIONS.has(projected.disposition)) handoffs.push(projected);
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

function compileRepoPlannerInput({ repositoryPath, current, recovered, localBound }) {
  if (!current?.head || current.head.schemaVersion !== "world-head/v2") {
    fail("MH_PLANNER_INPUT_WORLD", "logical planning requires authoritative world-head/v2");
  }
  const productDirection = pinProductDirection(repositoryPath);
  if (current.world.productDirectionDigest !== productDirection.digest) {
    fail("MH_PLANNER_PRODUCT_DIRECTION_STALE", "authoritative World does not match live owner-authored PRODUCT.md");
  }
  const activeCommitments = projectActiveCommitments(repositoryPath, recovered);
  const activeOutcomeDigests = new Set(activeCommitments.map((entry) => entry.outcomeDigest));
  const occupiedSlots = recovered.filter((entry) => entry.type === "EXECUTABLE").length;
  return Object.freeze({
    schemaVersion: REPO_PLANNER_INPUT_SCHEMA,
    productDirection,
    head: Object.freeze({
      headDigest: current.head.headDigest,
      productCommit: current.head.productCommit,
    }),
    currentWorld: current.world,
    repoCharterDigest: repoCharterDigest(repositoryPath),
    ownerDirective: ownerDirective(repositoryPath),
    capacity: Object.freeze({
      localBound,
      occupiedSlots,
      availableSlots: Math.max(0, localBound - occupiedSlots),
    }),
    activeCommitments,
    unresolvedHandoffs: latestUnresolvedHandoffs(repositoryPath, current, activeOutcomeDigests),
  });
}

module.exports = {
  OWNER_DIRECTIVE_RELATIVE_PATH,
  REPO_CHARTER_RELATIVE_PATH,
  REPO_PLANNER_INPUT_SCHEMA,
  compileRepoPlannerInput,
  latestUnresolvedHandoffs,
  ownerDirective,
  projectActiveCommitments,
  repoCharterDigest,
  repoPlannerEnabled,
};
