"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const {
  discardProductIntegration,
  ensureLinearProductHead,
  latestIntegrationReceiptForHead,
  prepareProductIntegration,
  PRODUCT_HEAD_REF,
  repairProductHeadRef,
} = require("../lib/repo-product-integration");
const {
  LEGACY_PRODUCT_INTEGRATION_SCHEMA,
  computeProductIntegrationDigest,
  validateProductIntegration,
} = require("../lib/repo-product-integration-record");
const {
  admitPreparedRepoProposal,
  loadRepoProposalSet,
  outcomeForProposal,
  prepareRepoProposal,
} = require("../lib/repo-proposal-set");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { runWork } = require("../lib/work-loop");
const { domainDigest } = require("../lib/contracts/digest");
const { persistImmutableJson } = require("../lib/world-authority");
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

function plannerCandidate(value) {
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

function plannerRunner(values) {
  return async ({ plannerInput }) => {
    const learned = new Set(plannerInput?.currentWorld?.payload?.learned || []);
    const active = new Set((plannerInput?.activeCommitments || []).map((entry) => entry.outcome.id));
    const unresolved = new Set((plannerInput?.unresolvedHandoffs || []).map((entry) => entry.outcome.id));
    return {
      batch: {
        schemaVersion: "planner-candidate-batch/v1",
        proposals: values.map(plannerCandidate).filter((entry) => !learned.has(entry.id) && !active.has(entry.id) && !unresolved.has(entry.id)),
      },
    };
  };
}

function writeJson(root, relative, value) {
  const filePath = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function installStructuralSawPolicy(root) {
  writeJson(root, ".meta-harness/clean-code-contract.json", {
    v: 1,
    mode: "ratchet",
    ratchets: {
      direct_events_jsonl_append: { approved_helpers: ["appendEvent"] },
      worker_report_flags: { must_not_increase_without: ["--from", "--input"] },
    },
    excluded_dirs: [".git", ".meta-harness", "node_modules"],
  });
  writeJson(root, ".meta-harness/complexity-policy.json", {
    schema_version: "1.0.0",
    version: 1,
    line_budgets: { source: 1, bin_entrypoint: 100, command_module: 100, test: 100 },
    duplicate_template_allowlist: [],
    import_direction: {
      "bin -> lib/commands": "allowed", "bin -> lib": "allowed", "lib/commands -> lib": "allowed",
      "lib/commands -> bin": "forbidden", "lib -> bin": "forbidden", "lib -> lib/commands": "forbidden", "templates -> lib": "forbidden",
    },
  });
  writeJson(root, "docs/architecture/owners.json", { schema_version: "1.0.0", version: 1, modules: [] });
  git(root, ["add", ".meta-harness/clean-code-contract.json", ".meta-harness/complexity-policy.json", "docs/architecture/owners.json"]);
  git(root, ["commit", "-m", "install structural policy"]);
}

function structuralDebtRunner() {
  return async ({ session }) => {
    const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1];
    return {
      worker: "linear-product-structural-debt-runner",
      stdout: "",
      stderr: "",
      result: {
        schemaVersion: "worker-result/v2",
        status: "DONE",
        observableResult: `Prepared ${id} with structural debt.`,
        operations: [
          { type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" },
          { type: "WRITE", path: `src/${id}/debt.js`, content: "const a=1;\nconst b=2;\n" },
        ],
        validation: ["synthetic runner"],
        stop: null,
      },
    };
  };
}

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
  assert.equal((await runRepoWorkWave({ repositoryPath: root, runner: runner(), plannerRunner: plannerRunner([proposal("a")]), interpret: fakeInterpretation, now: monotonicNow() })).outcome, "DONE");
  const afterA = readCurrentWorldState(root); const p1 = afterA.head.productCommit;
  writeProposalSet(root, afterA.head.headDigest, [proposal("c", { allowedPaths: ["src/c", "src/shared"] })]);
  const second = await runRepoWorkWave({ repositoryPath: root, runner: runner({ breakSharedId: "c" }), plannerRunner: plannerRunner([proposal("c", { allowedPaths: ["src/c", "src/shared"] })]), interpret: fakeInterpretation, now: monotonicNow() });
  assert.equal(second.outcome, "REPLAN_REQUIRED");
  const afterC = readCurrentWorldState(root); assert.equal(afterC.head.productCommit, p1);
  assert.deepEqual(afterC.world.payload.learned, ["a"]); assert.deepEqual(afterC.world.payload.replans, ["c"]);
  assert.equal(git(root, ["show", `${p1}:src/shared/invariant.txt`]), "safe");
});

test("structural SAW failure on a later cumulative tree replans without advancing product code", async (t) => {
  const { root } = repository(t);
  installStructuralSawPolicy(root);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const first = await runRepoWorkWave({
    repositoryPath: root,
    runner: runner(),
    plannerRunner: plannerRunner([proposal("a")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(first.outcome, "DONE");
  const afterA = readCurrentWorldState(root);
  const p1 = afterA.head.productCommit;
  const receiptA = latestIntegrationReceiptForHead(root, afterA.head);
  assert.equal(receiptA.schemaVersion, "product-integration/v2");
  assert.ok(receiptA.structuralSawDigest);

  writeProposalSet(root, afterA.head.headDigest, [proposal("b")]);
  const second = await runRepoWorkWave({
    repositoryPath: root,
    runner: structuralDebtRunner(),
    plannerRunner: plannerRunner([proposal("b")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(second.outcome, "REPLAN_REQUIRED");
  const afterB = readCurrentWorldState(root);
  assert.equal(afterB.head.productCommit, p1);
  assert.deepEqual(afterB.world.payload.learned, ["a"]);
  assert.deepEqual(afterB.world.payload.replans, ["b"]);
  assert.equal(git(root, ["show", `${p1}:src/a/result.txt`]), "delivered");
  assert.throws(() => git(root, ["show", `${p1}:src/b/debt.js`]));
});

test("product-integration/v2 recovers retained obligations through historical v1 lineage", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  await runRepoWorkWave({ repositoryPath: root, runner: runner(), plannerRunner: plannerRunner([proposal("a")]), interpret: fakeInterpretation, now: monotonicNow() });
  const afterA = readCurrentWorldState(root);
  const v2A = latestIntegrationReceiptForHead(root, afterA.head);
  assert.equal(v2A.schemaVersion, "product-integration/v2");
  assert.ok(v2A.structuralSawDigest);

  const legacyBody = { ...v2A, schemaVersion: LEGACY_PRODUCT_INTEGRATION_SCHEMA };
  delete legacyBody.structuralSawDigest;
  delete legacyBody.integrationDigest;
  const legacyA = validateProductIntegration({ ...legacyBody, integrationDigest: computeProductIntegrationDigest(legacyBody) });
  persistImmutableJson(root, "product-integrations", legacyA.integrationDigest, legacyA, "TEST_PRODUCT_INTEGRATION");
  const transitionDigest = domainDigest("test-mixed-product-lineage-transition/v1", { integrationDigest: legacyA.integrationDigest });
  persistImmutableJson(root, "transitions", transitionDigest, {
    schemaVersion: "world-transition/v2",
    predecessorHeadDigest: null,
    cause: { type: "ATTEMPT_LEARNING", integrationDigest: legacyA.integrationDigest },
  }, "TEST_TRANSITION");
  const mixedHead = {
    headDigest: domainDigest("test-mixed-product-lineage-head/v1", { transitionDigest }),
    lastTransitionDigest: transitionDigest,
  };

  writeProposalSet(root, afterA.head.headDigest, [proposal("b")]);
  const loaded = loadRepoProposalSet(root, afterA);
  const value = loaded.value.proposals[0];
  const outcome = outcomeForProposal(root, value);
  const prepared = prepareRepoProposal(root, loaded, value, { outcome });
  const admitted = admitPreparedRepoProposal(root, loaded, prepared);
  await runWork({ repositoryPath: root, session: admitted.session, runner: runner() });
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const candidate = prepareProductIntegration({
    repositoryPath: root,
    predecessorProductCommit: afterA.head.productCommit,
    currentHead: mixedHead,
    claim: admitted.claim,
    closure,
    now: new Date("2026-08-18T05:00:00.000Z"),
  });
  try {
    assert.equal(candidate.status, "ACCEPTED");
    assert.equal(candidate.receipt.schemaVersion, "product-integration/v2");
    assert.equal(candidate.receipt.retainedObligations.length, 2);
    assert.deepEqual(candidate.receipt.retainedObligations[0], legacyA.retainedObligations[0]);
    assert.equal(candidate.receipt.structuralSawDigest, candidate.structuralSaw.sawDigest);
    assert.equal(candidate.structuralSaw.predecessorProductCommit, afterA.head.productCommit);
    assert.equal(candidate.structuralSaw.candidateTreeOid, candidate.receipt.integratedTreeOid);
    assert.equal(candidate.structuralSaw.passed, true);
  } finally {
    discardProductIntegration(candidate);
  }
});

test("authoritative product commit remains reachable and repairs a missing mirror ref", async (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  await runRepoWorkWave({ repositoryPath: root, runner: runner(), plannerRunner: plannerRunner([proposal("a")]), interpret: fakeInterpretation, now: monotonicNow() });
  const productCommit = readCurrentWorldState(root).head.productCommit; git(root, ["cat-file", "-e", `${productCommit}^{commit}`]);
  git(root, ["update-ref", "-d", PRODUCT_HEAD_REF]);
  assert.notEqual(spawnSync("git", ["rev-parse", "--verify", PRODUCT_HEAD_REF], { cwd: root }).status, 0);
  repairProductHeadRef(root, productCommit); assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), productCommit);
  ensureLinearProductHead(root, { now: monotonicNow() }); assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), productCommit);
});
