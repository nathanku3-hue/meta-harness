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
const { landOutcomeClosure, runRepoWorkWave } = require("../lib/repo-work-wave");
const { appendRunEvent, listRunSessions, readRunJournal, runIdForSession } = require("../lib/run-journal");
const { commonGitDirectory } = require("../lib/work-git");
const { runWork } = require("../lib/work-loop");
const { domainDigest } = require("../lib/contracts/digest");
const { persistImmutableBytes, persistImmutableJson } = require("../lib/world-authority");
const {
  commitTransition,
  computeInterpretationDigest,
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
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: value.allowedPaths,
    continuesFromTransitionDigests: [],
  };
}

function plannerRunner(values) {
  return async ({ plannerInput }) => {
    const learned = new Set(plannerInput?.currentWorld?.payload?.learned || []);
    const active = new Set((plannerInput?.activeCommitments || []).map((entry) => entry.outcome.id));
    const unresolved = new Set((plannerInput?.unresolvedHandoffs || []).map((entry) => entry.outcome.id));
    return {
      batch: {
        schemaVersion: "planner-candidate-batch/v3",
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

test("one-time Git conflict repairs the same Outcome directly from the current product head", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const values = [
    proposal("b", { allowedPaths: ["src/b", "src/shared"] }),
    proposal("c", { allowedPaths: ["src/c", "src/shared"] }),
  ];
  writeProposalSet(root, initial.head.headDigest, values);

  const attempts = [];
  let initialStarts = 0;
  let releaseInitial;
  const initialBarrier = new Promise((resolve) => { releaseInitial = resolve; });
  let plannerSawIntegrationHandoff = false;
  const plan = plannerRunner(values);
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    runner: async ({ session, priorFailure }) => {
      const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1];
      attempts.push({ id, base: session.base.commit, priorFailure });
      if (!priorFailure) {
        initialStarts += 1;
        if (initialStarts === 2) releaseInitial();
        await initialBarrier;
      }
      return {
        worker: "linear-product-git-conflict-runner",
        stdout: "",
        stderr: "",
        result: {
          schemaVersion: "worker-result/v2",
          status: "DONE",
          observableResult: `Prepared ${id}.`,
          operations: [
            { type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" },
            { type: "WRITE", path: "src/shared/invariant.txt", content: `from-${id}\n` },
          ],
          validation: ["synthetic runner"],
          stop: null,
        },
      };
    },
    plannerRunner: async (args) => {
      plannerSawIntegrationHandoff = plannerSawIntegrationHandoff || args.plannerInput.unresolvedHandoffs.some((entry) => (
        entry.disposition === "REPLAN_REQUIRED"
      ));
      return plan(args);
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(attempts.length, 3, "two optimistic attempts plus one direct repair");
  const byId = new Map(["b", "c"].map((id) => [id, attempts.filter((entry) => entry.id === id)]));
  const repairedId = [...byId].find(([, entries]) => entries.length === 2)?.[0];
  assert.ok(repairedId === "b" || repairedId === "c");
  const repaired = byId.get(repairedId);
  assert.equal(Boolean(repaired[0].priorFailure), false);
  assert.match(repaired[1].priorFailure, /GIT_CONFLICT/u);
  assert.notEqual(repaired[1].base, initial.head.productCommit, "repair starts from the winner's current product head");
  assert.equal(plannerSawIntegrationHandoff, false, "planner does not construct the first integration repair");
  const current = readCurrentWorldState(root);
  assert.deepEqual([...current.world.payload.learned].sort(), ["b", "c"]);
  assert.deepEqual(current.world.payload.replans, [repairedId]);
  assert.equal(git(root, ["show", `${current.head.productCommit}:src/b/result.txt`]), "delivered");
  assert.equal(git(root, ["show", `${current.head.productCommit}:src/c/result.txt`]), "delivered");
});

test("repair intent recovery creates the direct successor exactly once after a crash window", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  assert.equal((await runRepoWorkWave({
    repositoryPath: root,
    runner: runner(),
    plannerRunner: plannerRunner([proposal("a")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  })).outcome, "USE_PRODUCT");
  const afterA = readCurrentWorldState(root);

  const value = proposal("c", { allowedPaths: ["src/c", "src/shared"] });
  writeProposalSet(root, afterA.head.headDigest, [value]);
  const loaded = loadRepoProposalSet(root, afterA);
  const prepared = prepareRepoProposal(root, loaded, loaded.value.proposals[0], {
    outcome: outcomeForProposal(root, loaded.value.proposals[0]),
  });
  const admitted = admitPreparedRepoProposal(root, loaded, prepared, {
    now: new Date("2026-08-18T02:30:00.000Z"),
  });
  await runWork({ repositoryPath: root, session: admitted.session, runner: runner({ breakSharedId: "c" }) });
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const landingNow = monotonicNow();
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: admitted.claim,
    closure,
    interpret: fakeInterpretation,
    now: landingNow,
  });
  assert.equal(landing.state, "REPLAN_REQUIRED");
  assert.equal(landing.repairContext.reason, "RETAINED_PROOF_FAILED");

  const gitCommonDirectory = commonGitDirectory(root);
  const predecessorRunId = runIdForSession(admitted.session.sessionDigest);
  const intent = appendRunEvent({
    gitCommonDirectory,
    runId: predecessorRunId,
    type: "integration/repair-intent",
    data: {
      predecessorSessionDigest: admitted.session.sessionDigest,
      transitionDigest: landing.transitionDigest,
      outcomeDigest: admitted.session.origin.outcomeDigest,
      objectiveRevision: admitted.session.origin.objectiveRevision,
      reason: landing.repairContext.reason,
      detail: landing.repairContext.detail,
    },
    now: landingNow(),
  });

  const recoveredAttempts = [];
  const broken = runner({ breakSharedId: "c" });
  const result = await runRepoWorkWave({
    repositoryPath: root,
    runner: async (args) => {
      if (/^Deliver c\.$/u.test(args.session.productResult)) {
        recoveredAttempts.push({ session: args.session, priorFailure: args.priorFailure });
      }
      return broken(args);
    },
    plannerRunner: plannerRunner([value]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(recoveredAttempts.length, 1, "restart materializes one repair successor and does not replay the predecessor");
  assert.match(recoveredAttempts[0].priorFailure, /RETAINED_PROOF_FAILED/u);
  assert.equal(recoveredAttempts[0].session.base.commit, afterA.head.productCommit);

  const continuations = listRunSessions({ gitCommonDirectory }).filter((session) => (
    session.origin?.type === "REPO_RUN"
    && session.origin.outcomeDigest === admitted.session.origin.outcomeDigest
    && JSON.stringify(session.origin.continuesFromTransitionDigests) === JSON.stringify([landing.transitionDigest])
  ));
  assert.equal(continuations.length, 1);
  const successorEvents = readRunJournal({
    gitCommonDirectory,
    runId: runIdForSession(continuations[0].sessionDigest),
  });
  assert.equal(successorEvents.filter((event) => event.type === "integration/repair-context"
    && event.data?.intentEventDigest === intent.eventDigest).length, 1);
  const predecessorEvents = readRunJournal({ gitCommonDirectory, runId: predecessorRunId });
  const resolutions = predecessorEvents.filter((event) => event.type === "integration/repair-resolution"
    && event.data?.intentEventDigest === intent.eventDigest);
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].data.status, "ADMITTED");
  assert.equal(resolutions[0].data.successorSessionDigest, continuations[0].sessionDigest);

  await runRepoWorkWave({
    repositoryPath: root,
    runner: async (args) => {
      if (/^Deliver c\.$/u.test(args.session.productResult)) recoveredAttempts.push({ session: args.session, priorFailure: args.priorFailure });
      return broken(args);
    },
    plannerRunner: plannerRunner([]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(recoveredAttempts.length, 1, "later recovery cannot create or execute a duplicate repair");
  assert.equal(listRunSessions({ gitCommonDirectory }).filter((session) => (
    session.origin?.type === "REPO_RUN"
    && session.origin.outcomeDigest === admitted.session.origin.outcomeDigest
    && JSON.stringify(session.origin.continuesFromTransitionDigests) === JSON.stringify([landing.transitionDigest])
  )).length, 1);
});

test("later wave cannot break a retained earlier product obligation", async (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  assert.equal((await runRepoWorkWave({ repositoryPath: root, runner: runner(), plannerRunner: plannerRunner([proposal("a")]), interpret: fakeInterpretation, now: monotonicNow() })).outcome, "USE_PRODUCT");
  const afterA = readCurrentWorldState(root); const p1 = afterA.head.productCommit;
  writeProposalSet(root, afterA.head.headDigest, [proposal("c", { allowedPaths: ["src/c", "src/shared"] })]);
  const cAttempts = [];
  let sawPlannerFallback = false;
  const breakShared = runner({ breakSharedId: "c" });
  const planC = plannerRunner([proposal("c", { allowedPaths: ["src/c", "src/shared"] })]);
  const second = await runRepoWorkWave({
    repositoryPath: root,
    runner: async (args) => {
      if (/^Deliver c\.$/u.test(args.session.productResult)) {
        cAttempts.push({ session: args.session, priorFailure: args.priorFailure });
      }
      return breakShared(args);
    },
    plannerRunner: async (args) => {
      sawPlannerFallback = sawPlannerFallback || args.plannerInput.unresolvedHandoffs.some((entry) => entry.outcome.id === "c");
      return planC(args);
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(second.outcome, "REPLAN_REQUIRED");
  assert.equal(cAttempts.length, 2, "one initial attempt plus exactly one direct integration repair");
  assert.equal(Boolean(cAttempts[0].priorFailure), false);
  assert.match(cAttempts[1].priorFailure, /RETAINED_PROOF_FAILED/u);
  assert.equal(cAttempts[1].session.base.commit, p1);
  assert.equal(sawPlannerFallback, true, "second integration rejection returns to the autonomous planner");
  const afterC = readCurrentWorldState(root); assert.equal(afterC.head.productCommit, p1);
  assert.deepEqual(afterC.world.payload.learned, ["a"]); assert.deepEqual(afterC.world.payload.replans, ["c", "c"]);
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
  assert.equal(first.outcome, "USE_PRODUCT");
  const afterA = readCurrentWorldState(root);
  const p1 = afterA.head.productCommit;
  const receiptA = latestIntegrationReceiptForHead(root, afterA.head);
  assert.equal(receiptA.schemaVersion, "product-integration/v3");
  assert.ok(receiptA.structuralSawDigest);

  writeProposalSet(root, afterA.head.headDigest, [proposal("b")]);
  const bAttempts = [];
  const debtRunner = structuralDebtRunner();
  const second = await runRepoWorkWave({
    repositoryPath: root,
    runner: async (args) => {
      if (/^Deliver b\.$/u.test(args.session.productResult)) {
        bAttempts.push({ session: args.session, priorFailure: args.priorFailure });
      }
      return debtRunner(args);
    },
    plannerRunner: plannerRunner([proposal("b")]),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(second.outcome, "REPLAN_REQUIRED");
  assert.equal(bAttempts.length, 2, "structural integration failure gets one direct repair and no third attempt");
  assert.equal(Boolean(bAttempts[0].priorFailure), false);
  assert.match(bAttempts[1].priorFailure, /STRUCTURAL_SAW_FAILED/u);
  assert.equal(bAttempts[1].session.base.commit, p1);
  const afterB = readCurrentWorldState(root);
  assert.equal(afterB.head.productCommit, p1);
  assert.deepEqual(afterB.world.payload.learned, ["a"]);
  assert.deepEqual(afterB.world.payload.replans, ["b", "b"]);
  assert.equal(git(root, ["show", `${p1}:src/a/result.txt`]), "delivered");
  assert.throws(() => git(root, ["show", `${p1}:src/b/debt.js`]));
});

test("product-integration/v3 recovers retained obligations through historical v1 lineage", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const outcomeA = persistOutcome(root, createOutcome({
    id: "a",
    desiredState: "Deliver a.",
    preconditions: ["a pending"],
    evidenceRequirement: "a delivered",
  }));
  const admittedA = legacySession(root, outcomeA, initial.head.headDigest, "a");
  await runWork({ repositoryPath: root, session: admittedA.session, runner: runner() });
  const closureA = findExecutionClosureForOrigin(root, admittedA.session.origin);
  landOutcomeClosure({ repositoryPath: root, claim: admittedA.claim, closure: closureA, interpret: fakeInterpretation, now: monotonicNow() });
  const afterA = readCurrentWorldState(root);
  const v3A = latestIntegrationReceiptForHead(root, afterA.head);
  assert.equal(v3A.schemaVersion, "product-integration/v3");
  assert.ok(v3A.structuralSawDigest);

  const legacyBody = { ...v3A, schemaVersion: LEGACY_PRODUCT_INTEGRATION_SCHEMA };
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
    assert.equal(candidate.receipt.schemaVersion, "product-integration/v3");
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

test("World pointer cannot advance behind a product-head that changed outside the landing transaction", (t) => {
  const { root, baseline } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), baseline);

  const tree = git(root, ["rev-parse", `${baseline}^{tree}`]);
  const ahead = git(root, ["commit-tree", tree, "-p", baseline, "-m", "external optimistic code advance"]);
  git(root, ["update-ref", PRODUCT_HEAD_REF, ahead, baseline]);

  const successor = projectionObjects(root, { learned: [], externalRevision: 2 });
  const transitionBody = {
    schemaVersion: "world-transition/v2",
    predecessorHeadDigest: initial.head.headDigest,
    cause: {
      type: "REALITY_REFRESH",
      projectionDigest: computeWorldProjectionDigest(successor.worldDigest, successor.attestation.attestationDigest),
    },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
    successorProductCommit: baseline,
  };
  const transition = {
    ...transitionBody,
    transitionDigest: computeWorldTransitionDigest(transitionBody),
  };

  assert.throws(
    () => commitTransition(root, transition),
    (error) => error.code === "MH_PRODUCT_HEAD_CONFLICT",
  );
  assert.equal(readCurrentWorldState(root).head.headDigest, initial.head.headDigest);
  assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), ahead);
});

test("recomputing one accepted integration produces the same Git commit across retry timestamps", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const loaded = loadRepoProposalSet(root, readCurrentWorldState(root));
  const value = loaded.value.proposals[0];
  const outcome = outcomeForProposal(root, value);
  const prepared = prepareRepoProposal(root, loaded, value, { outcome });
  const admitted = admitPreparedRepoProposal(root, loaded, prepared);
  await runWork({ repositoryPath: root, session: admitted.session, runner: runner() });
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);

  const first = prepareProductIntegration({
    repositoryPath: root,
    predecessorProductCommit: initial.head.productCommit,
    currentHead: initial.head,
    claim: admitted.claim,
    closure,
    now: new Date("2026-08-18T06:00:00.000Z"),
  });
  const second = prepareProductIntegration({
    repositoryPath: root,
    predecessorProductCommit: initial.head.productCommit,
    currentHead: initial.head,
    claim: admitted.claim,
    closure,
    now: new Date("2026-08-19T09:15:00.000Z"),
  });
  try {
    assert.equal(first.status, "ACCEPTED");
    assert.equal(second.status, "ACCEPTED");
    assert.equal(first.receipt.integratedTreeOid, second.receipt.integratedTreeOid);
    assert.equal(first.receipt.integratedCommit, second.receipt.integratedCommit);
    assert.notEqual(first.receipt.integratedAt, second.receipt.integratedAt);
  } finally {
    discardProductIntegration(first);
    discardProductIntegration(second);
  }
});

test("retry after product-head CAS but before World pointer publication completes the same landing", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  const loaded = loadRepoProposalSet(root, readCurrentWorldState(root));
  const value = loaded.value.proposals[0];
  const outcome = outcomeForProposal(root, value);
  const prepared = prepareRepoProposal(root, loaded, value, { outcome });
  const admitted = admitPreparedRepoProposal(root, loaded, prepared);
  await runWork({ repositoryPath: root, session: admitted.session, runner: runner() });
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const integration = prepareProductIntegration({
    repositoryPath: root,
    predecessorProductCommit: initial.head.productCommit,
    currentHead: initial.head,
    claim: admitted.claim,
    closure,
    now: new Date("2026-08-18T07:00:00.000Z"),
  });
  assert.equal(integration.status, "ACCEPTED");

  const successor = projectionObjects(root, { learned: ["a"] });
  const interpretationBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: "repo-closure-interpretation/v1",
    disposition: "APPLIED",
    interpretation: "Apply the proven product result.",
  }, null, 2)}\n`, "utf8");
  const interpretationDigest = computeInterpretationDigest(interpretationBytes);
  persistImmutableBytes(root, "interpretations", interpretationDigest, interpretationBytes, "TEST_INTERPRETATION");
  const transitionBody = {
    schemaVersion: "world-transition/v2",
    predecessorHeadDigest: initial.head.headDigest,
    cause: {
      type: "ATTEMPT_LEARNING",
      executionClosureDigest: closure.closureDigest,
      interpretationDigest,
      integrationDigest: integration.receipt.integrationDigest,
    },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
    successorProductCommit: integration.receipt.integratedCommit,
  };
  const transition = {
    ...transitionBody,
    transitionDigest: computeWorldTransitionDigest(transitionBody),
  };

  git(root, ["update-ref", PRODUCT_HEAD_REF, integration.receipt.integratedCommit, initial.head.productCommit]);
  assert.equal(readCurrentWorldState(root).head.headDigest, initial.head.headDigest);

  try {
    const committed = commitTransition(root, transition);
    assert.equal(committed.status, "APPLIED");
    assert.equal(committed.head.productCommit, integration.receipt.integratedCommit);
    assert.equal(readCurrentWorldState(root).head.headDigest, committed.head.headDigest);
    assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), integration.receipt.integratedCommit);
  } finally {
    discardProductIntegration(integration);
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

test("legacy product-head repair never moves a newer CAS head backward or sideways", async (t) => {
  const { root } = repository(t); const initial = persistInitial(root, "world-transition/v2");
  writeProposalSet(root, initial.head.headDigest, [proposal("a")]);
  await runRepoWorkWave({ repositoryPath: root, runner: runner(), plannerRunner: plannerRunner([proposal("a")]), interpret: fakeInterpretation, now: monotonicNow() });
  const productCommit = readCurrentWorldState(root).head.productCommit;

  const tree = git(root, ["rev-parse", `${productCommit}^{tree}`]);
  const ahead = git(root, ["commit-tree", tree, "-p", productCommit, "-m", "newer optimistic head"]);
  git(root, ["update-ref", PRODUCT_HEAD_REF, ahead, productCommit]);
  assert.throws(
    () => repairProductHeadRef(root, productCommit),
    (error) => error.code === "MH_PRODUCT_HEAD_AHEAD",
  );
  assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), ahead);

  const sibling = git(root, ["commit-tree", tree, "-p", git(root, ["rev-parse", `${productCommit}^`]), "-m", "divergent optimistic head"]);
  git(root, ["update-ref", PRODUCT_HEAD_REF, sibling, ahead]);
  assert.throws(
    () => repairProductHeadRef(root, productCommit),
    (error) => error.code === "MH_PRODUCT_HEAD_DIVERGED",
  );
  assert.equal(git(root, ["rev-parse", PRODUCT_HEAD_REF]), sibling);
});
