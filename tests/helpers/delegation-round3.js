"use strict";

const { compileDelegationRound2Contract } = require("../../lib/delegation-round2-contract");
const { createOutcome, persistOutcome } = require("../../lib/outcome");

function laneOutcome(root, id) {
  return persistOutcome(root, createOutcome({
    id,
    desiredState: `Delegated outcome ${id} is acceptance-ready.`,
    preconditions: [`Delegated outcome ${id} is not yet acceptance-ready.`],
    evidenceRequirement: `Evidence ${id} proves the delegated outcome.`,
  }));
}

function resultCard(lane, letter = "a", submittedAt = "2026-08-27T17:00:00.000Z") {
  const evidenceRef = `${lane.laneKey}-proof`;
  return {
    schemaVersion: "lane-result-card/v1",
    resultDigest: `sha256:${letter.repeat(64)}`,
    taskOutcome: "DONE",
    claim: `${lane.laneKey} became acceptance-ready.`,
    criteria: lane.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      verdict: "PASS",
      evidenceRefs: [evidenceRef],
    })),
    evidenceIndex: [{ ref: evidenceRef, summary: `Compact proof for ${lane.laneKey}.` }],
    worldDelta: [{ fact: `${lane.laneKey} is now learned by World.`, evidenceRefs: [evidenceRef] }],
    remainingUncertainty: [],
    recommendedHandoff: null,
    submittedAt,
  };
}

function snapshot(contract, {
  delegationId = "delegation_r3_test",
  states = {},
  results = {},
} = {}) {
  return {
    slice: "DELEGATION-R2",
    delegationId,
    contextDigest: contract.devspaceContextDigest,
    lanes: contract.lanes.map((lane, index) => ({
      laneKey: lane.laneKey,
      taskId: `task_${lane.laneKey}`,
      workspaceId: `ws_${lane.laneKey}`,
      objective: lane.objective,
      acceptanceCriteria: lane.acceptanceCriteria.map((criterion) => ({ ...criterion })),
      status: states[lane.laneKey] || "LAUNCHED",
      laneBriefDigest: `sha256:${String(index + 1).repeat(64)}`,
      bootPromptDigest: `sha256:${String(index + 5).repeat(64)}`,
      result: results[lane.laneKey] || null,
    })),
  };
}

function contractFor(root, current, outcomes, gate = "Round 3 autonomous delegation remains active.", laneKeys = null) {
  return compileDelegationRound2Contract({
    repositoryPath: root,
    current,
    recovered: [],
    gate,
    lanes: outcomes.map((outcome, index) => ({
      laneKey: laneKeys?.[index] || String.fromCharCode(65 + index),
      outcomeDigest: outcome.outcomeDigest,
    })),
  });
}

function evidenceRef(input) {
  return input.world.head.headDigest;
}

function refillCandidate(id, ref) {
  return {
    id,
    desiredState: `Delegated outcome ${id} is acceptance-ready.`,
    preconditions: [`Delegated outcome ${id} is not yet acceptance-ready.`],
    evidenceRequirement: `Evidence ${id} proves the delegated outcome.`,
    journeyState: `Delegated outcome ${id} still needs implementation.`,
    doNow: `Implement delegated outcome ${id} inside its predicted path.`,
    stopOnlyIf: ["The controller-proven write boundary or validation authority is insufficient."],
    expectedWritePaths: [`src/${id}`],
    reason: "Released capacity has a positive-value successor.",
    evidenceRefs: [ref],
  };
}

function acceptGrill() {
  return {
    schemaVersion: "delegation-grill-candidate/v1",
    verdict: "ACCEPT",
    challenge: "The proposed frontier follows from current accepted World and does not add orchestration machinery.",
    replacement: null,
  };
}

module.exports = {
  acceptGrill,
  contractFor,
  evidenceRef,
  refillCandidate,
  laneOutcome,
  resultCard,
  snapshot,
};
