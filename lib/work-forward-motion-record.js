"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { validateWorkerResult } = require("./worker-result");
const {
  objectPath,
  persistImmutableJson,
  readImmutableJson,
} = require("./world-authority");

const WORKER_STOP_SCHEMA = "worker-stop/v1";
const WORKER_STOP_DOMAIN = "meta-harness-worker-stop/v1";
const FORWARD_MOTION_PROOF_SCHEMA = "forward-motion-proof/v1";
const FORWARD_MOTION_PROOF_DOMAIN = "meta-harness-forward-motion-proof/v1";
const FORWARD_MOTION_DISPOSITIONS = Object.freeze([
  "CONTINUE_WITH_ALTERNATIVE", "REPLAN_REQUIRED", "HARD_BLOCKED", "OWNER_REQUIRED",
]);
const OWNER_AUTHORITY_KINDS = Object.freeze([
  "PRODUCT_TASTE", "SCOPE_EXPANSION", "CREDENTIALS", "PROTECTED_ACCESS",
  "DESTRUCTIVE_ACTION", "PUBLICATION", "MATERIAL_RISK",
]);
const ALTERNATIVE_DISPOSITIONS = Object.freeze(["FAILED", "RULED_OUT", "AVAILABLE"]);
function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_FORWARD_MOTION_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_FORWARD_MOTION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_FORWARD_MOTION_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function stringList(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("MH_FORWARD_MOTION_VALUE", `${label} must contain at least ${min} item(s)`);
  }
  return value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`));
}

function boundaryKeys() {
  return ["head", "branch", "indexDigest", "dirtyManifestDigest", "treeOid"];
}

function validateBoundary(value, label) {
  exactKeys(value, boundaryKeys(), label);
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.head || ""))) {
    fail("MH_WORKER_STOP_BOUNDARY", `${label}.head must be a Git commit oid`);
  }
  if (value.branch !== null && (typeof value.branch !== "string" || value.branch.trim() === "")) {
    fail("MH_WORKER_STOP_BOUNDARY", `${label}.branch must be null or a non-empty branch name`);
  }
  if (!isDigest(value.indexDigest) || !isDigest(value.dirtyManifestDigest)) {
    fail("MH_WORKER_STOP_BOUNDARY", `${label} digest fields must be sha256 digests`);
  }
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.treeOid || ""))) {
    fail("MH_WORKER_STOP_BOUNDARY", `${label}.treeOid must be a Git tree oid`);
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function stopBoundaryEvidence(boundary) {
  return validateBoundary({
    head: boundary.head,
    branch: boundary.branch,
    indexDigest: domainDigest("meta-harness-worker-stop-index/v1", String(boundary.indexDiff || "")),
    dirtyManifestDigest: boundary.dirtyManifestDigest,
    treeOid: boundary.treeOid,
  }, "stopBoundaryEvidence");
}

function workerStopBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.stopDigest;
  return body;
}

function computeWorkerStopDigest(value) {
  return domainDigest(WORKER_STOP_DOMAIN, workerStopBody(value));
}

function validateWorkerStop(value) {
  exactKeys(value, [
    "schemaVersion",
    "sessionDigest",
    "workspaceId",
    "generation",
    "attemptEntryDigest",
    "startBoundary",
    "endBoundary",
    "workerResult",
    "recordedAt",
    "stopDigest",
  ], "workerStop");
  if (value.schemaVersion !== WORKER_STOP_SCHEMA) {
    fail("MH_WORKER_STOP_SCHEMA", `workerStop.schemaVersion must be ${WORKER_STOP_SCHEMA}`);
  }
  if (!isDigest(value.sessionDigest) || !isDigest(value.attemptEntryDigest)) {
    fail("MH_WORKER_STOP_DIGEST", "workerStop session/attempt identity must be sha256 digests");
  }
  nonEmpty(value.workspaceId, "workerStop.workspaceId");
  if (!Number.isInteger(value.generation) || value.generation < 1) {
    fail("MH_WORKER_STOP_VALUE", "workerStop.generation must be a positive integer");
  }
  const startBoundary = validateBoundary(value.startBoundary, "workerStop.startBoundary");
  const endBoundary = validateBoundary(value.endBoundary, "workerStop.endBoundary");
  if (JSON.stringify(startBoundary) !== JSON.stringify(endBoundary)) {
    fail("MH_WORKER_STOP_MUTATION", "worker STOP is valid only when the exact Git-visible workspace boundary is unchanged");
  }
  const workerResult = validateWorkerResult(value.workerResult);
  if (workerResult.status !== "STOP" || workerResult.operations.length !== 0) {
    fail("MH_WORKER_STOP_VALUE", "workerStop must bind a worker-result/v2 STOP with zero operations");
  }
  if (!Number.isFinite(Date.parse(value.recordedAt))) {
    fail("MH_WORKER_STOP_VALUE", "workerStop.recordedAt must be an ISO timestamp");
  }
  if (!isDigest(value.stopDigest) || value.stopDigest !== computeWorkerStopDigest(value)) {
    fail("MH_WORKER_STOP_DIGEST", "workerStop.stopDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function recordWorkerStop({
  repositoryPath,
  session,
  workspace,
  attemptEntry,
  startBoundary,
  endBoundary,
  workerResult,
  now = new Date(),
}) {
  if (!session || !workspace || !attemptEntry) {
    fail("MH_WORKER_STOP_VALUE", "recordWorkerStop requires session, workspace, and AttemptEntry authority");
  }
  if (attemptEntry.sessionDigest !== session.sessionDigest
      || attemptEntry.workspaceId !== workspace.workspaceId
      || attemptEntry.generation !== workspace.generation) {
    fail("MH_WORKER_STOP_IDENTITY", "worker STOP identity does not match the consumed AttemptEntry/workspace generation");
  }
  const body = {
    schemaVersion: WORKER_STOP_SCHEMA,
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    attemptEntryDigest: attemptEntry.entryDigest,
    startBoundary: validateBoundary(startBoundary, "startBoundary"),
    endBoundary: validateBoundary(endBoundary, "endBoundary"),
    workerResult: validateWorkerResult(workerResult),
    recordedAt: now.toISOString(),
  };
  const record = validateWorkerStop({ ...body, stopDigest: computeWorkerStopDigest(body) });
  persistImmutableJson(repositoryPath, "worker-stops", record.stopDigest, record, "MH_WORKER_STOP_WRITE");
  return record;
}

function readWorkerStop(repositoryPath, digest) {
  const value = validateWorkerStop(readImmutableJson(repositoryPath, "worker-stops", digest));
  if (value.stopDigest !== digest) fail("MH_WORKER_STOP_DIGEST", "worker-stop path identity does not match its body");
  return value;
}

function immutableDigests(repositoryPath, kind) {
  const directory = path.dirname(objectPath(repositoryPath, kind, `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `sha256:${name.slice(0, 64)}`);
}

function findWorkerStopForGeneration(repositoryPath, sessionDigest, workspaceId, generation) {
  const matches = immutableDigests(repositoryPath, "worker-stops")
    .map((digest) => readWorkerStop(repositoryPath, digest))
    .filter((record) => record.sessionDigest === sessionDigest
      && record.workspaceId === workspaceId
      && record.generation === generation);
  if (matches.length > 1) fail("MH_WORKER_STOP_CONFLICT", "more than one durable worker STOP exists for one generation");
  return matches[0] || null;
}

function sameBoundary(left, right) {
  return JSON.stringify(validateBoundary(left, "expectedBoundary")) === JSON.stringify(validateBoundary(right, "currentBoundary"));
}

function assertWorkerStopBoundaryCurrent(workerStop, currentBoundary) {
  const record = validateWorkerStop(workerStop);
  if (!sameBoundary(record.endBoundary, currentBoundary)) {
    fail("MH_WORKER_STOP_STALE", "workspace bytes/Git authority no longer match the durable worker STOP boundary");
  }
  return record;
}

function proofBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.proofDigest;
  return body;
}

function computeForwardMotionProofDigest(value) {
  return domainDigest(FORWARD_MOTION_PROOF_DOMAIN, proofBody(value));
}

function validRequiredPath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..")
    && value !== ".git" && !value.startsWith(".git/");
}

function pathWithinAllowed(candidate, allowedPaths) {
  if (!validRequiredPath(candidate)) return false;
  return allowedPaths.some((entry) => entry === "." || candidate === entry || candidate.startsWith(`${entry}/`));
}

function validateAlternative(value, label) {
  exactKeys(value, ["means", "disposition", "evidence", "requiredPaths"], label);
  nonEmpty(value.means, `${label}.means`);
  if (!ALTERNATIVE_DISPOSITIONS.includes(value.disposition)) {
    fail("MH_FORWARD_MOTION_VALUE", `${label}.disposition is invalid`);
  }
  stringList(value.evidence, `${label}.evidence`, { min: 1 });
  if (!Array.isArray(value.requiredPaths) || value.requiredPaths.some((entry) => !validRequiredPath(entry))) {
    fail("MH_FORWARD_MOTION_VALUE", `${label}.requiredPaths must contain valid repository-relative paths`);
  }
  return value;
}

function validateOwnerRequest(value) {
  exactKeys(value, ["kind", "question", "evidence"], "forwardMotionProof.ownerRequest");
  if (!OWNER_AUTHORITY_KINDS.includes(value.kind)) {
    fail("MH_FORWARD_MOTION_OWNER_KIND", "owner request kind is not a constitutional owner-exclusive authority");
  }
  nonEmpty(value.question, "forwardMotionProof.ownerRequest.question");
  stringList(value.evidence, "forwardMotionProof.ownerRequest.evidence", { min: 1 });
  return value;
}

function validateForwardMotionProof(value) {
  exactKeys(value, [
    "schemaVersion",
    "workerStopDigest",
    "disposition",
    "failedMeans",
    "alternatives",
    "hardConstraint",
    "ownerRequest",
    "disprovedAssertions",
    "evaluatedAt",
    "proofDigest",
  ], "forwardMotionProof");
  if (value.schemaVersion !== FORWARD_MOTION_PROOF_SCHEMA || !isDigest(value.workerStopDigest)) {
    fail("MH_FORWARD_MOTION_SCHEMA", `forwardMotionProof must be ${FORWARD_MOTION_PROOF_SCHEMA} and bind one worker STOP digest`);
  }
  if (!FORWARD_MOTION_DISPOSITIONS.includes(value.disposition)) {
    fail("MH_FORWARD_MOTION_VALUE", "forwardMotionProof disposition is invalid");
  }
  if (!Array.isArray(value.failedMeans) || value.failedMeans.length === 0) {
    fail("MH_FORWARD_MOTION_VALUE", "forwardMotionProof.failedMeans must contain at least one failed means record");
  }
  value.failedMeans.forEach((entry, index) => {
    exactKeys(entry, ["means", "evidence"], `forwardMotionProof.failedMeans[${index}]`);
    nonEmpty(entry.means, `forwardMotionProof.failedMeans[${index}].means`);
    stringList(entry.evidence, `forwardMotionProof.failedMeans[${index}].evidence`, { min: 1 });
  });
  if (!Array.isArray(value.alternatives)) fail("MH_FORWARD_MOTION_VALUE", "forwardMotionProof.alternatives must be an array");
  value.alternatives.forEach((entry, index) => validateAlternative(entry, `forwardMotionProof.alternatives[${index}]`));
  if (value.hardConstraint !== null) nonEmpty(value.hardConstraint, "forwardMotionProof.hardConstraint");
  if (value.ownerRequest !== null) validateOwnerRequest(value.ownerRequest);
  stringList(value.disprovedAssertions, "forwardMotionProof.disprovedAssertions");
  const available = value.alternatives.filter((entry) => entry.disposition === "AVAILABLE");
  if (value.disposition === "CONTINUE_WITH_ALTERNATIVE" && (available.length === 0 || value.ownerRequest !== null || value.hardConstraint !== null)) {
    fail("MH_FORWARD_MOTION_VALUE", "CONTINUE_WITH_ALTERNATIVE requires an available alternative and no hard/owner terminal claim");
  }
  if (value.disposition === "REPLAN_REQUIRED" && value.ownerRequest !== null) {
    fail("MH_FORWARD_MOTION_VALUE", "REPLAN_REQUIRED cannot consume owner authority");
  }
  if (value.disposition === "HARD_BLOCKED" && (value.hardConstraint === null || value.ownerRequest !== null || available.length > 0)) {
    fail("MH_FORWARD_MOTION_VALUE", "HARD_BLOCKED requires a hard constraint, no owner request, and no available alternative");
  }
  if (value.disposition === "OWNER_REQUIRED" && (value.ownerRequest === null || available.length > 0)) {
    fail("MH_FORWARD_MOTION_VALUE", "OWNER_REQUIRED requires a typed owner request and no available alternative");
  }
  if (!Number.isFinite(Date.parse(value.evaluatedAt))) {
    fail("MH_FORWARD_MOTION_VALUE", "forwardMotionProof.evaluatedAt must be an ISO timestamp");
  }
  if (!isDigest(value.proofDigest) || value.proofDigest !== computeForwardMotionProofDigest(value)) {
    fail("MH_FORWARD_MOTION_DIGEST", "forwardMotionProof.proofDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function normalizedCandidate(candidate, session) {
  exactKeys(candidate, [
    "disposition",
    "failedMeans",
    "alternatives",
    "hardConstraint",
    "ownerRequest",
    "disprovedAssertions",
  ], "forwardMotionCandidate");
  const cloned = JSON.parse(JSON.stringify(candidate));
  if (!FORWARD_MOTION_DISPOSITIONS.includes(cloned.disposition)) {
    fail("MH_FORWARD_MOTION_VALUE", "forwardMotionCandidate.disposition is invalid");
  }
  if (!Array.isArray(cloned.failedMeans) || cloned.failedMeans.length === 0 || !Array.isArray(cloned.alternatives)
      || !Array.isArray(cloned.disprovedAssertions)) {
    fail("MH_FORWARD_MOTION_VALUE", "forwardMotionCandidate list fields are invalid");
  }
  cloned.failedMeans.forEach((entry, index) => {
    exactKeys(entry, ["means", "evidence"], `forwardMotionCandidate.failedMeans[${index}]`);
    nonEmpty(entry.means, `forwardMotionCandidate.failedMeans[${index}].means`);
    stringList(entry.evidence, `forwardMotionCandidate.failedMeans[${index}].evidence`, { min: 1 });
  });
  cloned.alternatives.forEach((entry, index) => validateAlternative(entry, `forwardMotionCandidate.alternatives[${index}]`));
  stringList(cloned.disprovedAssertions, "forwardMotionCandidate.disprovedAssertions");
  if (cloned.hardConstraint !== null) nonEmpty(cloned.hardConstraint, "forwardMotionCandidate.hardConstraint");

  const invalidAvailable = cloned.alternatives.some((entry) => entry.disposition === "AVAILABLE"
    && entry.requiredPaths.some((candidatePath) => !pathWithinAllowed(candidatePath, session.allowedPaths)));
  if (cloned.ownerRequest !== null) {
    const shapeValid = cloned.ownerRequest && typeof cloned.ownerRequest === "object" && !Array.isArray(cloned.ownerRequest)
      && Object.keys(cloned.ownerRequest).sort().join("\0") === "evidence\0kind\0question"
      && typeof cloned.ownerRequest.question === "string" && cloned.ownerRequest.question.trim() !== ""
      && Array.isArray(cloned.ownerRequest.evidence) && cloned.ownerRequest.evidence.length > 0
      && cloned.ownerRequest.evidence.every((entry) => typeof entry === "string" && entry.trim() !== "");
    if (!shapeValid || !OWNER_AUTHORITY_KINDS.includes(cloned.ownerRequest.kind)) {
      cloned.disprovedAssertions.push(`Rejected unsupported owner authority: ${String(cloned.ownerRequest?.kind || "invalid")}`);
      cloned.ownerRequest = null;
      cloned.hardConstraint = null;
      cloned.disposition = "REPLAN_REQUIRED";
    }
  }
  if (invalidAvailable && cloned.disposition === "CONTINUE_WITH_ALTERNATIVE") {
    cloned.disprovedAssertions.push("Rejected alternative because its required paths exceed the sealed execution boundary.");
    cloned.disposition = "REPLAN_REQUIRED";
    cloned.hardConstraint = null;
    cloned.ownerRequest = null;
  }
  return cloned;
}

function recordForwardMotionProof({ repositoryPath, workerStop, session, candidate, now = new Date() }) {
  const stop = validateWorkerStop(workerStop);
  if (!session || session.sessionDigest !== stop.sessionDigest) {
    fail("MH_FORWARD_MOTION_IDENTITY", "forward-motion proof must evaluate the same sealed session as the worker STOP");
  }
  const normalized = normalizedCandidate(candidate, session);
  const body = {
    schemaVersion: FORWARD_MOTION_PROOF_SCHEMA,
    workerStopDigest: stop.stopDigest,
    disposition: normalized.disposition,
    failedMeans: normalized.failedMeans,
    alternatives: normalized.alternatives,
    hardConstraint: normalized.hardConstraint,
    ownerRequest: normalized.ownerRequest,
    disprovedAssertions: normalized.disprovedAssertions,
    evaluatedAt: now.toISOString(),
  };
  const proof = validateForwardMotionProof({ ...body, proofDigest: computeForwardMotionProofDigest(body) });
  persistImmutableJson(repositoryPath, "forward-motion-proofs", proof.proofDigest, proof, "MH_FORWARD_MOTION_WRITE");
  return proof;
}

function readForwardMotionProof(repositoryPath, digest) {
  const value = validateForwardMotionProof(readImmutableJson(repositoryPath, "forward-motion-proofs", digest));
  if (value.proofDigest !== digest) fail("MH_FORWARD_MOTION_DIGEST", "forward-motion proof path identity does not match its body");
  readWorkerStop(repositoryPath, value.workerStopDigest);
  return value;
}

function findForwardMotionProofForStop(repositoryPath, workerStopDigest) {
  const matches = immutableDigests(repositoryPath, "forward-motion-proofs")
    .map((digest) => readForwardMotionProof(repositoryPath, digest))
    .filter((record) => record.workerStopDigest === workerStopDigest);
  if (matches.length > 1) fail("MH_FORWARD_MOTION_CONFLICT", "more than one forward-motion proof exists for one worker STOP");
  return matches[0] || null;
}

module.exports = {
  ALTERNATIVE_DISPOSITIONS, FORWARD_MOTION_DISPOSITIONS, FORWARD_MOTION_PROOF_DOMAIN,
  FORWARD_MOTION_PROOF_SCHEMA, OWNER_AUTHORITY_KINDS, WORKER_STOP_DOMAIN, WORKER_STOP_SCHEMA,
  assertWorkerStopBoundaryCurrent, computeForwardMotionProofDigest, computeWorkerStopDigest,
  findForwardMotionProofForStop, findWorkerStopForGeneration, readForwardMotionProof, readWorkerStop,
  recordForwardMotionProof, recordWorkerStop, stopBoundaryEvidence, validateBoundary,
  validateForwardMotionProof, validateWorkerStop,
};
