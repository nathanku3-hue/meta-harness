"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const { recoverRunCommitment, runRepoWorkWave } = require("../lib/repo-work-wave");
const { DRAIN_COMPLETE, runWork } = require("../lib/work-loop");
const {
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id = "a") {
  const value = proposal(id);
  return {
    id: value.id,
    productResult: value.productResult,
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: value.allowedPaths,
  };
}

function materializedRun(t) {
  const { root } = repository(t);
  persistInitial(root);
  const materialized = materializePreparedPlannerRun(
    root,
    null,
    preparePlannerCandidate(root, null, candidate()),
  );
  return { root, ...materialized };
}

test("pre-aborted repo wave drains before planner or workspace materialization", async (t) => {
  const { root } = repository(t);
  persistInitial(root);
  const controller = new AbortController();
  controller.abort();
  let plannerCalls = 0;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    signal: controller.signal,
    plannerRunner: async () => {
      plannerCalls += 1;
      return { schemaVersion: "planner-candidate-batch/v4", proposals: [] };
    },
  });
  assert.deepEqual(result, DRAIN_COMPLETE);
  assert.equal(plannerCalls, 0);
});

test("mid-worker drain parks durable execution facts and recovery creates a fresh executable child", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t);
  const controller = new AbortController();
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    signal: controller.signal,
    runner: async () => {
      controller.abort();
      return {
        worker: "drain-test",
        stdout: "",
        stderr: "",
        result: {
          schemaVersion: "worker-result/v2",
          status: "DONE",
          observableResult: "This response loses the drain race.",
          operations: [{ type: "WRITE", path: "src/a/result.txt", content: "delivered\n" }],
          validation: [],
          stop: null,
        },
      };
    },
  });
  assert.deepEqual(result, DRAIN_COMPLETE);

  const recovered = recoverRunCommitment(fixture.root, fixture.session);
  assert.equal(recovered.type, "EXECUTABLE");
  assert.equal(recovered.session.sessionDigest, fixture.session.sessionDigest);
  assert.notEqual(recovered.continuation, "ENTERED_NO_SEAL");
});
