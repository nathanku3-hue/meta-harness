"use strict";

const LEVEL_ORDER = {
  NONE: 0,
  PATCH: 1,
  MINOR: 2,
  MAJOR: 3,
};

const BREAKING_VALUE_CATEGORIES = new Set([
  "artifact_age_policy",
  "contract_template_hash",
  "dimensions",
  "governance_engine_hash",
  "phase_order",
  "phase_to_expected_transition",
]);

const ADDITIVE_SET_CATEGORIES = new Set([
  "allowed_transitions",
  "bypass_reason_codes",
  "execution_transitions",
  "valid_verdicts",
]);

function maxLevel(left, right) {
  return LEVEL_ORDER[right] > LEVEL_ORDER[left] ? right : left;
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function fixedClassification(change, changeLevel, breaking, breakingReason) {
  return {
    severity: changeLevel,
    breaking_reason: breaking ? breakingReason || `${change.category}_changed` : null,
    change_level: changeLevel,
    breaking,
  };
}

function classifyAdditiveSet(change) {
  if (hasItems(change.removed)) {
    return fixedClassification(change, "MAJOR", true, `${change.category}_removed`);
  }
  if (hasItems(change.added)) {
    return fixedClassification(change, "MINOR", false, null);
  }
  return fixedClassification(change, "MAJOR", true, `${change.category}_shape_unknown`);
}

function classifyGatePartition(change) {
  let changeLevel = "NONE";
  const breakingReasons = [];

  if (hasItems(change.required && change.required.added)) {
    changeLevel = maxLevel(changeLevel, "MAJOR");
    breakingReasons.push("required_gate_added");
  }
  if (hasItems(change.required && change.required.removed)) {
    changeLevel = maxLevel(changeLevel, "MAJOR");
    breakingReasons.push("required_gate_removed");
  }
  if (hasItems(change.advisory && change.advisory.added)) {
    changeLevel = maxLevel(changeLevel, "MINOR");
  }
  if (hasItems(change.advisory && change.advisory.removed)) {
    changeLevel = maxLevel(changeLevel, "MAJOR");
    breakingReasons.push("advisory_gate_removed");
  }

  if (changeLevel === "NONE") {
    return fixedClassification(change, "MAJOR", true, "gate_partition_shape_unknown");
  }
  return fixedClassification(
    change,
    changeLevel,
    breakingReasons.length > 0,
    breakingReasons.join(",")
  );
}

function unknownCategory(change) {
  const category = change && change.category ? String(change.category) : "unknown";
  return {
    severity: "MAJOR",
    breaking_reason: `unknown_category:${category}`,
    change_level: "MAJOR",
    breaking: true,
    reason: {
      code: "unknown_category",
      category,
      change_level: "MAJOR",
      breaking: true,
      message: `unknown governance diff category ${category} classified as MAJOR`,
    },
  };
}

function classifyChange(change) {
  if (!change || typeof change !== "object") return unknownCategory(change);
  if (change.category === "package_version") {
    return fixedClassification(change, "PATCH", false, null);
  }
  if (BREAKING_VALUE_CATEGORIES.has(change.category)) {
    return fixedClassification(change, "MAJOR", true, `${change.category}_changed`);
  }
  if (ADDITIVE_SET_CATEGORIES.has(change.category)) {
    return classifyAdditiveSet(change);
  }
  if (change.category === "gate_partition") {
    return classifyGatePartition(change);
  }
  return unknownCategory(change);
}

function classifyGovernanceChanges(changes) {
  const sourceChanges = Array.isArray(changes) ? changes : [];
  let changeLevel = "NONE";
  let breaking = false;
  const reasons = [];
  const annotated_changes = sourceChanges.map((change) => {
    const result = classifyChange(change);
    changeLevel = maxLevel(changeLevel, result.change_level);
    breaking = breaking || result.breaking;
    if (result.reason) reasons.push(result.reason);
    return {
      ...change,
      severity: result.severity,
      breaking_reason: result.breaking_reason,
    };
  });

  return {
    classification: {
      change_level: sourceChanges.length === 0 ? "NONE" : changeLevel,
      breaking,
      migration_required: breaking,
      reasons,
    },
    annotated_changes,
  };
}

module.exports = { classifyGovernanceChanges };
