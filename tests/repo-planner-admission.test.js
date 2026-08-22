"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { pinProductDirection } = require("../lib/product-direction");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const {
  CONTROLLER_MAX_ATTEMPTS,
  admitPreparedPlannerCandidate,
  compileExecutionBoundary,
  preparePlannerCandidate,
  validatePlannerCandidateBatch,
} = require("../lib/repo-planner-admission");
const { createGoalWorkSession } = require("../lib/work-session");
const { readCurrentWorldState } = require("../lib/world-transition");
const { gapProofSpec } = require("./helpers/product-proof");
const {
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id = "a", paths = [`src/${id}`]) {
  const value = proposal(id, { allowedPaths: paths });
  return {
    id: value.id,
    productResult: value.productResult,
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
  };
}

function directGoalSession(root, current, goal = "Direct entry parity.") {
  const productDirection = pinProductDirection(root);
  const base = { type: "EXACT_COMMIT", commit: current.head.productCommit };
  const doneWhen = "The requested behavior works in the repository and relevant validation passes.";
  return createGoalWorkSession({
    goal,
    repositoryPath: root,
    productDirection,
    base,
    allowedPaths: ["src/a"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    productProofSpec: gapProofSpec({
      productDirection,
      base,
      productResult: goal,
      newlyTrueBehavior: goal,
      doneWhen,
    }),
  });
}

test("planner candidate schema is semantic-only and rejects authority fields", () => {
  const valid = candidate();
  assert.equal(validatePlannerCandidateBatch({
    schemaVersion: "planner-candidate-batch/v2",
    proposals: [valid],
  }).proposals.length, 1);

  for (const [field, value] of [
    ["allowedPaths", ["src/a"]],
    ["base", { type: "EXACT_COMMIT", commit: "0".repeat(40) }],
    ["validation", []],
    ["maxAttempts", 3],
    ["delivery", { commit: true, push: false }],
    ["ownerRequest", { kind: "PRODUCT_TASTE", question: "approve?", evidence: ["model"] }],
    ["claimDigest", `sha256:${"1".repeat(64)}`],
    ["workerPrompt", "relay me"],
    ["semanticAuthorityDigest", `sha256:${"2".repeat(64)}`],
  ]) {
    assert.throws(
      () => validatePlannerCandidateBatch({
        schemaVersion: "planner-candidate-batch/v2",
        proposals: [{ ...valid, [field]: value }],
      }),
      (error) => error.code === "MH_PLANNER_CANDIDATE_SHAPE",
      field,
    );
  }
});

test("boundary compilation normalizes equivalent syntax but never widens or shrinks", () => {
  assert.deepEqual(
    compileExecutionBoundary(["./src/a/", "src/b\\nested"]),
    { writePaths: ["src/a", "src/b/nested"] },
  );
  assert.throws(
    () => compileExecutionBoundary(["src/a", "./src/a/"]),
    (error) => error.code === "MH_PLANNER_BOUNDARY_VALUE",
  );
  for (const unsafe of [".", "PRODUCT.md", ".meta-harness/repo-world.json", ".git/config", "../escape", "/absolute"] ) {
    assert.throws(
      () => compileExecutionBoundary([unsafe]),
      (error) => String(error.code).startsWith("MH_PLANNER_BOUNDARY_"),
      unsafe,
    );
  }
});

test("planner admission rejects stale objective revision before Claim visibility", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "objective one");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a", ["src/a"], root));
  replaceOwnerObjectiveState(root, "objective two");

  assert.throws(
    () => admitPreparedPlannerCandidate(root, current, prepared, { objectiveRevision: 1 }),
    (error) => error.code === "MH_OUTCOME_CLAIM_STALE_OBJECTIVE",
  );
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("T6 OWNER_GOAL and REPO_OUTCOME entry paths share standing authority across objective revisions", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);

  replaceOwnerObjectiveState(root, "objective one");
  const firstPrepared = preparePlannerCandidate(root, current, candidate("a"));
  const firstDirect = directGoalSession(root, current);

  replaceOwnerObjectiveState(root, "objective two");
  const secondPrepared = preparePlannerCandidate(root, current, candidate("a"));
  const secondDirect = directGoalSession(root, current);

  for (const value of [firstPrepared, secondPrepared]) {
    assert.equal(value.semanticAuthority.productDirectionDigest, firstDirect.productDirection.digest);
    assert.equal(value.semanticAuthority.semanticState, firstDirect.semanticState);
    assert.deepEqual(value.semanticProjection, firstDirect.semanticProjection);
    assert.deepEqual(value.endgameProjection, firstDirect.endgameProjection);
  }
  assert.equal(firstDirect.semanticState, secondDirect.semanticState);
  assert.deepEqual(firstDirect.semanticProjection, secondDirect.semanticProjection);
  assert.deepEqual(firstDirect.endgameProjection, secondDirect.endgameProjection);
});

test("controller derives exact capability, base, validation, attempts, and local-only delivery", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a", ["src/a/"], root));
  assert.deepEqual(prepared.executionBoundary, { writePaths: ["src/a"] });
  assert.equal(prepared.base.commit, current.head.productCommit);
  assert.ok(prepared.validation.length > 0);

  const admitted = admitPreparedPlannerCandidate(root, current, prepared);
  assert.deepEqual(admitted.claim.executionBoundary, { writePaths: ["src/a"] });
  assert.deepEqual(admitted.session.allowedPaths, ["src/a"]);
  assert.equal(admitted.session.base.commit, current.head.productCommit);
  assert.equal(admitted.session.maxAttempts, CONTROLLER_MAX_ATTEMPTS);
  assert.deepEqual(admitted.session.delivery, { commit: true, push: false });
});
