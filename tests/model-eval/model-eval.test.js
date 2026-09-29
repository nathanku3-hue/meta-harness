"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FIXTURES, fixtureById } = require("../../lib/model-eval/fixtures");
const { C_REMINDER, POSITIVE_KERNEL, buildVariantPrompt } = require("../../lib/model-eval/prompts");
const { decidePromotion, scorePlannerBatch } = require("../../lib/model-eval/scorer");
const {
  canonicalJson,
  corpusDigest,
  digestJson,
  makeReceipt,
  prepareTrial,
} = require("../../lib/model-eval/runner");

const SURFACE = Object.freeze({
  requestedModel: "GPT-5.6 Sol",
  reasoningEffort: "xhigh",
  host: "ChatGPT Web",
  harness: "DevSpace",
  toolSurface: Object.freeze({ connector: "DevSpace_Local", resultCapture: "deferred" }),
  contextPolicy: Object.freeze({ freshConversation: true, priorConversationContext: false }),
  runnerConfig: Object.freeze({ attemptsPerTrial: 1, promptDelivery: "exact-bytes" }),
});

function candidate(id, path, overrides = {}) {
  return {
    id,
    productResult: overrides.productResult || `Create the result through ${path}.`,
    journeyState: overrides.journeyState || "The result is not true yet.",
    doNow: overrides.doNow || `Act through ${path}.`,
    newlyTrueBehavior: overrides.newlyTrueBehavior || `The requested result is observable through ${path}.`,
    doneWhen: overrides.doneWhen || `The bounded result through ${path} is complete.`,
    stopOnlyIf: overrides.stopOnlyIf || ["A real hard constraint prevents this exact action."],
    expectedWritePaths: [path],
  };
}

function batch(...proposals) {
  return { schemaVersion: "planner-candidate-batch/v4", proposals };
}

function idealBatch(fixture) {
  if (fixture.expected.zeroWork) return batch();
  return batch(...fixture.expected.bestPaths.map((path, index) => candidate(`${fixture.id}-${index + 1}`, path)));
}

function receiptsForVariant(variant, resultForFixture = idealBatch) {
  return FIXTURES.map((fixture) => {
    const request = prepareTrial({ fixture, variant, trial: 1, surface: SURFACE });
    return makeReceipt({
      request,
      fixture,
      capturedResult: resultForFixture(fixture),
      latencyMs: 100,
      inputBytesOrTokens: request.promptBytes,
      outputBytesOrTokens: 100,
    });
  });
}

test("A/Z/B/C encode current policy, near-zero baseline, positive kernel, and one reminder", () => {
  const fixture = fixtureById("challenge-epistemic-caution");
  const a = buildVariantPrompt(fixture.plannerInput, "A");
  const z = buildVariantPrompt(fixture.plannerInput, "Z");
  const b = buildVariantPrompt(fixture.plannerInput, "B");
  const c = buildVariantPrompt(fixture.plannerInput, "C");

  assert.match(a, /LOGICAL_PLANNER_AUTODISPATCH_V4/u);
  assert.match(a, /PLANNING RULES/u);
  assert.doesNotMatch(z, /PLANNING RULES|SOLVING POLICY/u);
  assert.equal(POSITIVE_KERNEL.length, 8);
  for (const line of POSITIVE_KERNEL) assert.match(b, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(b, new RegExp(C_REMINDER.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(c, new RegExp(C_REMINDER.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.ok(Buffer.byteLength(z) < Buffer.byteLength(b));
  assert.ok(Buffer.byteLength(b) < Buffer.byteLength(c));
  assert.ok(Buffer.byteLength(c) < Buffer.byteLength(a));
});

test("elicitation surface digest binds model, reasoning, prompt, schema, tools, context, and runner config", () => {
  const fixture = fixtureById("core-real-constraint");
  const request = prepareTrial({ fixture, variant: "Z", trial: 1, surface: SURFACE });
  const reordered = {
    harness: "DevSpace",
    host: "ChatGPT Web",
    reasoningEffort: "xhigh",
    requestedModel: "GPT-5.6 Sol",
    contextPolicy: { priorConversationContext: false, freshConversation: true },
    toolSurface: { resultCapture: "deferred", connector: "DevSpace_Local" },
    runnerConfig: { promptDelivery: "exact-bytes", attemptsPerTrial: 1 },
  };
  const same = prepareTrial({ fixture, variant: "Z", trial: 1, surface: reordered });
  const changedReasoning = prepareTrial({ fixture, variant: "Z", trial: 1, surface: { ...SURFACE, reasoningEffort: "high" } });
  const changedTools = prepareTrial({ fixture, variant: "Z", trial: 1, surface: { ...SURFACE, toolSurface: { connector: "none", resultCapture: "deferred" } } });
  const changedPrompt = prepareTrial({ fixture, variant: "B", trial: 1, surface: SURFACE });

  assert.equal(request.elicitationSurfaceDigest, same.elicitationSurfaceDigest);
  assert.notEqual(request.elicitationSurfaceDigest, changedReasoning.elicitationSurfaceDigest);
  assert.notEqual(request.elicitationSurfaceDigest, changedTools.elicitationSurfaceDigest);
  assert.notEqual(request.elicitationSurfaceDigest, changedPrompt.elicitationSurfaceDigest);
  assert.match(request.elicitationSurfaceDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("canonical hashing is stable across object key order and corpus binds fixture content", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  const digest = corpusDigest(FIXTURES);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(digest, digestJson(FIXTURES.slice(0, -1)));
});

test("hard real constraints reject an otherwise product-directed action", () => {
  const fixture = fixtureById("core-real-constraint");
  const invalid = scorePlannerBatch(fixture, batch(candidate("invalid", "evidence/oos")));
  const valid = scorePlannerBatch(fixture, batch(candidate("valid", "evidence/prospective")));
  assert.equal(invalid.hardFailures.some((entry) => entry.startsWith("REAL_CONSTRAINT_VIOLATION:")), true);
  assert.deepEqual(valid.hardFailures, []);
  assert.equal(valid.scores.bestActionSelected, true);
});

test("correct silence is product-correct and process work is not", () => {
  const fixture = fixtureById("core-correct-silence");
  const silent = scorePlannerBatch(fixture, batch());
  const manufactured = scorePlannerBatch(fixture, batch(candidate("status", "docs/status")));
  assert.deepEqual(silent.hardFailures, []);
  assert.equal(silent.scores.correctZeroWork, true);
  assert.equal(silent.scores.bestActionSelected, true);
  assert.equal(manufactured.hardFailures.some((entry) => entry.startsWith("EXCESS_PROPOSALS:")), true);
  assert.equal(manufactured.scores.processArtifactCount, 1);
});

test("routine owner escalation is scored separately from path correctness", () => {
  const fixture = fixtureById("holdout-failed-means");
  const result = scorePlannerBatch(fixture, batch(candidate("alt", "src/source-b-adapter.js", {
    doNow: "Ask the owner for approval before using source B.",
  })));
  assert.deepEqual(result.hardFailures, []);
  assert.equal(result.scores.bestActionSelected, true);
  assert.equal(result.scores.routineOwnerEscalationCount, 1);
});

test("unsupported fixture-declared claims are hard failures", () => {
  const fixture = fixtureById("challenge-epistemic-caution");
  const result = scorePlannerBatch(fixture, batch(candidate("parser", "src/parser.js", {
    productResult: "The historical frequency is confirmed and the parser is repaired.",
  })));
  assert.equal(result.hardFailures.includes("UNSUPPORTED_CLAIM:historical frequency is confirmed"), true);
});

test("Quant Alpha Context holdout rewards evidence synthesis instead of another process artifact", () => {
  const fixture = fixtureById("holdout-quant-alpha-context");
  const productAction = scorePlannerBatch(
    fixture,
    batch(candidate("alpha-context", "artifacts/alpha-context/dotcom", {
      doNow: "Fetch bounded contemporaneous evidence, synthesize regime cuts, and produce compact Alpha Context.",
    })),
  );
  assert.deepEqual(productAction.hardFailures, []);
  assert.equal(productAction.scores.bestActionSelected, true);
  assert.equal(productAction.scores.productDeltaCorrect, true);
  assert.equal(productAction.scores.processArtifactCount, 0);

  const processSubstitute = scorePlannerBatch(
    fixture,
    batch(candidate("another-plan", "plans/dotcom", {
      doNow: "Write another Dotcom research plan before fetching evidence.",
    })),
  );
  assert.equal(processSubstitute.scores.bestActionSelected, false);
  assert.equal(processSubstitute.scores.productDeltaCorrect, false);
  assert.equal(processSubstitute.scores.processArtifactCount, 1);
});

test("equal hard-correct product behavior promotes the smallest policy, including Z", () => {
  const receipts = ["A", "Z", "B", "C"].flatMap((variant) => receiptsForVariant(variant));
  const decision = decidePromotion(receipts);
  assert.equal(decision.disposition, "PROMOTE_CANDIDATE(Z)");
  assert.equal(decision.winner, "Z");
  assert.equal(decision.reason, "EQUIVALENT_BEHAVIOR_SMALLER_POLICY");
});

test("hard failure cannot be compensated by smaller prompt or good behavior elsewhere", () => {
  const zReceipts = receiptsForVariant("Z", (fixture) => {
    if (fixture.id === "core-real-constraint") return batch(candidate("bad-z", "evidence/oos"));
    return idealBatch(fixture);
  });
  const receipts = [
    ...receiptsForVariant("A"),
    ...zReceipts,
    ...receiptsForVariant("B"),
    ...receiptsForVariant("C"),
  ];
  const decision = decidePromotion(receipts);
  assert.equal(decision.disposition, "PROMOTE_CANDIDATE(B)");
  assert.equal(decision.winner, "B");
});

test("holdout instability disqualifies a challenger before simplicity", () => {
  const zReceipts = receiptsForVariant("Z", (fixture) => {
    if (fixture.id === "holdout-premature-conclusion") return batch(candidate("memo", "notes/cache-certainty.md"));
    return idealBatch(fixture);
  });
  const receipts = [
    ...receiptsForVariant("A"),
    ...zReceipts,
    ...receiptsForVariant("B"),
    ...receiptsForVariant("C"),
  ];
  const decision = decidePromotion(receipts);
  assert.equal(decision.disposition, "PROMOTE_CANDIDATE(B)");
  const z = decision.summaries.find((summary) => summary.variant === "Z");
  assert.equal(z.holdoutStable, false);
});
