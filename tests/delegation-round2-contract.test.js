"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  acceptDelegationRound2FanIn,
  compileDelegationEvidenceRequest,
  compileDelegationRound2Contract,
  validateDelegationEvidenceResponse,
  validateDelegationRound2Contract,
} = require("../lib/delegation-round2-contract");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  createOutcome,
  persistInitial,
  persistOutcome,
  repository,
} = require("./helpers/linear-product-head");

function laneOutcome(root, id, state, evidence) {
  return persistOutcome(root, createOutcome({
    id,
    desiredState: state,
    preconditions: [`${id} has not yet become true.`],
    evidenceRequirement: evidence,
  }));
}

function fixture(t) {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const a = laneOutcome(root, "lane-a", "A user can complete lane A.", "A-proof demonstrates lane A behavior.");
  const b = laneOutcome(root, "lane-b", "A user can complete lane B.", "B-proof demonstrates lane B behavior.");
  const current = readCurrentWorldState(root);
  const contract = compileDelegationRound2Contract({
    repositoryPath: root,
    current,
    recovered: [],
    gate: "Round 2 is complete when both independent outcomes are acceptance-readable without child transcripts.",
    lanes: [
      { laneKey: "A", outcomeDigest: a.outcomeDigest },
      { laneKey: "B", outcomeDigest: b.outcomeDigest },
    ],
  });
  return { root, current, a, b, contract };
}

function resultCard(lane, { verdict = "PASS", evidenceRef = "proof", uncertainty = [] } = {}) {
  return {
    schemaVersion: "lane-result-card/v1",
    resultDigest: `sha256:${lane.laneKey === "A" ? "a" : "b"}`.padEnd(71, lane.laneKey === "A" ? "a" : "b"),
    taskOutcome: "DONE",
    claim: `${lane.laneKey} returned compact acceptance evidence.`,
    criteria: lane.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      verdict,
      evidenceRefs: [evidenceRef],
    })),
    evidenceIndex: [{ ref: evidenceRef, summary: `${lane.laneKey} compact proof summary.` }],
    worldDelta: [{ fact: `${lane.laneKey} may update World after normal interpretation.`, evidenceRefs: [evidenceRef] }],
    remainingUncertainty: uncertainty,
    recommendedHandoff: verdict === "UNKNOWN" ? `Inspect ${evidenceRef}.` : null,
    submittedAt: "2026-08-27T12:00:00.000Z",
  };
}

function compactSnapshot(contract) {
  return {
    slice: "DELEGATION-R2",
    delegationId: "delegation_contract_test",
    repository: "E:/Code/example",
    baseSha: "1".repeat(40),
    contextDigest: contract.devspaceContextDigest,
    status: "ACTIVE",
    createdAt: "2026-08-27T11:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
    fanIn: { submitted: 2, pending: 0, cancelled: 0, complete: true },
    lanes: contract.lanes.map((lane, index) => ({
      laneKey: lane.laneKey,
      status: "LAUNCHED",
      bootAttempts: 1,
      taskId: `task_${lane.laneKey}`,
      taskDigest: `sha256:${String(index + 1).repeat(64)}`,
      workspaceId: `ws_${lane.laneKey}`,
      workspaceRoot: `E:/Code/example/.worktrees/${lane.laneKey}`,
      taskOutcome: "DONE",
      laneBriefDigest: `sha256:${String(index + 3).repeat(64)}`,
      bootPromptDigest: `sha256:${String(index + 5).repeat(64)}`,
      objective: lane.objective,
      acceptanceCriteria: lane.acceptanceCriteria.map((criterion) => ({ ...criterion })),
      launch: {
        slice: "WEB-LAUNCH-0",
        launchSuccess: true,
        conversationIdentitySha256: String(index + 7).repeat(64),
        timestamp: "2026-08-27T11:00:01.000Z",
        assistantOutputCaptured: false,
      },
      result: resultCard(lane, index === 0
        ? { evidenceRef: "A-proof" }
        : {
            verdict: "UNKNOWN",
            evidenceRef: "B-proof",
            uncertainty: [{ fact: "One B fact remains uncertain.", evidenceRefs: ["B-proof"] }],
          }),
    })),
  };
}

test("Round-2 contract projects exact PRODUCT endgame and accepted World into DevSpace memory", (t) => {
  const { current, a, b, contract } = fixture(t);

  assert.equal(contract.schemaVersion, "meta-harness-delegation-round2/v1");
  assert.equal(contract.originWorldHeadDigest, current.head.headDigest);
  assert.equal(contract.memory.endgame.includes("Deliver one clear product result without losing owner taste."), true);
  const projectedWorld = JSON.parse(contract.memory.world);
  assert.equal(projectedWorld.head.headDigest, current.head.headDigest);
  assert.equal(projectedWorld.head.worldDigest, current.head.worldDigest);
  assert.deepEqual(projectedWorld.currentWorld, current.world);
  assert.match(contract.devspaceContextDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(contract.contractDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(contract.lanes.map((lane) => lane.outcomeDigest), [a.outcomeDigest, b.outcomeDigest]);
  assert.deepEqual(contract.lanes[0].acceptanceCriteria, [
    { id: "desired-state", text: "A user can complete lane A." },
    { id: "evidence-requirement", text: "A-proof demonstrates lane A behavior." },
  ]);
  assert.equal(contract.memory.evidenceIndex.some((entry) => entry.ref === current.head.headDigest), true);
  assert.equal(contract.memory.evidenceIndex.some((entry) => entry.ref === a.outcomeDigest), true);
  assert.equal(contract.memory.evidenceIndex.some((entry) => entry.ref === b.outcomeDigest), true);
  assert.deepEqual(validateDelegationRound2Contract(contract), contract);
});

test("compact DELEGATION-R2 fan-in reduces to an acceptance matrix without transcript bodies", (t) => {
  const { contract } = fixture(t);
  const snapshot = compactSnapshot(contract);
  const acceptance = acceptDelegationRound2FanIn({ contract, snapshot });

  assert.equal(acceptance.schemaVersion, "meta-harness-delegation-acceptance/v1");
  assert.equal(acceptance.complete, true);
  assert.deepEqual(acceptance.summary, { pass: 1, fail: 0, unknown: 1, pending: 0, cancelled: 0 });
  assert.equal(acceptance.lanes[0].acceptance, "PASS");
  assert.equal(acceptance.lanes[1].acceptance, "UNKNOWN");
  assert.equal(acceptance.lanes[0].result.worldDelta[0].fact.includes("may update World"), true);
  assert.equal(Object.hasOwn(acceptance.lanes[0].result.evidenceIndex[0], "detail"), false);
  assert.equal(JSON.stringify(acceptance).includes("transcript"), false);
});

test("fan-in fails closed on context drift, lane drift, or transcript-shaped payloads", (t) => {
  const { contract } = fixture(t);

  const contextDrift = compactSnapshot(contract);
  contextDrift.contextDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => acceptDelegationRound2FanIn({ contract, snapshot: contextDrift }),
    (error) => error?.code === "MH_DELEGATION_R2_FANIN",
  );

  const laneDrift = compactSnapshot(contract);
  laneDrift.lanes[0].acceptanceCriteria[0].text = "Rewritten criterion";
  assert.throws(
    () => acceptDelegationRound2FanIn({ contract, snapshot: laneDrift }),
    (error) => error?.code === "MH_DELEGATION_R2_FANIN",
  );

  const transcript = compactSnapshot(contract);
  transcript.lanes[0].transcript = "raw child conversation";
  assert.throws(
    () => acceptDelegationRound2FanIn({ contract, snapshot: transcript }),
    (error) => error?.code === "MH_DELEGATION_R2_TRANSCRIPT",
  );
});

test("orchestrator requests only evidence refs named by the compact card", (t) => {
  const { contract } = fixture(t);
  const acceptance = acceptDelegationRound2FanIn({ contract, snapshot: compactSnapshot(contract) });
  const request = compileDelegationEvidenceRequest({
    acceptance,
    laneKey: "B",
    refs: ["B-proof"],
  });
  assert.deepEqual(request, {
    delegationId: "delegation_contract_test",
    evidence: { laneKey: "B", refs: ["B-proof"] },
  });
  assert.throws(
    () => compileDelegationEvidenceRequest({ acceptance, laneKey: "B", refs: ["not-indexed"] }),
    (error) => error?.code === "MH_DELEGATION_R2_EVIDENCE",
  );

  const evidenceSnapshot = compactSnapshot(contract);
  evidenceSnapshot.selectedEvidence = [{
    laneKey: "B",
    resultDigest: evidenceSnapshot.lanes[1].result.resultDigest,
    ref: "B-proof",
    summary: "B compact proof summary.",
    detail: "Only this disputed evidence body is expanded.",
  }];
  const selected = validateDelegationEvidenceResponse({ request, acceptance, snapshot: evidenceSnapshot });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].detail, "Only this disputed evidence body is expanded.");

  const overreach = compactSnapshot(contract);
  overreach.selectedEvidence = [
    evidenceSnapshot.selectedEvidence[0],
    {
      laneKey: "A",
      resultDigest: evidenceSnapshot.lanes[0].result.resultDigest,
      ref: "A-proof",
      summary: "unrequested",
      detail: "unrequested",
    },
  ];
  assert.throws(
    () => validateDelegationEvidenceResponse({ request, acceptance, snapshot: overreach }),
    (error) => error?.code === "MH_DELEGATION_R2_EVIDENCE",
  );
});
