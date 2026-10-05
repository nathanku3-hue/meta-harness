"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeEnvelope } = require("../lib/human-handoff");
const {
  compileTextPresentation,
  validateTextPresentation,
} = require("../lib/text-presentation");
const { humanEnvelopeForResult } = require("../lib/commands/work");

function envelope(textMode, overrides = {}) {
  const presentation = {
    kind: "AUTO",
    shape: "LINEAR",
    itemCount: 1,
    hasBranches: false,
    hasEvidence: false,
    textMode,
    ...(overrides.presentation || {}),
  };
  return {
    status: "CSV export works and validation passed.",
    why: "The requested product result is usable.",
    next: {
      action: "Use the result.",
      where: "After implementation.",
      whyNow: "The result is ready.",
      locks: ["the delivered behavior"],
      doneWhen: "The result is consumed.",
      unlocks: "A new objective can begin.",
      whyNotOthers: ["Repeating the work would not change the result."],
      ...(overrides.next || {}),
    },
    humanStopRequired: false,
    humanStopReason: null,
    decisionQuestion: null,
    egressSource: "NORMAL_COMPLETION",
    ...overrides,
    presentation,
  };
}

function lines(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

test("terminal completion can be one compact owner-facing line", () => {
  const result = compileTextPresentation(envelope("COMPLETION", { next: null }));
  assert.equal(result.schemaVersion, "human-text-presentation/v1");
  assert.equal(result.mode, "COMPLETION");
  assert.equal(result.text, "Done — CSV export works and validation passed.\n");
  assert.equal(lines(result.text).length, 1);
});

test("explicit next remains supported when terminal callers truly have one", () => {
  const result = compileTextPresentation(envelope("COMPLETION"));
  assert.equal(result.text, "Done — CSV export works and validation passed.\nNext — Use the result.\n");
});

test("terminal quiescent and safe-stop omit synthetic next while active modes keep it", () => {
  for (const [mode, firstLine] of [
    ["QUIESCENT", "No current product gap."],
    ["SAFE_STOP", "Stopped safely — current product state is preserved."],
  ]) {
    const result = compileTextPresentation(envelope(mode, { next: null }));
    assert.deepEqual(lines(result.text), [firstLine], mode);
  }

  for (const [mode, firstLine] of [
    ["CONTINUATION", "Not done — CSV export works and validation passed."],
    ["BLOCKER", "Blocked — CSV export works and validation passed."],
    ["AGGREGATE", "Update — CSV export works and validation passed."],
  ]) {
    const result = compileTextPresentation(envelope(mode));
    assert.deepEqual(lines(result.text), [firstLine, "Next — Use the result."], mode);
  }
});

test("owner-required text is three lines with one question and no Decision needed label", () => {
  const result = compileTextPresentation(envelope("OWNER_REQUIRED", {
    humanStopRequired: true,
    humanStopReason: "MATERIAL_PRODUCT_CHOICE",
    decisionQuestion: "Use UTC or local time?",
  }));
  assert.deepEqual(lines(result.text), [
    "Need input — Use UTC or local time?",
    "Why — This choice changes product behavior.",
    "Then — The same work continues.",
  ]);
  assert.doesNotMatch(result.text, /Decision needed/iu);
});

test("all supported owner reasons have deterministic product-facing explanations", () => {
  const reasons = [
    "SCOPE_EXPANSION",
    "MATERIAL_PRODUCT_CHOICE",
    "CREDENTIAL_INPUT",
    "PROTECTED_ACCESS",
    "EXTERNAL_PUBLICATION",
    "DESTRUCTIVE_EXTERNAL_EFFECT",
    "ACCEPT_MATERIAL_RISK",
    "AMBIGUOUS_NON_REPLAYABLE_EFFECT",
  ];
  for (const reason of reasons) {
    const result = compileTextPresentation(envelope("OWNER_REQUIRED", {
      humanStopRequired: true,
      humanStopReason: reason,
      decisionQuestion: "Continue?",
    }));
    assert.equal(lines(result.text).length, 3);
    assert.match(lines(result.text)[1], /^Why — /u);
  }
});

test("owner-stop semantics and OWNER_REQUIRED mode must agree", () => {
  assert.throws(
    () => compileTextPresentation(envelope("OWNER_REQUIRED")),
    (error) => error && error.code === "MH_TEXT_PRESENTATION_MODE",
  );
  assert.throws(
    () => compileTextPresentation(envelope("COMPLETION", {
      humanStopRequired: true,
      humanStopReason: "PROTECTED_ACCESS",
      decisionQuestion: "Provide access?",
    })),
    (error) => error && error.code === "MH_TEXT_PRESENTATION_MODE",
  );
});

test("text validator rejects expanded handoff fields and control vocabulary", () => {
  const normalized = normalizeEnvelope(envelope("COMPLETION"));
  const invalid = [
    "Done — CSV export works.",
    "- Where: completion boundary.",
    "Next — use durable truth and choose a reversible means.",
  ].join("\n");
  const errors = validateTextPresentation(invalid, normalized).join("\n");
  assert.match(errors, /expanded handoff field/u);
  assert.match(errors, /durable-truth narration/u);
  assert.match(errors, /reversible-means narration/u);
});

test("real work-result adapters assign text modes without changing semantic fields", () => {
  const done = normalizeEnvelope(humanEnvelopeForResult({
    outcome: "DONE",
    observableResult: "CSV export works.",
    nextAction: "Use CSV export.",
  }));
  assert.equal(done.presentation.textMode, "COMPLETION");
  assert.equal(done.status, "CSV export works.");
  assert.equal(done.next, null);
  assert.equal(done.humanStopRequired, false);

  const owner = normalizeEnvelope(humanEnvelopeForResult({
    outcome: "BLOCKED",
    blocker: "A date convention is required.",
    ownerEffect: {
      kind: "MATERIAL_PRODUCT_CHOICE",
      question: "Use UTC or local time?",
    },
  }));
  assert.equal(owner.presentation.textMode, "OWNER_REQUIRED");
  assert.equal(owner.humanStopRequired, true);
  assert.equal(owner.decisionQuestion, "Use UTC or local time?");
});

test("aggregate unresolved language stays product-facing in the compact projection", () => {
  const handoff = humanEnvelopeForResult({
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "PARTIAL",
    outcomes: [
      { state: "LANDED", observableResult: "Parser works." },
      { state: "REPLAN_REQUIRED", observableResult: "Importer still needs another approach." },
    ],
  });
  const result = compileTextPresentation(handoff);
  assert.equal(handoff.presentation.textMode, "AGGREGATE");
  assert.match(result.text, /^Update — Completed: Parser works\. Still unresolved: Importer still needs another approach\./u);
  assert.doesNotMatch(result.text, /reversible means|lifecycle|handoff|boundary/iu);
});
