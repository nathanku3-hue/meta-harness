"use strict";

/**
 * D070-A1 private AO constants (lineage under internal/d069 until post-dogfood R1A).
 * Not packaged. No public API.
 */

const PROVIDER_ID = "meta-harness-ao-codex";
const WORKER_PROFILE = "d070-ao-artifact-v1";

/** Validation-command / maxCommandTimeoutSeconds remain 60s (D069). */
const FIXED_TIMEOUT_SECONDS = 60;

/** Separate fixed AO process timeout. Requires process-tree termination. */
const AO_TIMEOUT_SECONDS = 120;

/** Exact bytes required by the A1 validation program (not sealed in RunSpec). */
const A1_VALIDATION_EXACT_CONTENT = "d070-ao-verified-marker\n";

/** A1 content ceiling for schema-bound change artifact body. */
const AO_CONTENT_MAX_BYTES = 64 * 1024;

/** Independent stdout / stderr capture ceilings. Exceeding kills the process tree. */
const AO_STDOUT_MAX_BYTES = 2 * 1024 * 1024;
const AO_STDERR_MAX_BYTES = 256 * 1024;

const AO_FIXED_PROMPT_LINES = [
  "Inspect the current repository read-only.",
  "Return the exact schema-bound change artifact requested by the output schema.",
  "Do not modify, stage, commit, create, delete, or rename any file.",
  "The intended change is to replace the single allowed path entirely with these exact bytes:",
  "d070-ao-verified-marker\\n  (one line of text: d070-ao-verified-marker followed by a single newline)",
  "Do not include commentary outside the JSON result.",
];

function buildFixedAoPrompt(allowedPath) {
  return [
    "Inspect the current repository read-only.",
    "Return the exact schema-bound change artifact requested by the output schema.",
    "Do not modify, stage, commit, create, delete, or rename any file.",
    `The intended change is to replace ${allowedPath} entirely with one line of text:`,
    "d070-ao-verified-marker",
    "The content field must be exactly that line followed by a single trailing newline character.",
    "Do not include commentary outside the JSON result.",
  ].join("\n");
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
  A1_VALIDATION_EXACT_CONTENT,
  AO_CONTENT_MAX_BYTES,
  AO_STDOUT_MAX_BYTES,
  AO_STDERR_MAX_BYTES,
  AO_FIXED_PROMPT_LINES,
  buildFixedAoPrompt,
  AO_ENV_ALLOWLIST,
};
