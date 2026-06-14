"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { validateContextGateArtifact } = require("./context-gate-validation");
const { contextGateGovernance } = require("./context-gate-utils");
const {
  governanceHash,
  normalizeGovernance,
} = require("./context-gate-governance");
const {
  applyMigrationToSnapshot,
  planMigration,
} = require("./governance-migration");

const KNOWN_DIFF_CATEGORIES = new Set([
  "allowed_transitions",
  "artifact_age_policy",
  "bypass_reason_codes",
  "contract_template_hash",
  "dimensions",
  "execution_transitions",
  "gate_partition",
  "governance_engine_hash",
  "package_version",
  "phase_order",
  "phase_to_expected_transition",
  "valid_verdicts",
]);

function slashPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function artifactLabel(artifact) {
  return artifact && (artifact.source_path || artifact.path || artifact.artifact_path || artifact.round_id || "<artifact>");
}

function validateArtifactForGovernance(governance, artifact) {
  return validateContextGateArtifact(artifact, {
    governance,
    maxAgeDays: null,
  });
}

function gateStatus(governance, transition) {
  const rules = contextGateGovernance(governance);
  if (!rules.allowedTransitions.includes(transition)) return "removed";
  if (rules.requiredGateTransitionSet.has(transition)) return "required";
  if (rules.optionalGateTransitionSet.has(transition)) return "advisory";
  return "allowed";
}

function readinessForSnapshot(governance, artifact) {
  const transition = artifact && artifact.transition;
  const validation = validateArtifactForGovernance(governance, artifact);
  const gate = gateStatus(governance, transition);
  const required = gate === "required";

  if (!validation.ok) {
    return {
      status: "BLOCKED",
      gate,
      required,
      valid: false,
      reason: "validation_failed",
      errors: validation.errors,
    };
  }

  if (!required) {
    return {
      status: "READY",
      gate,
      required: false,
      valid: true,
      reason: artifact.verdict === "blocked" ? "advisory_blocked" : "not_required",
      errors: [],
    };
  }

  if (artifact.verdict === "blocked") {
    return {
      status: "BLOCKED",
      gate,
      required: true,
      valid: true,
      reason: "required_blocked_verdict",
      errors: [],
    };
  }

  return {
    status: "READY",
    gate,
    required: true,
    valid: true,
    reason: "required_satisfied",
    errors: [],
  };
}

function forecastReadiness(before, after, artifact) {
  const beforeResult = readinessForSnapshot(before, artifact);
  const afterResult = readinessForSnapshot(after, artifact);
  const degraded = beforeResult.status === "READY" && afterResult.status === "BLOCKED";
  return {
    artifact: artifactLabel(artifact),
    round_id: artifact && artifact.round_id || null,
    transition: artifact && artifact.transition || null,
    before: beforeResult,
    after: afterResult,
    degraded,
    required_degraded: degraded && afterResult.required,
    reason: degraded ? afterResult.reason : "unchanged",
  };
}

function fingerprintState(before, after, artifact, plan) {
  const beforeHash = plan && plan.before_hash || governanceHash(before);
  const afterHash = plan && plan.after_hash || governanceHash(after);
  const fingerprintHash = artifact && artifact.fingerprint && artifact.fingerprint.governance_hash;
  return {
    present: typeof fingerprintHash === "string" && fingerprintHash.length > 0,
    governance_hash: fingerprintHash || null,
    before_hash: beforeHash,
    after_hash: afterHash,
    matches_before: fingerprintHash === beforeHash,
    matches_after: fingerprintHash === afterHash,
  };
}

function classifyArtifactValidity(before, after, artifact, plan = {}) {
  const transition = artifact && artifact.transition;
  const afterRules = contextGateGovernance(after);
  const beforeValidation = validateArtifactForGovernance(before, artifact);
  const afterValidation = validateArtifactForGovernance(after, artifact);
  const fingerprint = fingerprintState(before, after, artifact, plan);

  let status;
  let reason;

  if (typeof transition === "string" && !afterRules.allowedTransitions.includes(transition)) {
    status = "orphaned";
    reason = "transition_removed";
  } else if (!afterValidation.ok) {
    status = "incompatible";
    reason = "after_validation_failed";
  } else if (!fingerprint.present) {
    status = "stale";
    reason = "missing_fingerprint";
  } else if (!fingerprint.matches_after) {
    status = "stale";
    reason = fingerprint.matches_before ? "governance_hash_changed" : "fingerprint_mismatch";
  } else {
    status = "valid";
    reason = "matches_after_governance";
  }

  return {
    artifact: artifactLabel(artifact),
    round_id: artifact && artifact.round_id || null,
    transition: transition || null,
    status,
    reason,
    before_valid: beforeValidation.ok,
    after_valid: afterValidation.ok,
    before_errors: beforeValidation.errors,
    after_errors: afterValidation.errors,
    fingerprint,
  };
}

function setChangeIncludes(change, value) {
  if (typeof value !== "string") return false;
  return (Array.isArray(change.added) && change.added.includes(value))
    || (Array.isArray(change.removed) && change.removed.includes(value));
}

function gatePartitionIncludes(change, transition) {
  if (typeof transition !== "string") return false;
  for (const partition of [change.required, change.advisory]) {
    if (!partition) continue;
    if (Array.isArray(partition.added) && partition.added.includes(transition)) return true;
    if (Array.isArray(partition.removed) && partition.removed.includes(transition)) return true;
  }
  return false;
}

function mapChangeIncludesTransition(change, transition) {
  if (typeof transition !== "string") return false;
  const values = [
    ...Object.values(change.baseline || {}),
    ...Object.values(change.current || {}),
  ];
  return values.includes(transition);
}

function phaseOrderTouchesTransition(change, transition) {
  if (typeof transition !== "string" || !transition.includes("->")) return false;
  const phases = new Set([
    ...(Array.isArray(change.baseline) ? change.baseline : []),
    ...(Array.isArray(change.current) ? change.current : []),
  ]);
  const [from, to] = transition.split("->");
  return phases.has(from) || phases.has(to);
}

function changeAffectsArtifact(change, artifact) {
  const transition = artifact && artifact.transition;
  switch (change && change.category) {
    case "artifact_age_policy":
    case "contract_template_hash":
    case "dimensions":
    case "governance_engine_hash":
    case "package_version":
      return true;
    case "allowed_transitions":
    case "execution_transitions":
      return setChangeIncludes(change, transition);
    case "gate_partition":
      return gatePartitionIncludes(change, transition);
    case "phase_order":
      return phaseOrderTouchesTransition(change, transition);
    case "phase_to_expected_transition":
      return mapChangeIncludesTransition(change, transition);
    case "valid_verdicts":
      return setChangeIncludes(change, artifact && artifact.verdict);
    case "bypass_reason_codes":
      return setChangeIncludes(change, artifact && artifact.override && artifact.override.code);
    default:
      return false;
  }
}

function buildDependencyGraph(plan, artifacts, before, after) {
  const edges = [];
  for (const change of plan.changes || []) {
    for (const artifact of artifacts || []) {
      if (!changeAffectsArtifact(change, artifact, before, after)) continue;
      edges.push({
        migration: plan.migration_id,
        change: change.category,
        transition: artifact.transition || null,
        artifact: artifactLabel(artifact),
        gate: gateStatus(after, artifact.transition),
      });
    }
  }
  return edges;
}

function impactIssuesForPlan(plan) {
  const issues = [];
  for (const change of plan.changes || []) {
    if (KNOWN_DIFF_CATEGORIES.has(change.category)) continue;
    issues.push({
      severity: "fail",
      code: "unknown_diff_category",
      message: `unknown governance diff category in migration impact: ${change.category || "missing"}`,
      category: change.category || null,
    });
  }
  return issues;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function classifyMigrationSafety(report) {
  const issues = report && Array.isArray(report.issues) ? report.issues : [];
  const artifacts = report && Array.isArray(report.affectedArtifacts) ? report.affectedArtifacts : [];
  const readiness = report && Array.isArray(report.affectedReadyChecks) ? report.affectedReadyChecks : [];
  const hasFailIssue = issues.some((issue) => issue && issue.severity === "fail");
  const hasOrphaned = artifacts.some((artifact) => artifact.status === "orphaned");
  const hasRequiredBlock = readiness.some((item) => item.required_degraded);
  if (hasFailIssue || hasOrphaned || hasRequiredBlock) {
    return "REQUIRES_MANUAL_REVIEW";
  }
  if (artifacts.some((artifact) => artifact.status === "stale" || artifact.status === "incompatible")) {
    return "REQUIRES_REGENERATION";
  }
  return "SAFE";
}

function analyzeMigrationImpact(snapshot, specInput, artifacts = []) {
  const before = normalizeGovernance(snapshot);
  const plan = planMigration(before, specInput);
  const after = applyMigrationToSnapshot(before, specInput);
  const sourceArtifacts = Array.isArray(artifacts) ? artifacts : [];
  const impactIssues = impactIssuesForPlan(plan);
  const affectedArtifacts = sourceArtifacts.map((artifact) => classifyArtifactValidity(before, after, artifact, plan));
  const affectedReadyChecks = sourceArtifacts.map((artifact) => forecastReadiness(before, after, artifact));
  const dependencyGraph = buildDependencyGraph(plan, sourceArtifacts, before, after);
  const issues = [...(plan.issues || []), ...impactIssues];
  const report = {
    schema_version: "1",
    ok: plan.ok && !issues.some((issue) => issue && issue.severity === "fail"),
    action: "migration_impact",
    migration_id: plan.migration_id,
    changeType: plan.classification && plan.classification.change_level || null,
    safety: "SAFE",
    before_hash: plan.before_hash,
    after_hash: plan.after_hash,
    classification: plan.classification,
    changes: plan.changes || [],
    affectedTransitions: [],
    affectedArtifacts,
    affectedReadyChecks,
    dependencyGraph,
    requiresRegeneration: affectedArtifacts
      .filter((artifact) => artifact.status === "stale" || artifact.status === "incompatible")
      .map((artifact) => artifact.artifact),
    issues,
    counts: {
      artifacts: sourceArtifacts.length,
      affected_artifacts: affectedArtifacts.filter((artifact) => artifact.status !== "valid").length,
      readiness_degraded: affectedReadyChecks.filter((item) => item.degraded).length,
      dependency_edges: dependencyGraph.length,
      issues: issues.length,
    },
  };
  report.safety = classifyMigrationSafety(report);
  report.affectedTransitions = uniqueSorted([
    ...affectedArtifacts.filter((artifact) => artifact.status !== "valid").map((artifact) => artifact.transition),
    ...affectedReadyChecks.filter((item) => item.degraded).map((item) => item.transition),
    ...dependencyGraph.map((edge) => edge.transition),
  ]);
  return report;
}

function collectArtifactsFromPaths(artifactPaths) {
  return [...(artifactPaths || [])]
    .map((artifactPath) => path.resolve(String(artifactPath)))
    .sort((left, right) => slashPath(left).localeCompare(slashPath(right)))
    .map((artifactPath) => {
      let raw;
      try {
        raw = fs.readFileSync(artifactPath, "utf8");
      } catch (error) {
        if (error && error.code === "ENOENT") {
          throw new ConfigError(`context gate artifact not found: ${artifactPath}`, { cause: error });
        }
        throw error;
      }
      try {
        const artifact = JSON.parse(raw);
        return {
          ...artifact,
          source_path: slashPath(artifactPath),
        };
      } catch (error) {
        throw new ConfigError(`invalid context gate artifact JSON: ${artifactPath}`, { cause: error });
      }
    });
}

module.exports = {
  analyzeMigrationImpact,
  forecastReadiness,
  classifyArtifactValidity,
  classifyMigrationSafety,
  buildDependencyGraph,
  collectArtifactsFromPaths,
};
