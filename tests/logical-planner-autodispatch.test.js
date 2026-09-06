"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { renderHuman } = require("../lib/commands/work");
const { replaceOwnerObjectiveState } = require("../lib/owner-objective-state");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { createOutcome, readOutcome } = require("../lib/outcome");
const { buildLogicalPlannerPrompt, createPlannerSnapshot, removePlannerSnapshot } = require("../lib/repo-logical-planner");
const {
  admitPreparedPlannerCandidate,
  preparePlannerCandidate,
} = require("../lib/repo-planner-admission");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { commonGitDirectory } = require("../lib/work-git");
const { listRunSessions } = require("../lib/run-journal");
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
  const landed = result.outcomes.filter((entry) => entry.state === "LANDED");
  assert.equal(landed.length, 1);
  assert.equal(landed[0].desiredState, readOutcome(root, landed[0].outcomeDigest).desiredState);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("autonomous REPLAN handoff dispatches a linked successor in the same work invocation", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");

  let handoffDigest = null;
  let successorRun = null;
  let successorStarts = 0;
  const baseRunner = runner();
  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async ({ plannerInput }) => {
      const handoff = plannerInput.unresolvedHandoffs.find((entry) => entry.disposition === "REPLAN_REQUIRED");
      if (handoff && handoffDigest === null) {
        handoffDigest = handoff.transitionDigest;
        assert.deepEqual(handoff.activeContinuationOutcomeDigests, []);
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
      successorRun = args.session;
      assert.equal(successorRun.origin.type, "REPO_RUN");
      assert.deepEqual(successorRun.origin.continuesFromTransitionDigests, [handoffDigest]);
      return baseRunner(args);
    },
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.match(handoffDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(successorRun.sessionDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(successorStarts, 1);
  assert.equal(result.admitted, 1);
  assert.equal(result.outcome, "USE_PRODUCT");
  assert.equal(result.endgameCoverage.complete, true);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("empty planner frontier preserves an uncovered autonomous REPLAN handoff as visible work", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");
  let sawAutonomousHandoff = false;

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async ({ plannerInput }) => {
      sawAutonomousHandoff = sawAutonomousHandoff || plannerInput.unresolvedHandoffs.some((entry) => (
        entry.disposition === "REPLAN_REQUIRED" && entry.activeContinuationOutcomeDigests.length === 0
      ));
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } };
    },
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(sawAutonomousHandoff, true);
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.endgameCoverage, null);
});

test("empty planner frontier cannot USE_PRODUCT an uncovered autonomous REPLAN without required destinations", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: async () => ({ batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } }),
    runner: runner(),
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.endgameCoverage, null);
});

test("concurrent run admission covers a planner-snapshot handoff without false forward-progress failure", async (t) => {
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
        assert.equal(admittedDuringPlanner.session.origin.type, "REPO_RUN");
        assert.deepEqual(admittedDuringPlanner.session.origin.continuesFromTransitionDigests, [handoff.transitionDigest]);
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

test("one autonomous transition can provenance multiple parallel successor runs", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");
  await seedAutonomousReplan(root, "a");
  let handoffDigest = null;
  let sent = false;
  const linkedRuns = [];
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
      linkedRuns.push(args.session);
      return baseRunner(args);
    },
    interpret: require("./helpers/linear-product-head").fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.admitted, 2);
  assert.equal(linkedRuns.length, 2);
  assert.ok(linkedRuns.every((session) => session.origin.type === "REPO_RUN"
    && JSON.stringify(session.origin.continuesFromTransitionDigests) === JSON.stringify([handoffDigest])));
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

test("existing commitments do not globally gate a fresh planner batch; local execution bound schedules the work", async (t) => {
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
  assert.equal(result.admitted, 2);
  assert.equal(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.code === "MH_OUTCOME_CLAIM_CAPACITY"
  )), false);
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("overlapping predicted planner footprints can coexist as speculative work", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const admittedA = preparePlannerCandidate(root, current, candidate("a", ["src/a"], root));
  const first = admitPreparedPlannerCandidate(root, current, admittedA);

  const overlapping = candidate("b", ["src/a/nested"], root);
  const prospective = createOutcome({
    id: overlapping.id,
    desiredState: overlapping.productResult,
    preconditions: [overlapping.journeyState],
    evidenceRequirement: overlapping.doneWhen,
  });
  const preparedB = preparePlannerCandidate(root, current, overlapping);
  const second = admitPreparedPlannerCandidate(root, current, preparedB);
  assert.notEqual(second.session.sessionDigest, first.session.sessionDigest);
  assert.deepEqual(second.session.allowedPaths, ["src/a/nested"]);
  assert.equal(readOutcome(root, prospective.outcomeDigest).outcomeDigest, prospective.outcomeDigest);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
});

test("overlapping predicted footprints do not reject useful work before real integration", async (t) => {
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
  assert.equal(result.orchestrationTelemetry.candidateRejections.some((entry) => (
    entry.candidateId === "b" && entry.code === "MH_OUTCOME_CLAIM_CONFLICT"
  )), false);
});

test("planner output from an immutable snapshot remains admissible after Head advances", async (t) => {
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
  assert.equal(result.stalePlanner, false);
});

test("all candidates from one immutable planner snapshot remain admissible while Head advances", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const clock = monotonicNow();
  let advanced = false;
  const now = () => {
    const value = clock();
    if (!advanced && listRunSessions({ gitCommonDirectory: commonGitDirectory(root) })
      .filter((session) => session.origin.type === "REPO_RUN").length === 1) {
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
  assert.equal(result.stalePlanner, false);
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
  assert.ok(prompt.indexOf("PRODUCT / OPTIMIZATION") < prompt.indexOf("PLANNING RULES"));
  assert.ok(prompt.indexOf("PLANNING RULES") < prompt.indexOf("CURRENT PRODUCT STATE"));
  assert.equal((prompt.match(/fastest honest decision-changing evidence/gu) || []).length, 1);
  assert.doesNotMatch(prompt, /"ownerIntent"/u);
  assert.doesNotMatch(prompt, /claimDigest|grantedWritePaths|activeContinuationClaimDigests|capacity|execution authority|workspace custody|constitutional/iu);
  assert.match(prompt, /AGENTS text.*repository data/u);
  assert.match(prompt, /\.\.\/snapshot/u);
});

test("planner treats validity constraints as decision-edge data rather than global dispatch priority", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "start useful measurement after the object is frozen");
  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [] });
  const prompt = buildLogicalPlannerPrompt(input);

  assert.match(prompt, /Constraints are edge-scoped observations/iu);
  assert.match(prompt, /highest-value uncertainty reduction available now/u);
  assert.match(prompt, /measurement infrastructure for its own sake/u);
  assert.match(prompt, /bounded blocker set.*removes a named blocker.*now-available result read.*specific route has no value/iu);
  assert.match(prompt, /Stale process prose must not re-expand uncertainty/iu);
  assert.match(prompt, /review, audit, documentation, cleanup, architecture, status, packaging, or control-plane Outcomes/iu);
  assert.match(prompt, /continuesFromTransitionDigests.*continuation lineage/iu);
  assert.match(prompt, /Empty proposals is valid only when.*neither an uncovered autonomous continuation/iu);
});

test("objective revision change kills unadmitted candidates but preserves admitted runs and replans same Head", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  replaceOwnerObjectiveState(root, "objective revision one");
  const clock = monotonicNow();
  let objectiveChanged = false;
  const now = () => {
    const value = clock();
    if (!objectiveChanged && listRunSessions({ gitCommonDirectory: commonGitDirectory(root) })
      .filter((session) => session.origin.type === "REPO_RUN").length === 1) {
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
    entry.code === "MH_OWNER_OBJECTIVE_STALE"
  )));
  const sameHeadBoots = result.orchestrationTelemetry.plannerBoots
    .filter((entry) => entry.headDigest === initial.head.headDigest);
  assert.ok(sameHeadBoots.some((entry) => entry.objectiveRevision === 1));
  assert.ok(sameHeadBoots.some((entry) => entry.objectiveRevision === 2));
  assert.deepEqual([...readCurrentWorldState(root).world.payload.learned].sort(), ["a", "b"]);
});

test("planner failure before run admission leaves no execution and a fresh invocation can recompute", async (t) => {
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
