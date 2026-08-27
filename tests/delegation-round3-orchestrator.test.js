"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { readDelegationHoldCheckpoint } = require("../lib/delegation-round3-checkpoint");
const { computeDecisionFrontierDigest } = require("../lib/delegation-round3-frontier");
const { latestSurfacedDelegationFrontier } = require("../lib/delegation-round3-gate-record");
const { runDelegationRound3 } = require("../lib/delegation-round3-orchestrator");
const { readOutcome } = require("../lib/outcome");
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
  monotonicNow,
  persistInitial,
  projectionObjects,
  repository,
  transition,
} = require("./helpers/linear-product-head");

test("Round 3 closes DONE, checkpoints+dies HOLD, continues useful lanes, and refills released capacity in one reconciliation", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcomes = ["a", "b", "c", "d"].map((id) => laneOutcome(root, id));
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, outcomes);
  const compact = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") } });
  const cancelled = [];
  const spawned = [];

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: compact }],
    host: {
      cancelLane: async (request) => { cancelled.push(request); },
      spawnDelegation: async (request) => {
        spawned.push(request);
        return { structuredContent: { delegationId: "delegation_refill" } };
      },
    },
    frontierRunner: async ({ input }) => ({
      schemaVersion: "delegation-frontier-candidate/v1",
      laneDecisions: input.liveLanes.map((lane) => ({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
        decision: lane.laneKey === "B" ? "HOLD" : "CONTINUE",
        reason: lane.laneKey === "B"
          ? "B remains relevant but should stop consuming live capacity."
          : "This lane remains positive-value.",
        evidenceRefs: [evidenceRef(input)],
      })),
      newOutcomes: ["e", "f"].map((id) => ({
        ...refillCandidate(id, evidenceRef(input)),
        reason: "A closed lane and one HOLD release two useful slots.",
      })),
      blockers: [],
      gate: {
        kind: "CONTINUE",
        key: "round3-live",
        statement: "Round 3 still has autonomous positive-value lanes.",
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
  assert.equal(spawned.length, 1);
  assert.deepEqual(Object.keys(spawned[0]).sort(), ["baseRef", "lanes", "memory", "repository"]);
  assert.equal(spawned[0].repository, root);
  assert.equal(spawned[0].baseRef, current.head.productCommit);
  assert.equal(spawned[0].memory.gate, "Round 3 still has autonomous positive-value lanes.");
  assert.deepEqual(spawned[0].lanes.map((lane) => lane.taskBrief.allowedPaths), [["src/e"], ["src/f"]]);
  assert.equal(spawned[0].lanes.every((lane) => lane.taskBrief.git.commit === false && lane.taskBrief.git.push === false), true);
  assert.equal(spawned[0].lanes.every((lane) => lane.taskBrief.validation.length > 0), true);
  assert.equal(result.refill.laneCount, 2);
  assert.deepEqual(result.refill.contract.lanes.map((lane) => readOutcome(root, lane.outcomeDigest).id), ["e", "f"]);
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
  const live = snapshot(contract);
  const cancelled = [];
  const frontier = ({ input }) => ({
    schemaVersion: "delegation-frontier-candidate/v1",
    laneDecisions: input.liveLanes.map((lane) => ({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
      decision: "OBSOLETE",
      reason: "Current accepted World makes this lane no longer decision-relevant.",
      evidenceRefs: [evidenceRef(input)],
    })),
    newOutcomes: [],
    blockers: [],
    gate: {
      kind: "FORWARD_GATE",
      key: "round4-eligible",
      statement: "Round 4 activation is eligible.",
      evidenceRefs: [evidenceRef(input)],
      ownerRequest: null,
    },
  });

  const first = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: live }],
    host: { cancelLane: async (request) => { cancelled.push(request); } },
    frontierRunner: async (args) => frontier(args),
    grillRunner: async () => acceptGrill(),
  });
  assert.deepEqual(cancelled, [{ delegationId: "delegation_r3_test", laneKey: "A" }]);
  assert.equal(first.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "OBSOLETE"), true);
  assert.equal(first.surfacedGate?.statement, "Round 4 activation is eligible.");
  assert.match(first.surfacedFrontierRecordDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(latestSurfacedDelegationFrontier(root)?.frontierDigest, first.decisionFrontierDigest);

  const cancelledSnapshot = snapshot(contract, { states: { A: "CANCELLED" } });
  const second = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, delegationId: "delegation_r3_test" }],
    host: { getDelegation: async () => ({ structuredContent: cancelledSnapshot }) },
    frontierRunner: async (args) => frontier(args),
    grillRunner: async () => acceptGrill(),
  });
  assert.equal(second.decisionFrontierDigest, first.decisionFrontierDigest);
  assert.equal(second.surfacedGate, null);
});

test("a useful interrupted lane resumes through the retained delegation substrate", async (t) => {
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
    host: { resumeDelegation: async (request) => { resumed.push(request); } },
    frontierRunner: async ({ input }) => ({
      schemaVersion: "delegation-frontier-candidate/v1",
      laneDecisions: input.liveLanes.map((lane) => ({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
        decision: "CONTINUE",
        reason: "The retained lane remains positive-value despite interruption.",
        evidenceRefs: [evidenceRef(input)],
      })),
      newOutcomes: [],
      blockers: [],
      gate: {
        kind: "CONTINUE",
        key: "resume-current",
        statement: "Autonomous work remains on the retained lane.",
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

test("a Grill replacement, not the pre-Grill proposal, drives lifecycle execution", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "c");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  const compact = snapshot(contract);
  const cancelled = [];

  const result = await runDelegationRound3({
    repositoryPath: root,
    delegations: [{ contract, snapshot: compact }],
    host: { cancelLane: async (request) => { cancelled.push(request); } },
    frontierRunner: async ({ input }) => ({
      schemaVersion: "delegation-frontier-candidate/v1",
      laneDecisions: input.liveLanes.map((lane) => ({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
        decision: "CONTINUE",
        reason: "Initial decomposition still appears useful.",
        evidenceRefs: [evidenceRef(input)],
      })),
      newOutcomes: [],
      blockers: [],
      gate: {
        kind: "CONTINUE",
        key: "initial",
        statement: "Continue the current lane.",
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
          reason: "Grill found the lane no longer decision-relevant.",
        })),
        gate: {
          kind: "FORWARD_GATE",
          key: "next",
          statement: "A new semantic forward gate is ready.",
          evidenceRefs: [evidenceRef(input)],
          ownerRequest: null,
        },
      },
    }),
  });

  assert.deepEqual(cancelled, [{ delegationId: "delegation_r3_test", laneKey: "A" }]);
  assert.equal(result.lifecycleActions.some((entry) => entry.laneKey === "A" && entry.action === "OBSOLETE"), true);
  assert.equal(result.frontier.laneDecisions[0].decision, "OBSOLETE");
  assert.equal(result.surfacedGate?.statement, "A new semantic forward gate is ready.");
  assert.match(computeDecisionFrontierDigest(result.frontier), /^sha256:[a-f0-9]{64}$/u);
});
