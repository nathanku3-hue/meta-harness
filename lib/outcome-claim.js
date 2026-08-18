"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { computePreconditionDigest, readOutcome } = require("./outcome");
const {
  digestStem,
  protocolRoot,
  readImmutableJson,
  withWorldAuthorityLock,
  writeCreateOnlyJson,
} = require("./world-authority");

const OUTCOME_CLAIM_SCHEMA = "outcome-claim/v1";
const OUTCOME_CLAIM_DOMAIN = "meta-harness-outcome-claim/v1";
const OUTCOME_CLAIM_RELEASE_SCHEMA = "outcome-claim-release/v1";
const OUTCOME_CLAIM_RELEASE_DOMAIN = "meta-harness-outcome-claim-release/v1";
const OUTCOME_CLAIM_BINDING_SCHEMA = "outcome-claim-binding/v1";
const OUTCOME_CLAIM_BINDING_DOMAIN = "meta-harness-outcome-claim-binding/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function withClaimAuthorityLock(repositoryPath, operation) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return withWorldAuthorityLock(repositoryPath, operation);
    } catch (error) {
      if (error?.code !== "MH_WORLD_AUTHORITY_BUSY" || attempt === 39) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  fail("MH_WORLD_AUTHORITY_BUSY", "Outcome claim authority remained busy after bounded contention retry");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_OUTCOME_CLAIM_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_OUTCOME_CLAIM_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function validRelativePath(value) {
  if (value === ".") return true;
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..")
    && value !== ".git"
    && !value.startsWith(".git/");
}

function normalizeWritePaths(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("MH_OUTCOME_CLAIM_BOUNDARY", "executionBoundary.writePaths must contain at least one path");
  }
  const paths = value.map((entry) => {
    if (!validRelativePath(entry)) fail("MH_OUTCOME_CLAIM_BOUNDARY", `invalid write boundary path: ${entry}`);
    return process.platform === "win32" ? entry.toLowerCase() : entry;
  });
  if (new Set(paths).size !== paths.length) {
    fail("MH_OUTCOME_CLAIM_BOUNDARY", "executionBoundary.writePaths must not contain duplicates");
  }
  return [...paths].sort();
}

function normalizeBoundary(value) {
  exactKeys(value, ["writePaths"], "executionBoundary");
  return Object.freeze({ writePaths: Object.freeze(normalizeWritePaths(value.writePaths)) });
}

function pathScopesOverlap(left, right) {
  if (left === "." || right === ".") return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function boundariesOverlap(left, right) {
  const a = normalizeBoundary(left);
  const b = normalizeBoundary(right);
  return a.writePaths.some((leftPath) => b.writePaths.some((rightPath) => pathScopesOverlap(leftPath, rightPath)));
}

function claimBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.claimDigest;
  return body;
}

function computeOutcomeClaimDigest(value) {
  return domainDigest(OUTCOME_CLAIM_DOMAIN, claimBody(value));
}

function validateOutcomeClaim(value) {
  exactKeys(value, [
    "schemaVersion",
    "claimId",
    "outcomeDigest",
    "originWorldHeadDigest",
    "preconditionDigest",
    "executionBoundary",
    "acquiredAt",
    "claimDigest",
  ], "outcomeClaim");
  if (value.schemaVersion !== OUTCOME_CLAIM_SCHEMA) {
    fail("MH_OUTCOME_CLAIM_SCHEMA", `outcomeClaim.schemaVersion must be ${OUTCOME_CLAIM_SCHEMA}`);
  }
  if (!UUID_RE.test(value.claimId)) fail("MH_OUTCOME_CLAIM_ID", "outcomeClaim.claimId must be a canonical UUID");
  for (const field of ["outcomeDigest", "originWorldHeadDigest", "preconditionDigest", "claimDigest"]) {
    if (!isDigest(value[field])) fail("MH_OUTCOME_CLAIM_DIGEST", `outcomeClaim.${field} must be a sha256 digest`);
  }
  normalizeBoundary(value.executionBoundary);
  if (!Number.isFinite(Date.parse(value.acquiredAt))) {
    fail("MH_OUTCOME_CLAIM_VALUE", "outcomeClaim.acquiredAt must be an ISO timestamp");
  }
  if (value.claimDigest !== computeOutcomeClaimDigest(value)) {
    fail("MH_OUTCOME_CLAIM_DIGEST", "outcomeClaim.claimDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function claimRoot(repositoryPath) {
  const root = path.join(protocolRoot(repositoryPath), "outcome-claims");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function claimDirectory(repositoryPath) {
  const directory = path.join(claimRoot(repositoryPath), "claims");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function releaseDirectory(repositoryPath) {
  const directory = path.join(claimRoot(repositoryPath), "releases");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function bindingDirectory(repositoryPath) {
  const directory = path.join(claimRoot(repositoryPath), "bindings");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function claimPath(repositoryPath, claimDigest) {
  return path.join(claimDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function releasePath(repositoryPath, claimDigest) {
  return path.join(releaseDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function bindingPath(repositoryPath, claimDigest) {
  return path.join(bindingDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function readOutcomeClaim(repositoryPath, claimDigest) {
  if (!isDigest(claimDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "claimDigest must be a sha256 digest");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(claimPath(repositoryPath, claimDigest), "utf8"));
  } catch (error) {
    fail("MH_OUTCOME_CLAIM_READ", `outcome claim is unreadable: ${error.message}`);
  }
  const claim = validateOutcomeClaim(value);
  if (claim.claimDigest !== claimDigest) fail("MH_OUTCOME_CLAIM_DIGEST", "claim path identity does not match its body");
  return claim;
}

function releaseBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.releaseDigest;
  return body;
}

function validateRelease(value) {
  exactKeys(value, ["schemaVersion", "claimDigest", "releasedAt", "releaseDigest"], "outcomeClaimRelease");
  if (value.schemaVersion !== OUTCOME_CLAIM_RELEASE_SCHEMA || !isDigest(value.claimDigest)) {
    fail("MH_OUTCOME_CLAIM_RELEASE", "outcome claim release is invalid");
  }
  if (!Number.isFinite(Date.parse(value.releasedAt))) fail("MH_OUTCOME_CLAIM_RELEASE", "releasedAt must be an ISO timestamp");
  if (!isDigest(value.releaseDigest) || value.releaseDigest !== domainDigest(OUTCOME_CLAIM_RELEASE_DOMAIN, releaseBody(value))) {
    fail("MH_OUTCOME_CLAIM_RELEASE", "outcome claim release digest is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function readOutcomeClaimRelease(repositoryPath, claimDigest, { optional = false } = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(releasePath(repositoryPath, claimDigest), "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_OUTCOME_CLAIM_RELEASE", `outcome claim release is unreadable: ${error.message}`);
  }
  const release = validateRelease(value);
  if (release.claimDigest !== claimDigest) fail("MH_OUTCOME_CLAIM_RELEASE", "release path identity does not match its claim");
  return release;
}

function listOutcomeClaims(repositoryPath) {
  const directory = claimDirectory(repositoryPath);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name))
    .map((entry) => readOutcomeClaim(repositoryPath, `sha256:${entry.name.slice(0, 64)}`));
}

function listActiveOutcomeClaims(repositoryPath) {
  return Object.freeze(listOutcomeClaims(repositoryPath)
    .filter((claim) => !readOutcomeClaimRelease(repositoryPath, claim.claimDigest, { optional: true })));
}

function findActiveOutcomeClaimForOutcome(repositoryPath, outcomeDigest) {
  if (!isDigest(outcomeDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "outcomeDigest must be a sha256 digest");
  const matches = listActiveOutcomeClaims(repositoryPath).filter((claim) => claim.outcomeDigest === outcomeDigest);
  if (matches.length > 1) {
    fail("MH_OUTCOME_CLAIM_CONFLICT", "more than one active claim exists for one Outcome", { outcomeDigest });
  }
  return matches[0] || null;
}

function claimSemanticsMatch(claim, { preconditionDigest, executionBoundary }) {
  return claim.preconditionDigest === preconditionDigest
    && JSON.stringify(normalizeBoundary(claim.executionBoundary)) === JSON.stringify(normalizeBoundary(executionBoundary));
}

function acquireOutcomeClaim({
  repositoryPath,
  outcomeDigest,
  originWorldHeadDigest,
  preconditionDigest = null,
  executionBoundary,
  now = new Date(),
}) {
  const outcome = readOutcome(repositoryPath, outcomeDigest);
  readImmutableJson(repositoryPath, "heads", originWorldHeadDigest);
  const resolvedPreconditionDigest = preconditionDigest || computePreconditionDigest(outcome);
  if (!isDigest(resolvedPreconditionDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "preconditionDigest must be a sha256 digest");
  const boundary = normalizeBoundary(executionBoundary);
  return withClaimAuthorityLock(repositoryPath, () => {
    for (const active of listActiveOutcomeClaims(repositoryPath)) {
      if (active.outcomeDigest === outcomeDigest) {
        fail("MH_OUTCOME_ALREADY_CLAIMED", "Outcome already has an active claim", {
          outcomeDigest,
          activeClaimDigest: active.claimDigest,
        });
      }
      if (boundariesOverlap(active.executionBoundary, boundary)) {
        fail("MH_OUTCOME_CLAIM_CONFLICT", "Outcome execution boundary conflicts with an active claim", {
          outcomeDigest,
          activeOutcomeDigest: active.outcomeDigest,
          activeClaimDigest: active.claimDigest,
        });
      }
    }
    const body = {
      schemaVersion: OUTCOME_CLAIM_SCHEMA,
      claimId: crypto.randomUUID(),
      outcomeDigest,
      originWorldHeadDigest,
      preconditionDigest: resolvedPreconditionDigest,
      executionBoundary: boundary,
      acquiredAt: now.toISOString(),
    };
    const claim = validateOutcomeClaim({ ...body, claimDigest: computeOutcomeClaimDigest(body) });
    writeCreateOnlyJson(claimPath(repositoryPath, claim.claimDigest), claim, "MH_OUTCOME_CLAIM_WRITE");
    return claim;
  });
}

function ensureOutcomeClaim(options) {
  const outcome = readOutcome(options.repositoryPath, options.outcomeDigest);
  const resolvedPreconditionDigest = options.preconditionDigest || computePreconditionDigest(outcome);
  return withClaimAuthorityLock(options.repositoryPath, () => {
    const active = findActiveOutcomeClaimForOutcome(options.repositoryPath, options.outcomeDigest);
    if (active) {
      if (!claimSemanticsMatch(active, {
        preconditionDigest: resolvedPreconditionDigest,
        executionBoundary: options.executionBoundary,
      })) {
        fail("MH_OUTCOME_CLAIM_CONFLICT", "active Outcome claim does not match the requested execution authority", {
          outcomeDigest: options.outcomeDigest,
          activeClaimDigest: active.claimDigest,
        });
      }
      return active;
    }
    readImmutableJson(options.repositoryPath, "heads", options.originWorldHeadDigest);
    for (const other of listActiveOutcomeClaims(options.repositoryPath)) {
      if (boundariesOverlap(other.executionBoundary, options.executionBoundary)) {
        fail("MH_OUTCOME_CLAIM_CONFLICT", "Outcome execution boundary conflicts with an active claim", {
          outcomeDigest: options.outcomeDigest,
          activeOutcomeDigest: other.outcomeDigest,
          activeClaimDigest: other.claimDigest,
        });
      }
    }
    const body = {
      schemaVersion: OUTCOME_CLAIM_SCHEMA,
      claimId: crypto.randomUUID(),
      outcomeDigest: options.outcomeDigest,
      originWorldHeadDigest: options.originWorldHeadDigest,
      preconditionDigest: resolvedPreconditionDigest,
      executionBoundary: normalizeBoundary(options.executionBoundary),
      acquiredAt: (options.now || new Date()).toISOString(),
    };
    const claim = validateOutcomeClaim({ ...body, claimDigest: computeOutcomeClaimDigest(body) });
    writeCreateOnlyJson(claimPath(options.repositoryPath, claim.claimDigest), claim, "MH_OUTCOME_CLAIM_WRITE");
    return claim;
  });
}

function releaseOutcomeClaimUnderAuthority(repositoryPath, claimDigest, now = new Date()) {
  readOutcomeClaim(repositoryPath, claimDigest);
  const existing = readOutcomeClaimRelease(repositoryPath, claimDigest, { optional: true });
  if (existing) return existing;
  const body = {
    schemaVersion: OUTCOME_CLAIM_RELEASE_SCHEMA,
    claimDigest,
    releasedAt: now.toISOString(),
  };
  const release = validateRelease({
    ...body,
    releaseDigest: domainDigest(OUTCOME_CLAIM_RELEASE_DOMAIN, body),
  });
  writeCreateOnlyJson(releasePath(repositoryPath, claimDigest), release, "MH_OUTCOME_CLAIM_RELEASE");
  return release;
}

function releaseOutcomeClaim(repositoryPath, claimDigest, now = new Date()) {
  return withClaimAuthorityLock(
    repositoryPath,
    () => releaseOutcomeClaimUnderAuthority(repositoryPath, claimDigest, now),
  );
}

function bindingBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.bindingDigest;
  return body;
}

function validateBinding(value) {
  exactKeys(value, ["schemaVersion", "claimDigest", "sessionDigest", "workspaceId", "boundAt", "bindingDigest"], "outcomeClaimBinding");
  if (value.schemaVersion !== OUTCOME_CLAIM_BINDING_SCHEMA
      || !isDigest(value.claimDigest)
      || !isDigest(value.sessionDigest)
      || !UUID_RE.test(value.workspaceId)
      || !Number.isFinite(Date.parse(value.boundAt))) {
    fail("MH_OUTCOME_CLAIM_BINDING", "outcome claim binding is invalid");
  }
  if (!isDigest(value.bindingDigest) || value.bindingDigest !== domainDigest(OUTCOME_CLAIM_BINDING_DOMAIN, bindingBody(value))) {
    fail("MH_OUTCOME_CLAIM_BINDING", "outcome claim binding digest is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function readOutcomeClaimBinding(repositoryPath, claimDigest, { optional = false } = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(bindingPath(repositoryPath, claimDigest), "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_OUTCOME_CLAIM_BINDING", `outcome claim binding is unreadable: ${error.message}`);
  }
  const binding = validateBinding(value);
  if (binding.claimDigest !== claimDigest) fail("MH_OUTCOME_CLAIM_BINDING", "binding path identity does not match its claim");
  return binding;
}

function bindOutcomeClaim({ repositoryPath, claimDigest, sessionDigest, workspaceId, now = new Date() }) {
  return withClaimAuthorityLock(repositoryPath, () => {
    readOutcomeClaim(repositoryPath, claimDigest);
    if (readOutcomeClaimRelease(repositoryPath, claimDigest, { optional: true })) {
      fail("MH_OUTCOME_CLAIM_RELEASED", "released Outcome claim cannot bind execution");
    }
    const existing = readOutcomeClaimBinding(repositoryPath, claimDigest, { optional: true });
    if (existing) {
      if (existing.sessionDigest !== sessionDigest || existing.workspaceId !== workspaceId) {
        fail("MH_OUTCOME_CLAIM_BINDING", "Outcome claim is already bound to different execution custody");
      }
      return existing;
    }
    const body = {
      schemaVersion: OUTCOME_CLAIM_BINDING_SCHEMA,
      claimDigest,
      sessionDigest,
      workspaceId,
      boundAt: now.toISOString(),
    };
    const binding = validateBinding({
      ...body,
      bindingDigest: domainDigest(OUTCOME_CLAIM_BINDING_DOMAIN, body),
    });
    writeCreateOnlyJson(bindingPath(repositoryPath, claimDigest), binding, "MH_OUTCOME_CLAIM_BINDING");
    return binding;
  });
}

function assertOutcomeClaimExecution({ repositoryPath, claimDigest, outcomeDigest, sessionDigest, workspaceId }) {
  const claim = readOutcomeClaim(repositoryPath, claimDigest);
  if (claim.outcomeDigest !== outcomeDigest) fail("MH_OUTCOME_CLAIM_MISMATCH", "Outcome claim does not own the requested Outcome");
  if (readOutcomeClaimRelease(repositoryPath, claimDigest, { optional: true })) {
    fail("MH_OUTCOME_CLAIM_RELEASED", "Outcome claim is no longer active");
  }
  const binding = readOutcomeClaimBinding(repositoryPath, claimDigest);
  if (binding.sessionDigest !== sessionDigest || binding.workspaceId !== workspaceId) {
    fail("MH_OUTCOME_CLAIM_BINDING", "Outcome claim execution does not match its durable session/workspace binding");
  }
  return Object.freeze({ claim, binding });
}

module.exports = {
  OUTCOME_CLAIM_BINDING_DOMAIN,
  OUTCOME_CLAIM_BINDING_SCHEMA,
  OUTCOME_CLAIM_DOMAIN,
  OUTCOME_CLAIM_RELEASE_DOMAIN,
  OUTCOME_CLAIM_RELEASE_SCHEMA,
  OUTCOME_CLAIM_SCHEMA,
  acquireOutcomeClaim,
  assertOutcomeClaimExecution,
  bindOutcomeClaim,
  boundariesOverlap,
  computeOutcomeClaimDigest,
  ensureOutcomeClaim,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
  readOutcomeClaim,
  readOutcomeClaimBinding,
  readOutcomeClaimRelease,
  releaseOutcomeClaim,
  releaseOutcomeClaimUnderAuthority,
  validateOutcomeClaim,
};
