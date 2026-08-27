"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyGrill,
  validateDelegationFrontierCandidate,
} = require("../lib/delegation-round3-frontier");
const { refillCandidate } = require("./helpers/delegation-round3");

test("frontier validation treats HOLD/OBSOLETE as released capacity and Grill replacement is authoritative for the action set", () => {
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
    newOutcomes: [{
      ...refillCandidate("replacement", ref),
      reason: "HOLD released one slot.",
    }],
    blockers: [],
    gate: {
      kind: "CONTINUE",
      key: "same-frontier",
      statement: "Autonomous delegation still has positive-value work.",
      evidenceRefs: [ref],
      ownerRequest: null,
    },
  };
  const options = { liveLanes, availableSlots: 0, knownEvidenceRefs: new Set([ref]) };
  const validated = validateDelegationFrontierCandidate(proposed, options);
  assert.equal(validated.newOutcomes.length, 1);

  const replacement = {
    ...proposed,
    laneDecisions: proposed.laneDecisions.map((entry) => ({ ...entry, decision: "OBSOLETE" })),
    newOutcomes: [],
    gate: {
      kind: "FORWARD_GATE",
      key: "round4",
      statement: "Round 4 activation is now the forward gate.",
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
});
