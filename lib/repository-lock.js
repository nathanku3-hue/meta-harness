"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { commonGitDirectory } = require("./protocol-store");

const LOCK_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const DEFAULT_ATTEMPTS = 2000;
const DEFAULT_WAIT_MS = 5;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function processIsLive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function repositoryLockPath(repositoryPath, name) {
  if (!LOCK_NAME_RE.test(String(name || ""))) {
    fail("MH_REPOSITORY_LOCK_NAME", "repository lock name is invalid");
  }
  const directory = path.join(commonGitDirectory(repositoryPath), "meta-harness", "locks");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${name}.lock`);
}

function readLock(filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("MH_REPOSITORY_LOCK_READ", `repository lock is unreadable: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== ["acquiredAt", "pid", "token"].sort().join("\0")
      || typeof value.token !== "string" || value.token.length < 16
      || !Number.isInteger(value.pid) || value.pid < 1
      || !Number.isFinite(Date.parse(value.acquiredAt))) {
    fail("MH_REPOSITORY_LOCK_READ", "repository lock record is invalid");
  }
  return value;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireRepositoryLock(repositoryPath, name, {
  attempts = DEFAULT_ATTEMPTS,
  waitMs = DEFAULT_WAIT_MS,
  now = () => new Date(),
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isInteger(waitMs) || waitMs < 0) {
    fail("MH_REPOSITORY_LOCK_VALUE", "repository lock retry settings are invalid");
  }
  const filePath = repositoryLockPath(repositoryPath, name);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lock = {
      token: crypto.randomUUID(),
      pid: process.pid,
      acquiredAt: now().toISOString(),
    };
    let fd;
    try {
      fd = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(lock)}\n`, "utf8");
      fs.fsyncSync(fd);
      return Object.freeze({ ...lock, filePath, name });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        fail("MH_REPOSITORY_LOCK_WRITE", `repository lock could not be acquired: ${error.message}`);
      }
      let observed;
      try {
        observed = readLock(filePath);
      } catch (readError) {
        if (readError?.code !== "MH_REPOSITORY_LOCK_READ") throw readError;
        wait(waitMs);
        continue;
      }
      if (!processIsLive(observed.pid)) {
        let verified;
        try {
          verified = readLock(filePath);
        } catch (_) {
          wait(waitMs);
          continue;
        }
        if (verified.token === observed.token && verified.pid === observed.pid) {
          try {
            fs.unlinkSync(filePath);
            continue;
          } catch (unlinkError) {
            if (unlinkError?.code !== "ENOENT") {
              wait(waitMs);
            }
          }
        }
      }
      wait(waitMs);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  fail("MH_REPOSITORY_LOCK_BUSY", `repository lock remained busy: ${name}`);
}

function releaseRepositoryLock(lock) {
  if (!lock?.filePath) return;
  if (!fs.existsSync(lock.filePath)) return;
  const current = readLock(lock.filePath);
  if (current.token !== lock.token || current.pid !== lock.pid) {
    fail("MH_REPOSITORY_LOCK_OWNERSHIP", "refusing to release a repository lock owned by another controller");
  }
  fs.unlinkSync(lock.filePath);
}

function withRepositoryLock(repositoryPath, name, operation, options) {
  const lock = acquireRepositoryLock(repositoryPath, name, options);
  try {
    return operation(lock);
  } finally {
    releaseRepositoryLock(lock);
  }
}

module.exports = {
  acquireRepositoryLock,
  releaseRepositoryLock,
  repositoryLockPath,
  withRepositoryLock,
};
