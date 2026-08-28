"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { renderHuman } = require("../lib/commands/work");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const {
  acceptGrill,
  contractFor,
  evidenceRef,
  laneOutcome,
  resultCard,
  snapshot,
} = require("./helpers/delegation-round3");
const {
  fakeInterpretation,
  monotonicNow,
  persistInitial,
  repository,
} = require("./helpers/linear-product-head");

function frontierFor(input) {
  const live = input.liveLanes.length > 0;
  return {
    schemaVersion: "delegation-frontier-candidate/v1",
    laneDecisions: input.liveLanes.map((lane) => ({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
      decision: "CONTINUE",
      reason: "The retained evidence lane is still positive-value.",
      evidenceRefs: [evidenceRef(input)],
    })),
    newOutcomes: [],
    blockers: [],
    gate: {
      kind: live ? "CONTINUE" : "FORWARD_GATE",
      key: live ? "evidence-still-running" : "delegation-evidence-complete",
      statement: live
        ? "Retained delegation evidence is still running."
        : "Delegation evidence is accepted; fresh coding remains on the repository planner path.",
      evidenceRefs: [evidenceRef(input)],
      ownerRequest: null,
    },
  };
}

test("one repo-work invocation waits for compact lane change and surfaces the material gate", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "round4-evidence");
  const current = require("../lib/world-transition").readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome], "Retain evidence until it becomes decision-relevant.");
  let currentSnapshot = snapshot(contract);
  let frontierCalls = 0;
  let getCalls = 0;

  const resultTimer = setTimeout(() => {
    currentSnapshot = snapshot(contract, {
      results: { A: resultCard(contract.lanes[0], "d") },
    });
  }, 20);
  t.after(() => clearTimeout(resultTimer));

  const result = await runRepoWorkWave({
    repositoryPath: root,
    delegationPollIntervalMs: 1,
    delegationRound3: {
      delegations: [{ contract, snapshot: currentSnapshot }],
      gate: "Retain evidence until it becomes decision-relevant.",
      host: {
        getDelegation: async ({ delegationId }) => {
          getCalls += 1;
          assert.equal(delegationId, currentSnapshot.delegationId);
          return { structuredContent: currentSnapshot };
        },
      },
      frontierRunner: async ({ input }) => {
        frontierCalls += 1;
        return frontierFor(input);
      },
      grillRunner: async () => acceptGrill(),
      interpret: fakeInterpretation,
      now: monotonicNow(),
    },
    plannerRunner: async () => ({
      batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] },
    }),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  assert.equal(result.delegationGate?.key, "delegation-evidence-complete");
  assert.equal(result.outcomes.length, 0);
  assert.ok(getCalls >= 3);
  assert.ok(frontierCalls <= 3, `frontier planner reran without a semantic event: ${frontierCalls}`);
  let output = "";
  renderHuman({ stdout: { write: (text) => { output += String(text); } } }, result);
  assert.equal(
    output,
    "Next: Delegation evidence is accepted; fresh coding remains on the repository planner path.\n",
  );
});

test("controlled drain interrupts the active delegation wait without durable poll state", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "round4-drain");
  const current = require("../lib/world-transition").readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome], "Retained evidence is still running.");
  const live = snapshot(contract);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  t.after(() => clearTimeout(timer));

  const result = await runRepoWorkWave({
    repositoryPath: root,
    signal: controller.signal,
    delegationPollIntervalMs: 1,
    delegationRound3: {
      delegations: [{ contract, snapshot: live }],
      gate: "Retained evidence is still running.",
      host: {
        getDelegation: async () => ({ structuredContent: live }),
      },
      frontierRunner: async ({ input }) => frontierFor(input),
      grillRunner: async () => acceptGrill(),
      interpret: fakeInterpretation,
      now: monotonicNow(),
    },
    plannerRunner: async () => ({
      batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] },
    }),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  assert.deepEqual(result, { control: "DRAIN_COMPLETE" });
});
