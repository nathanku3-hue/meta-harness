"use strict";

/** Constants for the packaged execution-custody runtime. */

const crypto = require("node:crypto");

const { renderRuntimeSkill } = require("../runtime-skills");

const PROVIDER_ID = "meta-harness-codex";
const WORKER_PROFILE = "bounded-repository-change/v1";

/** Validation commands remain bounded independently from the agent process. */
const MAX_VALIDATION_TIMEOUT_SECONDS = 180;

/** Fixed agent process budget with process-tree termination on timeout. */
const AGENT_TIMEOUT_SECONDS = 240;

/** Content ceiling for the schema-bound single-file change artifact. */
const ARTIFACT_CONTENT_MAX_BYTES = 64 * 1024;

/** Independent stdout/stderr capture ceilings. */
const AGENT_STDOUT_MAX_BYTES = 2 * 1024 * 1024;
const AGENT_STDERR_MAX_BYTES = 256 * 1024;

/**
 * Deterministic agent prompt derived only from sealed objective and literal scope.
 */
function buildObjectiveAgentPrompt(objective, allowedPath) {
  if (typeof objective !== "string" || objective.length === 0) {
    throw new Error("objective must be a non-empty string");
  }
  if (typeof allowedPath !== "string" || allowedPath.length === 0) {
    throw new Error("allowedPath must be a non-empty string");
  }
  return renderRuntimeSkill("execution-custody", {
    OBJECTIVE_JSON: JSON.stringify(objective),
    ALLOWED_PATH_JSON: JSON.stringify(allowedPath),
  });
}

function promptSha256(prompt) {
  return crypto.createHash("sha256").update(String(prompt), "utf8").digest("hex");
}

/** Explicit child environment allowlist for the authenticated agent process. */
const AGENT_ENV_ALLOWLIST = Object.freeze([
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
  MAX_VALIDATION_TIMEOUT_SECONDS,
  AGENT_TIMEOUT_SECONDS,
  ARTIFACT_CONTENT_MAX_BYTES,
  AGENT_STDOUT_MAX_BYTES,
  AGENT_STDERR_MAX_BYTES,
  buildObjectiveAgentPrompt,
  promptSha256,
  AGENT_ENV_ALLOWLIST,
};
