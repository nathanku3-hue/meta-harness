"use strict";

const path = require("node:path");
const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  freezeDeep,
  cloneStrict,
} = require("./canonical-json");

const SCHEMA_VERSION = "run-spec/v1";
const DOMAIN = "run-spec/v1";
const COMMAND_DOMAIN = "command/v1";

const OBJECT_FORMATS = new Set(["sha1", "sha256"]);
const REVISION_LEN = { sha1: 40, sha256: 64 };
const CHANGE_POLICIES = new Set(["forbid-noop", "allow-noop"]);

/** Protocol ceiling — policy may only tighten. */
const PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS = 86400;

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHexRevision(value, objectFormat) {
  if (typeof value !== "string") return false;
  const len = REVISION_LEN[objectFormat];
  if (!len || value.length !== len) return false;
  return /^[a-f0-9]+$/.test(value);
}

function normalizeStringList(list, { sorted = false, unique = true } = {}) {
  if (!Array.isArray(list)) return { ok: false, detail: "must be an array" };
  if (!list.every(isNonEmptyString)) return { ok: false, detail: "entries must be non-empty strings" };
  if (unique) {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item)) return { ok: false, detail: "duplicate entries are forbidden" };
      seen.add(item);
    }
  }
  const out = list.slice();
  if (sorted) out.sort();
  return { ok: true, value: out };
}

/**
 * cwdRelative must be repository-contained: ".", no absolute, no "..".
 */
function isSafeCwdRelative(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return false;
  if (cwd.includes("\0")) return false;
  if (path.isAbsolute(cwd)) return false;
  if (/^[a-zA-Z]:/.test(cwd) || cwd.startsWith("\\\\")) return false;
  const norm = cwd.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || ".";
  if (norm !== cwd.replace(/\\/g, "/")) {
    // require already-normalized form (no backslash, no double slash, no trailing slash except ".")
  }
  const asPosix = cwd.replace(/\\/g, "/");
  if (asPosix !== cwd) return false;
  if (asPosix.includes("//")) return false;
  if (asPosix.endsWith("/") && asPosix !== "/") return false;
  if (asPosix.startsWith("/")) return false;
  const parts = asPosix === "." ? [] : asPosix.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    if (!(asPosix === ".")) return false;
  }
  if (asPosix === ".") return true;
  if (parts.length === 0) return false;
  if (parts.some((p) => p === ".." || p === "." || p === "")) return false;
  return true;
}

function normalizeCommandSpec(cmd) {
  const cwdRelative = cmd.cwdRelative == null ? "." : cmd.cwdRelative;
  const timeoutSeconds = cmd.timeoutSeconds == null ? 600 : cmd.timeoutSeconds;
  const networkPolicy = cmd.networkPolicy == null ? "denied" : cmd.networkPolicy;
  let environmentPolicy = { allow: [] };
  if (cmd.environmentPolicy != null) {
    environmentPolicy = cmd.environmentPolicy;
  } else if (cmd.environment != null && isOrdinaryPlainObject(cmd.environment)) {
    environmentPolicy = { allow: Array.isArray(cmd.environment.allow) ? cmd.environment.allow : [] };
  }
  return {
    argv: cmd.argv,
    cwdRelative,
    timeoutSeconds,
    networkPolicy,
    environmentPolicy,
  };
}

function computeCommandId(normalized) {
  const envNorm = normalizeStringList(normalized.environmentPolicy.allow || [], {
    sorted: true,
    unique: true,
  });
  if (!envNorm.ok) {
    const err = new Error(envNorm.detail);
    err.code = "ENV_ALLOW_INVALID";
    throw err;
  }
  return domainDigest(COMMAND_DOMAIN, {
    argv: normalized.argv,
    cwdRelative: normalized.cwdRelative,
    timeoutSeconds: normalized.timeoutSeconds,
    networkPolicy: normalized.networkPolicy,
    environmentPolicy: { allow: envNorm.value },
  });
}

function validateValidationCommand(cmd, index, reasons, maxTimeoutSeconds) {
  if (!isOrdinaryPlainObject(cmd)) {
    reasons.push(reason("VALIDATION_COMMAND_INVALID", `validation.commands[${index}] must be an object`));
    return;
  }
  if (!exactKeys(cmd, [
    "argv", "cwdRelative", "timeoutSeconds", "networkPolicy", "environmentPolicy",
  ])) {
    reasons.push(reason(
      "VALIDATION_COMMAND_SHAPE",
      `validation.commands[${index}] must be exactly { argv, cwdRelative, timeoutSeconds, networkPolicy, environmentPolicy }`,
    ));
    return;
  }
  if (!Array.isArray(cmd.argv) || cmd.argv.length === 0 || !cmd.argv.every(isNonEmptyString)) {
    reasons.push(reason(
      "VALIDATION_ARGV_REQUIRED",
      `validation.commands[${index}].argv must be a non-empty string array`,
    ));
  }
  if (!isSafeCwdRelative(cmd.cwdRelative)) {
    reasons.push(reason(
      "VALIDATION_CWD_INVALID",
      `validation.commands[${index}].cwdRelative must be "." or a repository-relative path without ".."`,
    ));
  }
  const ceiling = maxTimeoutSeconds != null
    ? Math.min(maxTimeoutSeconds, PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS)
    : PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS;
  if (!Number.isInteger(cmd.timeoutSeconds)
    || cmd.timeoutSeconds < 1
    || cmd.timeoutSeconds > ceiling) {
    reasons.push(reason(
      "VALIDATION_TIMEOUT_INVALID",
      `validation.commands[${index}].timeoutSeconds must be integer in [1, ${ceiling}]`,
    ));
  }
  if (cmd.networkPolicy !== "denied") {
    reasons.push(reason(
      "VALIDATION_NETWORK_POLICY",
      `validation.commands[${index}].networkPolicy must be "denied" in v1`,
    ));
  }
  if (!isOrdinaryPlainObject(cmd.environmentPolicy)
    || !exactKeys(cmd.environmentPolicy, ["allow"])) {
    reasons.push(reason(
      "VALIDATION_ENV_POLICY_INVALID",
      `validation.commands[${index}].environmentPolicy must be { allow: string[] }`,
    ));
  } else {
    const env = normalizeStringList(cmd.environmentPolicy.allow, { sorted: false, unique: true });
    if (!env.ok) {
      reasons.push(reason(
        "VALIDATION_ENV_ALLOW_INVALID",
        `validation.commands[${index}].environmentPolicy.allow: ${env.detail}`,
      ));
    }
  }
}

/**
 * Validate immutable RunSpec (requested work only — no attempt, no approval, no budgets).
 * @param {object} spec
 * @param {{ maxCommandTimeoutSeconds?: number }} [options]
 */
function validateRunSpec(spec, options = {}) {
  const reasons = [];
  if (!isOrdinaryPlainObject(spec)) {
    return { ok: false, reasons: [reason("RUN_SPEC_NOT_OBJECT", "runSpec must be a plain object")] };
  }
  try {
    assertStrictJsonData(spec);
  } catch (err) {
    return {
      ok: false,
      reasons: [reason(err.code || "STRICT_JSON", err.message)],
    };
  }

  const allowedTop = new Set([
    "schemaVersion", "runId", "repository", "objective",
    "scope", "validation", "changePolicy",
  ]);
  for (const k of Object.keys(spec)) {
    if (!allowedTop.has(k)) {
      reasons.push(reason("UNKNOWN_FIELD", `${k} is not allowed on RunSpec`));
    }
  }
  if (Object.prototype.hasOwnProperty.call(spec, "attemptId")) {
    reasons.push(reason("ATTEMPT_ON_RUN_SPEC", "attemptId must not appear on RunSpec"));
  }

  if (spec.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${SCHEMA_VERSION}`));
  }
  if (!isNonEmptyString(spec.runId)) {
    reasons.push(reason("FIELD_REQUIRED", "runId must be a non-empty string"));
  }
  if (!isNonEmptyString(spec.objective)) {
    reasons.push(reason("FIELD_REQUIRED", "objective must be a non-empty string"));
  }

  const repo = spec.repository;
  if (!isOrdinaryPlainObject(repo)) {
    reasons.push(reason("REPOSITORY_MISSING", "repository object is required"));
  } else if (!exactKeys(repo, ["repositoryId", "objectFormat", "expectedBaseRevision"])) {
    reasons.push(reason(
      "REPOSITORY_SHAPE",
      "repository must be exactly { repositoryId, objectFormat, expectedBaseRevision }",
    ));
  } else {
    if (!isNonEmptyString(repo.repositoryId)) {
      reasons.push(reason("REPOSITORY_ID_REQUIRED", "repository.repositoryId is required"));
    }
    if (!OBJECT_FORMATS.has(repo.objectFormat)) {
      reasons.push(reason("OBJECT_FORMAT_INVALID", 'objectFormat must be "sha1" or "sha256"'));
    }
    if (!isHexRevision(repo.expectedBaseRevision, repo.objectFormat)) {
      reasons.push(reason(
        "BASE_REVISION_INVALID",
        "expectedBaseRevision must be full lowercase hex for objectFormat",
      ));
    }
  }

  const scope = spec.scope;
  if (!isOrdinaryPlainObject(scope) || !exactKeys(scope, ["allow", "deny"])) {
    reasons.push(reason("SCOPE_SHAPE", "scope must be exactly { allow, deny }"));
  } else {
    const allow = normalizeStringList(scope.allow, { unique: true });
    if (!allow.ok || allow.value.length === 0) {
      reasons.push(reason("SCOPE_ALLOW_REQUIRED", "scope.allow must be a non-empty unique string array"));
    }
    const deny = normalizeStringList(scope.deny, { unique: true });
    if (!deny.ok) {
      reasons.push(reason("SCOPE_DENY_REQUIRED", `scope.deny: ${deny.detail}`));
    }
  }

  const maxTimeout = options.maxCommandTimeoutSeconds;
  const validation = spec.validation;
  if (!isOrdinaryPlainObject(validation)
    || !exactKeys(validation, ["commands"])
    || !Array.isArray(validation.commands)
    || validation.commands.length === 0) {
    reasons.push(reason("VALIDATION_COMMANDS_REQUIRED", "validation.commands must be non-empty"));
  } else {
    validation.commands.forEach((cmd, i) => validateValidationCommand(cmd, i, reasons, maxTimeout));
  }

  if (!CHANGE_POLICIES.has(spec.changePolicy)) {
    reasons.push(reason(
      "CHANGE_POLICY_INVALID",
      'changePolicy must be "forbid-noop" or "allow-noop"',
    ));
  }

  return { ok: reasons.length === 0, reasons };
}

function computeRunSpecDigest(spec) {
  return domainDigest(DOMAIN, spec);
}

function commandIdFromSpecCommand(cmd) {
  const n = normalizeCommandSpec(cmd);
  return computeCommandId(n);
}

module.exports = {
  SCHEMA_VERSION,
  DOMAIN,
  COMMAND_DOMAIN,
  PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS,
  validateRunSpec,
  computeRunSpecDigest,
  computeCommandId,
  commandIdFromSpecCommand,
  normalizeCommandSpec,
  isHexRevision,
  isSafeCwdRelative,
  freezeDeep,
  cloneStrict,
  isDigest,
};
