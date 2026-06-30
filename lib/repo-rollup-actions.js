"use strict";

const ACTION_KIND = "review";
const STATUS_SOURCE = ".meta-harness/status.md";
const READY_SOURCE = ".meta-harness/ready.json";
const REPOS_SOURCE = ".meta-harness/repos.json";

const READINESS_ACTIONS = Object.freeze({
  failed: {
    id: "ACTION_REVIEW_FAILED_READINESS",
    priority: "high",
    reason: "review failed child readiness evidence",
  },
  warned: {
    id: "ACTION_REVIEW_WARNED_READINESS",
    priority: "medium",
    reason: "review warned child readiness evidence",
  },
  stale: {
    id: "ACTION_REVIEW_STALE_READINESS",
    priority: "medium",
    reason: "refresh or review stale readiness evidence",
  },
  invalid: {
    id: "ACTION_REVIEW_INVALID_READINESS",
    priority: "high",
    reason: "review invalid child readiness contract",
  },
  missing: {
    id: "ACTION_REVIEW_MISSING_REPO",
    priority: "high",
    reason: "review .meta-harness/repos.json",
  },
  unknown: {
    id: "ACTION_REVIEW_UNKNOWN_READINESS",
    priority: "medium",
    reason: "review child readiness/status evidence",
  },
});

const DRIFT_ACTIONS = Object.freeze({
  governance_compatibility: {
    id: "ACTION_REVIEW_GOVERNANCE_COMPATIBILITY_DRIFT",
    reason: "review child governance compatibility",
  },
  template_manifest: {
    id: "ACTION_REVIEW_TEMPLATE_DRIFT",
    reason: "review template manifest drift",
  },
  security_surface: {
    id: "ACTION_REVIEW_SECURITY_DRIFT",
    reason: "review security policy drift",
  },
  skill_registry: {
    id: "ACTION_REVIEW_SKILL_REGISTRY_DRIFT",
    reason: "review skill registry drift",
  },
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactStrings(values) {
  return asArray(values).filter((value) => value != null && value !== "").map(String);
}

function checkIds(checks) {
  return compactStrings(asArray(checks).map((check) => check && check.id));
}

function stripColonDetail(source) {
  return String(source || "").split(":")[0] || null;
}

function uniqueStrings(values) {
  return [...new Set(compactStrings(values))];
}

function readinessTargetPaths(repo) {
  if (repo && repo.state === "missing") return [REPOS_SOURCE];
  if (repo && repo.source) return [stripColonDetail(repo.source)];
  if (repo && repo.state === "unknown") return [READY_SOURCE, STATUS_SOURCE];
  return [READY_SOURCE];
}

function actionCandidate(fields) {
  return {
    id: fields.id,
    priority: fields.priority,
    kind: ACTION_KIND,
    reason: fields.reason,
    repo: fields.repo,
    source_state: fields.source_state || null,
    source_warning_ids: uniqueStrings(fields.source_warning_ids),
    source_warning_kinds: uniqueStrings(fields.source_warning_kinds),
    source_check_ids: uniqueStrings(fields.source_check_ids),
    target_paths: uniqueStrings(fields.target_paths),
    mutates: false,
  };
}

function readinessAction(repo) {
  if (!repo || !READINESS_ACTIONS[repo.state]) return null;
  const action = READINESS_ACTIONS[repo.state];
  return actionCandidate({
    id: action.id,
    priority: action.priority,
    reason: action.reason,
    repo: repo.name,
    source_state: repo.state,
    source_warning_ids: [],
    source_warning_kinds: [],
    source_check_ids: [...checkIds(repo.failing_checks), ...checkIds(repo.warning_checks)],
    target_paths: readinessTargetPaths(repo),
  });
}

function driftAction(repo, warning) {
  if (!warning || !DRIFT_ACTIONS[warning.kind]) return null;
  const action = DRIFT_ACTIONS[warning.kind];
  return actionCandidate({
    id: action.id,
    priority: "low",
    reason: action.reason,
    repo: repo.name,
    source_state: null,
    source_warning_ids: [warning.id],
    source_warning_kinds: [warning.kind],
    source_check_ids: [],
    target_paths: [stripColonDetail(warning.source)],
  });
}

function buildActionCandidates(repo) {
  const candidates = [];
  const readiness = readinessAction(repo);
  if (readiness) candidates.push(readiness);
  for (const warning of asArray(repo && repo.drift_warnings)) {
    const candidate = driftAction(repo, warning);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

module.exports = { buildActionCandidates };
