"use strict";

const HANDOFF_KIND = "read_only_review_handoff";

const DRIFT_REASONS = Object.freeze({
  template_manifest: "child has template manifest drift",
  security_surface: "child has security policy surface drift",
  skill_registry: "child has skill registry drift",
  governance_compatibility: "child has governance compatibility drift",
});

function compactStrings(values) {
  return Array.isArray(values) ? values.filter((value) => value != null && value !== "").map(String) : [];
}

function uniqueInOrder(values) {
  const seen = new Set();
  const output = [];
  for (const value of compactStrings(values)) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function checkIds(checks) {
  return compactStrings(Array.isArray(checks) ? checks.map((check) => check && check.id) : []);
}

function driftWarnings(repo) {
  return Array.isArray(repo && repo.drift_warnings) ? repo.drift_warnings : [];
}

function warningChecks(repo) {
  return Array.isArray(repo && repo.warning_checks) ? repo.warning_checks : [];
}

function failingChecks(repo) {
  return Array.isArray(repo && repo.failing_checks) ? repo.failing_checks : [];
}

function readinessCheckIds(repo) {
  return [...checkIds(failingChecks(repo)), ...checkIds(warningChecks(repo))];
}

function driftWarningIds(repo) {
  return compactStrings(driftWarnings(repo).map((warning) => warning && warning.id));
}

function sources(repo) {
  return uniqueInOrder([
    repo && repo.source,
    ...driftWarnings(repo).map((warning) => warning && warning.source),
  ]);
}

function driftReason(repo) {
  for (const kind of ["template_manifest", "security_surface", "skill_registry", "governance_compatibility"]) {
    if (driftWarnings(repo).some((warning) => warning && warning.kind === kind)) return DRIFT_REASONS[kind];
  }
  return null;
}

function handoffReason(repo) {
  if (!repo) return null;
  if (repo.state === "failed") return "child readiness failed";
  if (repo.state === "stale") return "child readiness evidence is stale";
  if (repo.state === "invalid") return "child readiness evidence is invalid";
  if (repo.state === "missing") return "configured child repo path is missing";
  if (repo.state === "unknown") return "child readiness state is unknown";
  if (warningChecks(repo).length > 0 || repo.state === "warned") return "child readiness has warnings";
  return driftReason(repo);
}

function buildHandoffItem(repo) {
  const reason = handoffReason(repo);
  if (!reason) return null;
  return {
    repo: String(repo.name || "unknown"),
    state: String(repo.state || "unknown"),
    reason,
    sources: sources(repo),
    drift_warning_ids: driftWarningIds(repo),
    readiness_check_ids: readinessCheckIds(repo),
    mutates: false,
  };
}

function buildResponseHandoff(repos) {
  const items = [];
  for (const repo of Array.isArray(repos) ? repos : []) {
    const item = buildHandoffItem(repo);
    if (item) items.push(item);
  }
  return {
    kind: HANDOFF_KIND,
    severity: items.length > 0 ? "warn" : "info",
    next_action: items.length > 0 ? "review_child_repo_evidence" : "none",
    items,
  };
}

module.exports = { buildResponseHandoff };
