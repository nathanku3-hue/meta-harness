"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const OBJECT_KINDS = new Set([
  "work-results",
  "execution-closures",
  "worker-stops",
  "product-integrations",
  "structural-saws",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_PROTOCOL_STORE_VALUE", `${label} must be a non-empty string`);
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
    fail("MH_PROTOCOL_STORE_GIT", `repository .git metadata is unreadable: ${error.message}`);
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) return dotGit;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_PROTOCOL_STORE_GIT", "repository .git metadata must be a directory or regular gitdir file");
  }
  const match = fs.readFileSync(dotGit, "utf8").trim().match(/^gitdir:\s*(.+)$/iu);
  if (!match) fail("MH_PROTOCOL_STORE_GIT", "repository .git file does not contain a gitdir identity");
  const gitDir = path.resolve(root, match[1]);
  const commonDirFile = path.join(gitDir, "commondir");
  if (!fs.existsSync(commonDirFile)) return gitDir;
  const commonRelative = fs.readFileSync(commonDirFile, "utf8").trim();
  if (!commonRelative) fail("MH_PROTOCOL_STORE_GIT", "Git commondir metadata is empty");
  return path.resolve(gitDir, commonRelative);
}

function protocolRoot(repositoryPath, { create = true } = {}) {
  const root = path.join(commonGitDirectory(repositoryPath), "meta-harness", "decision-plane-v2");
  if (create) fs.mkdirSync(root, { recursive: true });
  return root;
}

function digestStem(digest, label = "digest") {
  if (!isDigest(digest)) fail("MH_PROTOCOL_STORE_DIGEST", `${label} must be a sha256 digest`);
  return digest.slice("sha256:".length);
}

function objectPath(repositoryPath, kind, digest) {
  if (!OBJECT_KINDS.has(kind)) fail("MH_PROTOCOL_STORE_KIND", `unknown immutable object kind: ${kind}`);
  const directory = path.join(protocolRoot(repositoryPath), "objects", kind);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${digestStem(digest)}.json`);
}

function attemptEntriesRoot(repositoryPath) {
  const directory = path.join(protocolRoot(repositoryPath), "attempt-entries");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runWorkspaceAttemptDirectory(repositoryPath, sessionDigest, workspaceId) {
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "run AttemptEntry workspaceId must be a canonical UUID");
  }
  const directory = path.join(
    attemptEntriesRoot(repositoryPath),
    "runs",
    digestStem(sessionDigest, "sessionDigest"),
    "workspaces",
    workspaceId,
  );
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
  if (origin?.type === "REPO_RUN_WORKSPACE") {
    return path.join(runWorkspaceAttemptDirectory(
      repositoryPath,
      origin.sessionDigest,
      origin.workspaceId,
    ), `${ordinal}.json`);
  }
  if (origin?.type === "OWNER_GOAL") {
    return path.join(ownerAttemptDirectory(repositoryPath, origin.workspaceId), `${ordinal}.json`);
  }
  fail("MH_ATTEMPT_ENTRY_ORIGIN", "attempt entry origin must be REPO_RUN_WORKSPACE or OWNER_GOAL");
}

function writeCreateOnlyBytes(filePath, bytes, code = "MH_PROTOCOL_STORE_WRITE") {
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
        fail(code, `immutable protocol object already exists with different bytes: ${path.basename(filePath)}`);
      }
      return { created: false, path: filePath };
    }
    fail(code, `cannot persist immutable protocol object: ${error.message}`);
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
    fail("MH_PROTOCOL_STORE_MISSING", `immutable ${kind} object is unreadable: ${error.message}`, { digest });
  }
}

function readImmutableJson(repositoryPath, kind, digest) {
  const bytes = readImmutableBytes(repositoryPath, kind, digest);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("MH_PROTOCOL_STORE_OBJECT", `immutable ${kind} object is invalid JSON: ${error.message}`, { digest });
  }
}

module.exports = {
  attemptEntriesRoot,
  attemptEntryPath,
  commonGitDirectory,
  digestStem,
  objectPath,
  persistImmutableBytes,
  persistImmutableJson,
  protocolRoot,
  readImmutableBytes,
  readImmutableJson,
  writeCreateOnlyBytes,
  writeCreateOnlyJson,
};
