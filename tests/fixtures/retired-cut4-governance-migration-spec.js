"use strict";

const fs = require("node:fs");

const { ConfigError } = require("./errors");

const TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version",
  "migration_id",
  "version_source",
  "version_target",
  "expected_change_level",
  "actions",
]);

const CHANGE_LEVELS = new Set(["NONE", "PATCH", "MINOR", "MAJOR"]);
const SET_FIELDS = new Set(["phases", "default_max_artifact_age_days", "contract_template_path", "contract_template_hash"]);
const SET_MEMBER_FIELDS = new Set([
  "allowed_transitions",
  "required_gate_transitions",
  "optional_gate_transitions",
  "dimensions",
  "valid_verdicts",
  "bypass_reason_codes",
  "execution_transitions",
]);
const MAP_FIELDS = new Set(["phase_to_expected_transition"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(issues, code, message, details = {}) {
  issues.push({ severity: "fail", code, message, ...details });
}

function rejectUnknownFields(issues, value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addIssue(issues, "unknown_field", `${label} contains unknown field: ${key}`, { field: key });
  }
}

function requireString(issues, value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    addIssue(issues, "invalid_field", `${field} must be a non-empty string`, { field });
    return null;
  }
  return value;
}

function requireArray(issues, value, field) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_field", `${field} must be an array`, { field });
    return null;
  }
  return value;
}

function stringArrayIssues(issues, value, field) {
  const seen = new Set();
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      addIssue(issues, "invalid_field", `${field} must contain only non-empty strings`, { field, index });
      return;
    }
    if (seen.has(item)) addIssue(issues, "duplicate_value", `${field} must not contain duplicate values`, { field, value: item });
    seen.add(item);
  });
}

function validateSetAction(issues, action, index) {
  rejectUnknownFields(issues, action, ["type", "field", "value"], `actions[${index}]`);
  const field = requireString(issues, action.field, `actions[${index}].field`);
  if (field && !SET_FIELDS.has(field)) addIssue(issues, "unsupported_field", `set cannot target governance field: ${field}`, { action: index, field });
  if (field === "version") addIssue(issues, "unsupported_field", "version is managed by version_target and cannot be set by an action", { action: index, field });
  if (!hasOwn(action, "value")) {
    addIssue(issues, "missing_field", `actions[${index}].value is required`, { action: index, field: "value" });
    return;
  }
  if (field === "phases") {
    const phases = requireArray(issues, action.value, `actions[${index}].value`);
    if (phases) stringArrayIssues(issues, phases, `actions[${index}].value`);
  } else if (field === "default_max_artifact_age_days") {
    if (!Number.isInteger(action.value) || action.value <= 0) addIssue(issues, "invalid_field", `actions[${index}].value must be a positive integer`, { action: index, field: "value" });
  } else if (field === "contract_template_path") {
    requireString(issues, action.value, `actions[${index}].value`);
  } else if (field === "contract_template_hash") {
    const hash = requireString(issues, action.value, `actions[${index}].value`);
    if (hash && !/^[a-f0-9]{64}$/.test(hash)) addIssue(issues, "invalid_field", `actions[${index}].value must be a lowercase sha256 hex digest`, { action: index, field: "value" });
  }
}

function validateSetMemberAction(issues, action, index) {
  rejectUnknownFields(issues, action, ["type", "field", "value"], `actions[${index}]`);
  const field = requireString(issues, action.field, `actions[${index}].field`);
  if (field && !SET_MEMBER_FIELDS.has(field)) addIssue(issues, "unsupported_field", `${action.type} cannot target governance field: ${field}`, { action: index, field });
  requireString(issues, action.value, `actions[${index}].value`);
}

function validateReplaceMapAction(issues, action, index) {
  rejectUnknownFields(issues, action, ["type", "map", "key", "value"], `actions[${index}]`);
  const map = requireString(issues, action.map, `actions[${index}].map`);
  if (map && !MAP_FIELDS.has(map)) addIssue(issues, "unsupported_field", `replace_map_value cannot target governance map: ${map}`, { action: index, map });
  requireString(issues, action.key, `actions[${index}].key`);
  if (!hasOwn(action, "value")) addIssue(issues, "missing_field", `actions[${index}].value is required`, { action: index, field: "value" });
  else if (action.value !== null && (typeof action.value !== "string" || action.value.trim() === "")) {
    addIssue(issues, "invalid_field", `actions[${index}].value must be a non-empty string or null`, { action: index, field: "value" });
  }
}

function normalizeAction(action) {
  if (action.type === "set") return { type: "set", field: action.field, value: cloneJson(action.value) };
  if (action.type === "add_to_set" || action.type === "remove_from_set") return { type: action.type, field: action.field, value: action.value };
  return { type: "replace_map_value", map: action.map, key: action.key, value: action.value };
}

function validateMigrationSpec(input) {
  const issues = [];
  if (!isObject(input)) {
    addIssue(issues, "invalid_spec", "migration spec must be a JSON object");
    return { ok: false, status: "fail", issues, spec: null };
  }
  rejectUnknownFields(issues, input, TOP_LEVEL_FIELDS, "migration spec");
  for (const field of TOP_LEVEL_FIELDS) if (!hasOwn(input, field)) addIssue(issues, "missing_field", `migration spec requires ${field}`, { field });
  if (input.schema_version !== "1") addIssue(issues, "schema_version", "migration spec schema_version must be 1", { field: "schema_version" });
  requireString(issues, input.migration_id, "migration_id");
  requireString(issues, input.version_source, "version_source");
  requireString(issues, input.version_target, "version_target");
  if (typeof input.expected_change_level !== "string" || !CHANGE_LEVELS.has(input.expected_change_level)) {
    addIssue(issues, "expected_change_level", "expected_change_level must be NONE, PATCH, MINOR, or MAJOR", { field: "expected_change_level" });
  }
  if (!Array.isArray(input.actions)) {
    addIssue(issues, "invalid_field", "actions must be an array", { field: "actions" });
  } else {
    input.actions.forEach((action, index) => {
      if (!isObject(action)) {
        addIssue(issues, "invalid_action", `actions[${index}] must be an object`, { action: index });
      } else if (action.type === "set") validateSetAction(issues, action, index);
      else if (action.type === "add_to_set" || action.type === "remove_from_set") validateSetMemberAction(issues, action, index);
      else if (action.type === "replace_map_value") validateReplaceMapAction(issues, action, index);
      else addIssue(issues, "unknown_action_type", `unknown migration action type: ${action.type || "missing"}`, { action: index });
    });
  }
  const ok = issues.length === 0;
  return {
    ok,
    status: ok ? "pass" : "fail",
    issues,
    spec: ok ? {
      schema_version: "1",
      migration_id: input.migration_id,
      version_source: input.version_source,
      version_target: input.version_target,
      expected_change_level: input.expected_change_level,
      actions: input.actions.map(normalizeAction),
    } : null,
  };
}

function requireValidSpec(input) {
  const validation = validateMigrationSpec(input);
  if (!validation.ok) throw new ConfigError(`invalid governance migration spec: ${validation.issues.map((item) => item.code).join(", ")}`, { details: { issues: validation.issues } });
  return validation.spec;
}

function readMigrationSpec(specPath) {
  try {
    return requireValidSpec(JSON.parse(fs.readFileSync(specPath, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") throw new ConfigError(`governance migration spec not found: ${specPath}`, { cause: error });
    if (error instanceof SyntaxError) throw new ConfigError(`invalid governance migration spec JSON: ${specPath}`, { cause: error });
    throw error;
  }
}

module.exports = { cloneJson, hasOwn, isObject, readMigrationSpec, requireValidSpec, validateMigrationSpec };
