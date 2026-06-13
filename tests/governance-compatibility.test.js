"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyGovernanceChanges } = require("../lib/governance-compatibility");

function assertClassification(actual, expected) {
  assert.equal(actual.change_level, expected.change_level);
  assert.equal(actual.breaking, expected.breaking);
  assert.equal(actual.migration_required, expected.migration_required);
  assert.equal(Array.isArray(actual.reasons), true);
}

test("governance compatibility classifies a clean diff as NONE", () => {
  const result = classifyGovernanceChanges([]);

  assert.deepEqual(result.classification, {
    change_level: "NONE",
    breaking: false,
    migration_required: false,
    reasons: [],
  });
  assert.deepEqual(result.annotated_changes, []);
});

test("governance compatibility classifies explicit value categories", () => {
  const cases = [
    {
      change: { category: "package_version", label: "package version changed", baseline: "0.1.0", current: "0.1.1" },
      expected: { change_level: "PATCH", breaking: false, migration_required: false },
      breakingReason: null,
    },
    {
      change: { category: "contract_template_hash", label: "contract template hash changed", baseline: "a", current: "b" },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "contract_template_hash_changed",
    },
    {
      change: { category: "governance_engine_hash", label: "governance engine hash changed", baseline: "a", current: "b" },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "governance_engine_hash_changed",
    },
    {
      change: { category: "phase_order", label: "phase order changed", baseline: ["plan", "work"], current: ["work", "plan"] },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "phase_order_changed",
    },
    {
      change: { category: "phase_to_expected_transition", label: "phase-to-transition map changed", baseline: { plan: "plan->work" }, current: { plan: null } },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "phase_to_expected_transition_changed",
    },
    {
      change: { category: "artifact_age_policy", label: "artifact age policy changed", baseline: 7, current: 14 },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "artifact_age_policy_changed",
    },
    {
      change: { category: "dimensions", label: "dimensions changed", added: ["decision_record"], removed: [] },
      expected: { change_level: "MAJOR", breaking: true, migration_required: true },
      breakingReason: "dimensions_changed",
    },
  ];

  for (const { change, expected, breakingReason } of cases) {
    const result = classifyGovernanceChanges([change]);

    assertClassification(result.classification, expected);
    assert.equal(result.annotated_changes[0].severity, expected.change_level);
    assert.equal(result.annotated_changes[0].breaking_reason, breakingReason);
  }
});

test("governance compatibility treats allowlisted set removals as MAJOR", () => {
  const additive = classifyGovernanceChanges([
    { category: "allowed_transitions", label: "allowed transitions changed", added: ["work->done"], removed: [] },
  ]);
  const removal = classifyGovernanceChanges([
    { category: "allowed_transitions", label: "allowed transitions changed", added: [], removed: ["plan->work"] },
  ]);

  assert.equal(additive.classification.change_level, "MINOR");
  assert.equal(additive.classification.breaking, false);
  assert.equal(additive.annotated_changes[0].severity, "MINOR");
  assert.equal(removal.classification.change_level, "MAJOR");
  assert.equal(removal.classification.breaking, true);
  assert.equal(removal.classification.migration_required, true);
  assert.equal(removal.annotated_changes[0].breaking_reason, "allowed_transitions_removed");
});

test("governance compatibility classifies all allowlisted set categories by additive versus removal drift", () => {
  const categories = [
    "allowed_transitions",
    "execution_transitions",
    "valid_verdicts",
    "bypass_reason_codes",
  ];

  for (const category of categories) {
    const additive = classifyGovernanceChanges([
      { category, label: `${category} changed`, added: [`new_${category}`], removed: [] },
    ]);
    const removal = classifyGovernanceChanges([
      { category, label: `${category} changed`, added: [], removed: [`old_${category}`] },
    ]);
    const mixed = classifyGovernanceChanges([
      { category, label: `${category} changed`, added: [`new_${category}`], removed: [`old_${category}`] },
    ]);

    assertClassification(additive.classification, {
      change_level: "MINOR",
      breaking: false,
      migration_required: false,
    });
    assert.equal(additive.annotated_changes[0].breaking_reason, null);
    assertClassification(removal.classification, {
      change_level: "MAJOR",
      breaking: true,
      migration_required: true,
    });
    assert.equal(removal.annotated_changes[0].breaking_reason, `${category}_removed`);
    assertClassification(mixed.classification, {
      change_level: "MAJOR",
      breaking: true,
      migration_required: true,
    });
  }
});

test("governance compatibility classifies gate partition changes conservatively", () => {
  const advisoryAdded = classifyGovernanceChanges([{
    category: "gate_partition",
    label: "required/advisory gate partition changed",
    required: { added: [], removed: [] },
    advisory: { added: ["verify->release"], removed: [] },
  }]);
  assertClassification(advisoryAdded.classification, {
    change_level: "MINOR",
    breaking: false,
    migration_required: false,
  });
  assert.equal(advisoryAdded.annotated_changes[0].breaking_reason, null);

  const cases = [
    {
      change: {
        required: { added: ["plan->work"], removed: [] },
        advisory: { added: [], removed: [] },
      },
      reason: "required_gate_added",
    },
    {
      change: {
        required: { added: [], removed: ["plan->work"] },
        advisory: { added: [], removed: [] },
      },
      reason: "required_gate_removed",
    },
    {
      change: {
        required: { added: [], removed: [] },
        advisory: { added: [], removed: ["verify->release"] },
      },
      reason: "advisory_gate_removed",
    },
    {
      change: {
        required: { added: ["plan->work"], removed: [] },
        advisory: { added: ["verify->release"], removed: [] },
      },
      reason: "required_gate_added",
    },
  ];

  for (const { change, reason } of cases) {
    const result = classifyGovernanceChanges([{
      category: "gate_partition",
      label: "required/advisory gate partition changed",
      ...change,
    }]);

    assertClassification(result.classification, {
      change_level: "MAJOR",
      breaking: true,
      migration_required: true,
    });
    assert.match(result.annotated_changes[0].breaking_reason, new RegExp(reason));
  }
});

test("governance compatibility fails closed for unknown categories", () => {
  const result = classifyGovernanceChanges([
    { category: "future_category", label: "future category changed" },
  ]);

  assert.equal(result.classification.change_level, "MAJOR");
  assert.equal(result.classification.breaking, true);
  assert.equal(result.classification.migration_required, true);
  assert.equal(result.annotated_changes[0].breaking_reason, "unknown_category:future_category");
  assert.deepEqual(result.classification.reasons, [
    {
      code: "unknown_category",
      category: "future_category",
      change_level: "MAJOR",
      breaking: true,
      message: "unknown governance diff category future_category classified as MAJOR",
    },
  ]);
});

test("governance compatibility fails closed for unknown schema-shape categories even when additive", () => {
  const result = classifyGovernanceChanges([
    { category: "schema_shape", label: "schema shape changed", added: ["field"], removed: [] },
  ]);

  assertClassification(result.classification, {
    change_level: "MAJOR",
    breaking: true,
    migration_required: true,
  });
  assert.equal(result.classification.reasons[0].code, "unknown_category");
  assert.equal(result.classification.reasons[0].category, "schema_shape");
  assert.match(result.classification.reasons[0].message, /schema_shape/);
});
