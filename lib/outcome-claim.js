"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { assertOwnerObjectiveRevision } = require("./owner-objective-state");
const {
  computePreconditionDigest,
  persistOutcome,
  readOutcome,
  validateOutcome,
} = require("./outcome");
const { validateWorkSession } = require("./work-session");
const { listRunSessions, persistRunSession } = require("./run-journal");
const {
  commonGitDirectory,
  digestStem,
  protocolRoot,
  readImmutableJson,
  writeCreateOnlyJson,
} = require("./world-authority");

const OUTCOME_CLAIM_SCHEMA = "outcome-claim/v2";
const OUTCOME_CLAIM_DOMAIN = "meta-harness-outcome-claim/v2";
const OUTCOME_CLAIM_RELEASE_SCHEMA = "outcome-claim-release/v1";
const OUTCOME_CLAIM_RELEASE_DOMAIN = "meta-harness-outcome-claim-release/v1";
const OUTCOME_CLAIM_SESSION_SCHEMA = "outcome-claim-session/v1";
const OUTCOME_CLAIM_SESSION_DOMAIN = "meta-harness-outcome-claim-session/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function outcomeClaimLockPath(repositoryPath, outcomeDigest) {
  if (!isDigest(outcomeDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "outcome lock requires a sha256 digest");
  const directory = path.join(protocolRoot(repositoryPath), "outcome-claims", "locks");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${digestStem(outcomeDigest, "outcomeDigest")}.lock`);
}

function withOutcomeClaimLock(repositoryPath, outcomeDigest, operation) {
  const filePath = outcomeClaimLockPath(repositoryPath, outcomeDigest);
  const maxAttempts = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const lock = { token: crypto.randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() };
    let fd;
    try {
      fd = fs.openSync(filePath, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(lock)}\n`, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      try {
        return operation();
      } finally {
        let current = null;
        try { current = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) {}
        if (current?.token === lock.token && current?.pid === lock.pid) {
          try { fs.unlinkSync(filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
        }
      }
    } catch (error) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
      if (error?.code !== "EEXIST") throw error;
      let raw;
      let current;
      try {
        raw = fs.readFileSync(filePath, "utf8");
        current = JSON.parse(raw);
      } catch (_) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        continue;
      }
      if (!processIsLive(current?.pid)) {
        try {
          if (fs.readFileSync(filePath, "utf8") === raw) fs.unlinkSync(filePath);
        } catch (_) {}
        continue;
      }
      if (attempt === maxAttempts - 1) {
        fail("MH_OUTCOME_CLAIM_BUSY", "same-Outcome admission remained busy after bounded contention retry");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  fail("MH_OUTCOME_CLAIM_BUSY", "same-Outcome admission remained busy after bounded contention retry");
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

function normalizeContinuationDigests(value, label = "continuesFromTransitionDigests") {
  if (!Array.isArray(value)) fail("MH_OUTCOME_CLAIM_CONTINUATION", `${label} must be an array`);
  const digests = value.map((entry, index) => {
    if (!isDigest(entry)) fail("MH_OUTCOME_CLAIM_CONTINUATION", `${label}[${index}] must be a sha256 digest`);
    return entry;
  });
  if (new Set(digests).size !== digests.length) {
    fail("MH_OUTCOME_CLAIM_CONTINUATION", `${label} must not contain duplicates`);
  }
  return Object.freeze([...digests]);
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
    "continuesFromTransitionDigests",
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
  normalizeContinuationDigests(value.continuesFromTransitionDigests, "outcomeClaim.continuesFromTransitionDigests");
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

function claimSessionDirectory(repositoryPath) {
  const directory = path.join(claimRoot(repositoryPath), "claim-sessions");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function sessionDirectory(repositoryPath) {
  const directory = path.join(claimRoot(repositoryPath), "sessions");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function claimPath(repositoryPath, claimDigest) {
  return path.join(claimDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function releasePath(repositoryPath, claimDigest) {
  return path.join(releaseDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function claimSessionPath(repositoryPath, claimDigest) {
  return path.join(claimSessionDirectory(repositoryPath), `${digestStem(claimDigest, "claimDigest")}.json`);
}

function sessionPath(repositoryPath, sessionDigest) {
  return path.join(sessionDirectory(repositoryPath), `${digestStem(sessionDigest, "sessionDigest")}.json`);
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

function listOutcomeClaimsForOutcome(repositoryPath, outcomeDigest) {
  if (!isDigest(outcomeDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "outcomeDigest must be a sha256 digest");
  return Object.freeze(listOutcomeClaims(repositoryPath).filter((claim) => claim.outcomeDigest === outcomeDigest));
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

function claimSemanticsMatch(claim, { preconditionDigest, executionBoundary, continuesFromTransitionDigests = [] }) {
  return claim.preconditionDigest === preconditionDigest
    && JSON.stringify(normalizeBoundary(claim.executionBoundary)) === JSON.stringify(normalizeBoundary(executionBoundary))
    && JSON.stringify(claim.continuesFromTransitionDigests) === JSON.stringify(normalizeContinuationDigests(continuesFromTransitionDigests));
}

function assertClaimAvailable(repositoryPath, outcomeDigest) {
  for (const active of listActiveOutcomeClaims(repositoryPath)) {
    if (active.outcomeDigest === outcomeDigest) {
      fail("MH_OUTCOME_ALREADY_CLAIMED", "Outcome already has an active claim", {
        outcomeDigest,
        activeClaimDigest: active.claimDigest,
      });
    }
  }
}

function acquireOutcomeClaim({
  repositoryPath,
  outcomeDigest,
  originWorldHeadDigest,
  preconditionDigest = null,
  executionBoundary,
  continuesFromTransitionDigests = [],
  now = new Date(),
}) {
  const outcome = readOutcome(repositoryPath, outcomeDigest);
  readImmutableJson(repositoryPath, "heads", originWorldHeadDigest);
  const resolvedPreconditionDigest = preconditionDigest || computePreconditionDigest(outcome);
  if (!isDigest(resolvedPreconditionDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "preconditionDigest must be a sha256 digest");
  const boundary = normalizeBoundary(executionBoundary);
  const continuationDigests = normalizeContinuationDigests(continuesFromTransitionDigests);
  return withOutcomeClaimLock(repositoryPath, outcomeDigest, () => {
    assertClaimAvailable(repositoryPath, outcomeDigest);
    const body = {
      schemaVersion: OUTCOME_CLAIM_SCHEMA,
      claimId: crypto.randomUUID(),
      outcomeDigest,
      originWorldHeadDigest,
      preconditionDigest: resolvedPreconditionDigest,
      executionBoundary: boundary,
      continuesFromTransitionDigests: continuationDigests,
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
  return withOutcomeClaimLock(options.repositoryPath, options.outcomeDigest, () => {
    const active = findActiveOutcomeClaimForOutcome(options.repositoryPath, options.outcomeDigest);
    if (active) {
      if (!claimSemanticsMatch(active, {
        preconditionDigest: resolvedPreconditionDigest,
        executionBoundary: options.executionBoundary,
        continuesFromTransitionDigests: options.continuesFromTransitionDigests || [],
      })) {
        fail("MH_OUTCOME_CLAIM_CONFLICT", "active Outcome claim does not match the requested execution authority", {
          outcomeDigest: options.outcomeDigest,
          activeClaimDigest: active.claimDigest,
        });
      }
      return active;
    }
    readImmutableJson(options.repositoryPath, "heads", options.originWorldHeadDigest);
    assertClaimAvailable(options.repositoryPath, options.outcomeDigest);
    const body = {
      schemaVersion: OUTCOME_CLAIM_SCHEMA,
      claimId: crypto.randomUUID(),
      outcomeDigest: options.outcomeDigest,
      originWorldHeadDigest: options.originWorldHeadDigest,
      preconditionDigest: resolvedPreconditionDigest,
      executionBoundary: normalizeBoundary(options.executionBoundary),
      continuesFromTransitionDigests: normalizeContinuationDigests(options.continuesFromTransitionDigests || []),
      acquiredAt: (options.now || new Date()).toISOString(),
    };
    const claim = validateOutcomeClaim({ ...body, claimDigest: computeOutcomeClaimDigest(body) });
    writeCreateOnlyJson(claimPath(options.repositoryPath, claim.claimDigest), claim, "MH_OUTCOME_CLAIM_WRITE");
    return claim;
  });
}

function claimSessionBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.bindingDigest;
  return body;
}

function validateOutcomeClaimSessionBinding(value) {
  exactKeys(value, ["schemaVersion", "claimDigest", "sessionDigest", "boundAt", "bindingDigest"], "outcomeClaimSession");
  if (value.schemaVersion !== OUTCOME_CLAIM_SESSION_SCHEMA
      || !isDigest(value.claimDigest)
      || !isDigest(value.sessionDigest)
      || !Number.isFinite(Date.parse(value.boundAt))) {
    fail("MH_OUTCOME_CLAIM_SESSION", "outcome claim session binding is invalid");
  }
  if (!isDigest(value.bindingDigest)
      || value.bindingDigest !== domainDigest(OUTCOME_CLAIM_SESSION_DOMAIN, claimSessionBody(value))) {
    fail("MH_OUTCOME_CLAIM_SESSION", "outcome claim session binding digest is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function readOutcomeClaimSessionBinding(repositoryPath, claimDigest, { optional = false } = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(claimSessionPath(repositoryPath, claimDigest), "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_OUTCOME_CLAIM_SESSION", `outcome claim session binding is unreadable: ${error.message}`);
  }
  const binding = validateOutcomeClaimSessionBinding(value);
  if (binding.claimDigest !== claimDigest) {
    fail("MH_OUTCOME_CLAIM_SESSION", "claim-session path identity does not match its claim");
  }
  return binding;
}

function neutralRunSessionForClaim(repositoryPath, claimDigest) {
  const matches = listRunSessions({ gitCommonDirectory: commonGitDirectory(repositoryPath) })
    .filter((session) => session.origin?.type === "REPO_OUTCOME" && session.origin.claimDigest === claimDigest);
  if (matches.length > 1) {
    fail("MH_RUN_SESSION_CONFLICT", "more than one neutral run session references one Outcome claim");
  }
  return matches[0] || null;
}

function readOutcomeClaimSession(repositoryPath, claimDigest, { optional = false } = {}) {
  const neutral = neutralRunSessionForClaim(repositoryPath, claimDigest);
  const binding = readOutcomeClaimSessionBinding(repositoryPath, claimDigest, { optional: true });
  let legacy = null;
  if (binding) {
    let value;
    try {
      value = JSON.parse(fs.readFileSync(sessionPath(repositoryPath, binding.sessionDigest), "utf8"));
    } catch (error) {
      fail("MH_OUTCOME_CLAIM_SESSION", `legacy claim-bound work session is unreadable: ${error.message}`);
    }
    legacy = validateWorkSession(value);
    if (legacy.sessionDigest !== binding.sessionDigest) {
      fail("MH_OUTCOME_CLAIM_SESSION", "legacy Claim-session relation does not match its sealed session");
    }
  }
  if (neutral && legacy && neutral.sessionDigest !== legacy.sessionDigest) {
    fail("MH_RUN_SESSION_CONFLICT", "neutral run session differs from the legacy Claim-session relation");
  }
  const session = neutral || legacy;
  if (!session) {
    if (optional) return null;
    fail("MH_OUTCOME_CLAIM_SESSION", "no sealed run session exists for this Outcome claim");
  }
  const claim = readOutcomeClaim(repositoryPath, claimDigest);
  if (session.origin.type !== "REPO_OUTCOME"
      || session.origin.claimDigest !== claimDigest
      || session.origin.outcomeDigest !== claim.outcomeDigest) {
    fail("MH_OUTCOME_CLAIM_SESSION", "run session does not match its retained Outcome provenance");
  }
  return session;
}

function acquireOutcomeClaimSession({
  repositoryPath,
  outcomeDigest = null,
  outcome: prospectiveOutcome = null,
  originWorldHeadDigest,
  expectedObjectiveRevision = null,
  preconditionDigest = null,
  executionBoundary,
  continuesFromTransitionDigests = [],
  buildSession,
  now = new Date(),
}) {
  const outcome = prospectiveOutcome
    ? validateOutcome(prospectiveOutcome)
    : readOutcome(repositoryPath, outcomeDigest);
  const resolvedOutcomeDigest = outcome.outcomeDigest;
  if (outcomeDigest !== null && outcomeDigest !== resolvedOutcomeDigest) {
    fail("MH_OUTCOME_CLAIM_DIGEST", "prospective Outcome digest does not match outcomeDigest");
  }
  readImmutableJson(repositoryPath, "heads", originWorldHeadDigest);
  const resolvedPreconditionDigest = preconditionDigest || computePreconditionDigest(outcome);
  if (!isDigest(resolvedPreconditionDigest)) fail("MH_OUTCOME_CLAIM_DIGEST", "preconditionDigest must be a sha256 digest");
  if (typeof buildSession !== "function") fail("MH_OUTCOME_CLAIM_SESSION", "buildSession must be a function");
  const boundary = normalizeBoundary(executionBoundary);
  const continuationDigests = normalizeContinuationDigests(continuesFromTransitionDigests);
  // New repo work is optimistic. A Claim is retained only as a compatibility identity for
  // historical readers; it does not reserve the Outcome, paths, capacity, or permission to start.
  // Coordination belongs at the non-monotonic integration decision, not at work admission.
  if (expectedObjectiveRevision !== null) {
    assertOwnerObjectiveRevision(repositoryPath, expectedObjectiveRevision);
  }
  if (prospectiveOutcome) persistOutcome(repositoryPath, outcome);
  const body = {
    schemaVersion: OUTCOME_CLAIM_SCHEMA,
    claimId: crypto.randomUUID(),
    outcomeDigest: resolvedOutcomeDigest,
    originWorldHeadDigest,
    preconditionDigest: resolvedPreconditionDigest,
    executionBoundary: boundary,
    continuesFromTransitionDigests: continuationDigests,
    acquiredAt: now.toISOString(),
  };
  const claim = validateOutcomeClaim({ ...body, claimDigest: computeOutcomeClaimDigest(body) });
  const session = validateWorkSession(buildSession(claim));
  if (session.origin.type !== "REPO_OUTCOME"
      || session.origin.outcomeDigest !== resolvedOutcomeDigest
      || session.origin.claimDigest !== claim.claimDigest) {
    fail("MH_OUTCOME_CLAIM_SESSION", "sealed work session is not bound to the compatibility Claim identity");
  }
  // Recovery-safe ordering: durable run/session truth exists before the compatibility record.
  persistRunSession({ gitCommonDirectory: commonGitDirectory(repositoryPath), session });
  writeCreateOnlyJson(claimPath(repositoryPath, claim.claimDigest), claim, "MH_OUTCOME_CLAIM_WRITE");
  return Object.freeze({ claim, session, relation: null });
}

function releaseOutcomeClaimUnderAuthority(repositoryPath, claimDigest, now = new Date()) {
  const observed = readOutcomeClaim(repositoryPath, claimDigest);
  return withOutcomeClaimLock(repositoryPath, observed.outcomeDigest, () => {
    const claim = readOutcomeClaim(repositoryPath, claimDigest);
    if (claim.outcomeDigest !== observed.outcomeDigest) {
      fail("MH_OUTCOME_CLAIM_MISMATCH", "Outcome claim identity changed during release");
    }
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
  });
}

function releaseOutcomeClaim(repositoryPath, claimDigest, now = new Date()) {
  return releaseOutcomeClaimUnderAuthority(repositoryPath, claimDigest, now);
}

function assertOutcomeClaimSessionExecution({ repositoryPath, claimDigest, outcomeDigest, sessionDigest }) {
  const claim = readOutcomeClaim(repositoryPath, claimDigest);
  if (claim.outcomeDigest !== outcomeDigest) fail("MH_OUTCOME_CLAIM_MISMATCH", "Outcome claim does not own the requested Outcome");
  if (readOutcomeClaimRelease(repositoryPath, claimDigest, { optional: true })) {
    fail("MH_OUTCOME_CLAIM_RELEASED", "Outcome claim is no longer active");
  }
  const relation = readOutcomeClaimSessionBinding(repositoryPath, claimDigest, { optional: true });
  if (relation && relation.sessionDigest !== sessionDigest) {
    fail("MH_OUTCOME_CLAIM_SESSION", "Outcome claim execution does not match its durable session identity");
  }
  return Object.freeze({ claim, relation });
}

module.exports = {
  OUTCOME_CLAIM_DOMAIN,
  OUTCOME_CLAIM_RELEASE_DOMAIN,
  OUTCOME_CLAIM_RELEASE_SCHEMA,
  OUTCOME_CLAIM_SCHEMA,
  OUTCOME_CLAIM_SESSION_DOMAIN,
  OUTCOME_CLAIM_SESSION_SCHEMA,
  acquireOutcomeClaim,
  acquireOutcomeClaimSession,
  assertOutcomeClaimSessionExecution,
  boundariesOverlap,
  computeOutcomeClaimDigest,
  ensureOutcomeClaim,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
  listOutcomeClaimsForOutcome,
  readOutcomeClaim,
  readOutcomeClaimRelease,
  readOutcomeClaimSession,
  readOutcomeClaimSessionBinding,
  releaseOutcomeClaim,
  releaseOutcomeClaimUnderAuthority,
  validateOutcomeClaim,
  validateOutcomeClaimSessionBinding,
  withOutcomeClaimLock,
};
