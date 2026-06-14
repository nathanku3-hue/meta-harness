"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildLiveGovernance,
  governanceHash,
  normalizeGovernance,
} = require("../lib/context-gate-governance");
const { attachContextGateFingerprint } = require("../lib/context-gate-fingerprint");
const {
  analyzeMigrationImpact,
  buildDependencyGraph,
  classifyArtifactValidity,
  classifyMigrationSafety,
  forecastReadiness,
} = require("../lib/governance-migration-impact");

function snapshot() {
  return buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
}

function spec(overrides = {}) {
  return {
    schema_version: "1",
    migration_id: "impact-test-migration",
    version_source: "0.1.0",
    version_target: "0.2.0",
    expected_change_level: "PATCH",
    actions: [],
    ...overrides,
  };
}

function scoresFor(governance, score = 8) {
  return Object.fromEntries(governance.dimensions.map((dimension) => [dimension, score]));
}

function artifact(governance, overrides = {}, options = {}) {
  const doc = {
    round_id: "ROUND-001",
    generated_at: "2026-06-13T00:00:00.000Z",
    transition: "plan->work",
    overall_score: 8,
    verdict: "proceed",
    scores: scoresFor(governance),
    correct_next_step: "Continue.",
    structural_hard_blockers: [],
    evidence_gap_dimensions: [],
    unknown_dimensions: [],
    questions: [],
    hints_applied: [],
    source_path: "ROUND-001.json",
    ...overrides,
  };
  if (options.fingerprint === false) return doc;
  return attachContextGateFingerprint({
    artifact: doc,
    governance,
    evidenceState: { events: [] },
  });
}

test("blocked advisory gate validates but forecasts READY to BLOCKED when it becomes required", () => {
  const before = snapshot();
  const transition = before.optional_gate_transitions[0];
  const blocked = artifact(before, { transition, verdict: "blocked", correct_next_step: "Clear blockers." });
  const migration = spec({
    expected_change_level: "MAJOR",
    actions: [
      { type: "remove_from_set", field: "optional_gate_transitions", value: transition },
      { type: "add_to_set", field: "required_gate_transitions", value: transition },
    ],
  });

  const report = analyzeMigrationImpact(before, migration, [blocked]);
  const forecast = report.affectedReadyChecks[0];

  assert.equal(forecast.before.status, "READY");
  assert.equal(forecast.before.reason, "advisory_blocked");
  assert.equal(forecast.after.status, "BLOCKED");
  assert.equal(forecast.required_degraded, true);
  assert.equal(report.safety, "REQUIRES_MANUAL_REVIEW");
});

test("artifact age does not affect deterministic readiness forecasting", () => {
  const before = snapshot();
  const oldArtifact = artifact(before, { generated_at: "2001-01-01T00:00:00.000Z" });

  const forecast = forecastReadiness(before, before, oldArtifact);

  assert.equal(forecast.before.status, "READY");
  assert.equal(forecast.after.status, "READY");
  assert.deepEqual(forecast.before.errors, []);
  assert.deepEqual(forecast.after.errors, []);
});

test("version-only migrations stale existing fingerprinted artifacts", () => {
  const before = snapshot();
  const current = artifact(before);

  const report = analyzeMigrationImpact(before, spec(), [current]);
  const validity = report.affectedArtifacts[0];

  assert.equal(validity.status, "stale");
  assert.equal(validity.reason, "governance_hash_changed");
  assert.equal(validity.fingerprint.matches_before, true);
  assert.equal(validity.fingerprint.matches_after, false);
  assert.equal(report.safety, "REQUIRES_REGENERATION");
});

test("fingerprint mismatch and missing fingerprint are strict stale states", () => {
  const before = snapshot();
  const mismatched = artifact(before, { source_path: "ROUND-001.json" });
  mismatched.fingerprint = {
    ...mismatched.fingerprint,
    governance_hash: "0".repeat(64),
  };
  const missing = artifact(before, { round_id: "ROUND-002", source_path: "ROUND-002.json" }, { fingerprint: false });

  const report = analyzeMigrationImpact(before, spec(), [mismatched, missing]);
  const statuses = Object.fromEntries(report.affectedArtifacts.map((item) => [item.round_id, item]));
  const missingReadiness = forecastReadiness(before, before, missing);

  assert.equal(statuses["ROUND-001"].status, "stale");
  assert.equal(statuses["ROUND-001"].reason, "fingerprint_mismatch");
  assert.equal(statuses["ROUND-002"].status, "stale");
  assert.equal(statuses["ROUND-002"].reason, "missing_fingerprint");
  assert.equal(missingReadiness.before.status, "READY");
});

test("validity priority reports removed transitions as orphaned before incompatible", () => {
  const before = snapshot();
  const transition = before.optional_gate_transitions[0];
  const current = artifact(before, { transition });
  const after = normalizeGovernance({
    ...before,
    allowed_transitions: before.allowed_transitions.filter((item) => item !== transition),
    optional_gate_transitions: before.optional_gate_transitions.filter((item) => item !== transition),
    phase_to_expected_transition: {
      ...before.phase_to_expected_transition,
      [transition.split("->")[0]]: null,
    },
  });

  const result = classifyArtifactValidity(before, after, current, {
    before_hash: governanceHash(before),
    after_hash: governanceHash(after),
  });

  assert.equal(result.after_valid, false);
  assert.equal(result.status, "orphaned");
  assert.equal(result.reason, "transition_removed");
  assert.equal(classifyMigrationSafety({
    issues: [],
    affectedArtifacts: [result],
    affectedReadyChecks: [],
  }), "REQUIRES_MANUAL_REVIEW");
});

test("safety priority sends impact issues to manual review before regeneration", () => {
  const safety = classifyMigrationSafety({
    issues: [{ severity: "fail", code: "unknown_diff_category" }],
    affectedArtifacts: [{ status: "stale" }],
    affectedReadyChecks: [],
  });

  assert.equal(safety, "REQUIRES_MANUAL_REVIEW");
});

test("dependency graph carries migration id and scoped artifact edges", () => {
  const before = snapshot();
  const current = artifact(before);
  const unrelated = artifact(before, {
    round_id: "ROUND-002",
    transition: "work->verify",
    verdict: "proceed",
    source_path: "ROUND-002.json",
  });
  const plan = {
    migration_id: "scoped-graph",
    changes: [
      { category: "package_version" },
      { category: "valid_verdicts", removed: ["blocked"], added: [] },
    ],
  };

  const graph = buildDependencyGraph(plan, [current, unrelated], before, before);

  assert.equal(graph.some((edge) => edge.migration === "scoped-graph"), true);
  assert.equal(graph.filter((edge) => edge.change === "package_version").length, 2);
  assert.equal(graph.some((edge) => edge.change === "valid_verdicts"), false);
});
