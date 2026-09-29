"use strict";

const RETIRED_EXECUTION_SCHEMAS = Object.freeze(new Set([
  "run-spec/v1",
  "run-spec-approval/v1",
  "attempt-authorization/v1",
  "implementation-assessment/v1",
  "execution-custody-manifest/v1",
  "meta-harness-execution-request/v1",
  "meta-harness-execution-receipt/v1",
  "meta-harness-execute-result/v1",
]));

const RETIRED_TRUTH_SCHEMAS = Object.freeze(new Set([
  "meta-harness-truth-authority-public/v1",
  "meta-harness-truth-authority-receipt/v1",
  "meta-harness-truth-authority-receipt/v2",
  "meta-harness-truth-proposal/v1",
  "truth-authority-public-key/v1",
]));

const RETIRED_CAPABILITIES = Object.freeze(new Set([
  "canonical_truth_mutation",
]));

function unsupportedSchema(schemaVersion) {
  const error = new Error(`unsupported pre-0.4 schema: ${String(schemaVersion || "missing")}`);
  error.code = "UNSUPPORTED_SCHEMA";
  error.details = { schemaVersion: schemaVersion || null };
  return error;
}

function assertNotRetiredSchema(schemaVersion) {
  if (RETIRED_EXECUTION_SCHEMAS.has(schemaVersion) || RETIRED_TRUTH_SCHEMAS.has(schemaVersion)) {
    throw unsupportedSchema(schemaVersion);
  }
}

function assertNotRetiredCapability(capability) {
  if (RETIRED_CAPABILITIES.has(capability)) {
    const error = new Error(`unsupported pre-0.4 capability: ${capability}`);
    error.code = "UNSUPPORTED_AUTHORITY";
    error.details = { capability };
    throw error;
  }
}

function findRetiredIdentity(value, seen = new Set()) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (RETIRED_EXECUTION_SCHEMAS.has(value) || RETIRED_TRUTH_SCHEMAS.has(value)) {
      return { kind: "schema", value };
    }
    if (RETIRED_CAPABILITIES.has(value)) return { kind: "capability", value };
    return null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRetiredIdentity(entry, seen);
      if (found) return found;
    }
    return null;
  }
  for (const entry of Object.values(value)) {
    const found = findRetiredIdentity(entry, seen);
    if (found) return found;
  }
  return null;
}

function rejectRetiredObject(value) {
  const found = findRetiredIdentity(value);
  if (!found) return;
  if (found.kind === "schema") throw unsupportedSchema(found.value);
  assertNotRetiredCapability(found.value);
}

module.exports = {
  RETIRED_CAPABILITIES,
  RETIRED_EXECUTION_SCHEMAS,
  RETIRED_TRUTH_SCHEMAS,
  assertNotRetiredCapability,
  assertNotRetiredSchema,
  findRetiredIdentity,
  rejectRetiredObject,
  unsupportedSchema,
};
