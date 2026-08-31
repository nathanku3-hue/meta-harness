"use strict";

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { createOutcome } = require("./outcome");
const { acquireOutcomeClaimSession } = require("./outcome-claim");
const { pinProductDirection } = require("./product-direction");
const { AUTONOMOUS_CONTINUATION_DISPOSITIONS, latestUnresolvedHandoffs } = require("./repo-planner-input");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("./semantic-authority");
const { compileProductProofSpec } = require("./work-proof-compiler");
const { WORK_SESSION_SCHEMA, sealWorkSession, validRelativePath } = require("./work-session");
const { resolveGoalValidation } = require("./work-validation");

const PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION = "planner-candidate-batch/v3";
const CONTROLLER_MAX_ATTEMPTS = 2;
const PLANNER_CANDIDATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "productResult",
    "objectRefs",
    "hypothesisRef",
    "criterionRefs",
    "metricRefs",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "expectedWritePaths",
    "continuesFromTransitionDigests",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    productResult: { type: "string", minLength: 1 },
    objectRefs: { type: "array", items: { type: "string", minLength: 1 } },
    hypothesisRef: { anyOf: [{ type: "string", minLength: 1 }, { type: "null", const: null }, { type: "string", const: "EXPLICIT_NONE" }] },
    criterionRefs: { type: "array", items: { type: "string", minLength: 1 } },
    metricRefs: { type: "array", items: { type: "string", minLength: 1 } },
    journeyState: { type: "string", minLength: 1 },
    doNow: { type: "string", minLength: 1 },
    newlyTrueBehavior: { type: "string", minLength: 1 },
    doneWhen: { type: "string", minLength: 1 },
    stopOnlyIf: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    expectedWritePaths: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    continuesFromTransitionDigests: { type: "array", items: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
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
    "objectRefs",
    "hypothesisRef",
    "criterionRefs",
    "metricRefs",
    "journeyState",
    "doNow",
    "newlyTrueBehavior",
    "doneWhen",
    "stopOnlyIf",
    "expectedWritePaths",
    "continuesFromTransitionDigests",
  ], label);
  const candidate = {};
  for (const field of ["id", "productResult", "journeyState", "doNow", "newlyTrueBehavior", "doneWhen"]) {
    candidate[field] = nonEmpty(value[field], `${label}.${field}`);
  }
  candidate.objectRefs = uniqueStrings(value.objectRefs, `${label}.objectRefs`);
  candidate.hypothesisRef = value.hypothesisRef === null || value.hypothesisRef === "EXPLICIT_NONE" ? value.hypothesisRef : nonEmpty(value.hypothesisRef, `${label}.hypothesisRef`);
  candidate.criterionRefs = uniqueStrings(value.criterionRefs, `${label}.criterionRefs`);
  candidate.metricRefs = uniqueStrings(value.metricRefs, `${label}.metricRefs`);
  candidate.stopOnlyIf = uniqueStrings(value.stopOnlyIf, `${label}.stopOnlyIf`, { min: 1 });
  candidate.expectedWritePaths = uniqueStrings(value.expectedWritePaths, `${label}.expectedWritePaths`, { min: 1 });
  candidate.continuesFromTransitionDigests = uniqueStrings(value.continuesFromTransitionDigests, `${label}.continuesFromTransitionDigests`);
  if (candidate.continuesFromTransitionDigests.some((digest) => !isDigest(digest))) {
    fail("MH_PLANNER_CANDIDATE_VALUE", `${label}.continuesFromTransitionDigests must contain only sha256 digests`);
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
    fail("MH_PLANNER_BOUNDARY_PROTECTED", "planner candidate may not request Meta-Harness authority/control material");
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

function assertCurrentDirection(repositoryPath, current, direction) {
  if (!current?.head || current.head.schemaVersion !== "world-head/v2") {
    fail("MH_PLANNER_WORLD", "planner admission requires authoritative world-head/v2 product authority");
  }
  if (current.world?.productDirectionDigest !== direction.digest) {
    fail("MH_PLANNER_PRODUCT_DIRECTION_STALE", "authoritative World does not match live owner-authored PRODUCT.md");
  }
}

function assertContinuationReferencesCurrent(repositoryPath, current, transitionDigests) {
  if (transitionDigests.length === 0) return;
  const autonomous = new Set(latestUnresolvedHandoffs(repositoryPath, current, new Set())
    .filter((handoff) => AUTONOMOUS_CONTINUATION_DISPOSITIONS.has(handoff.disposition))
    .map((handoff) => handoff.transitionDigest));
  const invalid = transitionDigests.filter((digest) => !autonomous.has(digest));
  if (invalid.length > 0) {
    fail(
      "MH_PLANNER_CANDIDATE_CONTINUATION",
      "planner continuation references must name current autonomous handoff transitions",
      { invalidTransitionDigests: invalid },
    );
  }
}

function preparePlannerCandidate(repositoryPath, current, input) {
  const candidate = validatePlannerCandidate(input);
  const executionBoundary = compileExecutionBoundary(candidate.expectedWritePaths);
  const direction = pinProductDirection(repositoryPath);
  assertCurrentDirection(repositoryPath, current, direction);
  const semanticAuthority = compileSemanticAuthority({ productDirection: direction });
  const projection = semanticProjection(semanticAuthority, candidate);
  const terminalProjection = endgameProjection(semanticAuthority);
  const base = { type: "EXACT_COMMIT", commit: current.head.productCommit };
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, executionBoundary.writePaths);
  if (!resolvedValidation.supported || resolvedValidation.validation.length === 0) {
    fail("MH_PLANNER_VALIDATION_UNAVAILABLE", resolvedValidation.reason || "deterministic validation is unavailable for planner candidate", {
      candidateId: candidate.id,
      adapter: resolvedValidation.adapter || null,
    });
  }
  const productProofSpec = compileProductProofSpec({
    repositoryPath,
    productDirection: direction,
    base,
    productResult: candidate.productResult,
    newlyTrueBehavior: candidate.newlyTrueBehavior,
    doneWhen: candidate.doneWhen,
    allowModel: false,
  });
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
    productProofSpec,
    outcome,
    semanticAuthority,
    semanticProjection: projection,
    endgameProjection: terminalProjection,
  });
}

function admitPreparedPlannerCandidate(repositoryPath, current, prepared, {
  now = new Date(),
  objectiveRevision = null,
} = {}) {
  if (objectiveRevision !== null && (!Number.isInteger(objectiveRevision) || objectiveRevision < 0)) {
    fail("MH_PLANNER_OBJECTIVE_REVISION", "planner admission objectiveRevision must be a non-negative integer");
  }
  const action = prepared.candidate;
  assertContinuationReferencesCurrent(repositoryPath, current, action.continuesFromTransitionDigests);
  return acquireOutcomeClaimSession({
    repositoryPath,
    outcome: prepared.outcome,
    originWorldHeadDigest: current.head.headDigest,
    expectedObjectiveRevision: objectiveRevision,
    executionBoundary: prepared.executionBoundary,
    continuesFromTransitionDigests: action.continuesFromTransitionDigests,
    now,
    buildSession: (claim) => sealWorkSession({
      schemaVersion: WORK_SESSION_SCHEMA,
      productDirection: prepared.direction,
      semanticState: prepared.semanticAuthority.semanticState,
      semanticProjection: prepared.semanticProjection,
      endgameProjection: prepared.endgameProjection,
      origin: {
        type: "REPO_OUTCOME",
        outcomeDigest: prepared.outcome.outcomeDigest,
        claimDigest: claim.claimDigest,
      },
      base: prepared.base,
      productResult: action.productResult,
      journeyState: action.journeyState,
      doNow: action.doNow,
      newlyTrueBehavior: action.newlyTrueBehavior,
      doneWhen: action.doneWhen,
      productProofSpec: prepared.productProofSpec,
      stopOnlyIf: action.stopOnlyIf,
      authorizedReversibleActions: [
        "Read repository instructions and relevant source files.",
        "Edit files inside the exact controller-granted paths.",
        "Run focused validation and repair failures inside scope.",
        "Execute only inside the fresh controller-owned managed worktree for this session.",
      ],
      ownerOnlyActions: [
        "Expand product scope or write paths.",
        "Change product direction in PRODUCT.md.",
        "Change repository World or repository interpretation semantics.",
        "Supply credentials or approve protected access.",
        "Approve publication, destructive operations, or material risk.",
      ],
      allowedPaths: prepared.executionBoundary.writePaths,
      validation: prepared.validation,
      maxAttempts: CONTROLLER_MAX_ATTEMPTS,
      delivery: { commit: true, push: false },
    }),
  });
}

module.exports = {
  CONTROLLER_MAX_ATTEMPTS,
  PLANNER_CANDIDATE_BATCH_SCHEMA,
  PLANNER_CANDIDATE_BATCH_SCHEMA_VERSION,
  admitPreparedPlannerCandidate,
  compileExecutionBoundary,
  normalizeExpectedWritePath,
  preparePlannerCandidate,
  validatePlannerCandidate,
  validatePlannerCandidateBatch,
};
