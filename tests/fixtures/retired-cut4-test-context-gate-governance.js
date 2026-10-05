"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { validateContextGateArtifact } = require("../lib/context-gate");
const {
  artifactFromEvaluations,
  finalizeArtifact,
  renderContextGateMarkdown,
} = require("../lib/context-gate-artifact");
const { ALLOWED_TRANSITIONS } = require("../lib/context-gate-constants");
const { normalizeTransition } = require("../lib/context-gate-utils");
const { validateContextGateArtifactDoc } = require("../lib/context-gate-validation");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");
const NOW = "2026-06-12T08:30:00.000Z";
const DIMENSIONS = [
  "product_outcome",
  "scope_boundary",
  "repo_and_stack",
  "owned_surface",
  "evidence_plan",
  "risk_and_stop_rules",
  "freshness",
  "handoff_completeness",
];

function snapshotGovernance(overrides = {}) {
  return {
    allowed_transitions: ["plan->work", "verify->release"],
    required_gate_transitions: ["verify->release"],
    optional_gate_transitions: ["plan->work"],
    phase_to_expected_transition: {
      plan: "plan->work",
      verify: "verify->release",
      release: null,
    },
    dimensions: DIMENSIONS,
    valid_verdicts: ["blocked", "narrowed", "proceed", "excellent"],
    bypass_reason_codes: ["snapshot_override"],
    execution_transitions: ["verify->release"],
    default_max_artifact_age_days: 7,
    ...overrides,
  };
}

test("snapshot governance allows snapshot-only transitions without mutating live constants", () => {
  const governance = snapshotGovernance();
  const output = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "outputs", "ROUND-001.json"), "utf8"));
  const artifact = {
    ...output,
    generated_at: NOW,
    transition: "verify->release",
  };

  assert.equal(ALLOWED_TRANSITIONS.includes("verify->release"), false);
  assert.throws(() => normalizeTransition({ transition: "verify->release" }), /invalid context transition/);
  assert.equal(normalizeTransition({ transition: "verify->release" }, { governance }), "verify->release");
  assert.throws(() => normalizeTransition({ transition: "release->done" }, { governance }), /invalid context transition/);

  const liveValidation = validateContextGateArtifact(artifact, { now: new Date(NOW), maxAgeDays: null });
  assert.equal(liveValidation.ok, false);
  assert.match(liveValidation.errors.join("\n"), /transition must be a supported phase transition/);

  const snapshotValidation = validateContextGateArtifact(artifact, { governance, now: new Date(NOW), maxAgeDays: null });
  assert.equal(snapshotValidation.ok, true, snapshotValidation.errors.join("\n"));

  const rejected = validateContextGateArtifact({ ...artifact, transition: "release->done" }, { governance, now: new Date(NOW), maxAgeDays: null });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("\n"), /transition must be a supported phase transition/);
  assert.equal(ALLOWED_TRANSITIONS.includes("verify->release"), false);
});

test("snapshot governance controls artifact dimensions and verdicts", () => {
  const output = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "outputs", "ROUND-001.json"), "utf8"));
  const dimensions = [...DIMENSIONS, "decision_record"];
  const governance = snapshotGovernance({
    dimensions,
    valid_verdicts: ["blocked", "archived"],
  });
  const artifact = {
    ...output,
    generated_at: NOW,
    transition: "verify->release",
    verdict: "archived",
    scores: {
      ...output.scores,
      decision_record: 8,
    },
  };

  const validation = validateContextGateArtifact(artifact, { governance, now: new Date(NOW), maxAgeDays: null });
  assert.equal(validation.ok, true, validation.errors.join("\n"));

  const docValidation = validateContextGateArtifactDoc(artifact, artifact.round_id, new Date(NOW), { governance, maxAgeDays: null });
  assert.equal(docValidation.ok, true, docValidation.reason);

  const missingDimension = validateContextGateArtifact({ ...artifact, scores: output.scores }, { governance, now: new Date(NOW), maxAgeDays: null });
  assert.equal(missingDimension.ok, false);
  assert.match(missingDimension.errors.join("\n"), /scores must contain exactly the context gate dimensions/);

  const rejectedVerdict = validateContextGateArtifact({ ...artifact, verdict: "excellent" }, { governance, now: new Date(NOW), maxAgeDays: null });
  assert.equal(rejectedVerdict.ok, false);
  assert.match(rejectedVerdict.errors.join("\n"), /verdict must be one of: blocked, archived/);
});

test("artifact helpers honor injected governance dimensions", () => {
  const governance = snapshotGovernance({
    dimensions: ["product_outcome", "decision_record"],
  });
  const base = artifactFromEvaluations({
    roundId: "ROUND-001",
    generatedAt: NOW,
    transition: "verify->release",
    state: { statusText: "", decisionLogText: "" },
    governance,
    evaluations: [{
      dimension: "product_outcome",
      score: 8,
      evidence: ["status goal"],
      summary: "Goal is known.",
    }],
  });

  assert.deepEqual(Object.keys(base.artifact.scores).sort(), ["decision_record", "product_outcome"]);
  assert.equal(base.artifact.scores.decision_record, 1);
  assert.deepEqual(base.artifact.evidence.decision_record, []);
  assert.ok(base.artifact.unknown_dimensions.includes("decision_record"));

  const artifact = finalizeArtifact(base.artifact, { governance });
  assert.equal(artifact.verdict, "blocked");
  assert.equal(artifact.overall_score, 1);

  const markdown = renderContextGateMarkdown(artifact, { governance });
  assert.match(markdown, /- decision_record: 1/);
  assert.doesNotMatch(markdown, /- scope_boundary:/);
});
