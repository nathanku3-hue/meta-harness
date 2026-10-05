"use strict";

const { ConfigError } = require("./errors");
const { modelControlViolations } = require("./model-control-boundary");
const { createOutcome } = require("./outcome");
const { assertOwnerObjectiveRevision } = require("./owner-objective-state");
const { readIntegrationHead } = require("./optimistic-integration");
const { pinProductDirection } = require("./product-direction");
const { WORK_SESSION_SCHEMA, sealWorkSession, validRelativePath } = require("./work-session");
const { persistRunSession } = require("./run-journal");
const { commonGitDirectory } = require("./work-git");
const { resolveGoalValidation } = require("./work-validation");

const PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION = "planner-candidate-batch/v4";
const CONTROLLER_MAX_ATTEMPTS = 8;
const PLANNER_CANDIDATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "productResult",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "expectedWritePaths",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    productResult: { type: "string", minLength: 1 },
    journeyState: { type: "string", minLength: 1 },
    doNow: { type: "string", minLength: 1 },
    newlyTrueBehavior: { type: "string", minLength: 1 },
    doneWhen: { type: "string", minLength: 1 },
    stopOnlyIf: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    expectedWritePaths: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
  },
});
const PLANNER_CANDIDATE_BATCH_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "proposals"],
  properties: {
    schemaVersion: { type: "string", const: PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION },
    proposals: { type: "array", items: PLANNER_CANDIDATE_SCHEMA },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_PLANNER_CANDIDATE_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_PLANNER_CANDIDATE_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_PLANNER_CANDIDATE_VALUE", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function uniqueStrings(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail("MH_PLANNER_CANDIDATE_VALUE", `${label} must contain at least ${min} item(s)`);
  }
  const result = value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    fail("MH_PLANNER_CANDIDATE_VALUE", `${label} must not contain duplicates`);
  }
  return result;
}

function validatePlannerCandidate(value, index = 0) {
  const label = `plannerCandidateBatch.proposals[${index}]`;
  exactKeys(value, [
    "id",
    "productResult",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "expectedWritePaths",
  ], label);
  const candidate = {};
  for (const field of ["id", "productResult", "journeyState", "doNow", "newlyTrueBehavior", "doneWhen"]) {
    candidate[field] = nonEmpty(value[field], `${label}.${field}`);
  }
  candidate.stopOnlyIf = uniqueStrings(value.stopOnlyIf, `${label}.stopOnlyIf`, { min: 1 });
  candidate.expectedWritePaths = uniqueStrings(value.expectedWritePaths, `${label}.expectedWritePaths`, { min: 1 });
  const controlText = [
    candidate.productResult,
    candidate.journeyState,
    candidate.doNow,
    candidate.newlyTrueBehavior,
    candidate.doneWhen,
    ...candidate.stopOnlyIf,
  ].join("\n");
  const controlViolations = modelControlViolations(controlText);
  if (controlViolations.length > 0) {
    fail("MH_PLANNER_MODEL_CONTROL", "planner candidate attempted to manufacture required human input", {
      candidateId: candidate.id,
      violations: controlViolations,
    });
  }
  return Object.freeze(candidate);
}

function validatePlannerCandidateBatch(value) {
  exactKeys(value, ["schemaVersion", "proposals"], "plannerCandidateBatch");
  if (value.schemaVersion !== PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION) {
    fail("MH_PLANNER_CANDIDATE_SCHEMA", `plannerCandidateBatch.schemaVersion must be ${PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.proposals)) fail("MH_PLANNER_CANDIDATE_VALUE", "plannerCandidateBatch.proposals must be an array");
  const proposals = value.proposals.map(validatePlannerCandidate);
  const ids = proposals.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) fail("MH_PLANNER_CANDIDATE_VALUE", "planner candidate ids must be unique");
  return Object.freeze({ schemaVersion: PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION, proposals: Object.freeze(proposals) });
}

function normalizeExpectedWritePath(value) {
  const raw = nonEmpty(value, "expectedWritePath");
  if (/^[a-zA-Z]:[\\/]/u.test(raw) || raw.startsWith("/")) {
    fail("MH_PLANNER_BOUNDARY_PATH", `planner write footprint must be repository-relative: ${value}`);
  }
  const slash = raw.replace(/\\/gu, "/");
  if (slash.split("/").some((part) => part === "..")) {
    fail("MH_PLANNER_BOUNDARY_PATH", `planner write footprint may not traverse parents: ${value}`);
  }
  const normalized = slash.replace(/^\.\//u, "").replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || ".";
  if (!validRelativePath(normalized)) fail("MH_PLANNER_BOUNDARY_PATH", `invalid planner write footprint: ${value}`);
  return normalized;
}

function assertSafeBoundaryPath(relativePath) {
  const lower = relativePath.toLowerCase();
  if (relativePath === ".") {
    fail("MH_PLANNER_BOUNDARY_UNREPRESENTABLE", "repository-root write footprint cannot represent protected-path exclusions exactly");
  }
  if (lower === "product.md") {
    fail("MH_PLANNER_BOUNDARY_PROTECTED", "planner candidate may not request owner-authored PRODUCT.md");
  }
  if (lower === ".git" || lower.startsWith(".git/")) {
    fail("MH_PLANNER_BOUNDARY_PROTECTED", "planner candidate may not request Git metadata");
  }
  if (lower === ".meta-harness" || lower.startsWith(".meta-harness/")) {
    fail("MH_PLANNER_BOUNDARY_PROTECTED", "planner candidate may not request Meta-Harness controller state");
  }
}

function compileExecutionBoundary(expectedWritePaths) {
  if (!Array.isArray(expectedWritePaths) || expectedWritePaths.length === 0) {
    fail("MH_PLANNER_BOUNDARY_VALUE", "expectedWritePaths must contain at least one path");
  }
  const normalized = expectedWritePaths.map(normalizeExpectedWritePath);
  if (new Set(normalized.map((entry) => process.platform === "win32" ? entry.toLowerCase() : entry)).size !== normalized.length) {
    fail("MH_PLANNER_BOUNDARY_VALUE", "expectedWritePaths collapse to duplicate paths after normalization");
  }
  normalized.forEach(assertSafeBoundaryPath);
  return Object.freeze({ writePaths: Object.freeze([...normalized].sort()) });
}

function assertCurrentDirection(current, direction) {
  if (current?.world?.productDirectionDigest && current.world.productDirectionDigest !== direction.digest) {
    fail("MH_PLANNER_PRODUCT_DIRECTION_STALE", "planner snapshot does not match live owner-authored PRODUCT.md");
  }
}

function preparePlannerCandidate(repositoryPath, current, input, { expectedProductCommit = null } = {}) {
  const candidate = validatePlannerCandidate(input);
  const executionBoundary = compileExecutionBoundary(candidate.expectedWritePaths);
  const direction = pinProductDirection(repositoryPath);
  assertCurrentDirection(current, direction);
  const productCommit = readIntegrationHead(repositoryPath);
  if (expectedProductCommit !== null && productCommit !== expectedProductCommit) {
    fail("MH_PLANNER_PRODUCT_HEAD_STALE", "Git product head changed after the planner snapshot", {
      expectedProductCommit,
      actualProductCommit: productCommit,
    });
  }
  const base = { type: "EXACT_COMMIT", commit: productCommit };
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, executionBoundary.writePaths);
  // Validation is post-mutation evidence, not planner admission. An empty
  // validation contract may produce a durable candidate, but cannot accept or
  // bank it until a deterministic route is later available.
  const outcome = createOutcome({
    id: candidate.id,
    desiredState: candidate.productResult,
    preconditions: [candidate.journeyState],
    evidenceRequirement: candidate.doneWhen,
  });
  return Object.freeze({
    candidate,
    executionBoundary,
    direction,
    base,
    validation: resolvedValidation.validation,
    outcome,
  });
}

function materializePreparedPlannerRun(repositoryPath, current, prepared, {
  now = new Date(),
  objectiveRevision = null,
  outcomeDigest = null,
} = {}) {
  if (objectiveRevision !== null && (!Number.isInteger(objectiveRevision) || objectiveRevision < 0)) {
    fail("MH_PLANNER_OBJECTIVE_REVISION", "planner run objectiveRevision must be a non-negative integer");
  }
  const action = prepared.candidate;
  const productCommit = readIntegrationHead(repositoryPath);
  if (prepared.base?.commit !== productCommit) {
    fail("MH_PLANNER_PRODUCT_HEAD_STALE", "Git product head changed before planner run materialization", {
      expectedProductCommit: prepared.base?.commit || null,
      actualProductCommit: productCommit,
    });
  }
  if (objectiveRevision !== null) assertOwnerObjectiveRevision(repositoryPath, objectiveRevision);
  const logicalOutcomeDigest = outcomeDigest || prepared.outcome.outcomeDigest;
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(logicalOutcomeDigest || ""))) {
    fail("MH_PLANNER_OUTCOME_DIGEST", "planner run outcomeDigest must be a sha256 digest");
  }
  const session = sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection: prepared.direction,
    origin: {
      type: "REPO_RUN",
      outcomeDigest: logicalOutcomeDigest,
      objectiveRevision: objectiveRevision ?? 0,
    },
    base: prepared.base,
    productResult: action.productResult,
    journeyState: action.journeyState,
    doNow: action.doNow,
    newlyTrueBehavior: action.newlyTrueBehavior,
    doneWhen: action.doneWhen,
    stopOnlyIf: action.stopOnlyIf,
    allowedPaths: prepared.executionBoundary.writePaths,
    validation: prepared.validation,
    maxAttempts: CONTROLLER_MAX_ATTEMPTS,
    delivery: { push: false },
  });
  const gitCommonDirectory = commonGitDirectory(repositoryPath);
  const persisted = persistRunSession({ gitCommonDirectory, session });
  return Object.freeze({
    runId: persisted.runId,
    outcomeDigest: logicalOutcomeDigest,
    session: persisted.session,
    relation: null,
    materializedAt: now.toISOString(),
  });
}

module.exports = {
  CONTROLLER_MAX_ATTEMPTS,
  PLANNER_CANDIDATE_BATCH_SCHEMA,
  PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION,
  materializePreparedPlannerRun,
  compileExecutionBoundary,
  normalizeExpectedWritePath,
  preparePlannerCandidate,
  validatePlannerCandidate,
  validatePlannerCandidateBatch,
};
