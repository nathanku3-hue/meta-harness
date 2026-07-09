"use strict";

const path = require("node:path");
const { stateHash } = require("./state-hash");
const { getRepoGitState } = require("./repo-git-state");
const { resolveSelectedRepo } = require("./selected-repo-resolver");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function baseReadiness() {
  return {
    kind: "execution_readiness",
    source: "operator_plan_artifact",
    verdict: "not_requested",
    ok: false,
    selected_repo: null,
    captured: null,
    plan_artifact_digest: null,
    reasons: [],
    runs_read_only_git_inspection: false,
    executes_child_commands: false,
    mutates: false,
    writes_files: false,
    writes_parent_files: false,
    writes_child_files: false,
    applies_patches: false,
    creates_tasks: false,
    creates_queues: false,
    refreshes_readiness: false,
    records_decision: false,
    records_approval: false,
  };
}

/**
 * Live execution readiness gate. Fail-closed unless:
 * - operatorPlanArtifactValidation.ok === true
 * - selectedRepoResolution.ok === true
 * - resolved child is an existing clean git repo with HEAD
 */
function buildExecutionReadiness({
  operatorPlanArtifact,
  operatorPlanArtifactValidation,
  selectedRepoResolution,
  cwd = process.cwd(),
} = {}) {
  const readiness = baseReadiness();

  if (isPlainObject(operatorPlanArtifact)) {
    readiness.plan_artifact_digest = stateHash(operatorPlanArtifact);
    const plan = operatorPlanArtifact.operator_execution_plan;
    if (isPlainObject(plan) && typeof plan.selected_repo === "string") {
      readiness.selected_repo = plan.selected_repo;
    }
  }

  if (!operatorPlanArtifactValidation || operatorPlanArtifactValidation.ok !== true) {
    readiness.verdict = "artifact_invalid";
    readiness.reasons.push({
      code: "ARTIFACT_INVALID",
      detail: "operator plan artifact validation must pass (ok=true) before readiness",
    });
    return readiness;
  }

  if (!selectedRepoResolution || selectedRepoResolution.ok !== true) {
    const code = selectedRepoResolution && selectedRepoResolution.code
      ? selectedRepoResolution.code
      : "missing_repo";
    const detail = selectedRepoResolution && selectedRepoResolution.detail
      ? selectedRepoResolution.detail
      : "selected repo could not be resolved";

    if (code === "ambiguous_repo") {
      readiness.verdict = "ambiguous_repo";
      readiness.reasons.push({ code: "ambiguous_repo", detail });
    } else if (code === "ARTIFACT_INVALID") {
      readiness.verdict = "artifact_invalid";
      readiness.reasons.push({ code: "ARTIFACT_INVALID", detail });
    } else {
      readiness.verdict = "missing_repo";
      readiness.reasons.push({
        code: code === "NO_SELECTED_REPO" || code === "invalid_repo_path" ? code : "missing_repo",
        detail,
      });
    }
    return readiness;
  }

  const resolvedChildPath = selectedRepoResolution.path;
  if (!resolvedChildPath || typeof resolvedChildPath !== "string") {
    readiness.verdict = "missing_repo";
    readiness.reasons.push({
      code: "missing_repo",
      detail: "resolved repo path is missing or invalid",
    });
    return readiness;
  }

  const absolutePath = path.resolve(cwd, resolvedChildPath);
  const gitState = getRepoGitState(absolutePath);
  readiness.captured = {
    exists: gitState.exists,
    isGitRepo: gitState.isGitRepo,
    branch: gitState.branch,
    detached: gitState.detached,
    has_head: gitState.has_head,
    head_commit: gitState.head_commit,
    is_clean: gitState.is_clean,
    dirty: gitState.dirty,
    state_hash: gitState.state_hash,
  };
  readiness.runs_read_only_git_inspection = true;

  if (!gitState.exists) {
    readiness.verdict = "missing_repo";
    readiness.reasons.push({
      code: "GIT_REPO_PATH_INVALID",
      detail: `child path does not exist or is not a directory: ${resolvedChildPath}`,
    });
    return readiness;
  }

  if (!gitState.isGitRepo) {
    readiness.verdict = "not_git_repo";
    readiness.reasons.push({
      code: "not_git_repo",
      detail: `path is not inside a git repository: ${resolvedChildPath}`,
    });
    return readiness;
  }

  if (!gitState.has_head) {
    readiness.verdict = "git_unavailable";
    readiness.reasons.push({
      code: "GIT_EMPTY_REPO",
      detail: "repository has no HEAD commit (empty repo)",
    });
    return readiness;
  }

  if (!gitState.is_clean) {
    readiness.verdict = "dirty";
    readiness.reasons.push({
      code: "REPO_DIRTY",
      detail: `child repo has ${gitState.dirty.count} dirty items (staged or untracked)`,
    });
    return readiness;
  }

  readiness.verdict = "ready";
  readiness.ok = true;
  readiness.reasons = [];
  return readiness;
}

/**
 * Attach selected_repo_resolution + execution_readiness to a rollup when verify-op is requested.
 * Always emits execution_readiness (fail-closed). Resolution only when validation.ok.
 */
function attachExecutionReadinessToRollup(rollup, {
  operatorPlanArtifact,
  operatorPlanArtifactValidation,
  packetBoundaryRepos,
  cwd,
}) {
  let selectedRepoResolution = null;
  if (operatorPlanArtifactValidation && operatorPlanArtifactValidation.ok === true && isPlainObject(operatorPlanArtifact)) {
    selectedRepoResolution = resolveSelectedRepo(operatorPlanArtifact, packetBoundaryRepos || []);
    rollup.selected_repo_resolution = selectedRepoResolution;
  }

  const readiness = buildExecutionReadiness({
    operatorPlanArtifact,
    operatorPlanArtifactValidation,
    selectedRepoResolution,
    cwd,
  });
  rollup.execution_readiness = readiness;
  rollup.runs_read_only_git_inspection = readiness.runs_read_only_git_inspection === true;
  return rollup;
}

function renderExecutionReadinessMarkdown(readiness) {
  if (!readiness) return [];
  const lines = ["", "## Execution Readiness", ""];
  lines.push(`- verdict: ${readiness.verdict}`);
  lines.push(`- ok: ${readiness.ok}`);
  lines.push(`- selected_repo: ${readiness.selected_repo || "none"}`);
  if (readiness.captured) {
    const c = readiness.captured;
    lines.push(`- branch: ${c.branch || (c.detached ? "(detached)" : "none")}`);
    lines.push(`- head_commit: ${c.head_commit || "none"}`);
    lines.push(`- is_clean: ${c.is_clean}`);
    if (c.dirty) {
      lines.push(`- dirty: count=${c.dirty.count} staged=${c.dirty.has_staged} untracked=${c.dirty.has_untracked}`);
    }
  }
  if (Array.isArray(readiness.reasons) && readiness.reasons.length > 0) {
    lines.push("- reasons:");
    readiness.reasons.forEach((r) => lines.push(`  - ${r.code}: ${r.detail}`));
  }
  return lines;
}

module.exports = {
  buildExecutionReadiness,
  attachExecutionReadinessToRollup,
  renderExecutionReadinessMarkdown,
};
