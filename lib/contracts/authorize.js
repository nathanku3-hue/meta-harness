"use strict";

const { digestOf, isDigest } = require("./digest");
const {
  validateRunManifest,
  computeManifestDigest,
} = require("./run-manifest");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reason(code, detail) {
  return { code, detail };
}

/**
 * Pure authorize: fail-closed contract authority.
 *
 * Inputs are fixtures / already-computed objects only — no git, network, or process.
 *
 * @param {object} input
 * @param {object} input.manifest draft RunManifest (no manifestDigest)
 * @param {object} input.workerEntryGate machine gate; must be open
 * @param {object} input.repoState fixture facts: { head, dirty, isGitRepo }
 * @param {string|Date|number} [input.now] clock for expiry (default Date.now())
 * @returns {{
 *   ok: boolean,
 *   verdict: "AUTHORIZED"|"BLOCKED"|"FAILED",
 *   reasons: Array<{code:string,detail:string}>,
 *   authorizedManifest: object|null,
 *   mutates: false,
 *   spawns_process: false,
 *   network: false,
 * }}
 */
function authorizeRun({
  manifest,
  workerEntryGate,
  repoState,
  now = Date.now(),
} = {}) {
  const base = {
    ok: false,
    verdict: "BLOCKED",
    reasons: [],
    authorizedManifest: null,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };

  if (!isPlainObject(manifest)) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [reason("MANIFEST_NOT_OBJECT", "manifest must be a plain object")],
    };
  }

  // Immutable after authorize: do not re-seal; new attempt/run required.
  if (isDigest(manifest.manifestDigest)) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "ALREADY_AUTHORIZED",
        "manifestDigest is set; create a new attemptId/runId instead of re-authorizing",
      )],
    };
  }

  const structure = validateRunManifest(manifest, { requireAuthorized: false });
  if (!structure.ok) {
    // Structural problems are FAILED (cannot form a valid authority object).
    return {
      ...base,
      verdict: "FAILED",
      reasons: structure.reasons,
    };
  }

  if (!isPlainObject(workerEntryGate)) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "WORKER_ENTRY_GATE_MISSING",
        "worker_entry_gate is required for authorize",
      )],
    };
  }
  if (workerEntryGate.verdict !== "open" || workerEntryGate.ok !== true) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "WORKER_ENTRY_GATE_NOT_OPEN",
        `worker_entry_gate must be open+ok (verdict=${String(workerEntryGate.verdict)}, ok=${String(workerEntryGate.ok)})`,
      )],
    };
  }

  const nowMs = now instanceof Date ? now.getTime() : (typeof now === "number" ? now : Date.parse(String(now)));
  if (Number.isNaN(nowMs)) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [reason("NOW_INVALID", "now must be a Date, epoch ms, or ISO string")],
    };
  }
  const expiresMs = Date.parse(manifest.expiresAt);
  if (nowMs >= expiresMs) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "MANIFEST_EXPIRED",
        `manifest expired at ${manifest.expiresAt}`,
      )],
    };
  }

  if (!isPlainObject(repoState)) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [reason(
        "REPO_STATE_MISSING",
        "repoState fixture is required ({ head, dirty, isGitRepo })",
      )],
    };
  }
  if (repoState.isGitRepo !== true) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason("NOT_GIT_REPO", "repoState.isGitRepo must be true")],
    };
  }
  if (repoState.dirty === true) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason("DIRTY_TREE", "repoState.dirty must be false at authorize")],
    };
  }
  if (typeof repoState.head !== "string" || repoState.head.length === 0) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [reason("HEAD_MISSING", "repoState.head is required")],
    };
  }
  if (repoState.head !== manifest.repository.baseRevision) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [reason(
        "HEAD_DRIFT",
        `repo HEAD ${repoState.head} does not match baseRevision ${manifest.repository.baseRevision}`,
      )],
    };
  }

  if (!isDigest(manifest.operatorPlanArtifactDigest)) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: [reason(
        "OPERATOR_PLAN_DIGEST_MISSING",
        "operatorPlanArtifactDigest must be present before authorize",
      )],
    };
  }

  const authorizedAt = new Date(nowMs).toISOString();
  const workerEntryGateDigest = digestOf(workerEntryGate);

  // Build authorized body without digest, then seal.
  const sealedBody = {
    ...manifest,
    authorizedAt,
    workerEntryGateDigest,
    gate: {
      workerEntryGateOk: true,
      workerEntryGateVerdict: "open",
    },
    manifestDigest: null,
  };
  const manifestDigest = computeManifestDigest(sealedBody);
  const authorizedManifest = {
    ...sealedBody,
    manifestDigest,
  };

  // Final structural check of authorized form.
  const finalCheck = validateRunManifest(authorizedManifest, { requireAuthorized: true });
  if (!finalCheck.ok) {
    return {
      ...base,
      verdict: "FAILED",
      reasons: finalCheck.reasons,
    };
  }

  // Immutability: freeze shallow + nested plain objects one level deep.
  freezeManifest(authorizedManifest);

  return {
    ok: true,
    verdict: "AUTHORIZED",
    reasons: [],
    authorizedManifest,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
  };
}

function freezeManifest(manifest) {
  if (!isPlainObject(manifest)) return;
  for (const value of Object.values(manifest)) {
    if (isPlainObject(value)) {
      Object.freeze(value);
      for (const nested of Object.values(value)) {
        if (isPlainObject(nested)) Object.freeze(nested);
      }
    } else if (Array.isArray(value)) {
      Object.freeze(value);
    }
  }
  Object.freeze(manifest);
}

module.exports = {
  authorizeRun,
};
