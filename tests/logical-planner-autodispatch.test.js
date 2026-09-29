"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildLogicalPlannerPrompt } = require("../lib/repo-logical-planner");
const {
  DEFAULT_LOCAL_EXECUTION_BOUND,
  localExecutionBound,
  runRepoWorkWave,
} = require("../lib/repo-work-wave");
const {
  git,
  persistInitial,
  proposal,
  repository,
  runner,
} = require("./helpers/linear-product-head");

function candidate(id, paths = [`src/${id}`]) {
  const value = proposal(id, { allowedPaths: paths });
  return {
    id: value.id,
    productResult: value.productResult,
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
  };
}

function emptyBatch() {
  return { batch: { schemaVersion: "planner-candidate-batch/v4", proposals: [] } };
}

test("repo work defaults to velocity-first WIP=2 while preserving an internal bounded override", () => {
  assert.equal(DEFAULT_LOCAL_EXECUTION_BOUND, 2);
  assert.equal(localExecutionBound({}), 2);
  assert.equal(localExecutionBound({ META_HARNESS_REPO_WORK_CONCURRENCY: "3" }), 3);
});

test("repo wave plans from PRODUCT + Git + run facts and returns USE_PRODUCT when nothing is needed", async (t) => {
  const { root, baseline } = repository(t);
  persistInitial(root);
  let observed = null;

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async ({ plannerInput }) => {
      observed = plannerInput;
      return emptyBatch();
    },
  });

  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.productCommit, baseline);
  assert.equal(result.plannerInvoked, true);
  assert.equal(result.plannerCandidateCount, 0);
  assert.equal(observed.schemaVersion, "repo-planner-input/v5");
  assert.equal(observed.product.commit, baseline);
  assert.deepEqual(observed.activeCommitments, []);

  const plannerPrompt = buildLogicalPlannerPrompt(observed);
  assert.match(plannerPrompt, /Current objective:/u);
  assert.doesNotMatch(plannerPrompt, /Current owner objective|owner work|approval|authorization|permission|ownerRequest|approver|manager|librarian|owner-escalation/iu);

  const serialized = JSON.stringify(observed);
  for (const retired of [
    "currentWorld",
    "worldHeadDigest",
    "claimDigest",
    "executionPermit",
    "semanticProjection",
    "productProofSpec",
  ]) {
    assert.equal(serialized.includes(retired), false, retired);
  }
});

test("historical repo-proposals.json is inert and never becomes planner ingress", async (t) => {
  const { root } = repository(t);
  persistInitial(root);
  const historicalPath = path.join(root, ".meta-harness", "repo-proposals.json");
  const bytes = "{ definitely-not-current-protocol: true }\n";
  fs.writeFileSync(historicalPath, bytes, "utf8");

  let calls = 0;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async () => {
      calls += 1;
      return emptyBatch();
    },
  });

  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(historicalPath, "utf8"), bytes);
});

test("invalid planner scope is rejected without creating a run", async (t) => {
  const { root } = repository(t);
  persistInitial(root);

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async () => ({
      batch: {
        schemaVersion: "planner-candidate-batch/v4",
        proposals: [candidate("a", ["PRODUCT.md"])],
      },
    }),
  });

  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.materialized, 0);
  assert.equal(result.plannerCandidateCount, 1);
  assert.equal(result.outcomes.length, 0);
  assert.equal(
    result.orchestrationTelemetry.plannerBoots[0].candidateRejections[0].code.startsWith("MH_PLANNER_BOUNDARY_"),
    true,
  );
});

test("compatible planner candidates execute concurrently and land through Git CAS", { skip: process.platform !== "linux" }, async (t) => {
  const { root, baseline } = repository(t);
  persistInitial(root);
  let plannerCalls = 0;

  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    plannerRunner: async () => {
      plannerCalls += 1;
      if (plannerCalls === 1) {
        return {
          batch: {
            schemaVersion: "planner-candidate-batch/v4",
            proposals: [candidate("a"), candidate("b")],
          },
        };
      }
      return emptyBatch();
    },
    runner: runner(),
  });

  assert.equal(result.outcome, "DONE");
  assert.equal(result.materialized, 2);
  assert.equal(result.orchestrationTelemetry.maxLocalConcurrency, 2);
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 2);
  assert.notEqual(result.productCommit, baseline);
  assert.equal(git(root, ["show", `${result.productCommit}:src/a/result.txt`]), "delivered");
  assert.equal(git(root, ["show", `${result.productCommit}:src/b/result.txt`]), "delivered");
});
