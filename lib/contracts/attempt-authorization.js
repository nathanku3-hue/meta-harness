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
  addSecondsExactUtc,
} = require("./canonical-json");

const SCHEMA_VERSION = "attempt-authorization/v1";
const DOMAIN = "attempt-authorization/v1";
const REQUEST_DOMAIN = "authorization-request/v1";
const POLICY_DOMAIN = "authorization-policy/v1";
const WORKSPACE_POLICY_DOMAIN = "workspace-policy/v1";
const WORKSPACE_POLICY_SCHEMA = "workspace-policy/v1";

/** Sole pre-start capability — not request-configurable. */
const PREPARE_WORKSPACE_CAPABILITY = "prepare-workspace";

/** Protocol ceilings — policy may only tighten. */
const PROTOCOL_MAX_AUTHORIZATION_TTL_SECONDS = 86400;
const PROTOCOL_MAX_READINESS_AGE_SECONDS = 86400;
const PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS = 86400;

const SEALED_KEYS = Object.freeze([
  "schemaVersion",
  "authorizationId",
  "attemptId",
  "approvalDigest",
  "runSpecDigest",
  "authorizationRequestDigest",
  "executionReadinessDigest",
  "authorizationPolicyDigest",
  "workspacePolicyDigest",
  "provider",
  "capability",
  "issuedAt",
  "expiresAt",
  "receiptDigest",
]);

const BODY_KEYS = SEALED_KEYS.filter((k) => k !== "receiptDigest");

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function receiptBody(receipt) {
  if (!isOrdinaryPlainObject(receipt)) return null;
  const body = {};
  for (const k of BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(receipt, k)) body[k] = receipt[k];
  }
  return body;
}

function computeReceiptDigest(receipt) {
  return domainDigest(DOMAIN, receiptBody(receipt));
}

/**
 * Full explicit authorization request identity — no transitive field omission.
 */
function authorizationRequestIdentity(fields) {
  return {
    authorizationId: fields.authorizationId,
    attemptId: fields.attemptId,
    approvalDigest: fields.approvalDigest,
    runSpecDigest: fields.runSpecDigest,
    executionReadinessDigest: fields.executionReadinessDigest,
    authorizationPolicyDigest: fields.authorizationPolicyDigest,
    workspacePolicyDigest: fields.workspacePolicyDigest,
    provider: {
      id: fields.provider.id,
      workerProfile: fields.provider.workerProfile,
    },
    capability: fields.capability,
  };
}

function computeAuthorizationRequestDigest(fields) {
  return domainDigest(REQUEST_DOMAIN, authorizationRequestIdentity(fields));
}

function computeAuthorizationRequestDigestFromReceipt(receipt) {
  return computeAuthorizationRequestDigest({
    authorizationId: receipt.authorizationId,
    attemptId: receipt.attemptId,
    approvalDigest: receipt.approvalDigest,
    runSpecDigest: receipt.runSpecDigest,
    executionReadinessDigest: receipt.executionReadinessDigest,
    authorizationPolicyDigest: receipt.authorizationPolicyDigest,
    workspacePolicyDigest: receipt.workspacePolicyDigest,
    provider: receipt.provider,
    capability: receipt.capability,
  });
}

function sealAuthorizationReceipt(body) {
  const without = { ...body };
  delete without.receiptDigest;
  const receiptDigest = domainDigest(DOMAIN, without);
  return freezeDeep({ ...without, receiptDigest });
}

function computeWorkspacePolicyDigest(workspacePolicy) {
  return domainDigest(WORKSPACE_POLICY_DOMAIN, workspacePolicy);
}

function computeAuthorizationPolicyDigest(policyBody) {
  return domainDigest(POLICY_DOMAIN, policyBody);
}

function checkBoundedInt(name, value, max, reasons) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    reasons.push(reason(
      "POLICY_BOUND_INVALID",
      `${name} must be integer in [1, ${max}]`,
    ));
    return false;
  }
  if (!Number.isSafeInteger(value * 1000)) {
    reasons.push(reason("POLICY_ARITHMETIC_OVERFLOW", `${name} causes unsafe millisecond arithmetic`));
    return false;
  }
  return true;
}

/**
 * Validate trusted policy; return digests and normalized provider/workspacePolicy or reasons.
 * Workspace policy path rules reuse validateWorkspacePolicyObject (lazy require).
 */
function validateAuthorizationPolicy(policy) {
  const reasons = [];
  if (!isOrdinaryPlainObject(policy)) {
    return {
      ok: false,
      reasons: [reason("POLICY_REQUIRED", "options.policy object is required")],
    };
  }
  try {
    assertStrictJsonData(policy);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  if (!exactKeys(policy, [
    "authorizationTtlSeconds",
    "maxReadinessAgeSeconds",
    "maxCommandTimeoutSeconds",
    "provider",
    "workspacePolicy",
  ])) {
    return {
      ok: false,
      reasons: [reason(
        "POLICY_SHAPE",
        "policy must be exactly { authorizationTtlSeconds, maxReadinessAgeSeconds, maxCommandTimeoutSeconds, provider, workspacePolicy }",
      )],
    };
  }

  checkBoundedInt(
    "authorizationTtlSeconds",
    policy.authorizationTtlSeconds,
    PROTOCOL_MAX_AUTHORIZATION_TTL_SECONDS,
    reasons,
  );
  checkBoundedInt(
    "maxReadinessAgeSeconds",
    policy.maxReadinessAgeSeconds,
    PROTOCOL_MAX_READINESS_AGE_SECONDS,
    reasons,
  );
  checkBoundedInt(
    "maxCommandTimeoutSeconds",
    policy.maxCommandTimeoutSeconds,
    PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS,
    reasons,
  );

  const provider = policy.provider;
  if (!isOrdinaryPlainObject(provider)
    || !exactKeys(provider, ["id", "workerProfile"])
    || !isNonEmptyString(provider.id)
    || !isNonEmptyString(provider.workerProfile)) {
    reasons.push(reason("PROVIDER_REQUIRED", "policy.provider must be { id, workerProfile }"));
  }

  // Lazy require avoids circular load with workspace-attestation.
  const { validateWorkspacePolicyObject } = require("./workspace-attestation");
  const wpCheck = validateWorkspacePolicyObject(policy.workspacePolicy);
  if (!wpCheck.ok) {
    reasons.push(...wpCheck.reasons);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const wp = policy.workspacePolicy;
  let authorizationPolicyDigest;
  try {
    authorizationPolicyDigest = computeAuthorizationPolicyDigest({
      authorizationTtlSeconds: policy.authorizationTtlSeconds,
      maxReadinessAgeSeconds: policy.maxReadinessAgeSeconds,
      maxCommandTimeoutSeconds: policy.maxCommandTimeoutSeconds,
      provider: { id: provider.id, workerProfile: provider.workerProfile },
      workspacePolicy: {
        schemaVersion: wp.schemaVersion,
        approvedRoot: wp.approvedRoot,
      },
    });
  } catch (err) {
    return {
      ok: false,
      reasons: [reason(err.code || "POLICY_DIGEST_FAILED", err.message)],
    };
  }

  return {
    ok: true,
    reasons: [],
    provider: { id: provider.id, workerProfile: provider.workerProfile },
    workspacePolicy: {
      schemaVersion: wp.schemaVersion,
      approvedRoot: wp.approvedRoot,
    },
    workspacePolicyDigest: wpCheck.digest,
    authorizationPolicyDigest,
  };
}

function validateAuthorizationReceiptBody(receipt) {
  const reasons = [];
  if (!isOrdinaryPlainObject(receipt)) {
    return {
      ok: false,
      reasons: [reason("RECEIPT_NOT_OBJECT", "authorization must be a plain object")],
    };
  }
  try {
    assertStrictJsonData(receipt);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  const keys = Object.keys(receipt);
  const hasDigest = keys.includes("receiptDigest");
  const expected = hasDigest ? SEALED_KEYS : BODY_KEYS;
  if (!exactKeys(receipt, expected)) {
    return {
      ok: false,
      reasons: [reason("RECEIPT_SHAPE", "authorization has unexpected or missing fields")],
    };
  }

  if (receipt.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${SCHEMA_VERSION}`));
  }
  for (const key of ["authorizationId", "attemptId"]) {
    if (!isNonEmptyString(receipt[key])) {
      reasons.push(reason("FIELD_REQUIRED", `${key} must be a non-empty string`));
    }
  }
  for (const key of [
    "approvalDigest",
    "runSpecDigest",
    "authorizationRequestDigest",
    "executionReadinessDigest",
    "authorizationPolicyDigest",
    "workspacePolicyDigest",
  ]) {
    if (!isDigest(receipt[key])) {
      reasons.push(reason("DIGEST_REQUIRED", `${key} must be sha256:<64 hex>`));
    }
  }
  if (!isOrdinaryPlainObject(receipt.provider)
    || !exactKeys(receipt.provider, ["id", "workerProfile"])
    || !isNonEmptyString(receipt.provider.id)
    || !isNonEmptyString(receipt.provider.workerProfile)) {
    reasons.push(reason("PROVIDER_REQUIRED", "provider must be { id, workerProfile }"));
  }
  if (receipt.capability !== PREPARE_WORKSPACE_CAPABILITY) {
    reasons.push(reason(
      "CAPABILITY_INVALID",
      `capability must be exactly "${PREPARE_WORKSPACE_CAPABILITY}"`,
    ));
  }
  if (!isExactUtcTimestamp(receipt.issuedAt)) {
    reasons.push(reason("ISSUED_AT_INVALID", "issuedAt must be exact UTC timestamp"));
  }
  if (!isExactUtcTimestamp(receipt.expiresAt)) {
    reasons.push(reason("EXPIRES_AT_INVALID", "expiresAt must be exact UTC timestamp"));
  }
  if (isExactUtcTimestamp(receipt.issuedAt) && isExactUtcTimestamp(receipt.expiresAt)) {
    if (parseExactUtcTimestamp(receipt.issuedAt) >= parseExactUtcTimestamp(receipt.expiresAt)) {
      reasons.push(reason("CHRONOLOGY_INVALID", "issuedAt must be < expiresAt"));
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function validateAttemptAuthorization(receipt) {
  const base = validateAuthorizationReceiptBody(receipt);
  if (!base.ok) return base;
  const reasons = [];
  if (!isDigest(receipt.receiptDigest)) {
    reasons.push(reason("RECEIPT_DIGEST_REQUIRED", "receiptDigest is required on sealed authorization"));
  } else {
    const expected = computeReceiptDigest(receipt);
    if (receipt.receiptDigest !== expected) {
      reasons.push(reason("RECEIPT_DIGEST_MISMATCH", "receiptDigest does not match body"));
    }
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // Request-digest self-consistency is a receipt invariant (not only idempotency).
  let expectedRequestDigest;
  try {
    expectedRequestDigest = computeAuthorizationRequestDigestFromReceipt(receipt);
  } catch (err) {
    return {
      ok: false,
      reasons: [reason(err.code || "REQUEST_DIGEST_RECOMPUTE_FAILED", err.message)],
    };
  }
  if (receipt.authorizationRequestDigest !== expectedRequestDigest) {
    return {
      ok: false,
      reasons: [reason(
        "AUTHORIZATION_REQUEST_DIGEST_MISMATCH",
        "authorizationRequestDigest does not match receipt identity fields",
      )],
    };
  }
  return { ok: true, reasons: [] };
}

function isWithinAuthorizationWindow(receipt, at) {
  if (!isExactUtcTimestamp(at) || !isExactUtcTimestamp(receipt.issuedAt)
    || !isExactUtcTimestamp(receipt.expiresAt)) {
    return false;
  }
  const t = parseExactUtcTimestamp(at);
  const issued = parseExactUtcTimestamp(receipt.issuedAt);
  const exp = parseExactUtcTimestamp(receipt.expiresAt);
  return issued <= t && t < exp;
}

module.exports = {
  SCHEMA_VERSION,
  DOMAIN,
  REQUEST_DOMAIN,
  POLICY_DOMAIN,
  WORKSPACE_POLICY_DOMAIN,
  WORKSPACE_POLICY_SCHEMA,
  PREPARE_WORKSPACE_CAPABILITY,
  PROTOCOL_MAX_AUTHORIZATION_TTL_SECONDS,
  PROTOCOL_MAX_READINESS_AGE_SECONDS,
  PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS,
  validateAttemptAuthorization,
  validateAuthorizationPolicy,
  computeReceiptDigest,
  computeAuthorizationRequestDigest,
  computeAuthorizationRequestDigestFromReceipt,
  authorizationRequestIdentity,
  computeWorkspacePolicyDigest,
  computeAuthorizationPolicyDigest,
  sealAuthorizationReceipt,
  isWithinAuthorizationWindow,
  addSecondsExactUtc,
  freezeDeep,
  cloneStrict,
};
