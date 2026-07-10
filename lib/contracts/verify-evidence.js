"use strict";

const { validateRunManifest } = require("./run-manifest");
const { validateEvidenceBundle } = require("./evidence-bundle");
const { checkPathInScope } = require("./scope");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reason(code, detail) {
  return { code, detail };
}

/**
 * Pure evidence verifier.
 *
 * READY only from verifiable facts bound to an authorized manifest:
 * head, changed files, patch hash, command cwd/exit/output hash, PR ref.
 *
 * Documented missing-fact rule:
 * - FAILED  = required provider facts missing / evidence structure incomplete
 * - BLOCKED = facts present but violate policy (scope, failed commands, digests, identity)
 *
 * No process spawn, network, AO, or Codex.
 *
 * @returns {{
 *   ok: boolean,
 *   verdict: "READY"|"BLOCKED"|"FAILED",
 *   reasons: Array<{code:string,detail:string}>,
 *   mutates: false,
 *   spawns_process: false,
 *   network: false,
 * }}
 */
function verifyEvidence({ authorizedManifest, evidence } = {}) {
  const base = {
    ok: false,
    verdict: "FAILED",
    reasons: [],
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };

  const manifestCheck = validateRunManifest(authorizedManifest, { requireAuthorized: true });
  if (!manifestCheck.ok) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [
        reason("AUTHORIZED_MANIFEST_INVALID", "authorizedManifest failed validation"),
        ...manifestCheck.reasons,
      ],
    };
  }

  const evidenceCheck = validateEvidenceBundle(evidence);
  if (!evidenceCheck.ok) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: evidenceCheck.reasons,
    };
  }

  const policyReasons = [];

  // Identity / digest binding
  if (evidence.manifestDigest !== authorizedManifest.manifestDigest) {
    policyReasons.push(reason(
      "MANIFEST_DIGEST_MISMATCH",
      "evidence.manifestDigest does not match authorized manifest",
    ));
  }
  if (evidence.runId !== authorizedManifest.runId) {
    policyReasons.push(reason("RUN_ID_MISMATCH", "evidence.runId does not match manifest"));
  }
  if (evidence.attemptId !== authorizedManifest.attemptId) {
    policyReasons.push(reason("ATTEMPT_ID_MISMATCH", "evidence.attemptId does not match manifest"));
  }
  if (evidence.workspace.baseRevision !== authorizedManifest.repository.baseRevision) {
    policyReasons.push(reason(
      "BASE_REVISION_MISMATCH",
      "evidence.workspace.baseRevision does not match manifest.repository.baseRevision",
    ));
  }
  if (evidence.executor.idempotencyToken !== authorizedManifest.idempotencyToken) {
    policyReasons.push(reason(
      "IDEMPOTENCY_TOKEN_MISMATCH",
      "evidence.executor.idempotencyToken does not match manifest",
    ));
  }

  // Head fact present was checked by validateEvidenceBundle; non-empty is enough for v0
  // (real commit existence is provider/git later).

  // Scope from changedFiles facts only
  for (const entry of evidence.diff.changedFiles) {
    const path = entry && entry.path;
    const scopeResult = checkPathInScope(authorizedManifest.scope, path);
    if (!scopeResult.ok) {
      policyReasons.push(reason(scopeResult.code, scopeResult.detail));
    }
  }

  // Validation commands: every required command must appear with exit 0 + cwd + outputHash
  const requiredCommands = authorizedManifest.validation.commands;
  const seen = new Map();
  for (const cmd of evidence.commands) {
    if (cmd && typeof cmd.command === "string") {
      seen.set(cmd.command, cmd);
    }
  }
  for (const required of requiredCommands) {
    const found = seen.get(required);
    if (!found) {
      // Missing required command fact → FAILED (infra/provider incomplete)
      return {
        ...base,
        verdict: "FAILED",
        reasons: [reason(
          "VALIDATION_COMMAND_MISSING",
          `missing evidence for validation command: ${required}`,
        )],
      };
    }
    if (found.exitCode !== 0) {
      policyReasons.push(reason(
        "VALIDATION_COMMAND_FAILED",
        `command exited ${found.exitCode}: ${required}`,
      ));
    }
  }

  // Delivery draft-PR policy
  if (authorizedManifest.delivery.mode === "draft-pr") {
    const pr = evidence.delivery && evidence.delivery.pullRequest;
    if (!isPlainObject(pr)) {
      return {
        ...base,
        verdict: "FAILED",
        reasons: [reason("PR_FACTS_MISSING", "delivery.pullRequest facts are required")],
      };
    }
    if (pr.draft !== true) {
      policyReasons.push(reason("PR_NOT_DRAFT", "delivery.pullRequest.draft must be true"));
    }
    if (pr.baseRef !== authorizedManifest.delivery.targetBranch) {
      policyReasons.push(reason(
        "PR_BASE_REF_MISMATCH",
        `PR baseRef ${String(pr.baseRef)} != targetBranch ${authorizedManifest.delivery.targetBranch}`,
      ));
    }
  }

  if (policyReasons.length > 0) {
    const scopeHit = policyReasons.some((r) => String(r.code).startsWith("SCOPE_"));
    return {
      ...base,
      ok: false,
      verdict: "BLOCKED",
      reasons: policyReasons,
      // convenience for callers/tests
      scope_violation: scopeHit,
    };
  }

  return {
    ok: true,
    verdict: "READY",
    reasons: [],
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
    scope_violation: false,
  };
}

module.exports = {
  verifyEvidence,
};
