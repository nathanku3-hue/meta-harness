"use strict";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveSelectedRepo(artifact, repos = []) {
  if (!isPlainObject(artifact)) {
    return {
      ok: false,
      code: "ARTIFACT_INVALID",
      detail: "operator plan artifact must be a plain object"
    };
  }

  const plan = artifact.operator_execution_plan;
  if (!isPlainObject(plan)) {
    return {
      ok: false,
      code: "ARTIFACT_INVALID",
      detail: "embedded operator_execution_plan must be a plain object"
    };
  }

  if (plan.verdict !== "ready_for_operator" || plan.ok !== true) {
    return {
      ok: false,
      code: "ARTIFACT_INVALID",
      detail: "embedded operator_execution_plan must have verdict=ready_for_operator and ok=true"
    };
  }

  const name = plan.selected_repo;
  if (typeof name !== "string" || name.length === 0) {
    return {
      ok: false,
      code: "NO_SELECTED_REPO",
      detail: "operator_execution_plan.selected_repo must be a non-empty string"
    };
  }

  if (!Array.isArray(repos)) {
    repos = [];
  }

  const matches = repos.filter((r) => isPlainObject(r) && r.name === name);

  if (matches.length === 0) {
    return {
      ok: false,
      code: "missing_repo",
      detail: `no entry with name=${name} found in repos index`
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      code: "ambiguous_repo",
      detail: `multiple entries with name=${name} in repos index`
    };
  }

  const repo = matches[0];
  if (typeof repo.path !== "string" || repo.path.length === 0) {
    return {
      ok: false,
      code: "invalid_repo_path",
      detail: `repo ${name} has no valid path in index`
    };
  }

  return {
    ok: true,
    name,
    path: repo.path
  };
}

module.exports = {
  resolveSelectedRepo
};
