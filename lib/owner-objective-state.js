"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { withRepositoryLock } = require("./repository-lock");
const { protocolRoot } = require("./protocol-store");

const OWNER_OBJECTIVE_STATE_SCHEMA = "owner-objective-state/v1";
const OWNER_OBJECTIVE_STATE_SOURCE_SCHEMA = "owner-objective-state/v2";
const MAX_OWNER_OBJECTIVE_BYTES = 128 * 1024;
const OWNER_OBJECTIVE_FILE = "owner-objective.json";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function digestContent(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function objectivePath(repositoryPath) {
  return path.join(protocolRoot(repositoryPath), OWNER_OBJECTIVE_FILE);
}

function validateOwnerObjectiveState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective state must be an object");
  }
  const actual = Object.keys(value).sort();
  const legacyExpected = ["schemaVersion", "revision", "content", "contentDigest"].sort();
  const sourceExpected = ["schemaVersion", "revision", "content", "contentDigest", "ingressDigest"].sort();
  const sourceBound = value.schemaVersion === OWNER_OBJECTIVE_STATE_SOURCE_SCHEMA;
  const expected = sourceBound ? sourceExpected : legacyExpected;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective state has missing or unexpected fields", { actual, expected });
  }
  if (value.schemaVersion !== OWNER_OBJECTIVE_STATE_SCHEMA && !sourceBound) {
    fail("MH_OWNER_OBJECTIVE_STATE", `owner objective state schema must be ${OWNER_OBJECTIVE_STATE_SCHEMA} or ${OWNER_OBJECTIVE_STATE_SOURCE_SCHEMA}`);
  }
  if (sourceBound && !isDigest(value.ingressDigest)) {
    fail("MH_OWNER_OBJECTIVE_STATE", "source-bound owner objective ingressDigest must be sha256:<hex>");
  }
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective revision must be a positive integer");
  }
  if (typeof value.content !== "string" || value.content.trim() === "") {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective content must be a non-empty string");
  }
  const bytes = Buffer.from(value.content, "utf8");
  if (bytes.byteLength > MAX_OWNER_OBJECTIVE_BYTES) {
    fail("MH_OWNER_OBJECTIVE_STATE", `owner objective content exceeds ${MAX_OWNER_OBJECTIVE_BYTES} bytes`);
  }
  const expectedDigest = digestContent(bytes);
  if (value.contentDigest !== expectedDigest) {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective contentDigest does not match exact content bytes");
  }
  return Object.freeze({ ...value });
}

function readOwnerObjectiveState(repositoryPath, { optional = true } = {}) {
  const filePath = objectivePath(repositoryPath);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_OWNER_OBJECTIVE_STATE", `owner objective state is unreadable: ${error.message}`);
  }
  return validateOwnerObjectiveState(value);
}

function writeObjectiveAtomic(repositoryPath, state) {
  const filePath = objectivePath(repositoryPath);
  const tempPath = path.join(
    path.dirname(filePath),
    `.tmp.owner-objective.${process.pid}.${Date.now()}.${crypto.randomUUID()}.json`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    fail("MH_OWNER_OBJECTIVE_WRITE", `cannot stage owner objective state: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    fail("MH_OWNER_OBJECTIVE_WRITE", `cannot replace owner objective state: ${error.message}`);
  }
  return state;
}

function withObjectiveLock(repositoryPath, operation) {
  return withRepositoryLock(repositoryPath, "owner-objective", operation);
}

function replaceOwnerObjectiveState(repositoryPath, content, { ingressDigest = null } = {}) {
  if (typeof content !== "string" || content.trim() === "") {
    fail("MH_OWNER_OBJECTIVE_VALUE", "owner objective must be a non-empty application-level string");
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > MAX_OWNER_OBJECTIVE_BYTES) {
    fail("MH_OWNER_OBJECTIVE_VALUE", `owner objective exceeds ${MAX_OWNER_OBJECTIVE_BYTES} bytes`);
  }
  if (ingressDigest !== null && !isDigest(ingressDigest)) {
    fail("MH_OWNER_OBJECTIVE_VALUE", "owner objective ingressDigest must be sha256:<hex>");
  }
  return withObjectiveLock(repositoryPath, () => {
    const previous = readOwnerObjectiveState(repositoryPath, { optional: true });
    if (ingressDigest !== null && previous?.ingressDigest === ingressDigest) {
      if (previous.content !== content || previous.contentDigest !== digestContent(bytes)) {
        fail("MH_OWNER_OBJECTIVE_STATE", "existing objective ingress identity is bound to different objective content");
      }
      return previous;
    }
    const state = validateOwnerObjectiveState({
      schemaVersion: ingressDigest === null ? OWNER_OBJECTIVE_STATE_SCHEMA : OWNER_OBJECTIVE_STATE_SOURCE_SCHEMA,
      revision: (previous?.revision || 0) + 1,
      content,
      contentDigest: digestContent(bytes),
      ...(ingressDigest === null ? {} : { ingressDigest }),
    });
    return writeObjectiveAtomic(repositoryPath, state);
  });
}

function clearOwnerObjectiveState(repositoryPath, { expectedRevision = null } = {}) {
  if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    fail("MH_OWNER_OBJECTIVE_STALE", "expected owner objective revision must be a positive integer");
  }
  return withObjectiveLock(repositoryPath, () => {
    const current = readOwnerObjectiveState(repositoryPath, { optional: true });
    if (!current) return false;
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      fail("MH_OWNER_OBJECTIVE_STALE", "owner objective changed before terminal settlement", {
        expected: expectedRevision,
        actual: current.revision,
      });
    }
    try {
      fs.unlinkSync(objectivePath(repositoryPath));
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      fail("MH_OWNER_OBJECTIVE_WRITE", `cannot clear settled owner objective state: ${error.message}`);
    }
    return true;
  });
}

function currentOwnerObjectiveRevision(repositoryPath) {
  return readOwnerObjectiveState(repositoryPath, { optional: true })?.revision || 0;
}

function assertOwnerObjectiveRevision(repositoryPath, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    fail("MH_OWNER_OBJECTIVE_STALE", "expected owner objective revision must be a non-negative integer");
  }
  const actualRevision = currentOwnerObjectiveRevision(repositoryPath);
  if (actualRevision !== expectedRevision) {
    fail("MH_OWNER_OBJECTIVE_STALE", "planner candidate owner objective revision is stale", {
      expected: expectedRevision,
      actual: actualRevision,
    });
  }
  return actualRevision;
}

module.exports = {
  MAX_OWNER_OBJECTIVE_BYTES,
  OWNER_OBJECTIVE_FILE,
  OWNER_OBJECTIVE_STATE_SCHEMA,
  OWNER_OBJECTIVE_STATE_SOURCE_SCHEMA,
  assertOwnerObjectiveRevision,
  clearOwnerObjectiveState,
  currentOwnerObjectiveRevision,
  objectivePath,
  readOwnerObjectiveState,
  replaceOwnerObjectiveState,
  validateOwnerObjectiveState,
};
