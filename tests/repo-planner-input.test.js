"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { initializeIntegrationHead, readIntegrationHead } = require("../lib/optimistic-integration");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { preparePlannerCandidate } = require("../lib/repo-planner-candidate");
const { git, repository } = require("./helpers/linear-product-head");

function initialize(root, baseline) {
  initializeIntegrationHead({ repositoryPath: root, baseCommit: baseline });
  return readIntegrationHead(root);
}

function candidate(id = "a") {
  return {
    id,
    productResult: `Deliver ${id}.`,
    journeyState: `${id} is not delivered.`,
    doNow: `Implement ${id}.`,
    newlyTrueBehavior: `${id} is delivered.`,
    doneWhen: `${id} works and validation passes.`,
    stopOnlyIf: ["A concrete owner-exclusive effect is required."],
    expectedWritePaths: [`src/${id}`],
  };
}

test("planner input v5 is PRODUCT + Git + active runs + factual observations", (t) => {
  const { root, baseline } = repository(t);
  initialize(root, baseline);
  replaceOwnerObjectiveState(root, "fastest honest decision-changing evidence");
  const input = compileRepoPlannerInput({
    repositoryPath: root,
    recovered: [],
    observations: [{
      sessionDigest: `sha256:${"1".repeat(64)}`,
      outcomeDigest: `sha256:${"2".repeat(64)}`,
      productResult: "Deliver prior result.",
      outcome: "REPLAN_REQUIRED",
      observableResult: "Preferred route was incomplete.",
      blocker: "source route incomplete",
      failedMeans: ["preferred API"],
    }],
  });

  assert.equal(input.schemaVersion, "repo-planner-input/v5");
  assert.equal(Object.keys(input)[1], "ownerIntent");
  assert.equal(input.ownerIntent.activeDirective.revision, 1);
  assert.equal(input.ownerIntent.activeDirective.content, "fastest honest decision-changing evidence");
  assert.match(input.ownerIntent.activeDirective.contentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(input.ownerIntent.productFrame.targetUser.includes("Solo developer"), true);
  assert.equal(input.product.commit, baseline);
  assert.deepEqual(input.activeCommitments, []);
  assert.equal(input.observations.length, 1);
  assert.deepEqual(input.observations[0].failedMeans, ["preferred API"]);

  const serialized = JSON.stringify(input);
  for (const forbidden of [
    "currentWorld",
    "worldHeadDigest",
    "semanticContext",
    "unresolvedHandoffs",
    "claimDigest",
    "executionPermit",
    "workspaceId",
    "candidateSeal",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("planner input follows the Git product head directly", (t) => {
  const { root, baseline } = repository(t);
  const h0 = initialize(root, baseline);
  const tree = git(root, ["rev-parse", `${h0}^{tree}`]);
  const h1 = git(root, ["commit-tree", tree, "-p", h0, "-m", "advance product head"]);
  git(root, ["update-ref", "refs/meta-harness/product-head", h1, h0]);

  const input = compileRepoPlannerInput({ repositoryPath: root, recovered: [] });
  assert.equal(input.product.commit, h1);
  assert.equal(Object.hasOwn(input, "head"), false);
  assert.equal(Object.hasOwn(input, "currentWorld"), false);
});

test("planner candidate base is exactly the current Git product head", (t) => {
  const { root, baseline } = repository(t);
  const h0 = initialize(root, baseline);
  const tree = git(root, ["rev-parse", `${h0}^{tree}`]);
  const h1 = git(root, ["commit-tree", tree, "-p", h0, "-m", "published before candidate preparation"]);
  git(root, ["update-ref", "refs/meta-harness/product-head", h1, h0]);

  const prepared = preparePlannerCandidate(root, null, candidate("a"), { expectedProductCommit: h1 });
  assert.equal(prepared.base.commit, h1);
});

test("active commitments expose product work but not controller topology", (t) => {
  const { root, baseline } = repository(t);
  initialize(root, baseline);
  const recovered = [{
    type: "RUNNING_ELSEWHERE",
    runKey: `sha256:${"3".repeat(64)}`,
    outcomeDigest: `sha256:${"4".repeat(64)}`,
    session: {
      sessionDigest: `sha256:${"3".repeat(64)}`,
      origin: { type: "REPO_RUN", outcomeDigest: `sha256:${"4".repeat(64)}`, objectiveRevision: 0 },
      productResult: "Deliver a.",
      doneWhen: "a works",
      allowedPaths: ["src/a"],
    },
  }];
  const input = compileRepoPlannerInput({ repositoryPath: root, recovered });
  assert.equal(input.activeCommitments.length, 1);
  assert.deepEqual(input.activeCommitments[0], {
    runKey: `sha256:${"3".repeat(64)}`,
    sessionDigest: `sha256:${"3".repeat(64)}`,
    outcomeDigest: `sha256:${"4".repeat(64)}`,
    state: "running_elsewhere",
    productResult: "Deliver a.",
    doneWhen: "a works",
    allowedPaths: ["src/a"],
  });
  const serialized = JSON.stringify(input.activeCommitments);
  assert.equal(serialized.includes("claim"), false);
  assert.equal(serialized.includes("workspace"), false);
  assert.equal(serialized.includes("permit"), false);
});
