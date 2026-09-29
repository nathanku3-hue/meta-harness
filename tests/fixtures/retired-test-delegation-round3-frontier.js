"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyGrill,
  validateDelegationFrontierCandidate,
} = require("../lib/delegation-round3-frontier");
const { refillCandidate } = require("./helpers/delegation-round3");

function fixture() {
  const ref = `sha256:${"1".repeat(64)}`;
  const liveLanes = ["A", "B", "C", "D"].map((laneKey, index) => ({
    delegationId: "d",
    laneKey,
    outcomeDigest: `sha256:${String(index + 2).repeat(64)}`,
    objective: `Objective ${laneKey}`,
    acceptanceCriteria: [{ id: "desired-state", text: `Objective ${laneKey}` }],
  }));
  const proposed = {
    schemaVersion: "delegation-frontier-candidate/v1",
    laneDecisions: liveLanes.map((lane) => ({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
      decision: lane.laneKey === "A" ? "HOLD" : "CONTINUE",
      reason: "Current accepted World determines this lifecycle action.",
      evidenceRefs: [ref],
    })),
    newOutcomes: [],
    blockers: [],
    gate: {
      kind: "CONTINUE",
      key: "same-frontier",
      statement: "Autonomous delegation still has positive-value retained work.",
      evidenceRefs: [ref],
      ownerRequest: null,
    },
  };
  return { ref, liveLanes, proposed, options: { liveLanes, knownEvidenceRefs: new Set([ref]) } };
}

test("Round 3 is lifecycle-only and Grill replacement remains authoritative for retained lanes", () => {
  const { ref, proposed, options } = fixture();
  const validated = validateDelegationFrontierCandidate(proposed, options);
  assert.deepEqual(validated.newOutcomes, []);

  const replacement = {
    ...proposed,
    laneDecisions: proposed.laneDecisions.map((entry) => ({ ...entry, decision: "OBSOLETE" })),
    gate: {
      kind: "FORWARD_GATE",
      key: "fresh-planner-authority",
      statement: "Retained delegation work is exhausted; fresh work belongs to the repository planner.",
      evidenceRefs: [ref],
      ownerRequest: null,
    },
  };
  const grilled = applyGrill(validated, {
    schemaVersion: "delegation-grill-candidate/v1",
    verdict: "REPLACE",
    challenge: "The live decomposition is obsolete after the accepted World change.",
    replacement,
  }, options);
  assert.equal(grilled.gate.kind, "FORWARD_GATE");
  assert.equal(grilled.laneDecisions.every((entry) => entry.decision === "OBSOLETE"), true);
  assert.deepEqual(grilled.newOutcomes, []);
});

test("released Round-3 capacity cannot mint a fresh coding Outcome", () => {
  const { ref, proposed, options } = fixture();
  assert.throws(
    () => validateDelegationFrontierCandidate({
      ...proposed,
      newOutcomes: [{
        ...refillCandidate("replacement", ref),
        reason: "HOLD released one slot, but Round 3 must not reuse it for fresh coding authority.",
      }],
    }, options),
    (error) => error?.code === "MH_DELEGATION_R3_FRESH_WORK_AUTHORITY",
  );
});
