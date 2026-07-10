"use strict";

const { digestOf, isDigest } = require("./digest");

const SCHEMA_VERSION = "run-manifest/v0";

const REQUIRED_WORKER_PERMISSIONS = {
  network: "denied",
  protectedBranchWrite: "denied",
  subagents: "denied",
  hostCheckoutWrite: "denied",
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function reason(code, detail) {
  return { code, detail };
}

/**
 * Fields excluded from canonical digest (set only after hash computation).
 */
function digestBody(manifest) {
  if (!isPlainObject(manifest)) return null;
  const { manifestDigest: _omit, ...rest } = manifest;
  return rest;
}

function computeManifestDigest(manifest) {
  const body = digestBody(manifest);
  if (!body) {
    throw new TypeError("manifest must be a plain object");
  }
  return digestOf(body);
}

function validatePermissions(permissions, reasons) {
  if (!isPlainObject(permissions)) {
    reasons.push(reason("PERMISSIONS_MISSING", "permissions object is required"));
    return;
  }
  const worker = permissions.worker;
  if (!isPlainObject(worker)) {
    reasons.push(reason("WORKER_PERMISSIONS_MISSING", "permissions.worker is required"));
  } else {
    for (const [key, expected] of Object.entries(REQUIRED_WORKER_PERMISSIONS)) {
      if (worker[key] !== expected) {
        reasons.push(reason(
          "WORKER_PERMISSION_INVALID",
          `permissions.worker.${key} must be ${JSON.stringify(expected)}`,
        ));
      }
    }
  }

  const delivery = permissions.delivery;
  if (!isPlainObject(delivery)) {
    reasons.push(reason("DELIVERY_PERMISSIONS_MISSING", "permissions.delivery is required"));
    return;
  }
  if (delivery.protectedBranchWrite !== "denied") {
    reasons.push(reason(
      "DELIVERY_PERMISSION_INVALID",
      'permissions.delivery.protectedBranchWrite must be "denied"',
    ));
  }
  if (delivery.merge !== "denied") {
    reasons.push(reason(
      "DELIVERY_PERMISSION_INVALID",
      'permissions.delivery.merge must be "denied"',
    ));
  }
  if (delivery.network !== "allowlisted_push_and_draft_pr_only") {
    reasons.push(reason(
      "DELIVERY_PERMISSION_INVALID",
      'permissions.delivery.network must be "allowlisted_push_and_draft_pr_only"',
    ));
  }
  if (delivery.createDraftPr !== true) {
    reasons.push(reason(
      "DELIVERY_PERMISSION_INVALID",
      "permissions.delivery.createDraftPr must be true",
    ));
  }
  if (delivery.pushBranch !== true) {
    reasons.push(reason(
      "DELIVERY_PERMISSION_INVALID",
      "permissions.delivery.pushBranch must be true",
    ));
  }
}

/**
 * Validate a pre-authorize (draft) or authorized RunManifest structure.
 * Does not check gate openness, expiry clock, or repo HEAD — that is authorize().
 *
 * @returns {{ ok: boolean, reasons: Array<{code:string,detail:string}> }}
 */
function validateRunManifest(manifest, { requireAuthorized = false } = {}) {
  const reasons = [];
  if (!isPlainObject(manifest)) {
    return { ok: false, reasons: [reason("MANIFEST_NOT_OBJECT", "manifest must be a plain object")] };
  }

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason(
      "SCHEMA_VERSION_INVALID",
      `schemaVersion must be ${SCHEMA_VERSION}`,
    ));
  }
  for (const key of ["runId", "attemptId", "packetId", "idempotencyToken", "objective"]) {
    if (!isNonEmptyString(manifest[key])) {
      reasons.push(reason("FIELD_REQUIRED", `${key} must be a non-empty string`));
    }
  }
  if (!isNonEmptyString(manifest.expiresAt)) {
    reasons.push(reason("EXPIRES_AT_REQUIRED", "expiresAt must be a non-empty ISO timestamp"));
  } else if (Number.isNaN(Date.parse(manifest.expiresAt))) {
    reasons.push(reason("EXPIRES_AT_INVALID", "expiresAt must be a valid ISO timestamp"));
  }

  if (!isDigest(manifest.operatorPlanArtifactDigest)) {
    reasons.push(reason(
      "OPERATOR_PLAN_DIGEST_MISSING",
      "operatorPlanArtifactDigest must be sha256:<64 hex>",
    ));
  }

  const repo = manifest.repository;
  if (!isPlainObject(repo)) {
    reasons.push(reason("REPOSITORY_MISSING", "repository object is required"));
  } else {
    if (!isNonEmptyString(repo.path)) {
      reasons.push(reason("REPOSITORY_PATH_REQUIRED", "repository.path is required"));
    }
    if (!isNonEmptyString(repo.baseRevision)) {
      reasons.push(reason("BASE_REVISION_REQUIRED", "repository.baseRevision is required"));
    }
  }

  const scope = manifest.scope;
  if (!isPlainObject(scope)) {
    reasons.push(reason("SCOPE_MISSING", "scope object is required"));
  } else {
    if (!Array.isArray(scope.allow) || scope.allow.length === 0) {
      reasons.push(reason("SCOPE_ALLOW_REQUIRED", "scope.allow must be a non-empty array"));
    } else if (!scope.allow.every(isNonEmptyString)) {
      reasons.push(reason("SCOPE_ALLOW_INVALID", "scope.allow entries must be non-empty strings"));
    }
    if (!Array.isArray(scope.deny)) {
      reasons.push(reason("SCOPE_DENY_REQUIRED", "scope.deny must be an array (may be empty)"));
    } else if (!scope.deny.every(isNonEmptyString)) {
      reasons.push(reason("SCOPE_DENY_INVALID", "scope.deny entries must be non-empty strings"));
    }
  }

  const validation = manifest.validation;
  if (!isPlainObject(validation) || !Array.isArray(validation.commands) || validation.commands.length === 0) {
    reasons.push(reason(
      "VALIDATION_COMMANDS_REQUIRED",
      "validation.commands must be a non-empty array",
    ));
  } else if (!validation.commands.every(isNonEmptyString)) {
    reasons.push(reason("VALIDATION_COMMANDS_INVALID", "validation.commands must be non-empty strings"));
  }

  const delivery = manifest.delivery;
  if (!isPlainObject(delivery)) {
    reasons.push(reason("DELIVERY_MISSING", "delivery object is required"));
  } else {
    if (delivery.mode !== "draft-pr") {
      reasons.push(reason("DELIVERY_MODE_INVALID", 'delivery.mode must be "draft-pr" for v0'));
    }
    if (!isNonEmptyString(delivery.targetBranch)) {
      reasons.push(reason("DELIVERY_TARGET_BRANCH_REQUIRED", "delivery.targetBranch is required"));
    }
  }

  const budgets = manifest.budgets;
  if (!isPlainObject(budgets)) {
    reasons.push(reason("BUDGETS_MISSING", "budgets object is required"));
  } else {
    if (!Number.isInteger(budgets.attempts) || budgets.attempts < 1) {
      reasons.push(reason("BUDGETS_ATTEMPTS_INVALID", "budgets.attempts must be an integer >= 1"));
    }
    if (!Number.isInteger(budgets.wallClockMinutes) || budgets.wallClockMinutes < 1) {
      reasons.push(reason(
        "BUDGETS_WALL_CLOCK_INVALID",
        "budgets.wallClockMinutes must be an integer >= 1",
      ));
    }
  }

  validatePermissions(manifest.permissions, reasons);

  const executor = manifest.executor;
  if (!isPlainObject(executor)) {
    reasons.push(reason("EXECUTOR_MISSING", "executor object is required"));
  } else {
    if (!isNonEmptyString(executor.provider)) {
      reasons.push(reason("EXECUTOR_PROVIDER_REQUIRED", "executor.provider is required"));
    }
    if (!isNonEmptyString(executor.worker)) {
      reasons.push(reason("EXECUTOR_WORKER_REQUIRED", "executor.worker is required"));
    }
  }

  if (requireAuthorized) {
    if (!isNonEmptyString(manifest.authorizedAt) || Number.isNaN(Date.parse(manifest.authorizedAt))) {
      reasons.push(reason("AUTHORIZED_AT_REQUIRED", "authorizedAt must be a valid ISO timestamp"));
    }
    if (!isDigest(manifest.workerEntryGateDigest)) {
      reasons.push(reason(
        "WORKER_ENTRY_GATE_DIGEST_REQUIRED",
        "workerEntryGateDigest must be sha256:<64 hex>",
      ));
    }
    if (!isDigest(manifest.manifestDigest)) {
      reasons.push(reason("MANIFEST_DIGEST_REQUIRED", "manifestDigest must be sha256:<64 hex>"));
    } else {
      const expected = computeManifestDigest(manifest);
      if (manifest.manifestDigest !== expected) {
        reasons.push(reason(
          "MANIFEST_DIGEST_MISMATCH",
          "manifestDigest does not match canonical digest of manifest body",
        ));
      }
    }
    const gate = manifest.gate;
    if (!isPlainObject(gate)
      || gate.workerEntryGateOk !== true
      || gate.workerEntryGateVerdict !== "open") {
      reasons.push(reason(
        "GATE_BINDING_INVALID",
        "gate must record workerEntryGateOk=true and verdict open",
      ));
    }
  } else if (manifest.manifestDigest != null) {
    // Draft must not carry an authority digest.
    reasons.push(reason(
      "MANIFEST_DIGEST_PREMATURE",
      "manifestDigest must be null/absent until after successful authorize",
    ));
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Build a minimal valid draft manifest for tests/fixtures.
 * Callers may override any field.
 */
function buildDraftRunManifest(overrides = {}) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    runId: "RUN-0001",
    attemptId: "RUN-0001-A1",
    packetId: "MWP-0001",
    idempotencyToken: "run:RUN-0001:attempt:A1",
    authorizedAt: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    operatorPlanArtifactDigest: digestOf({ kind: "fixture-plan", id: "plan-1" }),
    workerEntryGateDigest: null,
    manifestDigest: null,
    gate: {
      workerEntryGateOk: false,
      workerEntryGateVerdict: null,
    },
    repository: {
      path: "/repos/example",
      baseRevision: "abc123def4567890abc123def4567890abc123de",
    },
    objective: "Fix a deterministic fixture defect and add a regression test.",
    scope: {
      allow: ["src/**", "tests/**"],
      deny: ["migrations/**", "infrastructure/**"],
    },
    validation: {
      commands: ["npm test -- session"],
    },
    delivery: {
      mode: "draft-pr",
      targetBranch: "main",
    },
    budgets: {
      attempts: 1,
      wallClockMinutes: 45,
    },
    permissions: {
      worker: { ...REQUIRED_WORKER_PERMISSIONS },
      delivery: {
        network: "allowlisted_push_and_draft_pr_only",
        createDraftPr: true,
        pushBranch: true,
        protectedBranchWrite: "denied",
        merge: "denied",
      },
    },
    executor: {
      provider: "agent-orchestrator",
      worker: "codex",
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (isPlainObject(v) && isPlainObject(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_WORKER_PERMISSIONS,
  validateRunManifest,
  computeManifestDigest,
  digestBody,
  buildDraftRunManifest,
};
