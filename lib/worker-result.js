"use strict";

const { ConfigError } = require("./errors");

const WORKER_RESULT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status", "observableResult", "operations", "validation", "stop"],
  properties: {
    schemaVersion: { const: "worker-result/v2" },
    status: { enum: ["DONE", "PARTIAL", "STOP"] },
    observableResult: { type: "string" },
    operations: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "path", "content"],
            properties: {
              type: { const: "WRITE" }, path: { type: "string" }, content: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "path"],
            properties: { type: { const: "DELETE" }, path: { type: "string" } },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "from", "to"],
            properties: {
              type: { const: "MOVE" }, from: { type: "string" }, to: { type: "string" },
            },
          },
        ],
      },
    },
    validation: { type: "array", items: { type: "string" } },
    stop: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["unsatisfiedRequirement", "failedMeans", "alternativesConsidered", "assertedConstraint"],
          properties: {
            unsatisfiedRequirement: { type: "string", minLength: 1 },
            failedMeans: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["means", "evidence"],
                properties: {
                  means: { type: "string", minLength: 1 },
                  evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
                },
              },
            },
            alternativesConsidered: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["means", "disposition", "evidence"],
                properties: {
                  means: { type: "string", minLength: 1 },
                  disposition: { enum: ["FAILED", "RULED_OUT", "AVAILABLE"] },
                  evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
                },
              },
            },
            assertedConstraint: { type: ["string", "null"] },
          },
        },
      ],
    },
  },
});

function fail(message) {
  throw new ConfigError(message, { code: "MH_WORKER_RESULT" });
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.trim() !== "");
}

function validStop(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== "alternativesConsidered\0assertedConstraint\0failedMeans\0unsatisfiedRequirement"
      || typeof value.unsatisfiedRequirement !== "string" || value.unsatisfiedRequirement.trim() === ""
      || !Array.isArray(value.failedMeans) || value.failedMeans.length === 0
      || !Array.isArray(value.alternativesConsidered)
      || (value.assertedConstraint !== null && typeof value.assertedConstraint !== "string")) return false;
  const failedMeansValid = value.failedMeans.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && Object.keys(entry).sort().join("\0") === "evidence\0means"
    && typeof entry.means === "string" && entry.means.trim() !== ""
    && nonEmptyStrings(entry.evidence));
  const alternativesValid = value.alternativesConsidered.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && Object.keys(entry).sort().join("\0") === "disposition\0evidence\0means"
    && typeof entry.means === "string" && entry.means.trim() !== ""
    && ["FAILED", "RULED_OUT", "AVAILABLE"].includes(entry.disposition)
    && nonEmptyStrings(entry.evidence));
  return failedMeansValid && alternativesValid;
}

function validOperation(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (entry.type === "WRITE") {
    return Object.keys(entry).sort().join("\0") === "content\0path\0type"
      && typeof entry.path === "string" && typeof entry.content === "string";
  }
  if (entry.type === "DELETE") {
    return Object.keys(entry).sort().join("\0") === "path\0type" && typeof entry.path === "string";
  }
  if (entry.type === "MOVE") {
    return Object.keys(entry).sort().join("\0") === "from\0to\0type"
      && typeof entry.from === "string" && typeof entry.to === "string";
  }
  return false;
}

function validateWorkerResult(parsed) {
  const required = ["schemaVersion", "status", "observableResult", "operations", "validation", "stop"];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).sort().join("\0") !== required.slice().sort().join("\0")) {
    fail("coding worker result has missing or unexpected fields");
  }
  if (parsed.schemaVersion !== "worker-result/v2"
      || !["DONE", "PARTIAL", "STOP"].includes(parsed.status)
      || typeof parsed.observableResult !== "string"
      || !Array.isArray(parsed.operations) || parsed.operations.some((entry) => !validOperation(entry))
      || !Array.isArray(parsed.validation) || parsed.validation.some((entry) => typeof entry !== "string")
      || (parsed.status === "STOP" ? !validStop(parsed.stop) || parsed.operations.length !== 0 : parsed.stop !== null)) {
    fail("coding worker result contains invalid values");
  }
  return Object.freeze(JSON.parse(JSON.stringify(parsed)));
}

module.exports = { WORKER_RESULT_SCHEMA, validateWorkerResult };
