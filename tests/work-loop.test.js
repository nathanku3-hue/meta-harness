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
const { pinProductDirection } = require("../lib/product-direction");
const { createGoalWorkSession } = require("../lib/work-session");
const { DRAIN_COMPLETE, runWork, workerReportsCompleteResult, hasDifferentialValidationEvidence, baselineWithCandidateTests } = require("../lib/work-loop");
const { runWorkSessionState } = require("../lib/work-git");
const {
  git,
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

test("worker completion claim cannot be inferred from PARTIAL or absent observation", () => {
  assert.equal(workerReportsCompleteResult({ status: "PARTIAL", observableResult: "Part of the feature is implemented." }), false);
  assert.equal(workerReportsCompleteResult({ status: "DONE", observableResult: "" }), false);
  assert.equal(workerReportsCompleteResult({ status: "DONE", observableResult: "The behavior was observed." }), true);
});

test("delta proof rejects unchanged-green tests and accepts observed red-to-green validation", () => {
  const passed = [{ passed: true }];
  assert.equal(hasDifferentialValidationEvidence(passed, [{ passed: true }]), false);
  assert.equal(hasDifferentialValidationEvidence(passed, [{ passed: false }]), true);
  assert.equal(hasDifferentialValidationEvidence(passed, []), false);
  assert.equal(hasDifferentialValidationEvidence([{ passed: false }], [{ passed: false }]), false);
});

test("candidate-authored behavior tests can be checked against unchanged base code without mutating the real index", (t) => {
  const { root, baseline } = repository(t);
  const target = path.join(root, "tests", "export.test.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "const test = require('node:test'); test('export', () => {});\n");
  fs.writeFileSync(path.join(root, "src", "a", "result.txt"), "delivered\n");
  git(root, ["add", "tests/export.test.js", "src/a/result.txt"]);
  const candidateTreeOid = git(root, ["write-tree"]);
  const originalIndex = git(root, ["write-tree"]);
  const mixed = baselineWithCandidateTests({
    workspacePath: root,
    baseCommit: baseline,
    candidateTreeOid,
    candidatePaths: ["tests/export.test.js", "src/a/result.txt"],
  });
  assert.ok(mixed && mixed !== candidateTreeOid);
  assert.equal(git(root, ["ls-tree", "--name-only", mixed, "--", "tests/export.test.js"]), "tests/export.test.js");
  assert.equal(git(root, ["ls-tree", "--name-only", mixed, "--", "src/a/result.txt"]), "");
  assert.equal(git(root, ["write-tree"]), originalIndex);
});

test("direct owner goal does not replace its completion target with generic regression success", (t) => {
  const { root } = repository(t);
  const goal = "The CLI exports CSV rows with quoted Unicode values.";
  const session = createGoalWorkSession({
    goal,
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths: ["src/a"],
    validation: [],
  });
  assert.equal(session.doneWhen, goal);
});

test("model-facing validation failure translates access errors into capability observations", () => {
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

test("missing validation does not block coding but still blocks acceptance and banking", async (t) => {
  const { root } = repository(t);
  fs.rmSync(path.join(root, ".meta-harness", "validation.json"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "remove validation route"]);
  const session = createGoalWorkSession({
    goal: "Deliver a.",
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths: ["src/a"],
    validation: [],
    delivery: { push: false },
  });
  let workerCalls = 0;
  const result = await runWork({
    repositoryPath: root,
    session,
    runner: async () => {
      workerCalls += 1;
      return doneResult("a");
    },
  });

  assert.equal(workerCalls, 1);
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.deepEqual(result.changedPaths, ["src/a/result.txt"]);
  assert.equal(result.delivery.validation, "not_completed");
  assert.equal(result.delivery.commit.status, "not_attempted");
  assert.equal(result.acceptance, null);
  assert.match(result.blocker, /durable candidate.*no deterministic validation command/iu);
});

test("unavailable verifier does not pre-block coding and preserves the durable candidate", { skip: process.platform === "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  let workerCalls = 0;
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async () => {
      workerCalls += 1;
      return doneResult("a");
    },
  });

  assert.equal(workerCalls, 1);
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.deepEqual(result.changedPaths, ["src/a/result.txt"]);
  assert.equal(result.delivery.commit.status, "not_attempted");
  assert.match(result.blocker, /durable candidate.*isolated verifier capability is unavailable/iu);
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
  assert.ok(Array.isArray(result.acceptance.validation) && result.acceptance.validation.length > 0);
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

test("worker DONE and a green historical regression cannot become product DONE", { skip: process.platform !== "linux" }, async (t) => {
  const { root } = repository(t);
  const policyFile = path.join(root, ".meta-harness", "validation.json");
  const policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  policy.commands[0].argv = ["node", "-e", "process.exit(0)"];
  fs.writeFileSync(policyFile, `${JSON.stringify(policy)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seal baseline-green regression test"]);
  const session = createGoalWorkSession({
    goal: "Create a user-visible export command.",
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths: ["src/a"],
    validation: [],
  });
  const result = await runWork({ repositoryPath: root, session, runner: async () => doneResult("a") });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.delivery.validation, "passed");
  assert.equal(result.acceptance, null);
  assert.equal(result.delivery.commit.status, "not_attempted");
  assert.match(result.blocker, /not been demonstrated/iu);
  const events = readRunEventsForSession({ gitCommonDirectory: journalCommonGitDirectory(root), sessionDigest: session.sessionDigest });
  assert.ok(events.some((entry) => entry.type === "validation/goal-delta" && entry.data.differentialEvidence === false));
});

test("candidate behavior test must fail against baseline code before a new feature is DONE", { skip: process.platform !== "linux" }, async (t) => {
  const { root } = repository(t);
  const policyFile = path.join(root, ".meta-harness", "validation.json");
  const policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  policy.commands[0].argv = ["node", "--test"];
  fs.writeFileSync(policyFile, `${JSON.stringify(policy)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seal automatic test discovery"]);
  const session = createGoalWorkSession({
    goal: "Write src/a/result.txt with delivered content and verify its observable behavior.",
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths: ["src/a", "tests/export.test.js"],
    validation: [],
  });
  const runner = async () => {
    const proposed = doneResult("a");
    proposed.result.operations.push({
      type: "WRITE",
      path: "tests/export.test.js",
      content: "const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');test('export behavior',()=>assert.equal(fs.readFileSync('src/a/result.txt','utf8'),'delivered\\n'));\n",
    });
    return proposed;
  };
  const result = await runWork({ repositoryPath: root, session, runner });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.delivery.commit.status, "committed");
  const events = readRunEventsForSession({ gitCommonDirectory: journalCommonGitDirectory(root), sessionDigest: session.sessionDigest });
  const delta = events.find((entry) => entry.type === "validation/goal-delta" && entry.data.differentialEvidence);
  assert.ok(delta);
  assert.ok(delta.data.candidateTestBaselineVerificationDigest);
});

test("a validated PARTIAL worker result cannot become DONE or a committed product", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  const result = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    runner: async () => {
      const proposed = doneResult("a");
      proposed.result.status = "PARTIAL";
      proposed.result.observableResult = "Code prepared; requested behavior still incomplete.";
      return proposed;
    },
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.delivery.validation, "passed");
  assert.equal(result.delivery.commit.status, "not_attempted");
  assert.equal(result.acceptance, null);
  assert.deepEqual(result.changedPaths, ["src/a/result.txt"]);
  assert.match(result.blocker, /not been demonstrated/iu);
});

test("interrupted validated PARTIAL retains candidate bytes for attempt 2 after resume", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = materializedRun(t, "a");
  const controller = new AbortController();
  const first = await runWork({
    repositoryPath: fixture.root,
    session: fixture.session,
    signal: controller.signal,
    onProgress: (stage) => { if (stage === "repairing") controller.abort(); },
    runner: async () => {
      const proposed = doneResult("a");
      proposed.result.status = "PARTIAL";
      return proposed;
    },
  });
  assert.deepEqual(first, DRAIN_COMPLETE);
  const recovery = runWorkSessionState(fixture.root, fixture.session);
  assert.equal(recovery.state, "ACTIVE");
  let observedRetainedBytes = false;
  const resumed = await runWork({
    repositoryPath: fixture.root,
    session: recovery.session,
    runner: async ({ workspacePath, attempt }) => {
      assert.equal(attempt, 2);
      observedRetainedBytes = fs.readFileSync(path.join(workspacePath, "src/a/result.txt"), "utf8") === "delivered\n";
      return doneResult("a");
    },
  });
  assert.equal(observedRetainedBytes, true);
  assert.equal(resumed.outcome, "DONE");
  assert.equal(resumed.delivery.commit.status, "committed");
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
