"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const {
  ensureLinearProductHead,
  PRODUCT_HEAD_REF,
  repairProductHeadRef,
} = require("../lib/repo-product-integration");
const {
  admitPreparedRepoProposal,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("../lib/repo-proposal-set");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { runWork } = require("../lib/work-loop");
const {
  computeWorldHeadDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldState,
} = require("../lib/world-transition");
const {
  createOutcome,
  fakeInterpretation,
  git,
  legacyLearning,
  legacySession,
  monotonicNow,
  persistInitial,
  persistOutcome,
  projectionObjects,
  proposal,
  repository,
  runner,
  writeProposalSet,
} = require("./helpers/linear-product-head");

test("world-transition/v2 product commit participates in transition and Head identity", (t) => {
  const { root, baseline } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  require("node:fs").writeFileSync(require("node:path").join(root, "extra.txt"), "x\n", "utf8");
  git(root, ["add", "extra.txt"]); git(root, ["commit", "-m", "extra"]);
  const otherCommit = git(root, ["rev-parse", "HEAD"]);
  const successor = projectionObjects(root, { learned: ["semantic-same"], replans: [] });
  const common = {
    schemaVersion: "world-transition/v2",
    predecessorHeadDigest: initial.head.headDigest,
    cause: { type: "REALITY_REFRESH", projectionDigest: computeWorldProjectionDigest(successor.worldDigest, successor.attestation.attestationDigest) },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
  };
  const leftDigest = computeWorldTransitionDigest({ ...common, successorProductCommit: baseline });
  const rightDigest = computeWorldTransitionDigest({ ...common, successorProductCommit: otherCommit });
  assert.notEqual(leftDigest, rightDigest);
  const leftHead = { schemaVersion: "world-head/v2", generation: initial.head.generation + 1, worldDigest: successor.worldDigest, attestationDigest: successor.attestation.attestationDigest, productCommit: baseline, lastTransitionDigest: leftDigest };
  const rightHead = { ...leftHead, productCommit: otherCommit, lastTransitionDigest: rightDigest };
  assert.notEqual(computeWorldHeadDigest(leftHead), computeWorldHeadDigest(rightHead));
});

test("proposal v2 derives new session base from authoritative productCommit", (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const loaded = loadRepoProposalSet(root, readCurrentWorldState(root)); const value = loaded.value.proposals[0];
  assert.equal(Object.hasOwn(value, "base"), false);
  const outcome = outcomeForProposal(root, value); const prepared = prepareRepoProposal(root, loaded, value, { outcome });
  const admitted = admitPreparedRepoProposal(root, loaded, prepared);
  assert.equal(admitted.session.base.commit, initial.head.productCommit);
});

test("legacy Phase-2 APPLIED A+B migration reconstructs one cumulative v2 product commit", async (t) => {
  const { root, baseline } = repository(t); const initial = persistInitial(root, "world-transition/v1");
  const a = persistOutcome(root, createOutcome({ id: "a", desiredState: "Deliver a.", preconditions: ["a pending"], evidenceRequirement: "a delivered" }));
  const b = persistOutcome(root, createOutcome({ id: "b", desiredState: "Deliver b.", preconditions: ["b pending"], evidenceRequirement: "b delivered" }));
  const admittedA = legacySession(root, a, initial.head.headDigest, "a"); const admittedB = legacySession(root, b, initial.head.headDigest, "b");
  await runWork({ repositoryPath: root, session: admittedA.session, runner: runner() }); await runWork({ repositoryPath: root, session: admittedB.session, runner: runner() });
  const closureA = findExecutionClosureForOrigin(root, admittedA.session.origin); const closureB = findExecutionClosureForOrigin(root, admittedB.session.origin);
  const h1 = legacyLearning(root, initial.head.headDigest, closureA, { learned: ["a"] }).head;
  legacyLearning(root, h1.headDigest, closureB, { learned: ["a", "b"] }, new Date("2026-08-18T04:00:01.000Z"));
  const migrated = ensureLinearProductHead(root, { now: monotonicNow() });
  assert.equal(migrated.head.schemaVersion, "world-head/v2"); assert.notEqual(migrated.head.productCommit, baseline);
  assert.equal(git(root, ["show", `${migrated.head.productCommit}:src/a/result.txt`]), "delivered");
  assert.equal(git(root, ["show", `${migrated.head.productCommit}:src/b/result.txt`]), "delivered");
  assert.equal(git(root, ["rev-parse", "HEAD"]), baseline); assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), migrated.head.productCommit);
});

test("later wave cannot break a retained earlier product obligation", async (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  assert.equal((await runRepoWorkWave({ repositoryPath: root, runner: runner(), interpret: fakeInterpretation, now: monotonicNow() })).outcome, "DONE");
  const afterA = readCurrentWorldState(root); const p1 = afterA.head.productCommit;
  writeProposalSet(root, afterA.head.headDigest, [proposal("c", { allowedPaths: ["src/c", "src/shared"] })]);
  const second = await runRepoWorkWave({ repositoryPath: root, runner: runner({ breakSharedId: "c" }), interpret: fakeInterpretation, now: monotonicNow() });
  assert.equal(second.outcome, "REPLAN_REQUIRED");
  const afterC = readCurrentWorldState(root); assert.equal(afterC.head.productCommit, p1);
  assert.deepEqual(afterC.world.payload.learned, ["a"]); assert.deepEqual(afterC.world.payload.replans, ["c"]);
  assert.equal(git(root, ["show", `${p1}:src/shared/invariant.txt`]), "safe");
});

test("authoritative product commit remains reachable and repairs a missing mirror ref", async (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  await runRepoWorkWave({ repositoryPath: root, runner: runner(), interpret: fakeInterpretation, now: monotonicNow() });
  const productCommit = readCurrentWorldState(root).head.productCommit; git(root, ["cat-file", "-e", `${productCommit}^{commit}`]);
  git(root, ["update-ref", "-d", PRODUCT_HEAD_REF]);
  assert.notEqual(spawnSync("git", ["rev-parse", "--verify", PRODUCT_HEAD_REF], { cwd: root }).status, 0);
  repairProductHeadRef(root, productCommit); assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), productCommit);
  ensureLinearProductHead(root, { now: monotonicNow() }); assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), productCommit);
});
