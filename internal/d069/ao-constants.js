"use strict";

/**
 * D070/D071 private AO constants (lineage under internal/d069 until post-dogfood R1A).
 * Not packaged. No public API.
 */

const crypto = require("node:crypto");

const PROVIDER_ID = "meta-harness-ao-codex";
const WORKER_PROFILE = "d070-ao-artifact-v1";

/** Validation-command / maxCommandTimeoutSeconds remain 60s (D069). */
const FIXED_TIMEOUT_SECONDS = 60;

/** Separate fixed AO process timeout. Requires process-tree termination. */
const AO_TIMEOUT_SECONDS = 240;

/** Content ceiling for schema-bound change artifact body. */
const AO_CONTENT_MAX_BYTES = 64 * 1024;

/** Independent stdout / stderr capture ceilings. Exceeding kills the process tree. */
const AO_STDOUT_MAX_BYTES = 2 * 1024 * 1024;
const AO_STDERR_MAX_BYTES = 256 * 1024;

/** Canonical Windows PowerShell host for D071 validation (not pwsh). */
const WINDOWS_POWERSHELL_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

/**
 * Validation-only host env keys. Supplied env must match this allowlist exactly.
 * Absolute validation argv means PATH is not required.
 */
const VALIDATION_ENV_ALLOWLIST = Object.freeze([
  "APPDATA",
  "ComSpec",
  "SystemRoot",
  "TEMP",
  "TMP",
  "WINDIR",
]);

const D071_SUBJECT_RELATIVE_PATH = "scripts/utils/CheckShortcut.ps1";

/**
 * Deterministic AO prompt from sealed objective + one literal allowed path.
 * Objective is JSON-string-encoded so newlines/quotes cannot escape the frame.
 */
function buildObjectiveAoPrompt(objective, allowedPath) {
  if (typeof objective !== "string" || objective.length === 0) {
    throw new Error("objective must be a non-empty string");
  }
  if (typeof allowedPath !== "string" || allowedPath.length === 0) {
    throw new Error("allowedPath must be a non-empty string");
  }
  const objectiveJson = JSON.stringify(objective);
  const pathJson = JSON.stringify(allowedPath);
  return [
    "Inspect the current repository read-only.",
    "Return the exact schema-bound change artifact requested by the output schema.",
    "Do not modify, stage, commit, create, delete, or rename any file.",
    "Do not include commentary outside the JSON result.",
    `Sealed objective (JSON string): ${objectiveJson}`,
    `Single allowed path (JSON string): ${pathJson}`,
    "Replace that path entirely with content that satisfies the sealed objective.",
    "The artifact must be exactly one JSON object with keys path and content only.",
  ].join("\n");
}

function promptSha256(prompt) {
  return crypto.createHash("sha256").update(String(prompt), "utf8").digest("hex");
}

/** Explicit child env allowlist. Values are snapshotted at controller construction. */
const AO_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "USER",
  "CODEX_HOME",
]);

module.exports = {
  PROVIDER_ID,
  WORKER_PROFILE,
  FIXED_TIMEOUT_SECONDS,
  AO_TIMEOUT_SECONDS,
  AO_CONTENT_MAX_BYTES,
  AO_STDOUT_MAX_BYTES,
  AO_STDERR_MAX_BYTES,
  WINDOWS_POWERSHELL_PATH,
  VALIDATION_ENV_ALLOWLIST,
  D071_SUBJECT_RELATIVE_PATH,
  buildObjectiveAoPrompt,
  promptSha256,
  AO_ENV_ALLOWLIST,
};
