"use strict";

const { cloneStrict, freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { persistImmutableJson, readImmutableJson } = require("./world-authority");

const DELEGATION_LEARNING_SCHEMA = "meta-harness-delegation-learning/v1";
const DELEGATION_LEARNING_DOMAIN = "meta-harness-delegation-learning/v1";
const ACCEPTANCE_STATES = new Set(["PASS", "FAIL", "UNKNOWN"]);
const CRITERION_VERDICTS = new Set(["PASS", "FAIL", "UNKNOWN"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R3_LEARNING_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R3_LEARNING_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label, max = 4_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function oneLine(value, label, max = 256) {
  const text = nonEmpty(value, label, max);
  if (text.includes("\n")) fail("MH_DELEGATION_R3_LEARNING_VALUE", `${label} must be one line`);
  return text;
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_DELEGATION_R3_LEARNING_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function stringRefs(value, label, known = null) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", `${label} must contain 1-20 evidence refs`);
  }
  const refs = value.map((entry, index) => oneLine(entry, `${label}[${index}]`, 128));
  if (new Set(refs).size !== refs.length) fail("MH_DELEGATION_R3_LEARNING_VALUE", `${label} must not contain duplicates`);
  if (known && refs.some((ref) => !known.has(ref))) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", `${label} references evidence outside the compact result index`);
  }
  return Object.freeze(refs);
}

function validateCompactResult(value, acceptance) {
  exactKeys(value, [
    "resultDigest",
    "taskOutcome",
    "claim",
    "acceptance",
    "criteria",
    "evidenceIndex",
    "worldDelta",
    "remainingUncertainty",
    "recommendedHandoff",
    "submittedAt",
  ], "delegationLearning.result");
  requireDigest(value.resultDigest, "delegationLearning.result.resultDigest");
  if (!["READY", "DONE", "UNVERIFIED", "BLOCKED"].includes(value.taskOutcome)) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.result.taskOutcome is invalid");
  }
  nonEmpty(value.claim, "delegationLearning.result.claim", 2_000);
  if (value.acceptance !== acceptance || !ACCEPTANCE_STATES.has(value.acceptance)) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.result.acceptance must match the accepted lane state");
  }
  if (!Array.isArray(value.evidenceIndex) || value.evidenceIndex.length < 1 || value.evidenceIndex.length > 20) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.result.evidenceIndex must contain 1-20 entries");
  }
  const evidenceRefs = new Set();
  value.evidenceIndex.forEach((entry, index) => {
    exactKeys(entry, ["ref", "summary"], `delegationLearning.result.evidenceIndex[${index}]`);
    const ref = oneLine(entry.ref, `delegationLearning.result.evidenceIndex[${index}].ref`, 128);
    nonEmpty(entry.summary, `delegationLearning.result.evidenceIndex[${index}].summary`, 500);
    if (evidenceRefs.has(ref)) fail("MH_DELEGATION_R3_LEARNING_VALUE", `duplicate evidence ref: ${ref}`);
    evidenceRefs.add(ref);
  });
  if (!Array.isArray(value.criteria) || value.criteria.length < 1 || value.criteria.length > 8) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.result.criteria must contain 1-8 entries");
  }
  value.criteria.forEach((criterion, index) => {
    exactKeys(criterion, ["id", "verdict", "evidenceRefs"], `delegationLearning.result.criteria[${index}]`);
    oneLine(criterion.id, `delegationLearning.result.criteria[${index}].id`, 128);
    if (!CRITERION_VERDICTS.has(criterion.verdict)) {
      fail("MH_DELEGATION_R3_LEARNING_VALUE", `delegationLearning.result.criteria[${index}].verdict is invalid`);
    }
    stringRefs(criterion.evidenceRefs, `delegationLearning.result.criteria[${index}].evidenceRefs`, evidenceRefs);
  });
  for (const field of ["worldDelta", "remainingUncertainty"]) {
    if (!Array.isArray(value[field]) || value[field].length > 12) {
      fail("MH_DELEGATION_R3_LEARNING_VALUE", `delegationLearning.result.${field} must contain at most 12 entries`);
    }
    value[field].forEach((entry, index) => {
      exactKeys(entry, ["fact", "evidenceRefs"], `delegationLearning.result.${field}[${index}]`);
      nonEmpty(entry.fact, `delegationLearning.result.${field}[${index}].fact`, 1_000);
      stringRefs(entry.evidenceRefs, `delegationLearning.result.${field}[${index}].evidenceRefs`, evidenceRefs);
    });
  }
  if (value.recommendedHandoff !== null) nonEmpty(value.recommendedHandoff, "delegationLearning.result.recommendedHandoff", 2_000);
  if (typeof value.submittedAt !== "string" || !Number.isFinite(Date.parse(value.submittedAt))) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.result.submittedAt must be an ISO timestamp");
  }
  return freezeDeep(cloneStrict(value));
}

function learningBody(value) {
  const body = cloneStrict(value);
  delete body.learningDigest;
  return body;
}

function computeDelegationLearningDigest(value) {
  return domainDigest(DELEGATION_LEARNING_DOMAIN, learningBody(value));
}

function validateDelegationLearning(value) {
  exactKeys(value, [
    "schemaVersion",
    "delegationId",
    "contractDigest",
    "originWorldHeadDigest",
    "contextDigest",
    "laneKey",
    "outcomeDigest",
    "taskId",
    "workspaceId",
    "laneBriefDigest",
    "bootPromptDigest",
    "resultDigest",
    "acceptance",
    "result",
    "learningDigest",
  ], "delegationLearning");
  if (value.schemaVersion !== DELEGATION_LEARNING_SCHEMA) {
    fail("MH_DELEGATION_R3_LEARNING_SCHEMA", `delegationLearning.schemaVersion must be ${DELEGATION_LEARNING_SCHEMA}`);
  }
  oneLine(value.delegationId, "delegationLearning.delegationId", 200);
  oneLine(value.laneKey, "delegationLearning.laneKey", 64);
  oneLine(value.taskId, "delegationLearning.taskId", 200);
  oneLine(value.workspaceId, "delegationLearning.workspaceId", 200);
  for (const field of [
    "contractDigest",
    "originWorldHeadDigest",
    "contextDigest",
    "outcomeDigest",
    "laneBriefDigest",
    "bootPromptDigest",
    "resultDigest",
    "learningDigest",
  ]) requireDigest(value[field], `delegationLearning.${field}`);
  if (!ACCEPTANCE_STATES.has(value.acceptance)) {
    fail("MH_DELEGATION_R3_LEARNING_VALUE", "delegationLearning.acceptance must be PASS, FAIL, or UNKNOWN");
  }
  const result = validateCompactResult(value.result, value.acceptance);
  if (result.resultDigest !== value.resultDigest) {
    fail("MH_DELEGATION_R3_LEARNING_DIGEST", "delegationLearning resultDigest does not match the compact result identity");
  }
  if (value.learningDigest !== computeDelegationLearningDigest(value)) {
    fail("MH_DELEGATION_R3_LEARNING_DIGEST", "delegationLearning.learningDigest does not match its body");
  }
  return freezeDeep(cloneStrict({ ...value, result }));
}

function delegationLearningFromAcceptance({ contract, acceptance, laneKey }) {
  if (!contract || !acceptance || acceptance.contractDigest !== contract.contractDigest
      || acceptance.contextDigest !== contract.devspaceContextDigest) {
    fail("MH_DELEGATION_R3_LEARNING_BINDING", "delegation learning requires compact acceptance bound to the exact Round-2 contract");
  }
  const key = oneLine(laneKey, "laneKey", 64);
  const contractLane = contract.lanes?.find((entry) => entry.laneKey === key);
  const lane = acceptance.lanes?.find((entry) => entry.laneKey === key);
  if (!contractLane || !lane || lane.outcomeDigest !== contractLane.outcomeDigest || !lane.result) {
    fail("MH_DELEGATION_R3_LEARNING_BINDING", `lane ${key} has no compact result bound to the sealed Round-2 lane`);
  }
  if (!ACCEPTANCE_STATES.has(lane.acceptance) || lane.result.acceptance !== lane.acceptance) {
    fail("MH_DELEGATION_R3_LEARNING_BINDING", `lane ${key} is not a result-bearing acceptance state`);
  }
  const body = {
    schemaVersion: DELEGATION_LEARNING_SCHEMA,
    delegationId: acceptance.delegationId,
    contractDigest: contract.contractDigest,
    originWorldHeadDigest: contract.originWorldHeadDigest,
    contextDigest: contract.devspaceContextDigest,
    laneKey: key,
    outcomeDigest: lane.outcomeDigest,
    taskId: lane.taskId,
    workspaceId: lane.workspaceId,
    laneBriefDigest: lane.laneBriefDigest,
    bootPromptDigest: lane.bootPromptDigest,
    resultDigest: lane.result.resultDigest,
    acceptance: lane.acceptance,
    result: cloneStrict(lane.result),
  };
  return validateDelegationLearning({ ...body, learningDigest: computeDelegationLearningDigest(body) });
}

function persistDelegationLearning(repositoryPath, value) {
  const learning = validateDelegationLearning(value);
  persistImmutableJson(repositoryPath, "delegation-learnings", learning.learningDigest, learning, "MH_DELEGATION_R3_LEARNING_WRITE");
  return learning;
}

function readDelegationLearning(repositoryPath, learningDigest) {
  requireDigest(learningDigest, "learningDigest");
  const value = validateDelegationLearning(readImmutableJson(repositoryPath, "delegation-learnings", learningDigest));
  if (value.learningDigest !== learningDigest) {
    fail("MH_DELEGATION_R3_LEARNING_DIGEST", "delegation-learning path identity does not match its body");
  }
  return value;
}

module.exports = {
  DELEGATION_LEARNING_DOMAIN,
  DELEGATION_LEARNING_SCHEMA,
  computeDelegationLearningDigest,
  delegationLearningFromAcceptance,
  persistDelegationLearning,
  readDelegationLearning,
  validateDelegationLearning,
};
