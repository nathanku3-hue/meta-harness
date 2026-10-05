"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { UsageError } = require("./errors");
const {
  ALLOWED_TRANSITIONS,
  BYPASS_REASON_CODES,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  EXECUTION_TRANSITIONS,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
  ROUND_PATTERN,
  VALID_VERDICTS,
} = require("./context-gate-constants");

function fail(message) {
  throw new UsageError(message);
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function repoRelative(cwd, targetPath) {
  const relative = path.relative(cwd, targetPath);
  return slashPath(relative || ".");
}

function isInsidePath(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRoundId(value) {
  const roundId = String(value || "").trim();
  if (!ROUND_PATTERN.test(roundId)) {
    fail("round id must match ROUND-NNN");
  }
  return roundId;
}

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(10, Math.round(value)));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return undefined;
  }
}

function parseIsoDate(value) {
  if (!nonEmpty(value)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstDefined(source, keys) {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function stringArray(value, fallback = []) {
  const source = value === undefined ? fallback : value;
  const values = source instanceof Set ? [...source] : source;
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function plainObject(value, fallback = {}) {
  const source = value === undefined ? fallback : value;
  if (!source || typeof source !== "object" || Array.isArray(source) || source instanceof Set) {
    return {};
  }
  return { ...source };
}

function numberValue(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function defaultField(defaults, key, fallback) {
  return Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : fallback;
}

function contextGateGovernance(governance, defaults = {}) {
  const source = governance || {};
  const allowedTransitions = stringArray(
    firstDefined(source, ["allowed_transitions", "allowedTransitions"]),
    defaultField(defaults, "allowedTransitions", ALLOWED_TRANSITIONS)
  );
  const requiredGateTransitions = stringArray(
    firstDefined(source, ["required_gate_transitions", "requiredGateTransitions"]),
    defaultField(defaults, "requiredGateTransitions", REQUIRED_GATE_TRANSITIONS)
  );
  const optionalGateTransitions = stringArray(
    firstDefined(source, ["optional_gate_transitions", "optionalGateTransitions"]),
    defaultField(defaults, "optionalGateTransitions", OPTIONAL_GATE_TRANSITIONS)
  );
  const dimensions = stringArray(
    firstDefined(source, ["dimensions"]),
    defaultField(defaults, "dimensions", DIMENSIONS)
  );
  const validVerdicts = stringArray(
    firstDefined(source, ["valid_verdicts", "validVerdicts"]),
    defaultField(defaults, "validVerdicts", VALID_VERDICTS)
  );
  const bypassReasonCodes = stringArray(
    firstDefined(source, ["bypass_reason_codes", "bypassReasonCodes"]),
    defaultField(defaults, "bypassReasonCodes", BYPASS_REASON_CODES)
  );
  const executionTransitions = stringArray(
    firstDefined(source, ["execution_transitions", "executionTransitions"]),
    defaultField(defaults, "executionTransitions", EXECUTION_TRANSITIONS)
  );
  const phases = stringArray(
    firstDefined(source, ["phases"]),
    defaultField(defaults, "phases", [])
  );
  const phaseToExpectedTransition = plainObject(
    firstDefined(source, ["phase_to_expected_transition", "phaseToExpectedTransition"]),
    defaultField(defaults, "phaseToExpectedTransition", {})
  );
  const defaultMaxArtifactAgeDays = numberValue(
    firstDefined(source, ["default_max_artifact_age_days", "defaultMaxArtifactAgeDays"]),
    defaultField(defaults, "defaultMaxArtifactAgeDays", DEFAULT_MAX_ARTIFACT_AGE_DAYS)
  );

  return {
    allowedTransitions,
    allowed_transitions: allowedTransitions,
    requiredGateTransitions,
    required_gate_transitions: requiredGateTransitions,
    requiredGateTransitionSet: new Set(requiredGateTransitions),
    optionalGateTransitions,
    optional_gate_transitions: optionalGateTransitions,
    optionalGateTransitionSet: new Set(optionalGateTransitions),
    dimensions,
    validVerdicts,
    valid_verdicts: validVerdicts,
    validVerdictSet: new Set(validVerdicts),
    bypassReasonCodes,
    bypass_reason_codes: bypassReasonCodes,
    executionTransitions,
    execution_transitions: executionTransitions,
    executionTransitionSet: new Set(executionTransitions),
    phases,
    phaseToExpectedTransition,
    phase_to_expected_transition: phaseToExpectedTransition,
    defaultMaxArtifactAgeDays,
    default_max_artifact_age_days: defaultMaxArtifactAgeDays,
  };
}

function normalizeTransition(input = {}, { governance } = {}) {
  const rules = contextGateGovernance(governance);
  if (input.transition) {
    const transition = String(input.transition).trim();
    if (!rules.allowedTransitions.includes(transition)) {
      fail(`invalid context transition: ${transition}`);
    }
    return transition;
  }

  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  if (!from || !to) {
    fail("context gate requires --from and --to phases");
  }
  const transition = `${from}->${to}`;
  if (!rules.allowedTransitions.includes(transition)) {
    fail(`invalid context transition: ${transition}`);
  }
  return transition;
}

module.exports = {
  clampScore,
  contextGateGovernance,
  fail,
  isInsidePath,
  nonEmpty,
  normalizeTransition,
  parseIsoDate,
  parseJsonSafe,
  repoRelative,
  safeRoundId,
  slashPath,
  uniqueStrings,
};
