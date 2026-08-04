"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");

const PROCESS_ENV_KEYS = Object.freeze(new Set([
  "APPDATA",
  "CODEX_HOME",
  "COLORTERM",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]));

const VALIDATION_DENY_KEYS = Object.freeze(new Set(["CODEX_HOME"]));
const CONFIGURED_WORKER_PREFIXES = Object.freeze(["FAKE_WORKER_"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function normalizedKey(value) {
  return String(value || "").toUpperCase();
}

function copyProcessEnvironment(env, { configuredWorker = false, validation = false } = {}) {
  const result = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (value === undefined) continue;
    const normalized = normalizedKey(key);
    const configured = configuredWorker
      && CONFIGURED_WORKER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
    if (!PROCESS_ENV_KEYS.has(normalized) && !configured) continue;
    if (validation && VALIDATION_DENY_KEYS.has(normalized)) continue;
    result[key] = String(value);
  }
  return result;
}

function buildWorkerEnvironment(env, { configuredWorker = false } = {}) {
  return copyProcessEnvironment(env, { configuredWorker });
}

function buildValidationEnvironment(env) {
  return copyProcessEnvironment(env, { validation: true });
}

function environmentSecurityRecord(sourceEnv, allowedEnv, surface) {
  const sourceCount = Object.keys(sourceEnv || {}).length;
  const allowedNames = Object.keys(allowedEnv || {}).map(normalizedKey).sort();
  return Object.freeze({
    schemaVersion: "work-security-environment/v1",
    surface,
    policy: "explicit-allowlist",
    allowedNames,
    filteredCount: Math.max(0, sourceCount - allowedNames.length),
  });
}

function instructionDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function instructionCandidates(workspacePath, allowedPaths) {
  const candidates = new Set(["AGENTS.md"]);
  for (const allowedPath of allowedPaths) {
    if (allowedPath === ".") continue;
    const parts = String(allowedPath).replaceAll("\\", "/").split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      const directory = parts.slice(0, index).join("/");
      const absolute = path.join(workspacePath, ...directory.split("/"));
      let stat = null;
      try {
        stat = fs.lstatSync(absolute);
      } catch (_) {}
      if (stat?.isFile()) break;
      candidates.add(`${directory}/AGENTS.md`);
    }
  }
  return [...candidates].sort();
}

function trustedInstructionIdentities(workspacePath, allowedPaths) {
  const identities = [];
  for (const relativePath of instructionCandidates(workspacePath, allowedPaths)) {
    const absolutePath = path.join(workspacePath, ...relativePath.split("/"));
    if (!fs.existsSync(absolutePath)) continue;
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("MH_WORK_TRUSTED_INSTRUCTION", `trusted instruction must be a regular non-symlink file: ${relativePath}`);
    }
    const bytes = fs.readFileSync(absolutePath);
    identities.push(Object.freeze({
      path: relativePath,
      digest: instructionDigest(bytes),
    }));
  }
  return Object.freeze(identities);
}

function formatTrustedInstructions(identities) {
  if (!identities || identities.length === 0) return "- none";
  return identities.map((identity) => `- ${identity.path} (${identity.digest})`).join("\n");
}

module.exports = {
  buildValidationEnvironment,
  buildWorkerEnvironment,
  environmentSecurityRecord,
  formatTrustedInstructions,
  trustedInstructionIdentities,
};
