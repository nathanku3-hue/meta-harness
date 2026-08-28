"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { renderHuman } = require("../lib/commands/work");
const { readDelegationHoldCheckpoint } = require("../lib/delegation-round3-checkpoint");
const { computeDecisionFrontierDigest } = require("../lib/delegation-round3-frontier");
const { latestSurfacedDelegationFrontier } = require("../lib/delegation-round3-gate-record");
const { runDelegationRound3 } = require("../lib/delegation-round3-orchestrator");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { commitTransition, readCurrentWorldState } = require("../lib/world-transition");
const {
  acceptGrill,
  contractFor,
  evidenceRef,
  refillCandidate,
  laneOutcome,
  resultCard,
  snapshot,
} = require("./helpers/delegation-round3");
const {
  fakeInterpretation,
  legacySession,
  monotonicNow,
  persistInitial,
  projectionObjects,
  repository,
  transition,
} = require("./helpers/linear-product-head");

function hostFor(getSnapshot, overrides = {}) {
  return {
    getDelegation: async ({ delegationId }) => {
      const current = getSnapshot();
      assert.equal(current.delegationId, delegationId);
      return { structuredContent: current };
    },
    ...overrides,
  };
}

function lifecycleFrontier({ input, decisions, gate }) {
  return {
    schemaVersion: "delegation-frontier-candidate/v1",
    laneDecisions: input.liveLanes.map((lane) => ({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
      decision: decisions(lane),
      reason: "Current accepted World determines this retained-lane lifecycle action.",
      evidenceRefs: [evidenceRef(input)],
    })),
    newOutcomes: [],
    blockers: [],
    gate,
  };
}

test("Round 3 closes evidence DONE, checkpoints+kills HOLD, continues useful lanes, and never refills coding work", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcomes = ["a", "b", "c", "d"].map((id) => laneOutcome(root, id));
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, outcomes);
  let currentSnapshot = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") } });
  const cancelled = [];
  let spawnCalls = 0;

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: currentSnapshot }],
    host: hostFor(() => currentSnapshot, {
      cancelLane: async (request) => {
        cancelled.push(request);
        currentSnapshot = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") }, states: { B: "CANCELLED" } });
      },
      spawnDelegation: async () => { spawnCalls += 1; },
    }),
    frontierRunner: async ({ input }) => lifecycleFrontier({
      input,
      decisions: (lane) => lane.laneKey === "B" ? "HOLD" : "CONTINUE",
      gate: {
        kind: "CONTINUE",
        key: "round3-live",
        statement: "Round 3 still has positive-value retained evidence lanes.",
        evidenceRefs: [evidenceRef(input)],
        ownerRequest: null,
      },
    }),
    grillRunner: async () => acceptGrill(),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.landings.length, 1);
  assert.equal(result.landings[0].laneKey, "A");
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "CLOSE"), true);
  const hold = result.lifecycleActions.find((entry) => entry.laneKey === "B" && entry.action === "HOLD");
  assert.ok(hold?.checkpointDigest);
  const checkpoint = readDelegationHoldCheckpoint(root, hold.checkpointDigest);
  assert.equal(checkpoint.taskId, "task_B");
  assert.equal(checkpoint.workspaceId, "ws_B");
  assert.deepEqual(cancelled, [{ delegationId: "delegation_r3_test", laneKey: "B" }]);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "C" && entry.action === "CONTINUE"), true);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "D" && entry.action === "CONTINUE"), true);
  assert.equal(spawnCalls, 0);
  assert.equal(result.refill, null);
  assert.equal(result.grillRuns, 1);
  assert.equal(result.surfacedGate, null);
  const after = readCurrentWorldState(root);
  assert.deepEqual(after.world.payload.learned, ["a"]);
  assert.equal(after.head.productCommit, current.head.productCommit);
});

test("obsolete lanes are killed and an unchanged semantic forward gate is not surfaced twice", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "b");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome], "Round 3 is still the current gate.");
  let currentSnapshot = snapshot(contract);
  const cancelled = [];
  const frontier = ({ input }) => lifecycleFrontier({
    input,
    decisions: () => "OBSOLETE",
    gate: {
      kind: "FORWARD_GATE",
      key: "fresh-planner-authority",
      statement: "Retained delegation work is exhausted; fresh work belongs to the repository planner.",
      evidenceRefs: [evidenceRef(input)],
      ownerRequest: null,
    },
  });

  const first = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: currentSnapshot }],
    host: hostFor(() => currentSnapshot, {
      cancelLane: async (request) => {
        cancelled.push(request);
        currentSnapshot = snapshot(contract, { states: { A: "CANCELLED" } });
      },
    }),
    frontierRunner: async (args) => frontier(args),
    grillRunner: async () => acceptGrill(),
  });
  assert.deepEqual(cancelled, [{ delegationId: "delegation_r3_test", laneKey: "A" }]);
  assert.equal(first.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "OBSOLETE"), true);
  assert.equal(first.surfacedGate?.key, "fresh-planner-authority");
  assert.match(first.surfacedFrontierRecordDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(latestSurfacedDelegationFrontier(root)?.frontierDigest, first.decisionFrontierDigest);

  const second = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, delegationId: "delegation_r3_test" }],
    host: hostFor(() => currentSnapshot),
    frontierRunner: async (args) => frontier(args),
    grillRunner: async () => acceptGrill(),
  });
  assert.equal(second.decisionFrontierDigest, first.decisionFrontierDigest);
  assert.equal(second.surfacedGate, null);
});

test("a useful interrupted lane resumes only after a fresh host-state comparison", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "a");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  const interrupted = snapshot(contract, { states: { A: "INTERRUPTED" } });
  const resumed = [];

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: interrupted }],
    host: hostFor(() => interrupted, { resumeDelegation: async (request) => { resumed.push(request); } }),
    frontierRunner: async ({ input }) => lifecycleFrontier({
      input,
      decisions: () => "CONTINUE",
      gate: {
        kind: "CONTINUE",
        key: "resume-current",
        statement: "Autonomous evidence work remains on the retained lane.",
        evidenceRefs: [evidenceRef(input)],
        ownerRequest: null,
      },
    }),
    grillRunner: async () => acceptGrill(),
  });

  assert.deepEqual(resumed, [{ delegationId: "delegation_r3_test" }]);
  assert.equal(result.lifecycleActions.some((entry) => entry.action === "RESUME"), true);
  assert.equal(result.refill, null);
  assert.equal(result.surfacedGate, null);
});

test("pre-fix writable code lanes cannot continue through Round-3 lifecycle authority", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "legacy-live-code");
  const current = readCurrentWorldState(root);
  const legacyLaneKey = `r3-1-${outcome.outcomeDigest.slice(-10)}`;
  const contract = contractFor(
    root,
    current,
    [outcome],
    "Legacy coding delegation must return to controller authority.",
    [legacyLaneKey],
  );
  const compact = snapshot(contract);
  let frontierCalls = 0;
  let resumeCalls = 0;

  await assert.rejects(
    runDelegationRound3({
      repositoryPath: root,
      delegations: [{ contract, snapshot: compact }],
      host: hostFor(() => compact, { resumeDelegation: async () => { resumeCalls += 1; } }),
      frontierRunner: async () => {
        frontierCalls += 1;
        throw new Error("legacy writable code must fail before frontier planning");
      },
      grillRunner: async () => acceptGrill(),
    }),
    (error) => error?.code === "MH_DELEGATION_R3_CODE_AUTHORITY"
      && error?.details?.legacyWritableRefill === true,
  );
  assert.equal(frontierCalls, 0);
  assert.equal(resumeCalls, 0);
});

test("frontier planning retries against a newer World before any stale lifecycle action can run", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  let frontierCalls = 0;

  const result = await runDelegationRound3({
    repositoryPath: root,
    gate: "Current semantic gate.",
    frontierRunner: async ({ input }) => {
      frontierCalls += 1;
      if (frontierCalls === 1) {
        const current = readCurrentWorldState(root);
        const successor = projectionObjects(root, { ...current.world.payload, concurrentRevision: 2 });
        commitTransition(root, transition(root, current.head.headDigest, successor));
      }
      return {
        schemaVersion: "delegation-frontier-candidate/v1",
        laneDecisions: [],
        newOutcomes: [],
        blockers: [],
        gate: {
          kind: "FORWARD_GATE",
          key: "stable-current-world",
          statement: "The next semantic gate follows from the newest World.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      };
    },
    grillRunner: async () => acceptGrill(),
  });

  assert.equal(frontierCalls, 2);
  assert.equal(result.grillRuns, 2);
  assert.equal(result.worldHeadDigest, readCurrentWorldState(root).head.headDigest);
  assert.equal(result.surfacedGate?.key, "stable-current-world");
});

test("a lane result submitted during Grill invalidates stale OBSOLETE before host lifecycle action", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "a");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  let currentSnapshot = snapshot(contract);
  let frontierCalls = 0;
  let grillCalls = 0;
  const cancelled = [];

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: currentSnapshot }],
    host: hostFor(() => currentSnapshot, { cancelLane: async (request) => { cancelled.push(request); } }),
    frontierRunner: async ({ input }) => {
      frontierCalls += 1;
      return lifecycleFrontier({
        input,
        decisions: () => "OBSOLETE",
        gate: {
          kind: "FORWARD_GATE",
          key: "fresh-after-result",
          statement: "No retained lane remains after accepting the fresh result.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      });
    },
    grillRunner: async () => {
      grillCalls += 1;
      if (grillCalls === 1) {
        currentSnapshot = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") } });
      }
      return acceptGrill();
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(frontierCalls, 2);
  assert.equal(grillCalls, 2);
  assert.deepEqual(cancelled, []);
  assert.equal(result.landings.length, 1);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "OBSOLETE"), false);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "CLOSE"), true);
  assert.deepEqual(readCurrentWorldState(root).world.payload.learned, ["a"]);
});

test("a Grill replacement, not the pre-Grill proposal, drives lifecycle execution", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "c");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  let compact = snapshot(contract);
  const cancelled = [];

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: compact }],
    host: hostFor(() => compact, {
      cancelLane: async (request) => {
        cancelled.push(request);
        compact = snapshot(contract, { states: { A: "CANCELLED" } });
      },
    }),
    frontierRunner: async ({ input }) => lifecycleFrontier({
      input,
      decisions: () => "CONTINUE",
      gate: {
        kind: "CONTINUE",
        key: "initial",
        statement: "Continue the current retained lane.",
        evidenceRefs: [evidenceRef(input)],
        ownerRequest: null,
      },
    }),
    grillRunner: async ({ input, frontier }) => ({
      schemaVersion: "delegation-grill-candidate/v1",
      verdict: "REPLACE",
      challenge: "The current World already makes that decomposition obsolete.",
      replacement: {
        ...frontier,
        laneDecisions: frontier.laneDecisions.map((entry) => ({
          ...entry,
          decision: "OBSOLETE",
          reason: "Grill found the retained lane no longer decision-relevant.",
        })),
        gate: {
          kind: "FORWARD_GATE",
          key: "next",
          statement: "Retained delegation work is exhausted.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      },
    }),
  });

  assert.deepEqual(cancelled, [{ delegationId: "delegation_r3_test", laneKey: "A" }]);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "OBSOLETE"), true);
  assert.equal(result.frontier.laneDecisions[0].decision, "OBSOLETE");
  assert.equal(result.surfacedGate?.statement, "Retained delegation work is exhausted.");
  assert.match(computeDecisionFrontierDigest(result.frontier), /^sha256:[a-f0-9]{64}$/u);
});

test("three active Claims plus a Round-3 coding proposal creates zero delegated code lanes", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  for (const id of ["a", "b", "c"]) {
    const outcome = laneOutcome(root, `claim-${id}`);
    legacySession(root, outcome, current.head.headDigest, id);
  }
  assert.equal(listActiveOutcomeClaims(root).length, 3);
  let spawnCalls = 0;

  await assert.rejects(
    runDelegationRound3({
      repositoryPath: root,
      gate: "Retained evidence lanes are reconciled before fresh work.",
      host: { spawnDelegation: async () => { spawnCalls += 1; } },
      frontierRunner: async ({ input }) => ({
        schemaVersion: "delegation-frontier-candidate/v1",
        laneDecisions: [],
        newOutcomes: [refillCandidate("fresh-code", evidenceRef(input))],
        blockers: [],
        gate: {
          kind: "CONTINUE",
          key: "invalid-fresh-code",
          statement: "This invalid frontier attempts to mint fresh coding authority.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      }),
      grillRunner: async () => acceptGrill(),
    }),
    (error) => error?.code === "MH_DELEGATION_R3_FRESH_WORK_AUTHORITY",
  );
  assert.equal(spawnCalls, 0);
  assert.equal(listActiveOutcomeClaims(root).length, 3);
});

test("an overlapping Round-3 write prediction is rejected before any host dispatch", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const outcome = laneOutcome(root, "claimed-a");
  legacySession(root, outcome, current.head.headDigest, "a");
  let spawnCalls = 0;

  await assert.rejects(
    runDelegationRound3({
      repositoryPath: root,
      gate: "Retained evidence lanes are reconciled before fresh work.",
      host: { spawnDelegation: async () => { spawnCalls += 1; } },
      frontierRunner: async ({ input }) => ({
        schemaVersion: "delegation-frontier-candidate/v1",
        laneDecisions: [],
        newOutcomes: [{ ...refillCandidate("overlap", evidenceRef(input)), expectedWritePaths: ["src/a"] }],
        blockers: [],
        gate: {
          kind: "CONTINUE",
          key: "invalid-overlap",
          statement: "This invalid frontier attempts to bypass Claim overlap authority.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      }),
      grillRunner: async () => acceptGrill(),
    }),
    (error) => error?.code === "MH_DELEGATION_R3_FRESH_WORK_AUTHORITY",
  );
  assert.equal(spawnCalls, 0);
  assert.equal(listActiveOutcomeClaims(root).length, 1);
});

test("repo work production reconciliation consumes Round 3 and surfaces only its still-current material gate", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  let round3PlannerCalls = 0;
  const result = await runRepoWorkWave({
    repositoryPath: root,
    delegationRound3: {
      gate: "Current retained-delegation gate.",
      frontierRunner: async ({ input }) => {
        round3PlannerCalls += 1;
        return {
          schemaVersion: "delegation-frontier-candidate/v1",
          laneDecisions: [],
          newOutcomes: [],
          blockers: [],
          gate: {
            kind: "FORWARD_GATE",
            key: "material-next-gate",
            statement: "Retained delegation is exhausted; the repository planner owns any fresh work.",
            evidenceRefs: [evidenceRef(input)],
            ownerRequest: null,
          },
        };
      },
      grillRunner: async () => acceptGrill(),
    },
    plannerRunner: async () => ({ batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } }),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(round3PlannerCalls, 1);
  assert.equal(result.delegationGate?.key, "material-next-gate");
  let output = "";
  renderHuman({ stdout: { write: (text) => { output += String(text); } } }, result);
  assert.equal(output, "Next: Retained delegation is exhausted; the repository planner owns any fresh work.\n");
});
