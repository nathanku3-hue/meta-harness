"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const { readRunEventsForSession, commonGitDirectory: journalCommonGitDirectory } = (() => {
  const journal = require("../lib/run-journal");
  const git = require("../lib/work-git");
  return { ...journal, commonGitDirectory: git.commonGitDirectory };
})();
const { validationFailureObservation } = require("../lib/model-observation");
const { DRAIN_COMPLETE, runWork } = require("../lib/work-loop");
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
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
  };
}

function materializedRun(t, id = "a", paths = [`src/${id}`]) {
  const { root } = repository(t);
  persistInitial(root);
  const prepared = preparePlannerCandidate(root, null, candidate(id, paths));
  const materialized = materializePreparedPlannerRun(root, null, prepared);
  return { root, ...materialized };
}

function doneResult(id, content = "delivered\n") {
  return {
    worker: "lean-work-loop-test",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "DONE",
      observableResult: `Prepared ${id}.`,
      operations: [{ type: "WRITE", path: `src/${id}/result.txt`, content }],
      validation: ["synthetic worker observation"],
      stop: null,
    },
  };
}

function stoppedResult() {
  return {
    worker: "lean-work-loop-test",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "STOP",
      observableResult: "The preferred route stopped.",
      operations: [],
      validation: [],
      stop: {
        unsatisfiedRequirement: "The preferred route did not produce the requested result.",
        failedMeans: [{ means: "preferred route", evidence: ["No usable result was returned."] }],
        alternativesConsidered: [{
          means: "in-repository substitute",
          disposition: "AVAILABLE",
          evidence: ["The same product result can be produced locally."],
        }],
        assertedConstraint: "The preferred route is unavailable.",
      },
    },
  };
}

test("model-facing validation failure translates authority-shaped errors into capability observations", () => {
  const observation = validationFailureObservation([{
    argv: ["node", "validator.js"],
    cwd: ".",
    passed: false,
    exitCode: 1,
    output: "Error: EACCES: permission denied, open '/protected/file'",
  }]);
  assert.match(observation, /CAPABILITY_ABSENT\(filesystem\)/u);
  assert.doesNotMatch(observation, /permission denied|EACCES|unauthorized|forbidden/iu);
});

test("validated REPO_RUN reaches local DONE with run capability, acceptance, and no proof/permit authority", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async () => doneResult("a"),
  });

  assert.equal(result.outcome, "DONE");
  assert.deepEqual(result.changedPaths, ["src/a/result.txt"]);
  assert.equal(result.validation.every((entry) => entry.passed), true);
  assert.ok(result.acceptance?.acceptanceDigest);
  assert.equal(result.delivery.commit.status, "committed");
  assert.equal(result.executionAttempts.length, 1);
  assert.equal(result.executionAttempts[0].mechanism, "RUN_CAPABILITY");
  for (const retired of ["permitDigest", "permitId", "productProof"]) {
    assert.equal(JSON.stringify(result).includes(retired), false, retired);
  }

  const events = readRunEventsForSession({
    gitCommonDirectory: journalCommonGitDirectory(fixture.root),
    sessionDigest: fixture.session.sessionDigest,
  });
  assert.ok(events.some((event) => event.type === "mutation/result"));
  assert.ok(events.some((event) => event.type === "run/completed"));
});

test("failed validation is repair input and a materially changed candidate can still reach DONE", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  const attempts = [];
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async ({ attempt, priorFailure }) => {
      attempts.push({ attempt, priorFailure });
      return doneResult("a", attempt === 1 ? "wrong\n" : "delivered\n");
    },
  });

  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.equal(attempts.length, 2);
  assert.match(attempts[1].priorFailure, /validation|exited|failed/iu);
});

test("worker STOP becomes direct evidence for the next fresh CODE generation", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  const attempts = [];
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async ({ attempt, priorFailure }) => {
      attempts.push({ attempt, priorFailure });
      return attempt === 1 ? stoppedResult() : doneResult("a");
    },
  });

  assert.equal(result.outcome, "DONE");
  assert.equal(attempts.length, 2);
  assert.match(attempts[1].priorFailure, /previous coding generation stopped/iu);
  assert.match(attempts[1].priorFailure, /in-repository substitute/iu);
  assert.equal(result.executionAttempts.length, 2);
  assert.equal(Object.hasOwn(result, "forwardMotionProofDigest"), false);
});

test("repeated identical worker STOP circuit-breaks without owner escalation", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  let workerCalls = 0;
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async () => {
      workerCalls += 1;
      return stoppedResult();
    },
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(workerCalls, 2);
  assert.equal(result.ownerRequest ?? null, null);
  assert.equal(Object.hasOwn(result, "forwardMotionProofDigest"), false);
});

test("direct worker mutation is rejected before controller materialization", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  await assert.rejects(
    () => runWork({
      repositoryPath: fixture.root,
      session: fixture.session,
      runner: async ({ workspacePath }) => {
        fs.writeFileSync(path.join(workspacePath, "src", "a", "result.txt"), "worker-write\n", "utf8");
        return doneResult("a");
      },
    }),
    (error) => /worker changed workspace bytes|BOUNDARY_BYTES/iu.test(String(error.message || error.code)),
  );
});

test("pre-aborted execution drains without creating a workspace", async (t) => {
  const fixture = materializedRun(t, "a");
  const controller = new AbortController();
  controller.abort();
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async () => doneResult("a"),
    signal: controller.signal,
  });
  assert.deepEqual(result, DRAIN_COMPLETE);
  assert.equal(fs.existsSync(path.join(fixture.root, ".worktrees")), false);
});
