"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { modelControlViolations } = require("../lib/model-control-boundary");
const { validateReadOnlyInteractionResponse } = require("../lib/read-only-interaction");
const { validatePlannerCandidateBatch } = require("../lib/repo-planner-candidate");
const { validateWorkerResult } = require("../lib/worker-result");

function plannerCandidate(overrides = {}) {
  return {
    id: "authority-edge",
    productResult: "Produce the fresh bounded evidence slice.",
    journeyState: "Fresh generalization evidence does not exist yet.",
    doNow: "Acquire the first six eligible sources under the fixed inclusion rule and freeze their bytes.",
    newlyTrueBehavior: "A fresh source set exists without outcome leakage.",
    doneWhen: "The source set and provenance are frozen before semantic scoring.",
    stopOnlyIf: ["The source bytes cannot be obtained with the physically available capabilities."],
    expectedWritePaths: ["evidence/fresh-slice"],
    ...overrides,
  };
}

function workerResult(overrides = {}) {
  return {
    schemaVersion: "worker-result/v2",
    status: "DONE",
    observableResult: "The bounded local change is represented as typed operations.",
    operations: [],
    validation: ["Focused validation is available to the controller."],
    stop: null,
    ...overrides,
  };
}

test("history-derived consent stalls are classified as invented model control", () => {
  const dirty = [
    "Path B — authorize a bounded acquisition slice",
    "Aligned. I’ll treat this as authorization to proceed with the L0 custody recut first.",
    "I’m treating your instruction as the new bounded GO.",
    "Decision needed: reply GO to open exactly this slice.",
    "- Decision needed: choose one before reversible work continues.",
    "1. Need input — approve the next local slice.",
    "Need input — approve the next reversible slice.",
    "Wait for the owner before continuing.",
    "The owner must choose a lane before local work continues.",
    "Any successor requires a new explicit owner GO.",
    "The next result-bearing round requires a new explicit GO.",
    "Authorize that P0 implementation slice.",
    "Reply approve next phase and I can continue.",
    "If you want me to execute it, I’d do the aggressive version.",
    "Do you want me to proceed with the reversible local repair?",
    "Do you want to authorize a fallback model for staging tests, or hold?",
    "We need your approval before running the reversible local validation.",
    "This is experimental sampling authority.",
    "如果你要我繼續，請給 GO。",
    "你給 GO 我可以直接開下一個 reversible slice。",
    "我把你的指令當作新的授權。",
    "下一步需要新的 explicit GO。",
    "No need to ask for approval before reversible work; ask the owner for approval before continuing this slice.",
  ];

  for (const text of dirty) {
    assert.ok(modelControlViolations(text).length > 0, text);
  }
});

test("method constraints, capability observations, and quoted counterexamples remain explainable", () => {
  const clean = [
    "Bound the acquisition to the first six eligible sources, freeze bytes, then score only after the candidate output is frozen.",
    "The API returned HTTP 401 Unauthorized; use another in-scope source if one is available.",
    "The API requires authorization and the current runtime has no credential capability; use another in-scope source if one is available.",
    "OAuth requires authorization of this client before the remote endpoint can be called.",
    "Authorize OAuth client requests only after token verification.",
    "No human reconfirmation is needed before this reversible local repair.",
    "No need to ask for approval before reversible local work.",
    "不需要新的 GO；可逆的本地修復直接繼續。",
    "Publication is a future external boundary; the current local scaffolding can continue.",
    "The label Need input: is reserved for controller-proven human effects.",
    "> Path B — authorize a bounded acquisition slice",
    "```text\nDecision needed: reply GO\n```",
  ];

  for (const text of clean) {
    assert.deepEqual(modelControlViolations(text), [], text);
  }
});

test("read-only model cannot create a consent gate", () => {
  assert.throws(
    () => validateReadOnlyInteractionResponse({
      answer: "Path B — authorize a bounded acquisition slice before I continue.",
    }),
    (error) => error.code === "MH_READ_ONLY_INTERACTION_MODEL_CONTROL",
  );

  assert.deepEqual(
    validateReadOnlyInteractionResponse({
      answer: "Use Path B because it creates fresh evidence under a fixed sampling rule; bounded acquisition is a method constraint, not a reason to pause.",
    }),
    {
      answer: "Use Path B because it creates fresh evidence under a fixed sampling rule; bounded acquisition is a method constraint, not a reason to pause.",
    },
  );
});

test("planner candidate cannot turn reversible work into owner reconfirmation", () => {
  assert.throws(
    () => validatePlannerCandidateBatch({
      schemaVersion: "planner-candidate-batch/v4",
      proposals: [plannerCandidate({
        doNow: "Ask the owner for approval before acquiring the bounded source set.",
      })],
    }),
    (error) => error.code === "MH_PLANNER_MODEL_CONTROL",
  );

  const valid = validatePlannerCandidateBatch({
    schemaVersion: "planner-candidate-batch/v4",
    proposals: [plannerCandidate()],
  });
  assert.equal(valid.proposals.length, 1);
});

test("coding worker cannot manufacture owner work in control-bearing result fields", () => {
  assert.deepEqual(
    validateWorkerResult(workerResult({
      operations: [{
        type: "WRITE",
        path: "docs/history-example.md",
        content: "Historical counterexample: Decision needed: reply GO before reversible work.\n",
      }],
    })).operations[0].path,
    "docs/history-example.md",
  );

  assert.throws(
    () => validateWorkerResult(workerResult({
      status: "STOP",
      observableResult: "The local route was inspected.",
      operations: [],
      stop: {
        unsatisfiedRequirement: "Need your approval before continuing the reversible repair.",
        failedMeans: [{ means: "Use the first parser branch.", evidence: ["The focused test still fails."] }],
        alternativesConsidered: [{ means: "Use the second parser branch.", disposition: "AVAILABLE", evidence: ["It stays inside the allowed path."] }],
        assertedConstraint: "The next step is local and reversible.",
      },
    })),
    (error) => error.code === "MH_WORKER_RESULT",
  );

  assert.deepEqual(
    validateWorkerResult(workerResult({
      status: "STOP",
      observableResult: "The remote API returned HTTP 401 Unauthorized.",
      operations: [],
      stop: {
        unsatisfiedRequirement: "The exact remote observation cannot be collected with the current capability surface.",
        failedMeans: [{ means: "Call the remote endpoint.", evidence: ["HTTP 401 Unauthorized."] }],
        alternativesConsidered: [{ means: "Use a local retained fixture.", disposition: "AVAILABLE", evidence: ["The fixture covers the parser behavior."] }],
        assertedConstraint: "Authenticated external capability is absent in this attempt.",
      },
    })).status,
    "STOP",
  );
});
