"use strict";

const ACTION_KIND = "review";
const ACTION_SEVERITY = "info";
const STATUS_SOURCE = ".meta-harness/status.md";
const READY_SOURCE = ".meta-harness/ready.json";
const REPOS_SOURCE = ".meta-harness/repos.json";

const READINESS_ACTIONS = Object.freeze({
  failed: ["ACTION_REVIEW_FAILED_READINESS", "review failed child readiness evidence before planning follow-up"],
  warned: ["ACTION_REVIEW_WARNED_READINESS", "review warned child readiness evidence before planning follow-up"],
  stale: ["ACTION_REVIEW_STALE_READINESS", "review stale child readiness evidence before planning follow-up"],
  invalid: ["ACTION_REVIEW_INVALID_READINESS", "review invalid child readiness evidence before planning follow-up"],
  unknown: ["ACTION_REVIEW_UNKNOWN_READINESS", "review unknown child readiness evidence before planning follow-up"],
  missing: ["ACTION_REVIEW_MISSING_REPO", "review configured child repo path before planning follow-up"],
});

const DRIFT_ACTIONS = Object.freeze({
  governance_compatibility: ["ACTION_REVIEW_GOVERNANCE_DRIFT", "review governance drift before planning follow-up"],
  template_manifest: ["ACTION_REVIEW_TEMPLATE_DRIFT", "review template manifest drift before planning follow-up"],
  security_surface: ["ACTION_REVIEW_SECURITY_DRIFT", "review security surface drift before planning follow-up"],
  skill_registry: ["ACTION_REVIEW_SKILL_DRIFT", "review skill registry drift before planning follow-up"],
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

function readinessTargetPath(repo) {
  if (repo && repo.state === "missing") return REPOS_SOURCE;
  if (repo && repo.source) return stripColonDetail(repo.source);
  return repo && repo.state ? READY_SOURCE : STATUS_SOURCE;
}

function actionCandidate(fields) {
  return {
    id: fields.id,
    kind: ACTION_KIND,
    severity: ACTION_SEVERITY,
    reason: fields.reason,
    source_state: fields.source_state || null,
    source_warning_id: fields.source_warning_id || null,
    source_warning_kind: fields.source_warning_kind || null,
    source_check_ids: compactStrings(fields.source_check_ids),
    target_path: fields.target_path || STATUS_SOURCE,
    mutates: false,
  };
}

function readinessAction(repo) {
  if (!repo || !READINESS_ACTIONS[repo.state]) return null;
  const [id, reason] = READINESS_ACTIONS[repo.state];
  return actionCandidate({
    id,
    reason,
    source_state: repo.state,
    source_check_ids: [...checkIds(repo.failing_checks), ...checkIds(repo.warning_checks)],
    target_path: readinessTargetPath(repo),
  });
}

function driftAction(warning) {
  if (!warning || !DRIFT_ACTIONS[warning.kind]) return null;
  const [id, reason] = DRIFT_ACTIONS[warning.kind];
  return actionCandidate({
    id,
    reason,
    source_warning_id: warning.id,
    source_warning_kind: warning.kind,
    target_path: stripColonDetail(warning.source),
  });
}

function buildActionCandidates(repo) {
  const candidates = [];
  const readiness = readinessAction(repo);
  if (readiness) candidates.push(readiness);
  for (const warning of asArray(repo && repo.drift_warnings)) {
    const candidate = driftAction(warning);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

module.exports = { buildActionCandidates };
