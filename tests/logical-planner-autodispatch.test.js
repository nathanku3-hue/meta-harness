"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { renderHuman } = require("../lib/commands/work");
const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { listActiveOutcomeClaims, readOutcomeClaim } = require("../lib/outcome-claim");
const { createOutcome } = require("../lib/outcome");
const { buildLogicalPlannerPrompt, createPlannerSnapshot, removePlannerSnapshot } = require("../lib/repo-logical-planner");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
} = require("../lib/repo-planner-admission");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { protocolRoot } = require("../lib/world-authority");
const { runWork } = require("../lib/work-loop");
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
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
    continuesFromTransitionDigests: [],
  };
}

function planner(values, onCall = () => {}) {
  let calls = 0;
  const run = async (args) => {
    calls += 1;
    onCall({ ...args, calls });
    const learned = new Set(args.plannerInput?.currentWorld?.payload?.learned || []);
    const active = new Set((args.plannerInput?.activeCommitments || []).map((entry) => entry.outcome.id));
    const unresolved = new Set((args.plannerInput?.unresolvedHandoffs || []).map((entry) => entry.outcome.id));
    const proposals = values.filter((entry) => !learned.has(entry.id) && !active.has(entry.id) && !unresolved.has(entry.id));
    return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: proposals.map((entry) => ({ ...entry, objectRefs: [], hypothesisRef: null, criterionRefs: [], metricRefs: [] })) } };
  };
  run.calls = () => calls;
  return run;
}

function installRequiredEndgame(root) {
  const current = fs.readFileSync(path.join(root, "PRODUCT.md"), "utf8");
  const prefix = current.split("## Semantic Authority")[0].trimEnd();
  const binding = {
    state: "BOUND",
    atoms: [{
      id: "DESTINATION_B",
      kind: "DESTINATION",
      identity: "Deliver b.",
      role: "REQUIRED_DESTINATION",
    }],
  };
  fs.writeFileSync(
    path.join(root, "PRODUCT.md"),
    `${prefix}\n\n## Semantic Authority\n\n\`\`\`json\n${JSON.stringify(binding, null, 2)}\n\`\`\`\n`,
    "utf8",
  );
  git(root, ["add", "PRODUCT.md"]);
  git(root, ["commit", "-m", "require terminal destination"]);
}

function stoppedWorkerResult() {
  return {
    worker: "autonomous-continuation-stop-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "STOP",
      observableResult: "STOP route is BLOCKed and closed without the required result.",
      operations: [],
      validation: [],
      stop: {
        unsatisfiedRequirement: "The preferred source is BLOCKed and this workcell is closed.",
        failedMeans: [{ means: "preferred source", evidence: ["STOP: source route returned no usable result."] }],
        alternativesConsidered: [],
        assertedConstraint: "The preferred source route is unavailable.",
      },
    },
  };
}

function replanProof() {
  return {
    disposition: "REPLAN_REQUIRED",
    failedMeans: [{ means: "preferred source", evidence: ["The preferred source route returned no usable result."] }],
    alternatives: [],
    hardConstraint: null,
    ownerRequest: null,
    disprovedAssertions: [],
  };
}

async function seedAutonomousReplan(root, id = "s0") {
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate(id, [`src/${id}`]));
  const admitted = admitPreparedPlannerCandidate(root, current, prepared);
  const result = await runWork({
    repositoryPath: root,
    session: admitted.session,
    runner: async () => stoppedWorkerResult(),
    forwardMotionRunner: async () => replanProof(),
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  return result;
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
  assert.equal(plannerRunner.calls(), 2);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["b"]);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "repo-proposals.json")), true);
  let humanOutput = "";
  renderHuman({ stdout: { write: (text) => { humanOutput += String(text); } } }, result);
  assert.equal(humanOutput, "No active slice.\nUse the product.\nWait for observed real-use friction.\n");
  assert.doesNotMatch(humanOutput, /planner prompt|worker prompt|claimDigest|workspaceId|run stream|sha256:/iu);
});

test("recovered executable commitments start before fresh planning on every reconciliation pass", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a", ["src/a"], root));
  admitPreparedPlannerCandidate(root, current, prepared);
  let workerStarted = false;
  let plannerCalls = 0;
  const baseRunner = runner();
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "1" },
    plannerRunner: async ({ plannerInput }) => {
      plannerCalls += 1;
      assert.equal(workerStarted, true);
      if (plannerCalls === 1) {
        assert.deepEqual(plannerInput.currentWorld.payload.learned, []);
        assert.deepEqual(plannerInput.activeCommitments.map((entry) => entry.outcome.id), ["a"]);
      } else {
        assert.deepEqual(plannerInput.currentWorld.payload.learned, ["a"]);
        assert.equal(plannerInput.activeCommitments.length, 0);
      }
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: async (args) => {
      workerStarted = true;
      return baseRunner(args);
    },
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(plannerCalls, 2);
  assert.equal(result.plannerInvoked, true);
  assert.equal(result.recovered, 1);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["a"]);
});

test("terminal Closure lands before a fresh planner boot", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a", ["src/a"], root));
  const admitted = admitPreparedPlannerCandidate(root, current, prepared);
  await runWork({ repositoryPath: root, session: admitted.session, runner: runner() });

  let plannerInput = null;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async (args) => {
      plannerInput = args.plannerInput;
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.ok(plannerInput);
  assert.deepEqual(plannerInput.currentWorld.payload.learned, ["a"]);
  assert.notEqual(plannerInput.head.productCommit, initial.head.productCommit);
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 1);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("autonomous REPLAN handoff dispatches a linked successor in the same work invocation", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");

  let handoffDigest = null;
  let successorClaimDigest = null;
  let successorStarts = 0;
  const baseRunner = runner();
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async ({ plannerInput }) => {
      const handoff = plannerInput.unresolvedHandoffs.find((entry) => entry.disposition === "REPLAN_REQUIRED");
      if (handoff && handoffDigest === null) {
        handoffDigest = handoff.transitionDigest;
        assert.deepEqual(handoff.activeContinuationClaimDigests, []);
        return {
          batch: {
            schemaVersion: "planner-candidate-batch/v3",
            proposals: [{ ...candidate("b"), continuesFromTransitionDigests: [handoff.transitionDigest] }],
          },
        };
      }
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: async (args) => {
      successorStarts += 1;
      successorClaimDigest = args.session.origin.claimDigest;
      const claim = readOutcomeClaim(root, successorClaimDigest);
      assert.deepEqual(claim.continuesFromTransitionDigests, [handoffDigest]);
      return baseRunner(args);
    },
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.match(handoffDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(successorClaimDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(successorStarts, 1);
  assert.equal(result.admitted, 1);
  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.endgameCoverage.complete, true);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("empty planner frontier cannot quiesce an uncovered autonomous REPLAN handoff", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");
  let sawAutonomousHandoff = false;

  await assert.rejects(
    runRepoWorkWave({
      repositoryPath: root,
      plannerRunner: async ({ plannerInput }) => {
        sawAutonomousHandoff = sawAutonomousHandoff || plannerInput.unresolvedHandoffs.some((entry) => (
          entry.disposition === "REPLAN_REQUIRED" && entry.activeContinuationClaimDigests.length === 0
        ));
        return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
      },
      runner: runner(),
      interpret: require("./helpers/linear-product-head").fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error.code === "MH_FORWARD_PROGRESS_INVARIANT"
      && /autonomous continuation obligation.*quiescence/iu.test(error.message),
  );
  assert.equal(sawAutonomousHandoff, true);
});

test("empty planner frontier cannot USE_PRODUCT an uncovered autonomous REPLAN without required destinations", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");

  await assert.rejects(
    runRepoWorkWave({
      repositoryPath: root,
      plannerRunner: async () => ({ batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } }),
      runner: runner(),
      interpret: require("./helpers/linear-product-head").fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error.code === "MH_FORWARD_PROGRESS_INVARIANT"
      && /autonomous continuation obligation.*quiescence/iu.test(error.message),
  );
});

test("concurrent Claim admission covers a planner-snapshot handoff without false forward-progress failure", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");
  let plannerCalls = 0;
  let admittedDuringPlanner = null;

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async ({ current, plannerInput }) => {
      plannerCalls += 1;
      const handoff = plannerInput.unresolvedHandoffs.find((entry) => entry.disposition === "REPLAN_REQUIRED");
      if (plannerCalls === 1) {
        assert.ok(handoff);
        const linked = { ...candidate("b"), continuesFromTransitionDigests: [handoff.transitionDigest] };
        const prepared = preparePlannerCandidate(root, current, linked);
        admittedDuringPlanner = admitPreparedPlannerCandidate(root, current, prepared, {
          objectiveRevision: plannerInput.ownerIntent.activeDirective?.revision || 0,
        });
        assert.deepEqual(admittedDuringPlanner.claim.continuesFromTransitionDigests, [handoff.transitionDigest]);
      }
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.ok(admittedDuringPlanner);
  assert.ok(plannerCalls >= 2);
  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.endgameCoverage.complete, true);
});

test("one autonomous transition can provenance multiple parallel successor Claims", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");
  let handoffDigest = null;
  let sent = false;
  const linkedClaims = [];
  const baseRunner = runner();

  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    plannerRunner: async ({ plannerInput }) => {
      const handoff = plannerInput.unresolvedHandoffs.find((entry) => entry.disposition === "REPLAN_REQUIRED");
      if (!sent && handoff) {
        sent = true;
        handoffDigest = handoff.transitionDigest;
        return {
          batch: {
            schemaVersion: "planner-candidate-batch/v3",
            proposals: ["b", "c"].map((id) => ({
              ...candidate(id),
              continuesFromTransitionDigests: [handoff.transitionDigest],
            })),
          },
        };
      }
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: async (args) => {
      const claim = readOutcomeClaim(root, args.session.origin.claimDigest);
      linkedClaims.push(claim);
      return baseRunner(args);
    },
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.admitted, 2);
  assert.equal(linkedClaims.length, 2);
  assert.ok(linkedClaims.every((claim) => JSON.stringify(claim.continuesFromTransitionDigests) === JSON.stringify([handoffDigest])));
  assert.equal(result.outcome, "USE_PRODUCT");
});

test("planner cannot invent continuation lineage absent from its exact handoff snapshot", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const invented = `sha256:${"9".repeat(64)}`;

  await assert.rejects(
    runRepoWorkWave({
      repositoryPath: root,
      plannerRunner: async () => ({
        batch: {
          schemaVersion: "planner-candidate-batch/v3",
          proposals: [{ ...candidate("b"), continuesFromTransitionDigests: [invented] }],
        },
      }),
      runner: runner(),
      interpret: require("./helpers/linear-product-head").fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error.code === "MH_PLANNER_CANDIDATE_CONTINUATION",
  );
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("capacity race rejection is normal Claim contention and stops the stale planner batch", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  let filledCapacity = false;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "3" },
    plannerRunner: async ({ current, plannerInput }) => {
      if (!filledCapacity) {
        filledCapacity = true;
        for (const id of ["a", "b", "c"]) {
          const prepared = preparePlannerCandidate(root, current, candidate(id));
          admitPreparedPlannerCandidate(root, current, prepared, {
            objectiveRevision: plannerInput.ownerIntent.activeDirective?.revision || 0,
          });
        }
        return {
          batch: {
            schemaVersion: "planner-candidate-batch/v3",
            proposals: [candidate("d"), candidate("e")],
          },
        };
      }
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.recovered, 3);
  assert.ok(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.candidateId === "d" && entry.code === "MH_OUTCOME_CLAIM_CAPACITY"
  )));
  assert.equal(result.orchestrationTelemetry.candidateRejections.some((entry) => entry.candidateId === "e"), false);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b", "c"]);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("ordinary conflicting planner rejection leaves no orphan Outcome", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const admittedA = preparePlannerCandidate(root, current, candidate("a", ["src/a"], root));
  admitPreparedPlannerCandidate(root, current, admittedA);

  const rejected = candidate("b", ["src/a/nested"], root);
  const prospective = createOutcome({
    id: rejected.id,
    desiredState: rejected.productResult,
    preconditions: [rejected.journeyState],
    evidenceRequirement: rejected.doneWhen,
  });
  const preparedB = preparePlannerCandidate(root, current, rejected);
  assert.throws(
    () => admitPreparedPlannerCandidate(root, current, preparedB),
    (error) => error.code === "MH_OUTCOME_CLAIM_CONFLICT",
  );
  const outcomePath = path.join(
    protocolRoot(root),
    "outcomes",
    `${prospective.outcomeDigest.slice("sha256:".length)}.json`,
  );
  assert.equal(fs.existsSync(outcomePath), false);
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
  assert.equal(result.admitted, 3);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b", "c"]);
  assert.ok(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.candidateId === "b" && entry.code === "MH_OUTCOME_CLAIM_CONFLICT"
  )));
});

test("stale planner output is discarded and a changed Head gets a fresh planning epoch", async (t) => {
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
  assert.equal(plannerRunner.calls(), 3);
  assert.equal(result.plannerRetryCount, 0);
  assert.equal(result.admitted, 1);
  assert.equal(result.stalePlanner, true);
});

test("partial stale admission preserves admitted Claims and replans only from the new Head", async (t) => {
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
  assert.equal(plannerRunner.calls(), result.orchestrationTelemetry.plannerBootCount);
  assert.ok(plannerRunner.calls() >= 3);
  assert.equal(
    new Set(result.orchestrationTelemetry.plannerBoots.map((entry) => entry.headDigest)).size,
    result.orchestrationTelemetry.plannerBootCount,
  );
  assert.equal(result.plannerRetryCount, 0);
  assert.equal(result.admitted, 2);
  assert.equal(result.stalePlanner, true);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b"]);
});

test("planner renders owner objective as instruction and repository workflow as data", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "fastest honest decision-changing evidence");
  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [] });
  const prompt = buildLogicalPlannerPrompt(input);

  assert.match(prompt, /^LOGICAL_PLANNER_AUTODISPATCH_V4/mu);
  assert.ok(prompt.indexOf("OWNER / OPTIMIZATION") < prompt.indexOf("PLANNING LAWS"));
  assert.ok(prompt.indexOf("PLANNING LAWS") < prompt.indexOf("FACTUAL / COMMITMENT DATA"));
  assert.equal((prompt.match(/fastest honest decision-changing evidence/gu) || []).length, 1);
  assert.doesNotMatch(prompt, /"ownerIntent"/u);
  assert.match(prompt, /Capacity is a ceiling, not a quota/u);
  assert.match(prompt, /AGENTS\.md.*repository material/u);
  assert.match(prompt, /\.\.\/snapshot/u);
});

test("planner treats validity constraints as decision-edge data rather than global dispatch priority", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "start useful measurement after the object is frozen");
  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [] });
  const prompt = buildLogicalPlannerPrompt(input);

  assert.match(prompt, /validity constraints lose global priority/iu);
  assert.match(prompt, /highest-value decision-relevant uncertainty reduction action available now/u);
  assert.match(prompt, /measurement scheduler, measurement persistence service/u);
  assert.match(prompt, /bounded blocker set.*remove a named blocker.*now-lawful result read.*terminal kill/iu);
  assert.match(prompt, /stale Next, HOLD, Gate, or handoff prose must not re-expand superseded uncertainty/iu);
  assert.match(prompt, /Governance, packaging, architecture, status, review, or evidence-hardening is inadmissible/iu);
  assert.match(prompt, /continuesFromTransitionDigests.*continuation lineage/iu);
  assert.match(prompt, /Empty proposals is valid only when.*neither an uncovered autonomous continuation obligation/iu);
});

test("objective revision change kills unclaimed candidates but preserves admitted Claims and replans same Head", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "objective revision one");
  const clock = monotonicNow();
  let objectiveChanged = false;
  const now = () => {
    const value = clock();
    if (!objectiveChanged && listActiveOutcomeClaims(root).length === 1) {
      replaceOwnerObjectiveState(root, "objective revision two");
      objectiveChanged = true;
    }
    return value;
  };

  const result = await runRepoWorkWave({
    repositoryPath: root,
    env: { ...process.env, META_HARNESS_REPO_WORK_CONCURRENCY: "2" },
    plannerRunner: planner([candidate("a"), candidate("b")]),
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now,
  });

  assert.equal(objectiveChanged, true);
  assert.equal(result.stalePlanner, true);
  assert.ok(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.code === "MH_OUTCOME_CLAIM_STALE_OBJECTIVE"
  )));
  const sameHeadBoots = result.orchestrationTelemetry.plannerBoots
    .filter((entry) => entry.headDigest === initial.head.headDigest);
  assert.ok(sameHeadBoots.some((entry) => entry.objectiveRevision === 1));
  assert.ok(sameHeadBoots.some((entry) => entry.objectiveRevision === 2));
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b"]);
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
    assert.equal(path.dirname(snapshot.plannerPath), snapshot.parent);
    assert.equal(path.dirname(snapshot.snapshotPath), snapshot.parent);
    assert.notEqual(snapshot.plannerPath, snapshot.snapshotPath);
    assert.equal(fs.existsSync(snapshot.plannerPath), true);
    assert.equal(fs.existsSync(path.join(snapshot.plannerPath, ".git")), false);
    const plannerRelative = path.relative(root, snapshot.plannerPath);
    const snapshotRelative = path.relative(root, snapshot.snapshotPath);
    assert.ok(path.isAbsolute(plannerRelative) || plannerRelative === ".." || plannerRelative.startsWith(`..${path.sep}`));
    assert.ok(path.isAbsolute(snapshotRelative) || snapshotRelative === ".." || snapshotRelative.startsWith(`..${path.sep}`));
  } finally {
    removePlannerSnapshot(root, snapshot);
  }
  assert.equal(git(root, ["status", "--porcelain"]), before);
});

test("planner input projects object maturity and edge-scoped constraint impact without lifecycle state", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const world = {
    ...current.world,
    payload: {
      ...current.world.payload,
      frozenObjectDigest: "object-digest-v1",
      constraints: [{
        id: "source-confidence",
        blocks: ["historical-claim"],
        doesNotBlock: ["measurement"],
        valueOfWaiting: "changes historical confidence decision",
      }],
    },
  };
  const input = compileRepoPlannerInput({
    repositoryPath: root,
    current: { ...current, world, head: initial.head },
    recovered: [],
  });
  assert.deepEqual(input.objectMaturity, {
    frozen: true,
    frozenObjectDigest: "object-digest-v1",
  });
  assert.deepEqual(input.constraintImpact, [{
    id: "source-confidence",
    blocks: ["historical-claim"],
    doesNotBlock: ["measurement"],
    valueOfWaiting: "changes historical confidence decision",
  }]);
});
