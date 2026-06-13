"use strict";

const {
  governanceHash,
  normalizeGovernance,
} = require("./context-gate-governance");

function setDiff(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    added: right.filter((item) => !leftSet.has(item)),
    removed: left.filter((item) => !rightSet.has(item)),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addSetChange(changes, category, label, baseline, current) {
  const diff = setDiff(baseline, current);
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  changes.push({
    category,
    label,
    added: diff.added,
    removed: diff.removed,
  });
}

function addValueChange(changes, category, label, baseline, current) {
  if (sameJson(baseline, current)) return;
  changes.push({
    category,
    label,
    baseline,
    current,
  });
}

function partitionChanges(baseline, current) {
  const required = setDiff(baseline.required_gate_transitions, current.required_gate_transitions);
  const advisory = setDiff(baseline.optional_gate_transitions, current.optional_gate_transitions);
  if (
    required.added.length === 0 &&
    required.removed.length === 0 &&
    advisory.added.length === 0 &&
    advisory.removed.length === 0
  ) {
    return null;
  }
  return {
    category: "gate_partition",
    label: "required/advisory gate partition changed",
    required,
    advisory,
  };
}

function diffGovernanceSnapshots(baselineSnapshot, currentSnapshot) {
  const baseline = normalizeGovernance(baselineSnapshot);
  const current = normalizeGovernance(currentSnapshot);
  const changes = [];

  addSetChange(changes, "allowed_transitions", "allowed transitions changed", baseline.allowed_transitions, current.allowed_transitions);
  const partition = partitionChanges(baseline, current);
  if (partition) changes.push(partition);
  addValueChange(changes, "phase_order", "phase order changed", baseline.phases, current.phases);
  addValueChange(changes, "phase_to_expected_transition", "phase-to-transition map changed", baseline.phase_to_expected_transition, current.phase_to_expected_transition);
  addSetChange(changes, "dimensions", "dimensions changed", baseline.dimensions, current.dimensions);
  addSetChange(changes, "valid_verdicts", "valid verdicts changed", baseline.valid_verdicts, current.valid_verdicts);
  addSetChange(changes, "execution_transitions", "execution transitions changed", baseline.execution_transitions, current.execution_transitions);
  addSetChange(changes, "bypass_reason_codes", "bypass reason codes changed", baseline.bypass_reason_codes, current.bypass_reason_codes);
  addValueChange(changes, "artifact_age_policy", "artifact age policy changed", baseline.default_max_artifact_age_days, current.default_max_artifact_age_days);
  addValueChange(changes, "package_version", "package version changed", baseline.version, current.version);
  addValueChange(changes, "contract_template_hash", "contract template hash changed", {
    path: baseline.contract_template_path,
    hash: baseline.contract_template_hash,
  }, {
    path: current.contract_template_path,
    hash: current.contract_template_hash,
  });
  addValueChange(changes, "governance_engine_hash", "governance engine hash changed", baseline.governance_engine_hash, current.governance_engine_hash);

  return {
    schema_version: "1",
    ok: changes.length === 0,
    baseline_hash: governanceHash(baseline),
    current_hash: governanceHash(current),
    counts: {
      changes: changes.length,
    },
    changes,
  };
}

module.exports = { diffGovernanceSnapshots };
