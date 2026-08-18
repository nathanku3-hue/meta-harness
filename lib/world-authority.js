"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const WORLD_AUTHORITY_LOCK_SCHEMA = "world-authority-lock/v1";
const WORLD_AUTHORITY_LOCK_STALE_MS = 30_000;
const WORKSPACE_EXECUTION_LEASE_STALE_MS = 30_000;
const CURRENT_WORLD_POINTER_SCHEMA = "current-world-pointer/v1";
const REPO_DECISION_SCHEMA = "repo-decision/v3";
const REPO_DECISION_DOMAIN = "meta-harness-repo-decision-bytes/v3";
const ATTEMPT_ENTRY_SCHEMA = "attempt-entry/v1";
const ATTEMPT_ENTRY_DOMAIN = "meta-harness-attempt-entry/v1";
const EXECUTION_CLOSURE_SCHEMA = "execution-closure/v1";
const EXECUTION_WORK_RESULT_SCHEMA = "execution-work-result/v1";
const OBJECT_KINDS = new Set([
  "worlds",
  "attestations",
  "decisions",
  "transitions",
  "heads",
  "interpretations",
  "outcomes",
  "work-results",
  "execution-closures",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORLD_AUTHORITY_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function commonGitDirectory(repositoryPath) {
  const root = path.resolve(nonEmptyString(repositoryPath, "repositoryPath"));
  const dotGit = path.join(root, ".git");
  let stat;
  try {
    stat = fs.lstatSync(dotGit);
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_GIT", `repository .git metadata is unreadable: ${error.message}`);
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) return dotGit;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_WORLD_AUTHORITY_GIT", "repository .git metadata must be a directory or regular gitdir file");
  }
  const match = fs.readFileSync(dotGit, "utf8").trim().match(/^gitdir:\s*(.+)$/iu);
  if (!match) fail("MH_WORLD_AUTHORITY_GIT", "repository .git file does not contain a gitdir identity");
  const gitDir = path.resolve(root, match[1]);
  const commonDirFile = path.join(gitDir, "commondir");
  if (!fs.existsSync(commonDirFile)) return gitDir;
  const commonRelative = fs.readFileSync(commonDirFile, "utf8").trim();
  if (!commonRelative) fail("MH_WORLD_AUTHORITY_GIT", "Git commondir metadata is empty");
  return path.resolve(gitDir, commonRelative);
}

function protocolRoot(repositoryPath) {
  const root = path.join(commonGitDirectory(repositoryPath), "meta-harness", "decision-plane-v2");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function digestStem(digest, label = "digest") {
  if (!isDigest(digest)) fail("MH_WORLD_AUTHORITY_DIGEST", `${label} must be a sha256 digest`);
  return digest.slice("sha256:".length);
}

function objectPath(repositoryPath, kind, digest) {
  if (!OBJECT_KINDS.has(kind)) fail("MH_WORLD_AUTHORITY_KIND", `unknown immutable object kind: ${kind}`);
  const directory = path.join(protocolRoot(repositoryPath), "objects", kind);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${digestStem(digest)}.json`);
}

function attemptEntriesRoot(repositoryPath) {
  const directory = path.join(protocolRoot(repositoryPath), "attempt-entries");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function decisionAttemptDirectory(repositoryPath, decisionDigest) {
  const directory = path.join(attemptEntriesRoot(repositoryPath), digestStem(decisionDigest, "decisionDigest"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function outcomeAttemptDirectory(repositoryPath, claimDigest) {
  const directory = path.join(attemptEntriesRoot(repositoryPath), "outcomes", digestStem(claimDigest, "claimDigest"));
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function ownerAttemptDirectory(repositoryPath, workspaceId) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "owner AttemptEntry workspaceId must be a canonical UUID");
  }
  const directory = path.join(attemptEntriesRoot(repositoryPath), "owner", workspaceId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function attemptEntryPath(repositoryPath, origin, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    fail("MH_ATTEMPT_ENTRY_VALUE", "attempt ordinal must be a positive integer");
  }
  if (origin?.type === "REPO_DECISION") {
    return path.join(decisionAttemptDirectory(repositoryPath, origin.decisionDigest), `${ordinal}.json`);
  }
  if (origin?.type === "REPO_OUTCOME") {
    return path.join(outcomeAttemptDirectory(repositoryPath, origin.claimDigest), `${ordinal}.json`);
  }
  if (origin?.type === "OWNER_GOAL") {
    return path.join(ownerAttemptDirectory(repositoryPath, origin.workspaceId), `${ordinal}.json`);
  }
  fail("MH_ATTEMPT_ENTRY_ORIGIN", "attempt entry origin must be REPO_OUTCOME, REPO_DECISION, or OWNER_GOAL");
}

function writeCreateOnlyBytes(filePath, bytes, code = "MH_WORLD_AUTHORITY_WRITE") {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    return { created: true, path: filePath };
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = fs.readFileSync(filePath);
      if (Buffer.compare(existing, content) !== 0) {
        fail(code, `immutable authority object already exists with different bytes: ${path.basename(filePath)}`);
      }
      return { created: false, path: filePath };
    }
    fail(code, `cannot persist immutable authority object: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeCreateOnlyJson(filePath, value, code) {
  return writeCreateOnlyBytes(filePath, `${JSON.stringify(value, null, 2)}\n`, code);
}

function persistImmutableJson(repositoryPath, kind, digest, value, code) {
  const filePath = objectPath(repositoryPath, kind, digest);
  writeCreateOnlyJson(filePath, value, code);
  return filePath;
}

function persistImmutableBytes(repositoryPath, kind, digest, bytes, code) {
  const filePath = objectPath(repositoryPath, kind, digest);
  writeCreateOnlyBytes(filePath, bytes, code);
  return filePath;
}

function readImmutableBytes(repositoryPath, kind, digest) {
  const filePath = objectPath(repositoryPath, kind, digest);
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_MISSING", `immutable ${kind} object is unreadable: ${error.message}`, { digest });
  }
}

function readImmutableJson(repositoryPath, kind, digest) {
  const bytes = readImmutableBytes(repositoryPath, kind, digest);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object is invalid JSON: ${error.message}`, { digest });
  }
}

function pointerPath(repositoryPath) {
  return path.join(protocolRoot(repositoryPath), "current-world.json");
}

function validatePointer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== "headDigest\0schemaVersion"
      || value.schemaVersion !== CURRENT_WORLD_POINTER_SCHEMA
      || !isDigest(value.headDigest)) {
    fail("MH_WORLD_POINTER", "current-world pointer is invalid");
  }
  return Object.freeze({ ...value });
}

function readCurrentWorldPointer(repositoryPath, { optional = false } = {}) {
  const filePath = pointerPath(repositoryPath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_WORLD_POINTER", `current-world pointer is unreadable: ${error.message}`);
  }
  return validatePointer(parsed);
}

function writePointerAtomic(repositoryPath, expectedHeadDigest, successorHeadDigest) {
  if (expectedHeadDigest !== null && !isDigest(expectedHeadDigest)) {
    fail("MH_WORLD_POINTER", "expected current head must be null or a sha256 digest");
  }
  if (!isDigest(successorHeadDigest)) fail("MH_WORLD_POINTER", "successor head must be a sha256 digest");
  const current = readCurrentWorldPointer(repositoryPath, { optional: true });
  const actual = current?.headDigest || null;
  if (actual !== expectedHeadDigest) {
    fail("MH_WORLD_CONFLICT", "current WorldHead changed before CAS", { expected: expectedHeadDigest, actual });
  }
  const filePath = pointerPath(repositoryPath);
  const tempPath = path.join(
    path.dirname(filePath),
    `.tmp.current-world.${process.pid}.${Date.now()}.${crypto.randomUUID()}.json`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify({
      schemaVersion: CURRENT_WORLD_POINTER_SCHEMA,
      headDigest: successorHeadDigest,
    }, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    fail("MH_WORLD_POINTER", `cannot replace current-world pointer: ${error.message}`);
  }
  return readCurrentWorldPointer(repositoryPath);
}

function processIsLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !error || error.code !== "ESRCH";
  }
}

function workspaceExecutionLeaseAppearsActive(repositoryPath, workspaceId, now = new Date()) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "AttemptEntry workspaceId is invalid");
  }
  const filePath = path.join(
    commonGitDirectory(repositoryPath),
    "meta-harness",
    "workspaces",
    `${workspaceId}.execution.lock`,
  );
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("MH_WORKSPACE_LEASE", `admitted workspace execution lease is unreadable: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schemaVersion !== "workspace-execution-lease/v1"
      || value.workspaceId !== workspaceId
      || !Number.isInteger(value.pid) || value.pid <= 0
      || !Number.isFinite(Date.parse(value.acquiredAt))) {
    fail("MH_WORKSPACE_LEASE", "admitted workspace execution lease is invalid");
  }
  const ageMs = now.getTime() - Date.parse(value.acquiredAt);
  return processIsLive(value.pid) || ageMs < WORKSPACE_EXECUTION_LEASE_STALE_MS;
}

function lockPath(repositoryPath) {
  return path.join(protocolRoot(repositoryPath), "world-authority.lock");
}

function validateLock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== "acquiredAt\0pid\0schemaVersion\0token"
      || value.schemaVersion !== WORLD_AUTHORITY_LOCK_SCHEMA
      || !Number.isInteger(value.pid) || value.pid <= 0
      || typeof value.token !== "string" || value.token.length < 16
      || !Number.isFinite(Date.parse(value.acquiredAt))) {
    fail("MH_WORLD_AUTHORITY_LOCK", "world-authority lock is invalid");
  }
  return value;
}

function parseLock(raw) {
  try {
    return validateLock(JSON.parse(raw));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    fail("MH_WORLD_AUTHORITY_LOCK", `world-authority lock is unreadable: ${error.message}`);
  }
}

function readLock(repositoryPath) {
  try {
    return parseLock(fs.readFileSync(lockPath(repositoryPath), "utf8"));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    fail("MH_WORLD_AUTHORITY_LOCK", `world-authority lock is unreadable: ${error.message}`);
  }
}

function createLock(repositoryPath, now) {
  const value = {
    schemaVersion: WORLD_AUTHORITY_LOCK_SCHEMA,
    pid: process.pid,
    token: crypto.randomUUID(),
    acquiredAt: now.toISOString(),
  };
  let fd;
  try {
    fd = fs.openSync(lockPath(repositoryPath), "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(fd);
    return value;
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    fail("MH_WORLD_AUTHORITY_LOCK", `cannot acquire world-authority lock: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function acquireWorldAuthorityLock(repositoryPath, now = new Date()) {
  const acquired = createLock(repositoryPath, now);
  if (acquired) return acquired;
  const existingRaw = fs.readFileSync(lockPath(repositoryPath), "utf8");
  const existing = parseLock(existingRaw);
  const ageMs = now.getTime() - Date.parse(existing.acquiredAt);
  if (processIsLive(existing.pid) || ageMs < WORLD_AUTHORITY_LOCK_STALE_MS) {
    fail("MH_WORLD_AUTHORITY_BUSY", "repository World authority is already locked by another live controller");
  }
  const verifiedRaw = fs.readFileSync(lockPath(repositoryPath), "utf8");
  const verified = parseLock(verifiedRaw);
  if (verifiedRaw !== existingRaw || verified.token !== existing.token) {
    fail("MH_WORLD_AUTHORITY_BUSY", "world-authority lock changed during stale recovery");
  }
  try {
    fs.unlinkSync(lockPath(repositoryPath));
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_BUSY", `stale world-authority lock could not be recovered: ${error.message}`);
  }
  const recovered = createLock(repositoryPath, now);
  if (!recovered) fail("MH_WORLD_AUTHORITY_BUSY", "world-authority lock was acquired concurrently");
  return recovered;
}

function releaseWorldAuthorityLock(repositoryPath, lock) {
  if (!lock) return;
  const filePath = lockPath(repositoryPath);
  if (!fs.existsSync(filePath)) return;
  const current = readLock(repositoryPath);
  if (current.token !== lock.token || current.pid !== lock.pid) {
    fail("MH_WORLD_AUTHORITY_LOCK", "refusing to release a world-authority lock owned by another controller");
  }
  fs.unlinkSync(filePath);
}

function withWorldAuthorityLock(repositoryPath, operation, { now = new Date() } = {}) {
  const lock = acquireWorldAuthorityLock(repositoryPath, now);
  try {
    return operation(lock);
  } finally {
    releaseWorldAuthorityLock(repositoryPath, lock);
  }
}

function firstAttemptEntries(repositoryPath) {
  const root = attemptEntriesRoot(repositoryPath);
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "owner" || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
    const firstPath = path.join(root, entry.name, "1.json");
    if (!fs.existsSync(firstPath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(firstPath, "utf8"));
    } catch (error) {
      fail("MH_ATTEMPT_ENTRY_READ", `first AttemptEntry is unreadable: ${error.message}`);
    }
    results.push({
      decisionDigest: `sha256:${entry.name}`,
      entry: parsed,
      path: firstPath,
    });
  }
  return results;
}

function durableDecisionReferences(repositoryPath) {
  const references = new Set();
  for (const [kind, schemaVersion] of [
    ["execution-closures", EXECUTION_CLOSURE_SCHEMA],
    ["work-results", EXECUTION_WORK_RESULT_SCHEMA],
  ]) {
    const directory = path.join(protocolRoot(repositoryPath), "objects", kind);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} directory contains an invalid authority object name`);
      }
      const digest = `sha256:${entry.name.slice(0, 64)}`;
      const value = readImmutableJson(repositoryPath, kind, digest);
      if (value?.schemaVersion !== schemaVersion || !value.origin || typeof value.origin !== "object") {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid repo execution provenance`, { digest });
      }
      if (value.origin.type === "REPO_OUTCOME") {
        if (!isDigest(value.origin.outcomeDigest) || !isDigest(value.origin.claimDigest)) {
          fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid Outcome provenance`, { digest });
        }
        continue;
      }
      if (value.origin.type !== "REPO_DECISION" || !isDigest(value.origin.decisionDigest)) {
        fail("MH_WORLD_AUTHORITY_OBJECT", `immutable ${kind} object has invalid Decision provenance`, { digest });
      }
      references.add(value.origin.decisionDigest);
    }
  }
  return references;
}

function validateFirstAttemptEntry(candidate) {
  const value = candidate.entry;
  const expectedKeys = [
    "schemaVersion",
    "permitId",
    "permitDigest",
    "sessionDigest",
    "attemptId",
    "generation",
    "ordinal",
    "workspaceId",
    "origin",
    "enteredAt",
    "entryDigest",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
      || value.schemaVersion !== ATTEMPT_ENTRY_SCHEMA
      || value.generation !== 1
      || value.ordinal !== 1
      || value.origin?.type !== "REPO_DECISION"
      || value.origin.decisionDigest !== candidate.decisionDigest
      || !isDigest(value.entryDigest)) {
    fail("MH_ATTEMPT_ENTRY_READ", "first AttemptEntry authority object is invalid", {
      decisionDigest: candidate.decisionDigest,
    });
  }
  const body = JSON.parse(JSON.stringify(value));
  delete body.entryDigest;
  if (value.entryDigest !== domainDigest(ATTEMPT_ENTRY_DOMAIN, body)) {
    fail("MH_ATTEMPT_ENTRY_READ", "first AttemptEntry digest does not match its body", {
      decisionDigest: candidate.decisionDigest,
    });
  }
  return value;
}

function readAdmissionDecision(repositoryPath, decisionDigest) {
  const bytes = readImmutableBytes(repositoryPath, "decisions", decisionDigest);
  const actualDigest = domainDigest(REPO_DECISION_DOMAIN, { content: bytes.toString("utf8") });
  if (actualDigest !== decisionDigest) {
    fail("MH_WORLD_AUTHORITY_OBJECT", "immutable Decision bytes do not match their authority digest", {
      expected: decisionDigest,
      actual: actualDigest,
    });
  }
  let decision;
  try {
    decision = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_WORLD_AUTHORITY_OBJECT", `immutable Decision object is invalid JSON: ${error.message}`, { decisionDigest });
  }
  if (!decision || typeof decision !== "object" || Array.isArray(decision)
      || decision.schemaVersion !== REPO_DECISION_SCHEMA
      || !isDigest(decision.worldHeadDigest)) {
    fail("MH_WORLD_AUTHORITY_OBJECT", "immutable Decision authority object is invalid", { decisionDigest });
  }
  return decision;
}

function admissionForHead(repositoryPath, headDigest) {
  if (!isDigest(headDigest)) fail("MH_WORLD_AUTHORITY_DIGEST", "headDigest must be a sha256 digest");
  const matches = [];
  const admittedDecisionDigests = new Set();
  for (const candidate of firstAttemptEntries(repositoryPath)) {
    validateFirstAttemptEntry(candidate);
    admittedDecisionDigests.add(candidate.decisionDigest);
    const decision = readAdmissionDecision(repositoryPath, candidate.decisionDigest);
    if (decision.worldHeadDigest === headDigest) matches.push({ ...candidate, decision });
  }
  for (const decisionDigest of durableDecisionReferences(repositoryPath)) {
    const decision = readAdmissionDecision(repositoryPath, decisionDigest);
    if (decision.worldHeadDigest === headDigest && !admittedDecisionDigests.has(decisionDigest)) {
      fail("MH_WORLD_AUTHORITY_MISSING", "durable execution authority references a missing generation-1 AttemptEntry", {
        headDigest,
        decisionDigest,
      });
    }
  }
  if (matches.length > 1) {
    fail("MH_WORLD_AUTHORITY_CONFLICT", "multiple Decisions have first AttemptEntry admission against one WorldHead", {
      headDigest,
      decisions: matches.map((entry) => entry.decisionDigest),
    });
  }
  return matches[0] || null;
}

module.exports = {
  CURRENT_WORLD_POINTER_SCHEMA,
  WORLD_AUTHORITY_LOCK_SCHEMA,
  WORLD_AUTHORITY_LOCK_STALE_MS,
  admissionForHead,
  attemptEntriesRoot,
  attemptEntryPath,
  digestStem,
  objectPath,
  persistImmutableBytes,
  persistImmutableJson,
  protocolRoot,
  readCurrentWorldPointer,
  readImmutableBytes,
  readImmutableJson,
  releaseWorldAuthorityLock,
  withWorldAuthorityLock,
  workspaceExecutionLeaseAppearsActive,
  writeCreateOnlyBytes,
  writeCreateOnlyJson,
  writePointerAtomic,
};
