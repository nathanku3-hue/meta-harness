"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildLiveGovernance } = require("../lib/context-gate-governance");
const { diffGovernanceSnapshots } = require("../lib/governance-diff");

test("governance diff reports engine and contract drift", () => {
  const baseline = buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
  const current = {
    ...baseline,
    generated_at: "2026-06-13T01:00:00.000Z",
    contract_template_hash: "0".repeat(64),
    governance_engine_hash: "1".repeat(64),
  };

  const diff = diffGovernanceSnapshots(baseline, current);
  const categories = diff.changes.map((item) => item.category);

  assert.equal(diff.ok, false);
  assert.equal(diff.counts.changes, 2);
  assert.deepEqual(categories, ["contract_template_hash", "governance_engine_hash"]);
});

test("governance diff reports transition and policy categories", () => {
  const baseline = buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
  const current = {
    ...baseline,
    phases: ["intake", "work", "plan"],
    allowed_transitions: [...baseline.allowed_transitions, "work->plan"],
    required_gate_transitions: baseline.required_gate_transitions.filter((item) => item !== "plan->work"),
    optional_gate_transitions: [...baseline.optional_gate_transitions, "plan->work"],
    default_max_artifact_age_days: 14,
  };

  const diff = diffGovernanceSnapshots(baseline, current);
  const categories = new Set(diff.changes.map((item) => item.category));

  assert.equal(categories.has("allowed_transitions"), true);
  assert.equal(categories.has("gate_partition"), true);
  assert.equal(categories.has("phase_order"), true);
  assert.equal(categories.has("artifact_age_policy"), true);
});
