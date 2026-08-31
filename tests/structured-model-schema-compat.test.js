"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FRONTIER_CANDIDATE_JSON_SCHEMA,
  GRILL_CANDIDATE_JSON_SCHEMA,
} = require("../lib/delegation-round3-frontier");
const { PLANNER_CANDIDATE_BATCH_SCHEMA } = require("../lib/repo-planner-admission");
const { RESEARCH_PROMOTION_CANDIDATE_SCHEMA } = require("../lib/repo-research-promotion");
const { FORWARD_MOTION_CANDIDATE_SCHEMA } = require("../lib/work-forward-motion");
const { PROOF_COMPILER_SCHEMA } = require("../lib/work-proof-compiler");
const { WORKER_RESULT_SCHEMA } = require("../lib/worker-result");

const PROVIDER_SCHEMAS = Object.freeze([
  ["research promotion", RESEARCH_PROMOTION_CANDIDATE_SCHEMA],
  ["logical planner", PLANNER_CANDIDATE_BATCH_SCHEMA],
  ["coding worker", WORKER_RESULT_SCHEMA],
  ["forward motion", FORWARD_MOTION_CANDIDATE_SCHEMA],
  ["product proof compiler", PROOF_COMPILER_SCHEMA],
  ["delegation frontier", FRONTIER_CANDIDATE_JSON_SCHEMA],
  ["delegation grill", GRILL_CANDIDATE_JSON_SCHEMA],
]);

function declaredTypes(schema) {
  if (typeof schema.type === "string") return [schema.type];
  return Array.isArray(schema.type) ? schema.type : [];
}

function compatibleScalarTypes(value) {
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string"];
  if (typeof value === "boolean") return ["boolean"];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? ["integer", "number"] : ["number"];
  }
  return [];
}

function assertScalarTypeDeclared(schema, value, path, keyword) {
  const compatible = compatibleScalarTypes(value);
  assert.ok(compatible.length > 0, `${path}.${keyword} must be a supported scalar literal`);
  assert.ok(
    declaredTypes(schema).some((type) => compatible.includes(type)),
    `${path}.${keyword} must have an explicit compatible scalar type`,
  );
}

function homogeneousScalarEnum(values) {
  if (!Array.isArray(values) || values.length === 0) return false;
  const families = values.map((value) => {
    if (value === null) return "null";
    if (typeof value === "number" && Number.isFinite(value)) return "number";
    if (typeof value === "string" || typeof value === "boolean") return typeof value;
    return null;
  });
  return families.every(Boolean) && new Set(families).size === 1;
}

function visitSchema(schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  assert.equal(Object.hasOwn(schema, "oneOf"), false, `${path} must not use provider-unsupported oneOf`);
  assert.equal(Object.hasOwn(schema, "uniqueItems"), false, `${path} must not use provider-unsupported uniqueItems`);

  if (Object.hasOwn(schema, "const")) {
    assertScalarTypeDeclared(schema, schema.const, path, "const");
  }
  if (homogeneousScalarEnum(schema.enum)) {
    for (const value of schema.enum) assertScalarTypeDeclared(schema, value, path, "enum");
  }

  const types = declaredTypes(schema);
  if (types.includes("object")) {
    assert.equal(schema.additionalProperties, false, `${path} object must set additionalProperties:false`);
    const propertyNames = Object.keys(schema.properties || {}).sort();
    if (propertyNames.length > 0) {
      assert.ok(Array.isArray(schema.required), `${path} object must require every declared property`);
      assert.deepEqual([...schema.required].sort(), propertyNames, `${path} object required must contain every property`);
    }
  }

  for (const [name, child] of Object.entries(schema.properties || {})) {
    visitSchema(child, `${path}.properties.${name}`);
  }
  if (schema.items && typeof schema.items === "object") visitSchema(schema.items, `${path}.items`);
  for (const keyword of ["anyOf", "allOf"]) {
    if (!Array.isArray(schema[keyword])) continue;
    schema[keyword].forEach((child, index) => visitSchema(child, `${path}.${keyword}[${index}]`));
  }
  for (const keyword of ["$defs", "definitions"]) {
    if (!schema[keyword] || typeof schema[keyword] !== "object") continue;
    for (const [name, child] of Object.entries(schema[keyword])) {
      visitSchema(child, `${path}.${keyword}.${name}`);
    }
  }
}

test("all provider-facing structured schemas satisfy the supported strict wire contract", () => {
  for (const [name, schema] of PROVIDER_SCHEMAS) {
    assert.ok(declaredTypes(schema).includes("object"), `${name} root must be type:object`);
    visitSchema(schema, name);
  }
});
