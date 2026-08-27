"use strict";

const { freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { ConfigError } = require("./errors");
const { createOutcome } = require("./outcome");
const { compileExecutionBoundary } = require("./repo-planner-admission");
const { resolveGoalValidation } = require("./work-validation");

const MAX_EXPECTED_WRITE_PATHS = 32;
const NO_PUBLISH_REMOTE = "meta-harness-no-publish";
const NO_PUBLISH_BRANCH = "meta-harness-no-publish";

const NEW_LANE_CANDIDATE_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "desiredState",
    "preconditions",
    "evidenceRequirement",
    "journeyState",
    "doNow",
    "stopOnlyIf",
    "expectedWritePaths",
    "reason",
    "evidenceRefs",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 200 },
    desiredState: { type: "string", minLength: 1, maxLength: 4000 },
    preconditions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    evidenceRequirement: { type: "string", minLength: 1, maxLength: 4000 },
    journeyState: { type: "string", minLength: 1, maxLength: 4000 },
    doNow: { type: "string", minLength: 1, maxLength: 4000 },
    stopOnlyIf: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    expectedWritePaths: {
      type: "array",
      minItems: 1,
      maxItems: MAX_EXPECTED_WRITE_PATHS,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    reason: { type: "string", minLength: 1, maxLength: 2000 },
    evidenceRefs: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 200 },
    },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R3_LANE_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R3_LANE_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function text(value, label, max = 4000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_LANE_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function uniqueTextList(value, label, { min = 1, max = 12, itemMax = 1000 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail("MH_DELEGATION_R3_LANE_VALUE", `${label} must contain ${min}-${max} entries`);
  }
  const values = value.map((entry, index) => text(entry, `${label}[${index}]`, itemMax));
  if (new Set(values).size !== values.length) fail("MH_DELEGATION_R3_LANE_VALUE", `${label} must not contain duplicates`);
  return Object.freeze(values);
}

function evidenceRefs(value, label, knownEvidenceRefs) {
  const refs = uniqueTextList(value, label, { min: 1, max: 20, itemMax: 200 });
  if (knownEvidenceRefs && refs.some((ref) => !knownEvidenceRefs.has(ref))) {
    fail("MH_DELEGATION_R3_FRONTIER_EVIDENCE", `${label} references evidence outside the bounded frontier input`);
  }
  return refs;
}

function validateDelegationLaneCandidate(value, index, { knownEvidenceRefs, liveOutcomeDigests, seenIds } = {}) {
  const label = `delegationFrontier.newOutcomes[${index}]`;
  exactKeys(value, [
    "id",
    "desiredState",
    "preconditions",
    "evidenceRequirement",
    "journeyState",
    "doNow",
    "stopOnlyIf",
    "expectedWritePaths",
    "reason",
    "evidenceRefs",
  ], label);
  const id = text(value.id, `${label}.id`, 200);
  if (id.includes("\n")) fail("MH_DELEGATION_R3_LANE_VALUE", `${label}.id must be one line`);
  if (seenIds?.has(id)) fail("MH_DELEGATION_R3_FRONTIER_VALUE", `duplicate new Outcome id: ${id}`);
  seenIds?.add(id);
  const outcome = createOutcome({
    id,
    desiredState: text(value.desiredState, `${label}.desiredState`, 4000),
    preconditions: uniqueTextList(value.preconditions, `${label}.preconditions`),
    evidenceRequirement: text(value.evidenceRequirement, `${label}.evidenceRequirement`, 4000),
  });
  if (liveOutcomeDigests?.has(outcome.outcomeDigest)) {
    fail("MH_DELEGATION_R3_FRONTIER_VALUE", `new Outcome duplicates a currently live lane: ${id}`);
  }
  const boundary = compileExecutionBoundary(
    uniqueTextList(value.expectedWritePaths, `${label}.expectedWritePaths`, {
      min: 1,
      max: MAX_EXPECTED_WRITE_PATHS,
      itemMax: 1000,
    }),
  );
  return freezeDeep({
    id: outcome.id,
    desiredState: outcome.desiredState,
    preconditions: [...outcome.preconditions],
    evidenceRequirement: outcome.evidenceRequirement,
    journeyState: text(value.journeyState, `${label}.journeyState`, 4000),
    doNow: text(value.doNow, `${label}.doNow`, 4000),
    stopOnlyIf: [...uniqueTextList(value.stopOnlyIf, `${label}.stopOnlyIf`)],
    expectedWritePaths: [...boundary.writePaths],
    reason: text(value.reason, `${label}.reason`, 2000),
    evidenceRefs: [...evidenceRefs(value.evidenceRefs, `${label}.evidenceRefs`, knownEvidenceRefs)],
  });
}

function compileDevSpaceTaskBrief({ repositoryPath, current, candidate }) {
  if (!current?.head?.productCommit) fail("MH_DELEGATION_R3_WORLD", "refill task compilation requires current world-head/v2 productCommit");
  const validation = resolveGoalValidation(repositoryPath, current.head.productCommit, candidate.expectedWritePaths);
  if (!validation.supported || validation.validation.length === 0) {
    fail(
      "MH_DELEGATION_R3_VALIDATION_UNAVAILABLE",
      validation.reason || "deterministic validation is unavailable for delegated refill lane",
      { outcomeId: candidate.id, adapter: validation.adapter || null },
    );
  }
  return freezeDeep({
    productResult: candidate.desiredState,
    journeyState: candidate.journeyState,
    doNow: candidate.doNow,
    doneWhen: candidate.evidenceRequirement,
    stopOnlyIf: [...candidate.stopOnlyIf],
    allowedPaths: [...candidate.expectedWritePaths],
    validation: validation.validation.map((command) => ({
      argv: [...command.argv],
      cwd: command.cwd,
      timeoutSeconds: command.timeoutSeconds,
    })),
    git: {
      remote: NO_PUBLISH_REMOTE,
      branch: NO_PUBLISH_BRANCH,
      paths: [...candidate.expectedWritePaths],
      commit: false,
      push: false,
    },
  });
}

module.exports = {
  MAX_EXPECTED_WRITE_PATHS,
  NEW_LANE_CANDIDATE_JSON_SCHEMA,
  NO_PUBLISH_BRANCH,
  NO_PUBLISH_REMOTE,
  compileDevSpaceTaskBrief,
  validateDelegationLaneCandidate,
};
