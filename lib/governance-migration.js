"use strict";

const { ConfigError } = require("./errors");
const {
  governanceHash,
  normalizeGovernance,
  validateGovernance,
} = require("./context-gate-governance");
const { diffGovernanceSnapshots } = require("./governance-diff");
const {
  cloneJson,
  hasOwn,
  readMigrationSpec,
  requireValidSpec,
  validateMigrationSpec,
} = require("./governance-migration-spec");

function requireSnapshotVersion(snapshot, spec, label) {
  if (snapshot.version !== spec.version_source) {
    throw new ConfigError(`${label}.version must match migration version_source`, {
      details: { expected: spec.version_source, actual: snapshot.version },
    });
  }
}

function requireValidSnapshot(snapshot, label) {
  const validation = validateGovernance(snapshot);
  if (!validation.ok) {
    throw new ConfigError(`${label} governance snapshot is invalid: ${validation.issues.map((item) => item.code).join(", ")}`, {
      details: { issues: validation.issues },
    });
  }
  return validation;
}

function requireSetItemState(action, items, shouldExist) {
  const exists = items.includes(action.value);
  if (shouldExist && !exists) {
    throw new ConfigError(`${action.type} value is missing from ${action.field}`, {
      details: { field: action.field, value: action.value },
    });
  }
  if (!shouldExist && exists) {
    throw new ConfigError(`${action.type} value already exists in ${action.field}`, {
      details: { field: action.field, value: action.value },
    });
  }
}

function applyAction(snapshot, action) {
  if (action.type === "set") {
    snapshot[action.field] = cloneJson(action.value);
    return;
  }
  if (action.type === "add_to_set") {
    const items = Array.isArray(snapshot[action.field]) ? [...snapshot[action.field]] : [];
    requireSetItemState(action, items, false);
    snapshot[action.field] = [...items, action.value];
    return;
  }
  if (action.type === "remove_from_set") {
    const items = Array.isArray(snapshot[action.field]) ? [...snapshot[action.field]] : [];
    requireSetItemState(action, items, true);
    snapshot[action.field] = items.filter((item) => item !== action.value);
    return;
  }

  const mapValue = snapshot[action.map];
  if (!mapValue || typeof mapValue !== "object" || Array.isArray(mapValue) || !hasOwn(mapValue, action.key)) {
    throw new ConfigError(`replace_map_value key is missing from ${action.map}`, {
      details: { map: action.map, key: action.key },
    });
  }
  snapshot[action.map] = { ...mapValue, [action.key]: action.value };
}

function applyMigrationToSnapshot(snapshot, specInput) {
  const spec = requireValidSpec(specInput);
  const before = normalizeGovernance(snapshot);
  requireSnapshotVersion(before, spec, "snapshot");
  requireValidSnapshot(before, "source");

  const after = cloneJson(before);
  for (const action of spec.actions) applyAction(after, action);
  after.version = spec.version_target;

  const normalized = normalizeGovernance(after);
  if (normalized.version !== spec.version_target) {
    throw new ConfigError("migrated snapshot.version must match migration version_target");
  }
  requireValidSnapshot(normalized, "migrated");
  return normalized;
}

function planMigration(snapshot, specInput) {
  const spec = requireValidSpec(specInput);
  const before = normalizeGovernance(snapshot);
  const after = applyMigrationToSnapshot(before, spec);
  const diff = diffGovernanceSnapshots(before, after);
  const beforeHash = governanceHash(before);
  const afterHash = governanceHash(after);
  const issues = [];
  if (diff.classification.change_level !== spec.expected_change_level) {
    issues.push({
      severity: "fail",
      code: "expected_change_level",
      message: `expected ${spec.expected_change_level} migration change level but got ${diff.classification.change_level}`,
      expected: spec.expected_change_level,
      actual: diff.classification.change_level,
    });
  }
  if (beforeHash !== afterHash && diff.counts.changes === 0) {
    issues.push({
      severity: "fail",
      code: "diff_coverage",
      message: "migration changed governance hash without an explainable diff category",
      before_hash: beforeHash,
      after_hash: afterHash,
    });
  }
  return {
    schema_version: "1",
    ok: issues.length === 0,
    action: "migration_plan",
    migration_id: spec.migration_id,
    version_source: spec.version_source,
    version_target: spec.version_target,
    expected_change_level: spec.expected_change_level,
    before_hash: beforeHash,
    after_hash: afterHash,
    classification: diff.classification,
    counts: diff.counts,
    changes: diff.changes,
    diff,
    issues,
  };
}

function verifyMigration(specInput, beforeSnapshot, afterSnapshot) {
  const spec = requireValidSpec(specInput);
  const plan = planMigration(beforeSnapshot, spec);
  if (!plan.ok) return { ...plan, action: "migration_verify" };

  const expected = applyMigrationToSnapshot(beforeSnapshot, spec);
  const actual = normalizeGovernance(afterSnapshot);
  const actualValidation = validateGovernance(actual);
  const expectedHash = governanceHash(expected);
  const actualHash = governanceHash(actual);
  const issues = [];
  if (actual.version !== spec.version_target) {
    issues.push({
      severity: "fail",
      code: "version_target",
      message: "after snapshot.version must match migration version_target",
      expected: spec.version_target,
      actual: actual.version,
    });
  }
  if (!actualValidation.ok) issues.push(...actualValidation.issues);
  if (actualHash !== expectedHash) {
    issues.push({
      severity: "fail",
      code: "governance_hash",
      message: "after snapshot does not match migration output",
      expected: expectedHash,
      actual: actualHash,
    });
  }

  const diff = diffGovernanceSnapshots(expected, actual);
  return {
    schema_version: "1",
    ok: issues.length === 0,
    action: "migration_verify",
    migration_id: spec.migration_id,
    version_source: spec.version_source,
    version_target: spec.version_target,
    expected_hash: expectedHash,
    actual_hash: actualHash,
    classification: diff.classification,
    counts: diff.counts,
    changes: diff.changes,
    diff,
    issues,
  };
}

module.exports = {
  readMigrationSpec,
  validateMigrationSpec,
  planMigration,
  applyMigrationToSnapshot,
  verifyMigration,
};
