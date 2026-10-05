"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeEnvelope } = require("../lib/human-handoff");
const { humanEnvelopeForResult } = require("../lib/commands/work");
const { projectHumanHandoff } = require("../lib/presentation-router");

function envelope(presentation = undefined) {
  return {
    status: "The requested result is observable.",
    why: "The product gap is closed.",
    next: {
      action: "Use the result.",
      where: "At the completed product boundary.",
      whyNow: "The result is ready.",
      locks: ["the delivered behavior", "the current product direction"],
      doneWhen: "The result is consumed.",
      unlocks: "A new independent objective can begin.",
      whyNotOthers: [
        "Repeating implementation would not change the result.",
        "Another audit would not reduce a product gap.",
      ],
    },
    humanStopRequired: false,
    humanStopReason: null,
    decisionQuestion: null,
    egressSource: "NORMAL_COMPLETION",
    ...(presentation === undefined ? {} : { presentation }),
  };
}

test("presentation defaults are conservative and text-first", () => {
  const normalized = normalizeEnvelope(envelope());
  assert.deepEqual(normalized.presentation, {
    kind: "AUTO",
    shape: "LINEAR",
    itemCount: 0,
    hasBranches: false,
    hasEvidence: false,
    textMode: "AUTO",
  });

  const projection = projectHumanHandoff(normalized);
  assert.equal(projection.schemaVersion, "human-presentation/v1");
  assert.equal(projection.kind, "TEXT");
  assert.equal(projection.model, null);
  assert.match(projection.text, /^Update — /u);
});

test("causal or state-shaped branching handoff becomes a renderer-neutral diagram", () => {
  const source = envelope({
    kind: "AUTO",
    shape: "CAUSAL",
    itemCount: 5,
    hasBranches: true,
    hasEvidence: false,
  });
  const projection = projectHumanHandoff(source);

  assert.equal(projection.kind, "DIAGRAM");
  assert.equal(projection.model.shape, "CAUSAL");
  assert.ok(projection.model.nodes.some((node) => node.id === "status" && node.label === source.status));
  assert.ok(projection.model.nodes.some((node) => node.role === "rejected-alternative"));
  assert.ok(projection.model.edges.some((edge) => edge.relation === "not-chosen-because"));
  assert.doesNotMatch(JSON.stringify(projection.model), /OWNER_DECISION|approval|authorize/iu);
});

test("comparison and evidence density can select an app payload without adding UI runtime", () => {
  const comparison = projectHumanHandoff(envelope({
    kind: "AUTO",
    shape: "COMPARISON",
    itemCount: 4,
    hasBranches: true,
    hasEvidence: false,
  }));
  assert.equal(comparison.kind, "APP");
  assert.equal(comparison.model.shape, "COMPARISON");
  assert.equal(comparison.model.declaredItemCount, 4);
  assert.ok(comparison.model.sections.some((section) => section.id === "alternatives"));

  const evidence = projectHumanHandoff(envelope({
    kind: "AUTO",
    shape: "EVIDENCE",
    itemCount: 6,
    hasBranches: false,
    hasEvidence: true,
  }));
  assert.equal(evidence.kind, "APP");
  assert.equal(evidence.model.hasEvidence, true);
});

test("terminal no-next handoff stays text even when rich hints request more UI", () => {
  const source = envelope({
    kind: "APP",
    shape: "COMPARISON",
    itemCount: 8,
    hasBranches: true,
    hasEvidence: true,
    textMode: "COMPLETION",
  });
  source.next = null;
  const projection = projectHumanHandoff(source);
  assert.equal(projection.kind, "TEXT");
  assert.equal(projection.model, null);
  assert.equal(projection.text, "Done — The requested result is observable.\n");
});

test("explicit rich mode cannot manufacture missing structure", () => {
  const invalidDiagram = projectHumanHandoff(envelope({
    kind: "DIAGRAM",
    shape: "LINEAR",
    itemCount: 20,
    hasBranches: false,
    hasEvidence: false,
  }));
  assert.equal(invalidDiagram.kind, "TEXT");
  assert.equal(invalidDiagram.model, null);

  const invalidApp = projectHumanHandoff(envelope({
    kind: "APP",
    shape: "COMPARISON",
    itemCount: 2,
    hasBranches: true,
    hasEvidence: false,
  }));
  assert.equal(invalidApp.kind, "TEXT");
});

test("presentation hints cannot alter semantic handoff or create owner attention", () => {
  const plain = normalizeEnvelope(envelope());
  const rich = normalizeEnvelope(envelope({
    kind: "APP",
    shape: "COMPARISON",
    itemCount: 12,
    hasBranches: true,
    hasEvidence: true,
  }));

  for (const key of ["status", "why", "humanStopRequired", "humanStopReason", "decisionQuestion", "egressSource"]) {
    assert.deepEqual(rich[key], plain[key]);
  }
  assert.deepEqual(rich.next, plain.next);
  assert.equal(rich.humanStopRequired, false);
  assert.doesNotMatch(projectHumanHandoff(rich).text, /Decision needed:/u);
});

test("real work path stays text-first even when aggregate shape could support a future app", () => {
  const handoff = humanEnvelopeForResult({
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "PARTIAL",
    outcomes: [
      { state: "LANDED", desiredState: "Parser works.", observableResult: "Parser works." },
      { state: "LANDED", desiredState: "Exporter works.", observableResult: "Exporter works." },
      { state: "RUNNING_ELSEWHERE", desiredState: "Importer is progressing.", observableResult: "Importer is progressing." },
      { state: "BLOCKED", desiredState: "Publisher is blocked.", observableResult: "Publisher is blocked." },
    ],
  });
  assert.equal(handoff.presentation.kind, "TEXT");
  assert.equal(handoff.presentation.shape, "COMPARISON");
  assert.equal(handoff.presentation.itemCount, 4);
  assert.equal(projectHumanHandoff(handoff).kind, "TEXT");
  assert.equal(projectHumanHandoff(handoff).model, null);
});

test("presentation hints are bounded data rather than an open UI instruction channel", () => {
  assert.throws(
    () => normalizeEnvelope(envelope({ kind: "HTML", shape: "LINEAR" })),
    /presentation.kind is invalid/u,
  );
  assert.throws(
    () => normalizeEnvelope(envelope({ kind: "AUTO", shape: "TIMELINE" })),
    /presentation.shape is invalid/u,
  );
  assert.throws(
    () => normalizeEnvelope(envelope({ kind: "AUTO", shape: "LINEAR", itemCount: 1001 })),
    /presentation.itemCount/u,
  );
  assert.throws(
    () => normalizeEnvelope(envelope({ kind: "AUTO", shape: "LINEAR", hasBranches: "yes" })),
    /presentation.hasBranches/u,
  );
});
