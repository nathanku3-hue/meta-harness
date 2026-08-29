"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { validRelativePath } = require("./work-session");

const CANDIDATE_MATERIALIZATION_SCHEMA = "candidate-materialization/v1";
const CANDIDATE_MATERIALIZATION_DOMAIN = "meta-harness-candidate-materialization/v1";
const OID_RE = /^[a-f0-9]{40,64}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function body(value) {
  const result = JSON.parse(JSON.stringify(value));
  delete result.planDigest;
  return result;
}

function computeCandidateMaterializationDigest(value) {
  return domainDigest(CANDIDATE_MATERIALIZATION_DOMAIN, body(value));
}

function validateCandidateMaterialization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization plan must be an object");
  }
  const expected = [
    "schemaVersion",
    "resultRecordDigest",
    "sessionDigest",
    "workspaceId",
    "generation",
    "attemptEntryDigest",
    "baselineTreeOid",
    "targetTreeOid",
    "touchedPaths",
    "createdAt",
    "planDigest",
  ].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization plan has missing or unexpected fields");
  }
  if (value.schemaVersion !== CANDIDATE_MATERIALIZATION_SCHEMA
      || !isDigest(value.resultRecordDigest)
      || !isDigest(value.sessionDigest)
      || typeof value.workspaceId !== "string" || value.workspaceId.trim() === ""
      || !Number.isInteger(value.generation) || value.generation < 1
      || !isDigest(value.attemptEntryDigest)
      || !OID_RE.test(String(value.baselineTreeOid || ""))
      || !OID_RE.test(String(value.targetTreeOid || ""))
      || !Array.isArray(value.touchedPaths)
      || !Number.isFinite(Date.parse(value.createdAt))
      || !isDigest(value.planDigest)) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization plan contains invalid identity values");
  }
  const touchedPaths = [...value.touchedPaths];
  if (touchedPaths.length === 0
      || touchedPaths.some((item) => item === "." || typeof item !== "string" || !validRelativePath(item))
      || new Set(touchedPaths).size !== touchedPaths.length
      || touchedPaths.join("\0") !== [...touchedPaths].sort().join("\0")) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization touchedPaths must be a non-empty sorted unique relative path set");
  }
  if (value.planDigest !== computeCandidateMaterializationDigest(value)) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization plan digest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function planPath(stateDirectory, sessionDigest, workspaceId, generation) {
  const sessionId = String(sessionDigest || "").replace(/^sha256:/u, "");
  if (!/^[a-f0-9]{64}$/u.test(sessionId)
      || typeof workspaceId !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(workspaceId)
      || !Number.isInteger(generation) || generation < 1) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization storage identity is invalid");
  }
  return path.join(
    path.resolve(stateDirectory),
    `${sessionId}.${workspaceId}.generation-${generation}.materialization.json`,
  );
}

function writeCreateOnly(filePath, value) {
  let fd;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function persistCandidateMaterialization({
  stateDirectory,
  resultRecordDigest,
  sessionDigest,
  workspaceId,
  generation,
  attemptEntryDigest,
  baselineTreeOid,
  targetTreeOid,
  touchedPaths,
  now = new Date(),
}) {
  const bodyValue = {
    schemaVersion: CANDIDATE_MATERIALIZATION_SCHEMA,
    resultRecordDigest,
    sessionDigest,
    workspaceId,
    generation,
    attemptEntryDigest,
    baselineTreeOid,
    targetTreeOid,
    touchedPaths: [...new Set(touchedPaths)].sort(),
    createdAt: now.toISOString(),
  };
  const plan = validateCandidateMaterialization({
    ...bodyValue,
    planDigest: computeCandidateMaterializationDigest(bodyValue),
  });
  const filePath = planPath(stateDirectory, sessionDigest, workspaceId, generation);
  try {
    writeCreateOnly(filePath, plan);
    return plan;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      fail("MH_CANDIDATE_MATERIALIZATION_WRITE", `candidate materialization plan could not be persisted: ${error.message}`);
    }
    const existing = readCandidateMaterialization({
      stateDirectory,
      sessionDigest,
      workspaceId,
      generation,
      optional: false,
    });
    if (existing.planDigest !== plan.planDigest) {
      fail("MH_CANDIDATE_MATERIALIZATION_CONFLICT", "generation already has a different durable materialization target");
    }
    return existing;
  }
}

function readCandidateMaterialization({ stateDirectory, sessionDigest, workspaceId, generation, optional = true }) {
  const filePath = planPath(stateDirectory, sessionDigest, workspaceId, generation);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_CANDIDATE_MATERIALIZATION_READ", `candidate materialization plan is unreadable: ${error.message}`);
  }
  const plan = validateCandidateMaterialization(parsed);
  if (plan.sessionDigest !== sessionDigest || plan.workspaceId !== workspaceId || plan.generation !== generation) {
    fail("MH_CANDIDATE_MATERIALIZATION", "candidate materialization path identity does not match its body");
  }
  return plan;
}

module.exports = {
  CANDIDATE_MATERIALIZATION_DOMAIN,
  CANDIDATE_MATERIALIZATION_SCHEMA,
  computeCandidateMaterializationDigest,
  persistCandidateMaterialization,
  planPath,
  readCandidateMaterialization,
  validateCandidateMaterialization,
};
