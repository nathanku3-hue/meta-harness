"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { assertContainedPath, assertRepositoryRoot } = require("./truth-paths");

const BOOTSTRAP_LOCK_SCHEMA = "meta-harness-bootstrap-lock/v1";
const BOOTSTRAP_LOCK_STALE_MS = 30_000;

function processIsLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !error || error.code !== "ESRCH";
  }
}

function lockDocument(token) {
  return `${JSON.stringify({
    schema_version: BOOTSTRAP_LOCK_SCHEMA,
    pid: process.pid,
    created_at: new Date().toISOString(),
    token,
  })}\n`;
}

function readLockSnapshot(root, lockPath, label) {
  assertContainedPath(root, lockPath, { leafType: "file", label });
  const raw = fs.readFileSync(lockPath, "utf8");
  const stats = fs.statSync(lockPath);
  let document = null;
  try {
    document = JSON.parse(raw);
  } catch (_) {}
  const createdAt = Date.parse(document?.created_at);
  return {
    raw,
    pid: Number.isInteger(document?.pid) ? document.pid : null,
    token: typeof document?.token === "string" ? document.token : null,
    createdAtMs: Number.isFinite(createdAt) ? createdAt : stats.mtimeMs,
  };
}

function isStale(snapshot, nowMs = Date.now()) {
  return !processIsLive(snapshot.pid) && nowMs - snapshot.createdAtMs >= BOOTSTRAP_LOCK_STALE_MS;
}

function releaseOwnedLock(root, lockPath, token, label) {
  try {
    const snapshot = readLockSnapshot(root, lockPath, label);
    if (snapshot.token === token) fs.unlinkSync(lockPath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

function acquireRecoveryGuard(root, guardPath) {
  const token = crypto.randomUUID();
  const content = lockDocument(token);
  assertContainedPath(root, guardPath, {
    allowMissingLeaf: true,
    leafType: "file",
    label: "bootstrap lock recovery guard",
  });
  try {
    fs.writeFileSync(guardPath, content, { encoding: "utf8", flag: "wx" });
    return token;
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }

  const snapshot = readLockSnapshot(root, guardPath, "bootstrap lock recovery guard");
  if (!isStale(snapshot)) {
    throw new ConfigError("truth authority bootstrap lock recovery is already in progress", {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }
  fs.unlinkSync(guardPath);
  fs.writeFileSync(guardPath, content, { encoding: "utf8", flag: "wx" });
  return token;
}

function recoverStaleBootstrapLock(root, lockPath, expectedSnapshot) {
  const guardPath = `${lockPath}.recovery`;
  const guardToken = acquireRecoveryGuard(root, guardPath);
  try {
    let current;
    try {
      current = readLockSnapshot(root, lockPath, "bootstrap lock");
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }
    if (current.raw !== expectedSnapshot.raw && !isStale(current)) {
      throw new ConfigError("truth authority bootstrap is already in progress", {
        code: "MH_TRUTH_AUTHORITY",
        exitCode: 1,
      });
    }
    const verified = readLockSnapshot(root, lockPath, "bootstrap lock");
    if (verified.raw !== current.raw || !isStale(verified)) {
      throw new ConfigError("truth authority bootstrap lock changed during stale recovery", {
        code: "MH_TRUTH_AUTHORITY",
        exitCode: 1,
      });
    }
    fs.unlinkSync(lockPath);
  } finally {
    releaseOwnedLock(root, guardPath, guardToken, "bootstrap lock recovery guard");
  }
}

function withBootstrapLock(context, operation) {
  const { root } = assertRepositoryRoot(context.cwd);
  const lockPath = path.join(root, ".meta-harness-bootstrap.lock");
  const token = crypto.randomUUID();
  const content = lockDocument(token);
  let acquired = false;

  for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
    assertContainedPath(root, lockPath, {
      allowMissingLeaf: true,
      leafType: "file",
      label: "bootstrap lock",
    });
    try {
      fs.writeFileSync(lockPath, content, { encoding: "utf8", flag: "wx" });
      assertContainedPath(root, lockPath, { leafType: "file", label: "bootstrap lock" });
      acquired = true;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      const snapshot = readLockSnapshot(root, lockPath, "bootstrap lock");
      if (!isStale(snapshot)) {
        throw new ConfigError("truth authority bootstrap is already in progress", {
          code: "MH_TRUTH_AUTHORITY",
          exitCode: 1,
        });
      }
      recoverStaleBootstrapLock(root, lockPath, snapshot);
    }
  }

  if (!acquired) {
    throw new ConfigError("truth authority bootstrap lock could not be acquired", {
      code: "MH_TRUTH_AUTHORITY",
      exitCode: 1,
    });
  }

  try {
    return operation();
  } finally {
    releaseOwnedLock(root, lockPath, token, "bootstrap lock");
  }
}

module.exports = {
  BOOTSTRAP_LOCK_SCHEMA,
  BOOTSTRAP_LOCK_STALE_MS,
  withBootstrapLock,
};
