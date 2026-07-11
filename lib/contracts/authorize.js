"use strict";

const {
  isOrdinaryPlainObject,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  addSecondsExactUtc,
  assertStrictJsonData,
  freezeDeep,
  cloneStrict,
} = require("./canonical-json");
const { validateRunSpecApproval } = require("./run-spec-approval");
const {
  validateExecutionReadinessFacts,
  bindReadinessToRunSpec,
  checkReadinessFreshness,
} = require("./execution-readiness-facts");
const {
  SCHEMA_VERSION,
  PREPARE_WORKSPACE_CAPABILITY,
  validateAttemptAuthorization,
  validateAuthorizationPolicy,
  sealAuthorizationReceipt,
  computeAuthorizationRequestDigest,
  isWithinAuthorizationWindow,
} = require("./attempt-authorization");

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function baseFailed(extra = {}) {
  return {
    ok: false, verdict: "FAILED", reasons: [], authorizationReceipt: null,
    runSpecDigest: null, approvalDigest: null, mutates: false,
    spawns_process: false, network: false, executes_child_commands: false, ...extra,
  };
}

function strictDataOrReasons(value, label) {
  try {
    assertStrictJsonData(value);
    return null;
  } catch (err) {
    return [reason(err.code || "STRICT_JSON", `${label}: ${err.message}`)];
  }
}

function exactKeysRequest(request) {
  if (!isOrdinaryPlainObject(request)) return false;
  const keys = Object.keys(request).sort();
  return keys.length === 2 && keys[0] === "attemptId" && keys[1] === "authorizationId";
}

const FORBIDDEN_REQUEST_FIELDS = [
  "issuedAt", "expiresAt", "authorizationTtlSeconds", "maxTtlSeconds",
  "provider", "requestedPreparationEffects", "allowedEffects", "capability",
  "executionReadinessDigest", "authorizationRequestDigest",
  "receiptDigest", "idempotencyKey", "approvalDigest", "runSpecDigest",
  "authorizationPolicyDigest", "workspacePolicyDigest",
];

const IDENTITY_KEYS = [
  "attemptId", "approvalDigest", "runSpecDigest", "executionReadinessDigest",
  "authorizationPolicyDigest", "workspacePolicyDigest", "capability",
  "authorizationRequestDigest",
];

/** Sealed validation → authId match → exact identity → TTL → window. */
function evaluatePriorReceipt(prior, expected, now, policy) {
  const priorCheck = validateAttemptAuthorization(prior);
  if (!priorCheck.ok) {
    return {
      ok: false, verdict: "FAILED",
      reasons: [reason("PRIOR_RECEIPT_INVALID", "priorReceipt failed sealed validation"), ...priorCheck.reasons],
    };
  }
  if (prior.authorizationId !== expected.authorizationId) {
    return {
      ok: false, verdict: "CONFLICT",
      reasons: [reason(
        "PRIOR_AUTHORIZATION_ID_MISMATCH",
        "supplied priorReceipt.authorizationId does not match request.authorizationId",
      )],
    };
  }
  const mismatches = IDENTITY_KEYS.filter((k) => prior[k] !== expected[k]);
  if (prior.provider?.id !== expected.provider.id
    || prior.provider?.workerProfile !== expected.provider.workerProfile) {
    mismatches.push("provider");
  }
  if (mismatches.length > 0) {
    return {
      ok: false, verdict: "CONFLICT",
      reasons: [reason(
        "AUTHORIZATION_ID_CONFLICT",
        `same authorizationId with different identity: ${mismatches.join(",")}`,
      )],
    };
  }
  const expectedExpires = addSecondsExactUtc(prior.issuedAt, policy.authorizationTtlSeconds);
  if (expectedExpires == null || prior.expiresAt !== expectedExpires) {
    return {
      ok: false, verdict: "CONFLICT",
      reasons: [reason(
        "PRIOR_TTL_MISMATCH",
        "prior.expiresAt must equal issuedAt + policy.authorizationTtlSeconds",
      )],
    };
  }
  if (!isWithinAuthorizationWindow(prior, now)) {
    return {
      ok: false, verdict: "STALE",
      reasons: [reason(
        "PRIOR_RECEIPT_OUTSIDE_WINDOW",
        "matching prior authorization is outside validity window at now",
      )],
    };
  }
  return { ok: true, authorizationReceipt: freezeDeep(cloneStrict(prior)) };
}

/**
 * Pure authorize:
 *   authorizeAttempt(runSpecApproval, readinessFacts, request, { now, policy, priorReceipt? })
 *
 * Content integrity only — not issuer provenance. Trusted runtime establishes custody.
 */
function authorizeAttempt(runSpecApproval, readinessFacts, request, options) {
  const base = baseFailed();
  const requestInput = request === undefined ? {} : request;
  const optionsInput = options === undefined ? {} : options;
  const requestStrict = strictDataOrReasons(requestInput, "request");
  if (requestStrict) return { ...base, reasons: requestStrict };
  const optionsStrict = strictDataOrReasons(optionsInput, "options");
  if (optionsStrict) return { ...base, reasons: optionsStrict };
  if (!isOrdinaryPlainObject(optionsInput)) {
    return { ...base, reasons: [reason("OPTIONS_REQUIRED", "options object is required")] };
  }
  if (isOrdinaryPlainObject(requestInput)) {
    for (const banned of FORBIDDEN_REQUEST_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(requestInput, banned)) {
        return {
          ...base,
          reasons: [reason("REQUEST_FIELD_FORBIDDEN", `request must not include ${banned}`)],
        };
      }
    }
  }

  const policyCheck = validateAuthorizationPolicy(optionsInput.policy);
  if (!policyCheck.ok) return { ...base, reasons: policyCheck.reasons };

  const approvalCheck = validateRunSpecApproval(runSpecApproval, {
    maxCommandTimeoutSeconds: optionsInput.policy.maxCommandTimeoutSeconds,
  });
  if (!approvalCheck.ok) return { ...base, reasons: approvalCheck.reasons };

  const runSpec = runSpecApproval.runSpec;
  const runSpecDigest = runSpecApproval.runSpecDigest;
  const approvalDigest = runSpecApproval.approvalDigest;
  const digests = { runSpecDigest, approvalDigest };
  const now = optionsInput.now;
  if (!isExactUtcTimestamp(now)) {
    return {
      ...base,
      reasons: [reason("NOW_REQUIRED", "options.now must be exact UTC timestamp YYYY-MM-DDTHH:mm:ss.sssZ")],
      ...digests,
    };
  }
  if (parseExactUtcTimestamp(runSpecApproval.approvedAt) > parseExactUtcTimestamp(now)) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason("APPROVAL_IN_FUTURE", "approval.approvedAt must not be after now")],
      ...digests,
    };
  }

  const readinessStruct = validateExecutionReadinessFacts(readinessFacts);
  if (!readinessStruct.ok) {
    return { ...base, verdict: "BLOCKED", reasons: readinessStruct.reasons, ...digests };
  }
  const readinessBind = bindReadinessToRunSpec(readinessFacts, runSpec, runSpecDigest);
  if (!readinessBind.ok) {
    return { ...base, verdict: "BLOCKED", reasons: readinessBind.reasons, ...digests };
  }
  if (readinessFacts.workspacePolicyDigest !== policyCheck.workspacePolicyDigest) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "WORKSPACE_POLICY_MISMATCH",
        "readiness.workspacePolicyDigest must match policy.workspacePolicy",
      )],
      ...digests,
    };
  }
  const freshness = checkReadinessFreshness(
    readinessFacts,
    runSpecApproval.approvedAt,
    now,
    optionsInput.policy.maxReadinessAgeSeconds,
  );
  if (!freshness.ok) {
    return { ...base, verdict: "STALE", reasons: freshness.reasons, ...digests };
  }
  if (!isOrdinaryPlainObject(requestInput) || !exactKeysRequest(requestInput)) {
    return {
      ...base,
      reasons: [reason("REQUEST_SHAPE", "request must be exactly { authorizationId, attemptId }")],
      ...digests,
    };
  }
  if (!isNonEmptyString(requestInput.authorizationId) || !isNonEmptyString(requestInput.attemptId)) {
    return {
      ...base,
      reasons: [reason("REQUEST_IDS_REQUIRED", "authorizationId and attemptId are required")],
      ...digests,
    };
  }
  const expiresAt = addSecondsExactUtc(now, optionsInput.policy.authorizationTtlSeconds);
  if (expiresAt == null) {
    return {
      ...base,
      reasons: [reason("TTL_ARITHMETIC_OVERFLOW", "authorization TTL cannot be applied safely to now")],
      ...digests,
    };
  }

  const provider = {
    id: policyCheck.provider.id,
    workerProfile: policyCheck.provider.workerProfile,
  };
  const authorizationRequestDigest = computeAuthorizationRequestDigest({
    authorizationId: requestInput.authorizationId,
    attemptId: requestInput.attemptId,
    approvalDigest,
    runSpecDigest,
    executionReadinessDigest: readinessFacts.readinessDigest,
    authorizationPolicyDigest: policyCheck.authorizationPolicyDigest,
    workspacePolicyDigest: policyCheck.workspacePolicyDigest,
    provider,
    capability: PREPARE_WORKSPACE_CAPABILITY,
  });
  const expectedIdentity = {
    authorizationId: requestInput.authorizationId,
    attemptId: requestInput.attemptId,
    approvalDigest,
    runSpecDigest,
    executionReadinessDigest: readinessFacts.readinessDigest,
    authorizationPolicyDigest: policyCheck.authorizationPolicyDigest,
    workspacePolicyDigest: policyCheck.workspacePolicyDigest,
    provider,
    capability: PREPARE_WORKSPACE_CAPABILITY,
    authorizationRequestDigest,
  };

  const prior = optionsInput.priorReceipt;
  if (prior != null) {
    const priorResult = evaluatePriorReceipt(prior, expectedIdentity, now, optionsInput.policy);
    if (!priorResult.ok) return { ...base, ...priorResult, ...digests };
    return {
      ok: true,
      verdict: "AUTHORIZED",
      reasons: [],
      authorizationReceipt: priorResult.authorizationReceipt,
      ...digests,
      idempotent: true,
      mutates: false,
      spawns_process: false,
      network: false,
      executes_child_commands: false,
    };
  }

  const body = {
    schemaVersion: SCHEMA_VERSION,
    authorizationId: requestInput.authorizationId,
    attemptId: requestInput.attemptId,
    approvalDigest,
    runSpecDigest,
    authorizationRequestDigest,
    executionReadinessDigest: readinessFacts.readinessDigest,
    authorizationPolicyDigest: policyCheck.authorizationPolicyDigest,
    workspacePolicyDigest: policyCheck.workspacePolicyDigest,
    provider,
    capability: PREPARE_WORKSPACE_CAPABILITY,
    issuedAt: now,
    expiresAt,
  };
  const receipt = sealAuthorizationReceipt(body);
  const sealedCheck = validateAttemptAuthorization(receipt);
  if (!sealedCheck.ok) return { ...base, reasons: sealedCheck.reasons, ...digests };
  return {
    ok: true,
    verdict: "AUTHORIZED",
    reasons: [],
    authorizationReceipt: receipt,
    ...digests,
    idempotent: false,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };
}

module.exports = { authorizeAttempt };
