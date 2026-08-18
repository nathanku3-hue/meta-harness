"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { persistImmutableJson, readImmutableJson } = require("./world-authority");

const OUTCOME_SCHEMA = "outcome/v1";
const OUTCOME_DOMAIN = "meta-harness-outcome/v1";
const PRECONDITION_DOMAIN = "meta-harness-outcome-preconditions/v1";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_OUTCOME_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_OUTCOME_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_OUTCOME_VALUE", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("MH_OUTCOME_VALUE", `${label} must contain at least one item`);
  }
  const normalized = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail("MH_OUTCOME_VALUE", `${label} must not contain duplicates`);
  }
  return normalized;
}

function outcomeBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.outcomeDigest;
  return body;
}

function computeOutcomeDigest(value) {
  return domainDigest(OUTCOME_DOMAIN, outcomeBody(value));
}

function computePreconditionDigest(value) {
  const outcome = validateOutcome(value);
  return domainDigest(PRECONDITION_DOMAIN, { preconditions: outcome.preconditions });
}

function validateOutcome(value) {
  exactKeys(value, [
    "schemaVersion",
    "id",
    "desiredState",
    "preconditions",
    "evidenceRequirement",
    "outcomeDigest",
  ], "outcome");
  if (value.schemaVersion !== OUTCOME_SCHEMA) {
    fail("MH_OUTCOME_SCHEMA", `outcome.schemaVersion must be ${OUTCOME_SCHEMA}`);
  }
  nonEmptyString(value.id, "outcome.id");
  nonEmptyString(value.desiredState, "outcome.desiredState");
  stringList(value.preconditions, "outcome.preconditions");
  nonEmptyString(value.evidenceRequirement, "outcome.evidenceRequirement");
  if (!isDigest(value.outcomeDigest) || value.outcomeDigest !== computeOutcomeDigest(value)) {
    fail("MH_OUTCOME_DIGEST", "outcome.outcomeDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function createOutcome({ id, desiredState, preconditions, evidenceRequirement }) {
  const body = {
    schemaVersion: OUTCOME_SCHEMA,
    id: nonEmptyString(id, "outcome.id"),
    desiredState: nonEmptyString(desiredState, "outcome.desiredState"),
    preconditions: stringList(preconditions, "outcome.preconditions"),
    evidenceRequirement: nonEmptyString(evidenceRequirement, "outcome.evidenceRequirement"),
  };
  return validateOutcome({ ...body, outcomeDigest: computeOutcomeDigest(body) });
}

function persistOutcome(repositoryPath, value) {
  const outcome = validateOutcome(value);
  persistImmutableJson(repositoryPath, "outcomes", outcome.outcomeDigest, outcome, "MH_OUTCOME_WRITE");
  return outcome;
}

function readOutcome(repositoryPath, outcomeDigest) {
  if (!isDigest(outcomeDigest)) fail("MH_OUTCOME_DIGEST", "outcomeDigest must be a sha256 digest");
  const outcome = validateOutcome(readImmutableJson(repositoryPath, "outcomes", outcomeDigest));
  if (outcome.outcomeDigest !== outcomeDigest) {
    fail("MH_OUTCOME_DIGEST", "immutable Outcome path identity does not match its body");
  }
  return outcome;
}

module.exports = {
  OUTCOME_DOMAIN,
  OUTCOME_SCHEMA,
  PRECONDITION_DOMAIN,
  computeOutcomeDigest,
  computePreconditionDigest,
  createOutcome,
  persistOutcome,
  readOutcome,
  validateOutcome,
};
