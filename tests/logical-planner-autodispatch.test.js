"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { renderHuman } = require("../lib/commands/work");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { createPlannerSnapshot, removePlannerSnapshot } = require("../lib/repo-logical-planner");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
} = require("../lib/repo-planner-admission");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { commitTransition, readCurrentWorldState } = require("../lib/world-transition");
const {
  git,
  monotonicNow,
  persistInitial,
  projectionObjects,
  proposal,
  repository,
  runner,
  transition,
  writeProposalSet,
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

function planner(values, onCall = () => {}) {
  let calls = 0;
  const run = async (args) => {
    calls += 1;
    onCall({ ...args, calls });
    return { batch: { schemaVersion: "planner-candidate-batch/v1", proposals: values } };
  };
  run.calls = () => calls;
  return run;
}

test("stale repo-proposals.json is inert fresh-work history", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const plannerRunner = planner([candidate("b")]);
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner,
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.admitted, 1);
  assert.equal(plannerRunner.calls(), 1);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["b"]);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "repo-proposals.json")), true);
  let humanOutput = "";
  renderHuman({ stdout: { write: (text) => { humanOutput += String(text); } } }, result);
  assert.match(humanOutput, /^Done — 1 independent outcome landed/u);
  assert.doesNotMatch(humanOutput, /planner prompt|worker prompt|claimDigest|workspaceId|run stream|sha256:/iu);
});

test("recovered executable capacity is committed before possibilities and can skip planner entirely", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a"));
  admitPreparedPlannerCandidate(root, current, prepared);
  let plannerCalls = 0;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "1" },
    plannerRunner: async () => { plannerCalls += 1; throw new Error("planner must not run"); },
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(plannerCalls, 0);
  assert.equal(result.plannerInvoked, false);
  assert.equal(result.recovered, 1);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["a"]);
});

test("conflict rejects the whole exact candidate rather than silently shrinking it", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "3" },
    plannerRunner: planner([
      candidate("a", ["src/a"]),
      candidate("b", ["src/a", "src/b"]),
      candidate("c", ["src/c"]),
    ]),
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.admitted, 2);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "c"]);
  assert.ok(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.candidateId === "b" && entry.code === "MH_OUTCOME_CLAIM_CONFLICT"
  )));
});

test("stale planner output retries exactly once when no Claim became visible", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  let advanced = false;
  const plannerRunner = planner([candidate("a")], ({ current, calls }) => {
    if (calls !== 1) return;
    const successor = projectionObjects(root, { learned: [], externalRevision: 2 });
    commitTransition(root, transition(root, current.head.headDigest, successor));
    advanced = true;
  });
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner,
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(advanced, true);
  assert.equal(plannerRunner.calls(), 2);
  assert.equal(result.plannerRetryCount, 1);
  assert.equal(result.admitted, 1);
  assert.equal(result.stalePlanner, false);
});

test("stale planner output never recursively replans after one new Claim is visible", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const clock = monotonicNow();
  let advanced = false;
  const now = () => {
    const value = clock();
    if (!advanced && listActiveOutcomeClaims(root).length === 1) {
      const current = readCurrentWorldState(root, { now: value });
      const successor = projectionObjects(root, { learned: [], concurrentRevision: 2 }, value.toISOString());
      commitTransition(root, transition(root, current.head.headDigest, successor));
      advanced = true;
    }
    return value;
  };
  const plannerRunner = planner([candidate("a"), candidate("b")]);
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    plannerRunner,
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now,
  });
  assert.equal(advanced, true);
  assert.equal(plannerRunner.calls(), 1);
  assert.equal(result.plannerRetryCount, 0);
  assert.equal(result.admitted, 1);
  assert.equal(result.stalePlanner, true);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["a"]);
});

test("planner failure before Claim leaves no execution authority and a fresh invocation can recompute", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  await assert.rejects(
    runRepoWorkWave({ repositoryPath: root, plannerRunner: async () => { throw new Error("planner died"); } }),
    /planner died/u,
  );
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: planner([candidate("a")]),
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.admitted, 1);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["a"]);
});

test("planner snapshot is exact productCommit and does not transport owner-checkout dirt", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  fs.writeFileSync(path.join(root, "owner-only.tmp"), "dirty owner state\n", "utf8");
  const before = git(root, ["status", "--porcelain"]);
  const snapshot = createPlannerSnapshot(root, initial.head.productCommit);
  try {
    assert.equal(git(snapshot.snapshotPath, ["rev-parse", "HEAD"]), initial.head.productCommit);
    assert.equal(fs.existsSync(path.join(snapshot.snapshotPath, "owner-only.tmp")), false);
  } finally {
    removePlannerSnapshot(root, snapshot);
  }
  assert.equal(git(root, ["status", "--porcelain"]), before);
});
