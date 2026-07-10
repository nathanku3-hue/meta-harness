"use strict";

const { digestOf, isDigest } = require("./digest");

const SCHEMA_VERSION = "evidence-bundle/v0";

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
 * Structural validation of an EvidenceBundle (facts shape only).
 * Semantic READY/BLOCKED/FAILED is verifyEvidence().
 *
 * @returns {{ ok: boolean, reasons: Array<{code:string,detail:string}> }}
 */
function validateEvidenceBundle(evidence) {
  const reasons = [];
  if (!isPlainObject(evidence)) {
    return { ok: false, reasons: [reason("EVIDENCE_NOT_OBJECT", "evidence must be a plain object")] };
  }

  if (evidence.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason(
      "SCHEMA_VERSION_INVALID",
      `schemaVersion must be ${SCHEMA_VERSION}`,
    ));
  }
  for (const key of ["runId", "attemptId"]) {
    if (!isNonEmptyString(evidence[key])) {
      reasons.push(reason("FIELD_REQUIRED", `${key} must be a non-empty string`));
    }
  }
  if (!isDigest(evidence.manifestDigest)) {
    reasons.push(reason(
      "MANIFEST_DIGEST_REQUIRED",
      "manifestDigest must be sha256:<64 hex>",
    ));
  }

  const workspace = evidence.workspace;
  if (!isPlainObject(workspace)) {
    reasons.push(reason("WORKSPACE_MISSING", "workspace object is required"));
  } else {
    if (!isNonEmptyString(workspace.baseRevision)) {
      reasons.push(reason("BASE_REVISION_REQUIRED", "workspace.baseRevision is required"));
    }
    if (!isNonEmptyString(workspace.headRevision)) {
      reasons.push(reason("HEAD_REVISION_REQUIRED", "workspace.headRevision is required"));
    }
    if (!isNonEmptyString(workspace.branch)) {
      reasons.push(reason("BRANCH_REQUIRED", "workspace.branch is required"));
    }
  }

  const diff = evidence.diff;
  if (!isPlainObject(diff)) {
    reasons.push(reason("DIFF_MISSING", "diff object is required"));
  } else {
    if (!isDigest(diff.patchHash)) {
      reasons.push(reason("PATCH_HASH_REQUIRED", "diff.patchHash must be sha256:<64 hex>"));
    }
    if (!Array.isArray(diff.changedFiles)) {
      reasons.push(reason("CHANGED_FILES_REQUIRED", "diff.changedFiles must be an array"));
    } else {
      diff.changedFiles.forEach((entry, i) => {
        if (!isPlainObject(entry) || !isNonEmptyString(entry.path)) {
          reasons.push(reason(
            "CHANGED_FILE_INVALID",
            `diff.changedFiles[${i}].path must be a non-empty string`,
          ));
        }
      });
    }
  }

  if (!Array.isArray(evidence.commands)) {
    reasons.push(reason("COMMANDS_REQUIRED", "commands must be an array"));
  } else {
    evidence.commands.forEach((cmd, i) => {
      if (!isPlainObject(cmd)) {
        reasons.push(reason("COMMAND_INVALID", `commands[${i}] must be an object`));
        return;
      }
      if (!isNonEmptyString(cmd.command)) {
        reasons.push(reason("COMMAND_NAME_REQUIRED", `commands[${i}].command is required`));
      }
      if (!isNonEmptyString(cmd.cwd)) {
        reasons.push(reason("COMMAND_CWD_REQUIRED", `commands[${i}].cwd is required`));
      }
      if (!Number.isInteger(cmd.exitCode)) {
        reasons.push(reason("COMMAND_EXIT_REQUIRED", `commands[${i}].exitCode must be an integer`));
      }
      if (!isDigest(cmd.outputHash)) {
        reasons.push(reason(
          "COMMAND_OUTPUT_HASH_REQUIRED",
          `commands[${i}].outputHash must be sha256:<64 hex>`,
        ));
      }
    });
  }

  const delivery = evidence.delivery;
  if (!isPlainObject(delivery) || !isPlainObject(delivery.pullRequest)) {
    reasons.push(reason(
      "DELIVERY_PR_REQUIRED",
      "delivery.pullRequest object is required for draft-pr mode",
    ));
  } else {
    const pr = delivery.pullRequest;
    if (!Number.isInteger(pr.number) || pr.number < 1) {
      reasons.push(reason("PR_NUMBER_REQUIRED", "delivery.pullRequest.number must be a positive integer"));
    }
    if (pr.draft !== true) {
      reasons.push(reason("PR_DRAFT_REQUIRED", "delivery.pullRequest.draft must be true"));
    }
    if (!isNonEmptyString(pr.headRef)) {
      reasons.push(reason("PR_HEAD_REF_REQUIRED", "delivery.pullRequest.headRef is required"));
    }
    if (!isNonEmptyString(pr.baseRef)) {
      reasons.push(reason("PR_BASE_REF_REQUIRED", "delivery.pullRequest.baseRef is required"));
    }
  }

  const executor = evidence.executor;
  if (!isPlainObject(executor)) {
    reasons.push(reason("EXECUTOR_MISSING", "executor object is required"));
  } else {
    if (!isNonEmptyString(executor.provider)) {
      reasons.push(reason("EXECUTOR_PROVIDER_REQUIRED", "executor.provider is required"));
    }
    if (!isNonEmptyString(executor.worker)) {
      reasons.push(reason("EXECUTOR_WORKER_REQUIRED", "executor.worker is required"));
    }
    if (!isNonEmptyString(executor.idempotencyToken)) {
      reasons.push(reason(
        "IDEMPOTENCY_TOKEN_REQUIRED",
        "executor.idempotencyToken is required",
      ));
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Build a fixture EvidenceBundle matching an authorized manifest.
 */
function buildFixtureEvidenceBundle(authorizedManifest, overrides = {}) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    runId: authorizedManifest.runId,
    attemptId: authorizedManifest.attemptId,
    manifestDigest: authorizedManifest.manifestDigest,
    workspace: {
      baseRevision: authorizedManifest.repository.baseRevision,
      headRevision: "def4567890abc123def4567890abc123def45678",
      branch: `mh/${String(authorizedManifest.runId).toLowerCase()}`,
    },
    diff: {
      patchHash: digestOf({ patch: "fixture" }),
      changedFiles: [
        { path: "src/session/expiry.js", status: "modified" },
        { path: "tests/session/expiry.test.js", status: "added" },
      ],
    },
    commands: (authorizedManifest.validation.commands || []).map((command) => ({
      command,
      cwd: "/abs/worktree/path",
      exitCode: 0,
      outputHash: digestOf({ command, ok: true }),
    })),
    delivery: {
      pullRequest: {
        number: 42,
        draft: true,
        url: null,
        headRef: `mh/${String(authorizedManifest.runId).toLowerCase()}`,
        baseRef: authorizedManifest.delivery.targetBranch,
      },
    },
    executor: {
      provider: authorizedManifest.executor.provider,
      worker: authorizedManifest.executor.worker,
      sessionId: "fixture-session",
      idempotencyToken: authorizedManifest.idempotencyToken,
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
  validateEvidenceBundle,
  buildFixtureEvidenceBundle,
};
