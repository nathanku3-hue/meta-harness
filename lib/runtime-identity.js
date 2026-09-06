"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");

const REPOSITORY_IDENTITY_SCHEMA = "repository-identity/v1";
const REPOSITORY_IDENTITY_DOMAIN = "meta-harness-repository-identity/v1";
const RUNTIME_CAPABILITY_SCHEMA = "runtime-capability/v1";
const RUNTIME_CAPABILITY_DOMAIN = "meta-harness-runtime-capability/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail("MH_RUNTIME_IDENTITY", `${label} must be a non-empty string`);
  return value.trim();
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/u.test(String(value || ""));
}

function isWslMountPath(value) {
  return /^\/mnt\/[A-Za-z](?:\/|$)/u.test(String(value || ""));
}

function windowsDriveToWsl(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(String(value || ""));
  if (!match) return String(value || "");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/gu, "/")}`;
}

function wslToWindowsDrive(value) {
  const match = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/u.exec(String(value || ""));
  if (!match) return String(value || "");
  return `${match[1].toUpperCase()}:/${match[2] || ""}`;
}

function nativePath(value, platform = process.platform) {
  let raw = nonEmpty(value, "path");
  if (platform === "win32" && isWslMountPath(raw)) raw = wslToWindowsDrive(raw);
  else if (platform !== "win32" && isWindowsDrivePath(raw)) raw = windowsDriveToWsl(raw);
  return path.resolve(raw);
}

function comparisonPath(value, platform = process.platform) {
  let current = nativePath(value, platform);
  const suffix = [];
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    suffix.unshift(path.basename(current));
    current = path.dirname(current);
  }
  if (fs.existsSync(current)) {
    try {
      current = fs.realpathSync.native(current);
    } catch (_) {
      // Keep the native spelling if the host cannot resolve the existing prefix.
    }
  }
  for (const part of suffix) current = path.join(current, part);
  return current;
}

function pathIdentity(value, platform = process.platform) {
  let normalized = comparisonPath(value, platform).replace(/\\/gu, "/");
  if (isWslMountPath(normalized)) normalized = wslToWindowsDrive(normalized);
  normalized = path.posix.normalize(normalized);
  if (isWindowsDrivePath(normalized)) return normalized.toLowerCase();
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsEqual(left, right, platform = process.platform) {
  return pathIdentity(left, platform) === pathIdentity(right, platform);
}

function repositoryIdentityPath(gitCommonDirectory) {
  return path.join(path.resolve(nonEmpty(gitCommonDirectory, "gitCommonDirectory")), "meta-harness", "repository-identity.json");
}

function identityBody(value) {
  return {
    schemaVersion: REPOSITORY_IDENTITY_SCHEMA,
    repositoryId: value.repositoryId,
    createdAt: value.createdAt,
  };
}

function validateRepositoryIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== ["createdAt", "identityDigest", "repositoryId", "schemaVersion"].sort().join("\0")
      || value.schemaVersion !== REPOSITORY_IDENTITY_SCHEMA
      || !UUID_RE.test(String(value.repositoryId || ""))
      || !Number.isFinite(Date.parse(value.createdAt))
      || !isDigest(value.identityDigest)
      || value.identityDigest !== domainDigest(REPOSITORY_IDENTITY_DOMAIN, identityBody(value))) {
    fail("MH_REPOSITORY_IDENTITY", "repository identity is invalid");
  }
  return Object.freeze({ ...value });
}

function readRepositoryIdentity(gitCommonDirectory, { optional = false } = {}) {
  const filePath = repositoryIdentityPath(gitCommonDirectory);
  try {
    return validateRepositoryIdentity(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    if (error?.code === "MH_REPOSITORY_IDENTITY") throw error;
    fail("MH_REPOSITORY_IDENTITY", `repository identity is unreadable: ${error.message}`);
  }
}

function ensureRepositoryIdentity(gitCommonDirectory, now = new Date()) {
  const existing = readRepositoryIdentity(gitCommonDirectory, { optional: true });
  if (existing) return existing;
  const body = {
    schemaVersion: REPOSITORY_IDENTITY_SCHEMA,
    repositoryId: crypto.randomUUID(),
    createdAt: now.toISOString(),
  };
  const identity = validateRepositoryIdentity({
    ...body,
    identityDigest: domainDigest(REPOSITORY_IDENTITY_DOMAIN, body),
  });
  const filePath = repositoryIdentityPath(gitCommonDirectory);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") return readRepositoryIdentity(gitCommonDirectory);
    fail("MH_REPOSITORY_IDENTITY", `repository identity could not be persisted: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return readRepositoryIdentity(gitCommonDirectory);
}

function runtimeCapabilityDescriptor(env = process.env) {
  let declared = null;
  const raw = env.META_HARNESS_RUNTIME_CAPABILITIES_JSON;
  if (raw) {
    try {
      declared = JSON.parse(raw);
    } catch (error) {
      fail("MH_RUNTIME_CAPABILITY", `META_HARNESS_RUNTIME_CAPABILITIES_JSON is invalid JSON: ${error.message}`);
    }
  }
  const host = Object.freeze({
    declared,
    internalHostResult: env.META_HARNESS_INTERNAL_HOST_RESULT === "1",
    devspaceProposalHost: Boolean(
      env.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT
      && env.META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN,
    ),
  });
  return Object.freeze({
    schemaVersion: RUNTIME_CAPABILITY_SCHEMA,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    host,
  });
}

function runtimeCapabilityDigest(env = process.env) {
  return domainDigest(RUNTIME_CAPABILITY_DOMAIN, runtimeCapabilityDescriptor(env));
}

module.exports = {
  REPOSITORY_IDENTITY_SCHEMA,
  RUNTIME_CAPABILITY_SCHEMA,
  ensureRepositoryIdentity,
  nativePath,
  pathIdentity,
  pathsEqual,
  readRepositoryIdentity,
  repositoryIdentityPath,
  runtimeCapabilityDescriptor,
  runtimeCapabilityDigest,
  windowsDriveToWsl,
  wslToWindowsDrive,
};
