"use strict";

const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  freezeDeep,
  cloneStrict,
} = require("./canonical-json");
const { isHexRevision } = require("./run-spec");

const SCHEMA_VERSION = "execution-readiness-facts/v1";
const DOMAIN = "execution-readiness-facts/v1";

const BODY_KEYS = [
  "schemaVersion",
  "runSpecDigest",
  "repositoryId",
  "objectFormat",
  "observedHeadRevision",
  "clean",
  "inspectedAt",
  "workspacePolicyDigest",
];

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function factsBody(facts) {
  const body = {};
  for (const k of BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(facts, k)) body[k] = facts[k];
  }
  return body;
}

function computeReadinessDigest(facts) {
  return domainDigest(DOMAIN, factsBody(facts));
}

function sealExecutionReadinessFacts(body) {
  const without = { ...body };
  delete without.readinessDigest;
  const readinessDigest = domainDigest(DOMAIN, without);
  return freezeDeep({ ...without, readinessDigest });
}

/**
 * Structural + digest validation of sealed ExecutionReadinessFacts.
 * Semantic binding to a RunSpec is applied by authorizeAttempt.
 */
function validateExecutionReadinessFacts(facts) {
  const reasons = [];
  if (!isOrdinaryPlainObject(facts)) {
    return {
      ok: false,
      reasons: [reason("READINESS_NOT_OBJECT", "executionReadinessFacts must be a plain object")],
    };
  }
  try {
    assertStrictJsonData(facts);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  if (!exactKeys(facts, [...BODY_KEYS, "readinessDigest"])) {
    return {
      ok: false,
      reasons: [reason(
        "READINESS_SHAPE",
        "executionReadinessFacts must be exactly the sealed readiness-facts shape",
      )],
    };
  }

  if (facts.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${SCHEMA_VERSION}`));
  }
  if (!isDigest(facts.runSpecDigest)) {
    reasons.push(reason("RUN_SPEC_DIGEST_REQUIRED", "runSpecDigest must be sha256 digest"));
  }
  if (!isNonEmptyString(facts.repositoryId)) {
    reasons.push(reason("REPOSITORY_ID_REQUIRED", "repositoryId is required"));
  }
  if (facts.objectFormat !== "sha1" && facts.objectFormat !== "sha256") {
    reasons.push(reason("OBJECT_FORMAT_INVALID", 'objectFormat must be "sha1" or "sha256"'));
  }
  if (!isHexRevision(facts.observedHeadRevision, facts.objectFormat)) {
    reasons.push(reason(
      "OBSERVED_HEAD_INVALID",
      "observedHeadRevision must be full lowercase hex for objectFormat",
    ));
  }
  if (facts.clean !== true) {
    reasons.push(reason("READINESS_NOT_CLEAN", "clean must be true"));
  }
  if (!isExactUtcTimestamp(facts.inspectedAt)) {
    reasons.push(reason("INSPECTED_AT_INVALID", "inspectedAt must be exact UTC timestamp"));
  }
  if (!isDigest(facts.workspacePolicyDigest)) {
    reasons.push(reason("WORKSPACE_POLICY_DIGEST_REQUIRED", "workspacePolicyDigest required"));
  }
  if (!isDigest(facts.readinessDigest)) {
    reasons.push(reason("READINESS_DIGEST_REQUIRED", "readinessDigest is required"));
  } else if (facts.readinessDigest !== computeReadinessDigest(facts)) {
    reasons.push(reason("READINESS_DIGEST_MISMATCH", "readinessDigest does not match body"));
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Bind readiness facts to a validated RunSpec (+ digests).
 */
function bindReadinessToRunSpec(facts, runSpec, runSpecDigest) {
  const reasons = [];
  if (facts.runSpecDigest !== runSpecDigest) {
    reasons.push(reason("READINESS_RUN_SPEC_MISMATCH", "readiness runSpecDigest does not match approval"));
  }
  if (facts.repositoryId !== runSpec.repository.repositoryId) {
    reasons.push(reason("READINESS_REPOSITORY_MISMATCH", "repositoryId does not match RunSpec"));
  }
  if (facts.objectFormat !== runSpec.repository.objectFormat) {
    reasons.push(reason("READINESS_OBJECT_FORMAT_MISMATCH", "objectFormat does not match RunSpec"));
  }
  if (facts.observedHeadRevision !== runSpec.repository.expectedBaseRevision) {
    reasons.push(reason(
      "READINESS_HEAD_MISMATCH",
      "observedHeadRevision must equal RunSpec.repository.expectedBaseRevision",
    ));
  }
  if (facts.clean !== true) {
    reasons.push(reason("READINESS_NOT_CLEAN", "clean must be true"));
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Chronology + freshness vs approval and now.
 */
function checkReadinessFreshness(facts, approvedAt, now, maxReadinessAgeSeconds) {
  const reasons = [];
  if (!isExactUtcTimestamp(approvedAt) || !isExactUtcTimestamp(now)
    || !isExactUtcTimestamp(facts.inspectedAt)) {
    return {
      ok: false,
      reasons: [reason("READINESS_FRESHNESS_INPUTS", "approvedAt, inspectedAt, now must be exact UTC")],
    };
  }
  if (!Number.isInteger(maxReadinessAgeSeconds) || maxReadinessAgeSeconds < 1) {
    return {
      ok: false,
      reasons: [reason("MAX_READINESS_AGE_INVALID", "maxReadinessAgeSeconds must be integer >= 1")],
    };
  }

  let approvedMs;
  let inspectedMs;
  let nowMs;
  try {
    approvedMs = parseExactUtcTimestamp(approvedAt);
    inspectedMs = parseExactUtcTimestamp(facts.inspectedAt);
    nowMs = parseExactUtcTimestamp(now);
  } catch (err) {
    return { ok: false, reasons: [reason("TIMESTAMP_INVALID", err.message)] };
  }

  if (inspectedMs < approvedMs) {
    reasons.push(reason(
      "READINESS_BEFORE_APPROVAL",
      "readiness.inspectedAt must be >= approval.approvedAt",
    ));
  }
  if (inspectedMs > nowMs) {
    reasons.push(reason("READINESS_IN_FUTURE", "readiness.inspectedAt must be <= now"));
  }
  if (!Number.isSafeInteger(maxReadinessAgeSeconds * 1000)) {
    reasons.push(reason("READINESS_AGE_OVERFLOW", "maxReadinessAgeSeconds causes unsafe arithmetic"));
  } else {
    const age = nowMs - inspectedMs;
    if (age > maxReadinessAgeSeconds * 1000) {
      reasons.push(reason("READINESS_STALE", "readiness exceeds maxReadinessAgeSeconds"));
    }
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  SCHEMA_VERSION,
  DOMAIN,
  validateExecutionReadinessFacts,
  bindReadinessToRunSpec,
  checkReadinessFreshness,
  computeReadinessDigest,
  sealExecutionReadinessFacts,
  freezeDeep,
  cloneStrict,
};
