"use strict";

const {
  isOrdinaryPlainObject,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  freezeDeep,
  cloneStrict,
  addSecondsExactUtc,
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

/**
 * Pure authorize:
 *   authorizeAttempt(runSpecApproval, readinessFacts, request, { now, policy, priorReceipt? })
 *
 * Content integrity only — not issuer provenance. Trusted runtime establishes custody.
 */
function authorizeAttempt(runSpecApproval, readinessFacts, request = {}, options = {}) {
  const base = {
    ok: false,
    verdict: "FAILED",
    reasons: [],
    authorizationReceipt: null,
    runSpecDigest: null,
    approvalDigest: null,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };

  if (!isOrdinaryPlainObject(options)) {
    return {
      ...base,
      reasons: [reason("OPTIONS_REQUIRED", "options object is required")],
    };
  }

  if (isOrdinaryPlainObject(request)) {
    for (const banned of [
      "issuedAt", "expiresAt", "authorizationTtlSeconds", "maxTtlSeconds",
      "provider", "requestedPreparationEffects", "allowedEffects", "capability",
      "executionReadinessDigest", "authorizationRequestDigest",
      "receiptDigest", "idempotencyKey", "approvalDigest", "runSpecDigest",
      "authorizationPolicyDigest", "workspacePolicyDigest",
    ]) {
      if (Object.prototype.hasOwnProperty.call(request, banned)) {
        return {
          ...base,
          reasons: [reason(
            "REQUEST_FIELD_FORBIDDEN",
            `request must not include ${banned}`,
          )],
        };
      }
    }
  }

  const policyCheck = validateAuthorizationPolicy(options.policy);
  if (!policyCheck.ok) {
    return { ...base, reasons: policyCheck.reasons };
  }

  const approvalCheck = validateRunSpecApproval(runSpecApproval, {
    maxCommandTimeoutSeconds: options.policy.maxCommandTimeoutSeconds,
  });
  if (!approvalCheck.ok) {
    return { ...base, reasons: approvalCheck.reasons };
  }

  const runSpec = runSpecApproval.runSpec;
  const runSpecDigest = runSpecApproval.runSpecDigest;
  const approvalDigest = runSpecApproval.approvalDigest;

  const now = options.now;
  if (!isExactUtcTimestamp(now)) {
    return {
      ...base,
      reasons: [reason("NOW_REQUIRED", "options.now must be exact UTC timestamp YYYY-MM-DDTHH:mm:ss.sssZ")],
      runSpecDigest,
      approvalDigest,
    };
  }

  const approvedAtMs = parseExactUtcTimestamp(runSpecApproval.approvedAt);
  const nowMs = parseExactUtcTimestamp(now);
  if (approvedAtMs > nowMs) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason("APPROVAL_IN_FUTURE", "approval.approvedAt must not be after now")],
      runSpecDigest,
      approvalDigest,
    };
  }

  const readinessStruct = validateExecutionReadinessFacts(readinessFacts);
  if (!readinessStruct.ok) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: readinessStruct.reasons,
      runSpecDigest,
      approvalDigest,
    };
  }

  const readinessBind = bindReadinessToRunSpec(readinessFacts, runSpec, runSpecDigest);
  if (!readinessBind.ok) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: readinessBind.reasons,
      runSpecDigest,
      approvalDigest,
    };
  }

  if (readinessFacts.workspacePolicyDigest !== policyCheck.workspacePolicyDigest) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "WORKSPACE_POLICY_MISMATCH",
        "readiness.workspacePolicyDigest must match policy.workspacePolicy",
      )],
      runSpecDigest,
      approvalDigest,
    };
  }

  const freshness = checkReadinessFreshness(
    readinessFacts,
    runSpecApproval.approvedAt,
    now,
    options.policy.maxReadinessAgeSeconds,
  );
  if (!freshness.ok) {
    return {
      ...base,
      verdict: "STALE",
      reasons: freshness.reasons,
      runSpecDigest,
      approvalDigest,
    };
  }

  if (!isOrdinaryPlainObject(request)
    || !exactKeysRequest(request)) {
    return {
      ...base,
      reasons: [reason(
        "REQUEST_SHAPE",
        "request must be exactly { authorizationId, attemptId }",
      )],
      runSpecDigest,
      approvalDigest,
    };
  }
  if (!isNonEmptyString(request.authorizationId) || !isNonEmptyString(request.attemptId)) {
    return {
      ...base,
      reasons: [reason("REQUEST_IDS_REQUIRED", "authorizationId and attemptId are required")],
      runSpecDigest,
      approvalDigest,
    };
  }

  const expiresAt = addSecondsExactUtc(now, options.policy.authorizationTtlSeconds);
  if (expiresAt == null) {
    return {
      ...base,
      reasons: [reason(
        "TTL_ARITHMETIC_OVERFLOW",
        "authorization TTL cannot be applied safely to now",
      )],
      runSpecDigest,
      approvalDigest,
    };
  }

  const authorizationRequestDigest = computeAuthorizationRequestDigest({
    approvalDigest,
    executionReadinessDigest: readinessFacts.readinessDigest,
    authorizationPolicyDigest: policyCheck.authorizationPolicyDigest,
    attemptId: request.attemptId,
    capability: PREPARE_WORKSPACE_CAPABILITY,
  });

  const body = {
    schemaVersion: SCHEMA_VERSION,
    authorizationId: request.authorizationId,
    attemptId: request.attemptId,
    approvalDigest,
    runSpecDigest,
    authorizationRequestDigest,
    executionReadinessDigest: readinessFacts.readinessDigest,
    authorizationPolicyDigest: policyCheck.authorizationPolicyDigest,
    workspacePolicyDigest: policyCheck.workspacePolicyDigest,
    provider: {
      id: policyCheck.provider.id,
      workerProfile: policyCheck.provider.workerProfile,
    },
    capability: PREPARE_WORKSPACE_CAPABILITY,
    issuedAt: now,
    expiresAt,
  };

  const receipt = sealAuthorizationReceipt(body);
  const sealedCheck = validateAttemptAuthorization(receipt);
  if (!sealedCheck.ok) {
    return {
      ...base,
      reasons: sealedCheck.reasons,
      runSpecDigest,
      approvalDigest,
    };
  }

  const prior = options.priorReceipt;
  if (prior != null) {
    const priorCheck = validateAttemptAuthorization(prior);
    if (!priorCheck.ok) {
      return {
        ...base,
        verdict: "FAILED",
        reasons: [
          reason("PRIOR_RECEIPT_INVALID", "priorReceipt failed sealed validation"),
          ...priorCheck.reasons,
        ],
        runSpecDigest,
        approvalDigest,
      };
    }
    if (prior.authorizationId === request.authorizationId) {
      if (prior.authorizationRequestDigest !== authorizationRequestDigest) {
        return {
          ...base,
          verdict: "CONFLICT",
          reasons: [reason(
            "AUTHORIZATION_ID_CONFLICT",
            "same authorizationId with different authorization request digest",
          )],
          runSpecDigest,
          approvalDigest,
        };
      }
      if (!isWithinAuthorizationWindow(prior, now)) {
        return {
          ...base,
          verdict: "STALE",
          reasons: [reason(
            "PRIOR_RECEIPT_OUTSIDE_WINDOW",
            "matching prior authorization is outside validity window at now",
          )],
          runSpecDigest,
          approvalDigest,
        };
      }
      return {
        ok: true,
        verdict: "AUTHORIZED",
        reasons: [],
        authorizationReceipt: freezeDeep(cloneStrict(prior)),
        runSpecDigest,
        approvalDigest,
        idempotent: true,
        mutates: false,
        spawns_process: false,
        network: false,
        executes_child_commands: false,
      };
    }
  }

  return {
    ok: true,
    verdict: "AUTHORIZED",
    reasons: [],
    authorizationReceipt: receipt,
    runSpecDigest,
    approvalDigest,
    idempotent: false,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };
}

function exactKeysRequest(request) {
  if (!isOrdinaryPlainObject(request)) return false;
  const keys = Object.keys(request).sort();
  return keys.length === 2 && keys[0] === "attemptId" && keys[1] === "authorizationId";
}

module.exports = {
  authorizeAttempt,
};
