"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { exactKeys, isExactUtcTimestamp, isOrdinaryPlainObject } = require("../contracts/canonical-json");
const { domainDigest, isDigest } = require("../contracts/digest");
const {
  codedError,
  readJsonIfExists,
  writeJsonNoReplace,
  writeJsonReplace,
} = require("../execution-custody/support");
const { exactUtcNow } = require("./clock");

const ACTIVE_INDEX_SCHEMA = "active-slice-index/v1";
const ACTIVE_INDEX_DOMAIN = "meta-harness-active-slice-index/v1";
const LEASE_CLAIM_DOMAIN = "meta-harness-active-slice-lease/v1";
const ACTIVE_INDEX_RELATIVE_PATH = path.join("active", "active-slice-index.json");
const ACTIVE_INDEX_LOCK_RELATIVE_PATH = path.join("locks", "active-slice-index.lock");
const STAGES = new Set([
  "AUTHORIZED",
  "ACTIVE",
  "TERMINAL_CANDIDATE",
  "TERMINAL_VERIFIED",
  "PUBLISHED",
  "CLOSED",
  "ABORTED",
]);
const TERMINAL_STAGES = new Set(["CLOSED", "ABORTED"]);
const INDEX_KEYS = Object.freeze([
  "schemaVersion",
  "repositoryId",
  "activeSliceId",
  "activeGeneration",
  "activeStateDigest",
  "activeStateEventDigest",
  "operationEventHead",
  "controllerBindingDigest",
  "attemptCount",
  "runSpecCount",
  "publicationAttemptCount",
  "stage",
  "leaseControllerInstanceId",
  "leaseOwnerClaimDigest",
  "leaseAcquiredAt",
  "leaseExpiresAt",
  "indexDigest",
]);

function indexPath(stateRoot) {
  return path.join(stateRoot, ACTIVE_INDEX_RELATIVE_PATH);
}

function lockPath(stateRoot) {
  return path.join(stateRoot, ACTIVE_INDEX_LOCK_RELATIVE_PATH);
}

function indexBody(index) {
  const body = { ...index };
  delete body.indexDigest;
  return body;
}

function leaseClaimBody(index) {
  return {
    repositoryId: index.repositoryId,
    activeSliceId: index.activeSliceId,
    activeGeneration: index.activeGeneration,
    activeStateDigest: index.activeStateDigest,
    activeStateEventDigest: index.activeStateEventDigest,
    operationEventHead: index.operationEventHead,
    controllerBindingDigest: index.controllerBindingDigest,
    leaseControllerInstanceId: index.leaseControllerInstanceId,
    leaseAcquiredAt: index.leaseAcquiredAt,
    leaseExpiresAt: index.leaseExpiresAt,
  };
}

function validateIndex(index) {
  if (!isOrdinaryPlainObject(index) || !exactKeys(index, INDEX_KEYS)) {
    throw codedError("ACTIVE_INDEX_SHAPE_INVALID", "active-slice index has unexpected or missing fields");
  }
  if (index.schemaVersion !== ACTIVE_INDEX_SCHEMA) {
    throw codedError("UNSUPPORTED_SCHEMA", `active-slice index schema must be ${ACTIVE_INDEX_SCHEMA}`);
  }
  for (const field of [
    "repositoryId",
    "activeSliceId",
    "activeStateDigest",
    "activeStateEventDigest",
    "operationEventHead",
    "controllerBindingDigest",
    "leaseControllerInstanceId",
    "leaseOwnerClaimDigest",
    "indexDigest",
  ]) {
    if (typeof index[field] !== "string" || index[field].length === 0) {
      throw codedError("ACTIVE_INDEX_FIELD_INVALID", `active-slice index ${field} is required`);
    }
  }
  for (const field of ["repositoryId", "activeStateDigest", "activeStateEventDigest", "operationEventHead", "controllerBindingDigest", "leaseOwnerClaimDigest", "indexDigest"]) {
    if (!isDigest(index[field])) {
      throw codedError("ACTIVE_INDEX_DIGEST_INVALID", `active-slice index ${field} must be a sha256 digest`);
    }
  }
  if (!Number.isInteger(index.activeGeneration) || index.activeGeneration < 1) {
    throw codedError("ACTIVE_INDEX_GENERATION_INVALID", "activeGeneration must be a positive integer");
  }
  for (const field of ["attemptCount", "runSpecCount", "publicationAttemptCount"]) {
    if (!Number.isInteger(index[field]) || index[field] < 0) {
      throw codedError("ACTIVE_INDEX_COUNTER_INVALID", `${field} must be a non-negative integer`);
    }
  }
  if (!STAGES.has(index.stage)) {
    throw codedError("ACTIVE_INDEX_STAGE_INVALID", `unsupported active-slice stage: ${index.stage}`);
  }
  if (!isExactUtcTimestamp(index.leaseAcquiredAt) || !isExactUtcTimestamp(index.leaseExpiresAt)) {
    throw codedError("ACTIVE_INDEX_LEASE_TIME_INVALID", "lease times must be exact UTC timestamps");
  }
  if (Date.parse(index.leaseExpiresAt) <= Date.parse(index.leaseAcquiredAt)) {
    throw codedError("ACTIVE_INDEX_LEASE_TIME_INVALID", "lease expiry must follow acquisition");
  }
  const expectedClaim = domainDigest(LEASE_CLAIM_DOMAIN, leaseClaimBody(index));
  if (index.leaseOwnerClaimDigest !== expectedClaim) {
    throw codedError("ACTIVE_INDEX_LEASE_DIGEST_MISMATCH", "lease owner claim digest does not match");
  }
  const expectedIndex = domainDigest(ACTIVE_INDEX_DOMAIN, indexBody(index));
  if (index.indexDigest !== expectedIndex) {
    throw codedError("ACTIVE_INDEX_DIGEST_MISMATCH", "active-slice index digest does not match");
  }
  return Object.freeze(JSON.parse(JSON.stringify(index)));
}

function readActiveSliceIndex(stateRoot) {
  const stored = readJsonIfExists(indexPath(stateRoot));
  if (!stored.exists) return null;
  return validateIndex(stored.value);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function acquireIndexLock(stateRoot, controllerInstanceId) {
  const target = lockPath(stateRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const owner = {
    pid: process.pid,
    hostname: os.hostname(),
    controllerInstanceId,
    acquiredAt: exactUtcNow(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(target);
      writeJsonNoReplace(path.join(target, "owner.json"), owner);
      return target;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const current = JSON.parse(fs.readFileSync(path.join(target, "owner.json"), "utf8"));
        stale = current.hostname === os.hostname() && !processAlive(current.pid);
      } catch {
        const stat = fs.statSync(target);
        stale = Date.now() - stat.mtimeMs > 30000;
      }
      if (!stale) {
        throw codedError("ACTIVE_INDEX_BUSY", "active-slice index is being updated by another controller");
      }
      const stalePath = `${target}.stale-${crypto.randomBytes(8).toString("hex")}`;
      try {
        fs.renameSync(target, stalePath);
        fs.rmSync(stalePath, { recursive: true, force: true });
      } catch {
        throw codedError("ACTIVE_INDEX_BUSY", "stale active-slice lock recovery lost a race");
      }
    }
  }
  throw codedError("ACTIVE_INDEX_BUSY", "unable to acquire active-slice index lock");
}

function withIndexLock(stateRoot, controllerInstanceId, operation) {
  const acquired = acquireIndexLock(stateRoot, controllerInstanceId);
  try {
    return operation();
  } finally {
    fs.rmSync(acquired, { recursive: true, force: true });
  }
}

function sealIndex(body) {
  const draft = { ...body };
  draft.leaseOwnerClaimDigest = domainDigest(LEASE_CLAIM_DOMAIN, leaseClaimBody(draft));
  draft.indexDigest = domainDigest(ACTIVE_INDEX_DOMAIN, indexBody(draft));
  return validateIndex(draft);
}

function writeIndexCas({ stateRoot, expectedPriorIndexDigest, nextBody, controllerInstanceId }) {
  return withIndexLock(stateRoot, controllerInstanceId, () => {
    const current = readActiveSliceIndex(stateRoot);
    const actualPrior = current ? current.indexDigest : null;
    if (actualPrior !== expectedPriorIndexDigest) {
      throw codedError("ACTIVE_INDEX_CAS_MISMATCH", "active-slice index changed before compare-and-swap", {
        expectedPriorIndexDigest,
        actualPriorIndexDigest: actualPrior,
      });
    }
    const next = sealIndex(nextBody);
    fs.mkdirSync(path.dirname(indexPath(stateRoot)), { recursive: true, mode: 0o700 });
    if (current === null) writeJsonNoReplace(indexPath(stateRoot), next);
    else writeJsonReplace(indexPath(stateRoot), next);
    return next;
  });
}

function initializeActiveSliceIndex({
  stateRoot,
  repositoryId,
  sliceId,
  generation,
  stateDigest,
  operationEventHead,
  activeStateEventDigest = operationEventHead,
  controllerBindingDigest,
  controllerInstanceId,
  leaseSeconds,
}) {
  const acquiredAt = exactUtcNow();
  const leaseExpiresAt = new Date(Date.parse(acquiredAt) + leaseSeconds * 1000).toISOString();
  return writeIndexCas({
    stateRoot,
    expectedPriorIndexDigest: null,
    controllerInstanceId,
    nextBody: {
      schemaVersion: ACTIVE_INDEX_SCHEMA,
      repositoryId,
      activeSliceId: sliceId,
      activeGeneration: generation,
      activeStateDigest: stateDigest,
      activeStateEventDigest,
      operationEventHead,
      controllerBindingDigest,
      attemptCount: 0,
      runSpecCount: 0,
      publicationAttemptCount: 0,
      stage: "ACTIVE",
      leaseControllerInstanceId: controllerInstanceId,
      leaseOwnerClaimDigest: "pending",
      leaseAcquiredAt: acquiredAt,
      leaseExpiresAt,
      indexDigest: "pending",
    },
  });
}

function takeoverExpiredLease({
  stateRoot,
  expectedPriorIndexDigest,
  sliceId,
  generation,
  stateDigest,
  operationEventHead,
  priorLeaseOwnerClaimDigest,
  controllerBindingDigest,
  replacementControllerInstanceId,
  leaseSeconds,
}) {
  const current = readActiveSliceIndex(stateRoot);
  if (!current || current.indexDigest !== expectedPriorIndexDigest) {
    throw codedError("ACTIVE_INDEX_CAS_MISMATCH", "active-slice index changed before lease takeover");
  }
  const now = exactUtcNow();
  if (Date.parse(now) < Date.parse(current.leaseExpiresAt)) {
    throw codedError("ACTIVE_LEASE_NOT_EXPIRED", "active controller lease has not expired");
  }
  const expected = {
    activeSliceId: sliceId,
    activeGeneration: generation,
    activeStateDigest: stateDigest,
    operationEventHead,
    leaseOwnerClaimDigest: priorLeaseOwnerClaimDigest,
    controllerBindingDigest,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (current[field] !== value) {
      throw codedError("ACTIVE_LEASE_TAKEOVER_MISMATCH", `lease takeover ${field} does not match current state`);
    }
  }
  if (TERMINAL_STAGES.has(current.stage)) {
    throw codedError("ACTIVE_LEASE_TERMINAL", "terminal slice does not require lease takeover");
  }

  return writeIndexCas({
    stateRoot,
    expectedPriorIndexDigest,
    controllerInstanceId: replacementControllerInstanceId,
    nextBody: {
      ...indexBody(current),
      leaseControllerInstanceId: replacementControllerInstanceId,
      leaseOwnerClaimDigest: "pending",
      leaseAcquiredAt: now,
      leaseExpiresAt: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(),
      indexDigest: "pending",
    },
  });
}

function advanceActiveSliceIndex({
  stateRoot,
  expectedPriorIndexDigest,
  controllerInstanceId,
  expectedPriorEventDigest,
  nextEventDigest,
  nextStateDigest,
  nextStateEventDigest,
  nextStage,
  nextGeneration,
}) {
  const current = readActiveSliceIndex(stateRoot);
  if (!current || current.indexDigest !== expectedPriorIndexDigest) {
    throw codedError("ACTIVE_INDEX_CAS_MISMATCH", "active-slice index changed before state advance");
  }
  if (current.leaseControllerInstanceId !== controllerInstanceId) {
    throw codedError("ACTIVE_LEASE_OWNER_MISMATCH", "stale controller cannot advance active-slice state");
  }
  if (Date.parse(exactUtcNow()) >= Date.parse(current.leaseExpiresAt)) {
    throw codedError("ACTIVE_LEASE_EXPIRED", "expired controller must take over the same slice before continuing");
  }
  if (current.operationEventHead !== expectedPriorEventDigest) {
    throw codedError("ACTIVE_EVENT_HEAD_MISMATCH", "operation event predecessor does not match active head");
  }
  if (!STAGES.has(nextStage)) {
    throw codedError("ACTIVE_INDEX_STAGE_INVALID", `unsupported active-slice stage: ${nextStage}`);
  }
  requireDigestLike(nextEventDigest, "nextEventDigest");
  requireDigestLike(nextStateDigest, "nextStateDigest");
  const generation = nextGeneration === undefined ? current.activeGeneration : nextGeneration;
  if (!Number.isInteger(generation) || generation < current.activeGeneration || generation > current.activeGeneration + 1) {
    throw codedError("ACTIVE_INDEX_GENERATION_INVALID", "active generation may stay constant or advance by exactly one");
  }
  return writeIndexCas({
    stateRoot,
    expectedPriorIndexDigest,
    controllerInstanceId,
    nextBody: {
      ...indexBody(current),
      activeGeneration: generation,
      activeStateDigest: nextStateDigest,
      activeStateEventDigest: nextStateEventDigest || current.activeStateEventDigest,
      operationEventHead: nextEventDigest,
      stage: nextStage,
      leaseOwnerClaimDigest: "pending",
      indexDigest: "pending",
    },
  });
}

function requireDigestLike(value, label) {
  if (!isDigest(value)) {
    throw codedError("ACTIVE_INDEX_DIGEST_INVALID", `${label} must be a sha256 digest`);
  }
}

function yieldActiveLease({
  stateRoot,
  expectedPriorIndexDigest,
  controllerInstanceId,
}) {
  const current = readActiveSliceIndex(stateRoot);
  if (!current || current.indexDigest !== expectedPriorIndexDigest) {
    throw codedError("ACTIVE_INDEX_CAS_MISMATCH", "active-slice index changed before lease yield");
  }
  if (current.leaseControllerInstanceId !== controllerInstanceId) {
    throw codedError("ACTIVE_LEASE_OWNER_MISMATCH", "only the current controller instance may yield its lease");
  }
  return writeIndexCas({
    stateRoot,
    expectedPriorIndexDigest,
    controllerInstanceId,
    nextBody: {
      ...indexBody(current),
      leaseExpiresAt: exactUtcNow(),
      leaseOwnerClaimDigest: "pending",
      indexDigest: "pending",
    },
  });
}

function reserveCounter({
  stateRoot,
  expectedPriorIndexDigest,
  controllerInstanceId,
  counter,
  maximum,
}) {
  if (!new Set(["attemptCount", "runSpecCount", "publicationAttemptCount"]).has(counter)) {
    throw codedError("ACTIVE_INDEX_COUNTER_INVALID", `unsupported counter: ${counter}`);
  }
  const current = readActiveSliceIndex(stateRoot);
  if (!current || current.indexDigest !== expectedPriorIndexDigest) {
    throw codedError("ACTIVE_INDEX_CAS_MISMATCH", "active-slice index changed before counter reservation");
  }
  if (current.leaseControllerInstanceId !== controllerInstanceId) {
    throw codedError("ACTIVE_LEASE_OWNER_MISMATCH", "stale controller cannot reserve active-slice capacity");
  }
  if (Date.parse(exactUtcNow()) >= Date.parse(current.leaseExpiresAt)) {
    throw codedError("ACTIVE_LEASE_EXPIRED", "expired controller must take over the same slice before continuing");
  }
  if (current[counter] >= maximum) {
    throw codedError("ACTIVE_INDEX_LIMIT_EXCEEDED", `${counter} limit exceeded`);
  }
  return writeIndexCas({
    stateRoot,
    expectedPriorIndexDigest,
    controllerInstanceId,
    nextBody: {
      ...indexBody(current),
      [counter]: current[counter] + 1,
      leaseOwnerClaimDigest: "pending",
      indexDigest: "pending",
    },
  });
}

module.exports = {
  ACTIVE_INDEX_DOMAIN,
  ACTIVE_INDEX_RELATIVE_PATH,
  ACTIVE_INDEX_SCHEMA,
  LEASE_CLAIM_DOMAIN,
  STAGES,
  TERMINAL_STAGES,
  advanceActiveSliceIndex,
  initializeActiveSliceIndex,
  readActiveSliceIndex,
  reserveCounter,
  takeoverExpiredLease,
  validateIndex,
  yieldActiveLease,
  writeIndexCas,
};
