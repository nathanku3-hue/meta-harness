"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { initializeIntegrationHead, readIntegrationHead } = require("../lib/optimistic-integration");
const { pinProductDirection } = require("../lib/product-direction");
const {
  CONTROLLER_MAX_ATTEMPTS,
  materializePreparedPlannerRun,
  compileExecutionBoundary,
  preparePlannerCandidate,
  validatePlannerCandidateBatch,
} = require("../lib/repo-planner-candidate");
const { createGoalWorkSession } = require("../lib/work-session");
const { repository } = require("./helpers/linear-product-head");

function candidate(id = "a", paths = [`src/${id}`]) {
  return {
    id,
    productResult: `Deliver ${id}.`,
    journeyState: `${id} is not delivered.`,
    doNow: `Implement ${id}.`,
    newlyTrueBehavior: `${id} is delivered.`,
    doneWhen: `${id} works and validation passes.`,
    stopOnlyIf: ["A concrete owner-exclusive effect is required."],
    expectedWritePaths: paths,
  };
}

function initialize(root, baseline) {
  initializeIntegrationHead({ repositoryPath: root, baseCommit: baseline });
  return readIntegrationHead(root);
}

function directGoalSession(root, baseCommit, goal = "Direct entry parity.") {
  return createGoalWorkSession({
    goal,
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: baseCommit },
    allowedPaths: ["src/a"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
  });
}

test("planner candidate v4 contains product work only and rejects retired authority or semantic fields", () => {
  const valid = candidate();
  assert.equal(validatePlannerCandidateBatch({
    schemaVersion: "planner-candidate-batch/v4",
    proposals: [valid],
  }).proposals.length, 1);

  for (const [field, value] of [
    ["allowedPaths", ["src/a"]],
    ["base", { type: "EXACT_COMMIT", commit: "0".repeat(40) }],
    ["validation", []],
    ["maxAttempts", 3],
    ["delivery", { push: false }],
    ["claimDigest", `sha256:${"1".repeat(64)}`],
    ["semanticAuthorityDigest", `sha256:${"2".repeat(64)}`],
    ["objectRefs", []],
    ["hypothesisRef", null],
    ["criterionRefs", []],
    ["metricRefs", []],
    ["continuesFromTransitionDigests", []],
    ["productProofSpec", {}],
  ]) {
    assert.throws(
      () => validatePlannerCandidateBatch({
        schemaVersion: "planner-candidate-batch/v4",
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
  for (const unsafe of [".", "PRODUCT.md", ".meta-harness/repo-world.json", ".git/config", "../escape", "/absolute"]) {
    assert.throws(
      () => compileExecutionBoundary([unsafe]),
      (error) => String(error.code).startsWith("MH_PLANNER_BOUNDARY_"),
      unsafe,
    );
  }
});

test("planner materialization rejects stale objective revision before run visibility", (t) => {
  const { root, baseline } = repository(t);
  initialize(root, baseline);
  replaceOwnerObjectiveState(root, "objective one");
  const prepared = preparePlannerCandidate(root, null, candidate("a"));
  replaceOwnerObjectiveState(root, "objective two");

  assert.throws(
    () => materializePreparedPlannerRun(root, null, prepared, { objectiveRevision: 1 }),
    (error) => error.code === "MH_OWNER_OBJECTIVE_STALE",
  );
});

test("OWNER_GOAL and REPO_RUN sessions pin PRODUCT without semantic or proof topology", (t) => {
  const { root, baseline } = repository(t);
  const productCommit = initialize(root, baseline);
  replaceOwnerObjectiveState(root, "objective one");
  const prepared = preparePlannerCandidate(root, null, candidate("a"));
  const direct = directGoalSession(root, productCommit);
  const materialized = materializePreparedPlannerRun(root, null, prepared, { objectiveRevision: 1 });

  assert.equal(prepared.direction.digest, direct.productDirection.digest);
  for (const session of [direct, materialized.session]) {
    assert.equal(session.schemaVersion, "work-session/v10");
    for (const obsolete of [
      "semanticState",
      "semanticProjection",
      "endgameProjection",
      "productProofSpec",
      "authorizedReversibleActions",
      "ownerOnlyActions",
    ]) {
      assert.equal(Object.hasOwn(session, obsolete), false, obsolete);
    }
  }
});

test("controller derives exact boundary, Git base, validation, attempts, and local-only delivery", (t) => {
  const { root, baseline } = repository(t);
  const productCommit = initialize(root, baseline);
  const prepared = preparePlannerCandidate(root, null, candidate("a", ["src/a/"]));
  assert.deepEqual(prepared.executionBoundary, { writePaths: ["src/a"] });
  assert.equal(prepared.base.commit, productCommit);
  assert.ok(prepared.validation.length > 0);

  const materialized = materializePreparedPlannerRun(root, null, prepared);
  assert.equal(materialized.session.origin.type, "REPO_RUN");
  assert.equal(materialized.session.origin.outcomeDigest, materialized.outcomeDigest);
  assert.equal(Object.hasOwn(materialized.session.origin, "originHeadDigest"), false);
  assert.equal(Object.hasOwn(materialized.session.origin, "continuesFromTransitionDigests"), false);
  assert.deepEqual(materialized.session.allowedPaths, ["src/a"]);
  assert.equal(materialized.session.base.commit, productCommit);
  assert.equal(materialized.session.maxAttempts, CONTROLLER_MAX_ATTEMPTS);
  assert.deepEqual(materialized.session.delivery, { push: false });
});
