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
} = require("./protocol-store");

const WORKER_STOP_SCHEMA = "worker-stop/v1";
const WORKER_STOP_DOMAIN = "meta-harness-worker-stop/v1";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORKER_STOP_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORKER_STOP_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORKER_STOP_VALUE", `${label} must be a non-empty string`);
  }
  return value;
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
    fail("MH_WORKER_STOP_VALUE", "recordWorkerStop requires session, workspace, and AttemptEntry identity");
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

function immutableDigests(repositoryPath) {
  const directory = path.dirname(objectPath(repositoryPath, "worker-stops", `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `sha256:${name.slice(0, 64)}`);
}

function findWorkerStopForGeneration(repositoryPath, sessionDigest, workspaceId, generation) {
  const matches = immutableDigests(repositoryPath)
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
    fail("MH_WORKER_STOP_STALE", "workspace bytes/Git state no longer match the durable worker STOP boundary");
  }
  return record;
}

module.exports = {
  WORKER_STOP_DOMAIN,
  WORKER_STOP_SCHEMA,
  assertWorkerStopBoundaryCurrent,
  computeWorkerStopDigest,
  findWorkerStopForGeneration,
  readWorkerStop,
  recordWorkerStop,
  stopBoundaryEvidence,
  validateBoundary,
  validateWorkerStop,
};
