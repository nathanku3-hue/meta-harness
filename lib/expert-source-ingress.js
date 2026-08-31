"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { fileURLToPath } = require("node:url");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { repositoryRoot } = require("./work-git");

const MAX_EXPERT_SOURCE_COUNT = 8;
const MAX_EXPERT_SOURCE_BYTES = 512 * 1024;
const MAX_EXPERT_SOURCE_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_EXPERT_SOURCE_NAME_BYTES = 512;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const OID_RE = /^[a-f0-9]{40,64}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function sha256Digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(String(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function requireBoundedName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_EXPERT_SOURCE_NAME", "resource_link.name must be a non-empty string");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_EXPERT_SOURCE_NAME_BYTES) {
    fail("MH_EXPERT_SOURCE_NAME", `resource_link.name exceeds ${MAX_EXPERT_SOURCE_NAME_BYTES} UTF-8 bytes`);
  }
  return value;
}

function localFilePath(uri) {
  if (typeof uri !== "string" || uri.length === 0) {
    fail("MH_EXPERT_SOURCE_URI", "resource_link.uri must be a non-empty file: URL");
  }
  const authority = /^file:\/\/([^/]*)/iu.exec(uri);
  if (!authority || authority[1] !== "") {
    fail("MH_EXPERT_SOURCE_URI", "resource_link.uri must be an absolute local file: URL with an empty hostname");
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (error) {
    fail("MH_EXPERT_SOURCE_URI", `resource_link.uri is invalid: ${error.message}`);
  }
  if (parsed.protocol !== "file:" || parsed.hostname !== "") {
    fail("MH_EXPERT_SOURCE_URI", "resource_link.uri must use local file: transport only");
  }
  let filePath;
  try {
    filePath = fileURLToPath(parsed);
  } catch (error) {
    fail("MH_EXPERT_SOURCE_URI", `resource_link.uri cannot be converted to a local path: ${error.message}`);
  }
  if (!path.isAbsolute(filePath)) {
    fail("MH_EXPERT_SOURCE_URI", "resource_link.uri must resolve to an absolute local path");
  }
  return path.resolve(filePath);
}

function assertNoLinkPath(filePath) {
  const parsed = path.parse(filePath);
  let current = parsed.root;
  let finalStat = null;
  const remainder = filePath.slice(parsed.root.length);
  const parts = remainder.split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      fail("MH_EXPERT_SOURCE_PATH", `resource_link path is unreadable: ${error.message}`, { path: current });
    }
    if (stat.isSymbolicLink()) {
      fail("MH_EXPERT_SOURCE_PATH", "resource_link path may not traverse a symlink or junction", { path: current });
    }
    finalStat = stat;
  }
  if (!finalStat) fail("MH_EXPERT_SOURCE_PATH", "resource_link path must name a regular file");
  return stableIdentity(finalStat);
}

function stableIdentity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  });
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function snapshotResourceLink(block) {
  if (!block || block.type !== "resource_link") {
    fail("MH_EXPERT_SOURCE_SHAPE", "only resource_link blocks are accepted as expert sources");
  }
  const name = requireBoundedName(block.name);
  const filePath = localFilePath(block.uri);
  const pathIdentity = assertNoLinkPath(filePath);

  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const beforeStat = fs.fstatSync(fd);
    const before = stableIdentity(beforeStat);
    if (!sameIdentity(pathIdentity, before)) {
      fail("MH_EXPERT_SOURCE_CHANGED", "resource_link target changed between path validation and opening the snapshot handle");
    }
    if (!beforeStat.isFile()) {
      fail("MH_EXPERT_SOURCE_TYPE", "resource_link target must be a regular file");
    }
    if (beforeStat.size <= 0 || beforeStat.size > MAX_EXPERT_SOURCE_BYTES) {
      fail("MH_EXPERT_SOURCE_BUDGET", `resource_link target must contain 1-${MAX_EXPERT_SOURCE_BYTES} bytes`, {
        byteLength: beforeStat.size,
      });
    }
    const realBefore = fs.realpathSync.native(filePath);
    if (!samePath(realBefore, filePath)) {
      fail("MH_EXPERT_SOURCE_PATH", "resource_link target may not resolve through a symlink or junction");
    }
    const bytes = fs.readFileSync(fd);
    const afterStat = fs.fstatSync(fd);
    const after = stableIdentity(afterStat);
    const realAfter = fs.realpathSync.native(filePath);
    if (!samePath(realAfter, filePath) || !sameIdentity(before, after) || bytes.length !== after.size) {
      fail("MH_EXPERT_SOURCE_CHANGED", "resource_link target changed while its exact snapshot was being captured");
    }
    if (bytes.length > MAX_EXPERT_SOURCE_BYTES) {
      fail("MH_EXPERT_SOURCE_BUDGET", `resource_link target exceeds ${MAX_EXPERT_SOURCE_BYTES} bytes`);
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      fail("MH_EXPERT_SOURCE_ENCODING", "resource_link target must be exact UTF-8 text");
    }
    return Object.freeze({
      name,
      transportKind: "file",
      bytes,
      text,
      byteLength: bytes.length,
      contentDigest: sha256Digest(bytes),
    });
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    fail("MH_EXPERT_SOURCE_READ", `resource_link target could not be snapshotted safely: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function runGitRaw(repositoryPath, args, { input, binary = false, allowFailure = false } = {}) {
  const root = repositoryRoot(repositoryPath);
  const executable = gitExecutableForWorkspace({ cwd: root, fs });
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...process.env },
    input,
    encoding: binary ? null : "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr || "");
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : String(result.stdout || "");
    fail("MH_EXPERT_SOURCE_GIT", `git ${args.join(" ")} failed: ${String(stderr || stdout || result.error?.message || "unknown error").trim()}`);
  }
  return result;
}

function expertSourceRefName(contentDigest) {
  if (typeof contentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(contentDigest)) {
    fail("MH_EXPERT_SOURCE_DIGEST", "expert source contentDigest must be sha256:<hex>");
  }
  return `refs/meta-harness/research-sources/${contentDigest.slice("sha256:".length)}`;
}

function readBlobBytes(repositoryPath, oid) {
  if (!OID_RE.test(String(oid || ""))) {
    fail("MH_EXPERT_SOURCE_BLOB", "expert source blobOid is invalid");
  }
  const type = runGitRaw(repositoryPath, ["cat-file", "-t", oid], { allowFailure: true });
  if (type.status !== 0 || String(type.stdout || "").trim() !== "blob") {
    fail("MH_EXPERT_SOURCE_BLOB_MISSING", "authoritative expert ingress references a missing or non-blob Git object", { blobOid: oid });
  }
  const result = runGitRaw(repositoryPath, ["cat-file", "blob", oid], { binary: true });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || "");
}

function ensureGcRef(repositoryPath, contentDigest, blobOid) {
  const refName = expertSourceRefName(contentDigest);
  const current = runGitRaw(repositoryPath, ["rev-parse", "--verify", "--quiet", refName], { allowFailure: true });
  const actual = current.status === 0 ? String(current.stdout || "").trim() : null;
  if (actual !== blobOid) runGitRaw(repositoryPath, ["update-ref", refName, blobOid]);
  return refName;
}

function persistSnapshot(repositoryPath, snapshot) {
  const hashed = runGitRaw(repositoryPath, ["hash-object", "-w", "--stdin"], { input: snapshot.bytes });
  const blobOid = String(hashed.stdout || "").trim();
  if (!OID_RE.test(blobOid)) {
    fail("MH_EXPERT_SOURCE_BLOB", "git hash-object did not return a valid blob identity");
  }
  const reopened = readBlobBytes(repositoryPath, blobOid);
  if (!reopened.equals(snapshot.bytes)
      || reopened.length !== snapshot.byteLength
      || sha256Digest(reopened) !== snapshot.contentDigest) {
    fail("MH_EXPERT_SOURCE_BLOB", "expert source Git blob does not reopen as the exact captured bytes");
  }
  ensureGcRef(repositoryPath, snapshot.contentDigest, blobOid);
  return Object.freeze({
    blobOid,
    contentDigest: snapshot.contentDigest,
    byteLength: snapshot.byteLength,
    name: snapshot.name,
    transportKind: "file",
  });
}

function captureExpertResourceLinks(repositoryPath, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_EXPERT_SOURCE_COUNT) {
    fail("MH_EXPERT_SOURCE_COUNT", `expert source count must be 1-${MAX_EXPERT_SOURCE_COUNT}`);
  }
  const snapshots = blocks.map(snapshotResourceLink);
  const totalBytes = snapshots.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (totalBytes > MAX_EXPERT_SOURCE_TOTAL_BYTES) {
    fail("MH_EXPERT_SOURCE_BUDGET", `expert source prompt total exceeds ${MAX_EXPERT_SOURCE_TOTAL_BYTES} bytes`, { totalBytes });
  }
  return Object.freeze(snapshots.map((snapshot) => persistSnapshot(repositoryPath, snapshot)));
}

function validateExpertSourceDescriptor(value, label = "expertSource") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_EXPERT_SOURCE_DESCRIPTOR", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = ["blobOid", "contentDigest", "byteLength", "name", "transportKind"].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || !OID_RE.test(String(value.blobOid || ""))
      || !/^sha256:[a-f0-9]{64}$/u.test(String(value.contentDigest || ""))
      || !Number.isInteger(value.byteLength)
      || value.byteLength <= 0
      || value.byteLength > MAX_EXPERT_SOURCE_BYTES
      || value.transportKind !== "file") {
    fail("MH_EXPERT_SOURCE_DESCRIPTOR", `${label} is invalid`);
  }
  const name = requireBoundedName(value.name);
  return Object.freeze({
    blobOid: value.blobOid,
    contentDigest: value.contentDigest,
    byteLength: value.byteLength,
    name,
    transportKind: "file",
  });
}

function reopenExpertSource(repositoryPath, descriptor, { repairRef = true } = {}) {
  const normalized = validateExpertSourceDescriptor(descriptor);
  const bytes = readBlobBytes(repositoryPath, normalized.blobOid);
  if (bytes.length !== normalized.byteLength || sha256Digest(bytes) !== normalized.contentDigest) {
    fail("MH_EXPERT_SOURCE_BLOB_MISMATCH", "authoritative expert ingress source does not match its retained Git blob", {
      blobOid: normalized.blobOid,
      contentDigest: normalized.contentDigest,
    });
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    fail("MH_EXPERT_SOURCE_ENCODING", "retained expert source blob is not exact UTF-8 text");
  }
  if (repairRef) ensureGcRef(repositoryPath, normalized.contentDigest, normalized.blobOid);
  return Object.freeze({ ...normalized, bytes, text });
}

module.exports = {
  MAX_EXPERT_SOURCE_BYTES,
  MAX_EXPERT_SOURCE_COUNT,
  MAX_EXPERT_SOURCE_TOTAL_BYTES,
  captureExpertResourceLinks,
  expertSourceRefName,
  reopenExpertSource,
  snapshotResourceLink,
  validateExpertSourceDescriptor,
};
