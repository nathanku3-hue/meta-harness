"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildLiveGovernance, governanceHash } = require("../lib/context-gate-governance");
const {
  applyMigrationToSnapshot,
  planMigration,
  validateMigrationSpec,
  verifyMigration,
} = require("../lib/governance-migration");
const {
  CURRENT_PACKAGE_VERSION,
  NEXT_MINOR_VERSION,
} = require("./helpers/package-version");

function snapshot() {
  return buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
}

function spec(overrides = {}) {
  return {
    schema_version: "1",
    migration_id: "test-migration",
    version_source: CURRENT_PACKAGE_VERSION,
    version_target: NEXT_MINOR_VERSION,
    expected_change_level: "PATCH",
    actions: [],
    ...overrides,
  };
}

test("governance migration applies version_target implicitly", () => {
  const before = snapshot();
  const migration = spec();

  const plan = planMigration(before, migration);
  const after = applyMigrationToSnapshot(before, migration);
  const verified = verifyMigration(migration, before, after);

  assert.equal(plan.ok, true);
  assert.equal(plan.classification.change_level, "PATCH");
  assert.deepEqual(plan.changes.map((item) => item.category), ["package_version"]);
  assert.equal(after.version, NEXT_MINOR_VERSION);
  assert.notEqual(governanceHash(before), governanceHash(after));
  assert.equal(verified.ok, true);
});

test("governance migration consumes existing diff classification", () => {
  const before = snapshot();
  const migration = spec({
    expected_change_level: "MINOR",
    actions: [
      { type: "add_to_set", field: "valid_verdicts", value: "deferred" },
    ],
  });

  const plan = planMigration(before, migration);
  const after = applyMigrationToSnapshot(before, migration);
  const categories = new Set(plan.changes.map((item) => item.category));

  assert.equal(plan.ok, true);
  assert.equal(plan.classification.change_level, "MINOR");
  assert.equal(categories.has("package_version"), true);
  assert.equal(categories.has("valid_verdicts"), true);
  assert.equal(after.valid_verdicts.includes("deferred"), true);
});

test("governance migration supports removal and explicit map replacement actions", () => {
  const before = snapshot();
  const removedVerdict = before.valid_verdicts[0];
  const migration = spec({
    expected_change_level: "MAJOR",
    actions: [
      { type: "remove_from_set", field: "valid_verdicts", value: removedVerdict },
      {
        type: "replace_map_value",
        map: "phase_to_expected_transition",
        key: "plan",
        value: before.phase_to_expected_transition.plan,
      },
    ],
  });

  const plan = planMigration(before, migration);
  const after = applyMigrationToSnapshot(before, migration);

  assert.equal(plan.ok, true);
  assert.equal(plan.classification.change_level, "MAJOR");
  assert.equal(after.valid_verdicts.includes(removedVerdict), false);
  assert.equal(after.phase_to_expected_transition.plan, before.phase_to_expected_transition.plan);
});

test("governance migration spec rejects unknown fields and version actions", () => {
  const invalid = validateMigrationSpec(spec({
    extra: true,
    actions: [
      { type: "set", field: "version", value: "0.2.0" },
      { type: "add_to_set", field: "streams", value: "release" },
      { type: "set", field: "default_max_artifact_age_days", value: 0 },
      { type: "set", field: "contract_template_hash", value: "A".repeat(64) },
    ],
  }));
  const codes = invalid.issues.map((item) => item.code);

  assert.equal(invalid.ok, false);
  assert.equal(codes.includes("unknown_field"), true);
  assert.equal(codes.includes("unsupported_field"), true);
  assert.equal(codes.includes("invalid_field"), true);
});

test("governance migration apply requires source version and set membership state", () => {
  const before = snapshot();
  const migration = spec({
    expected_change_level: "MINOR",
    actions: [
      { type: "add_to_set", field: "valid_verdicts", value: before.valid_verdicts[0] },
    ],
  });

  assert.throws(
    () => applyMigrationToSnapshot({ ...before, version: "9.9.9" }, spec()),
    /version_source/
  );
  assert.throws(
    () => applyMigrationToSnapshot(before, migration),
    /already exists/
  );
});

test("governance migration verify fails on undeclared after-state drift", () => {
  const before = snapshot();
  const migration = spec({
    expected_change_level: "MINOR",
    actions: [
      { type: "add_to_set", field: "valid_verdicts", value: "deferred" },
    ],
  });
  const after = applyMigrationToSnapshot(before, migration);
  const tampered = {
    ...after,
    valid_verdicts: [...after.valid_verdicts, "tampered"],
  };

  const verified = verifyMigration(migration, before, tampered);

  assert.equal(verified.ok, false);
  assert.notEqual(verified.expected_hash, verified.actual_hash);
  assert.equal(verified.issues.some((item) => item.code === "governance_hash"), true);
  assert.equal(verified.changes.some((item) => item.category === "valid_verdicts"), true);
});
