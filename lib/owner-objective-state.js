"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const {
  protocolRoot,
  withWorldAuthorityLock,
} = require("./world-authority");

const OWNER_OBJECTIVE_STATE_SCHEMA = "owner-objective-state/v1";
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
  const expected = ["schemaVersion", "revision", "content", "contentDigest"].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("MH_OWNER_OBJECTIVE_STATE", "owner objective state has missing or unexpected fields", { actual, expected });
  }
  if (value.schemaVersion !== OWNER_OBJECTIVE_STATE_SCHEMA) {
    fail("MH_OWNER_OBJECTIVE_STATE", `owner objective state schema must be ${OWNER_OBJECTIVE_STATE_SCHEMA}`);
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

function withObjectiveAuthorityLock(repositoryPath, operation) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return withWorldAuthorityLock(repositoryPath, operation);
    } catch (error) {
      if (error?.code !== "MH_WORLD_AUTHORITY_BUSY" || attempt === 39) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  fail("MH_WORLD_AUTHORITY_BUSY", "owner objective authority remained busy after bounded contention retry");
}

function replaceOwnerObjectiveState(repositoryPath, content) {
  if (typeof content !== "string" || content.trim() === "") {
    fail("MH_OWNER_OBJECTIVE_VALUE", "owner objective must be a non-empty application-level string");
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > MAX_OWNER_OBJECTIVE_BYTES) {
    fail("MH_OWNER_OBJECTIVE_VALUE", `owner objective exceeds ${MAX_OWNER_OBJECTIVE_BYTES} bytes`);
  }
  return withObjectiveAuthorityLock(repositoryPath, () => {
    const previous = readOwnerObjectiveState(repositoryPath, { optional: true });
    const state = validateOwnerObjectiveState({
      schemaVersion: OWNER_OBJECTIVE_STATE_SCHEMA,
      revision: (previous?.revision || 0) + 1,
      content,
      contentDigest: digestContent(bytes),
    });
    return writeObjectiveAtomic(repositoryPath, state);
  });
}

function currentOwnerObjectiveRevision(repositoryPath) {
  return readOwnerObjectiveState(repositoryPath, { optional: true })?.revision || 0;
}

function assertOwnerObjectiveRevision(repositoryPath, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    fail("MH_OUTCOME_CLAIM_STALE_OBJECTIVE", "expected owner objective revision must be a non-negative integer");
  }
  const actualRevision = currentOwnerObjectiveRevision(repositoryPath);
  if (actualRevision !== expectedRevision) {
    fail("MH_OUTCOME_CLAIM_STALE_OBJECTIVE", "planner candidate owner objective revision is stale", {
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
  assertOwnerObjectiveRevision,
  currentOwnerObjectiveRevision,
  objectivePath,
  readOwnerObjectiveState,
  replaceOwnerObjectiveState,
  validateOwnerObjectiveState,
};
