"use strict";

const { evaluateEntryAuthority } = require("./contracts/entry-authority");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safetyFlags() {
  return {
    mutates: false,
    writes_files: false,
    writes_parent_files: false,
    writes_child_files: false,
    executes_child_commands: false,
    applies_patches: false,
    creates_tasks: false,
    creates_queues: false,
    refreshes_readiness: false,
    records_decision: false,
    records_approval: false,
  };
}

function baseGate() {
  return {
    kind: "worker_entry_gate",
    source: "execution_readiness",
    verdict: "blocked",
    ok: false,
    required_inputs: {
      operator_plan_validation_ok: false,
      selected_repo_resolution_ok: false,
      execution_readiness_ok: false,
      read_only_git_inspection_ran: false,
      entry_authority_verdict: "MISSING",
      executes_child_commands: false,
    },
    reasons: [],
    ...safetyFlags(),
  };
}

/**
 * Pure consumption gate over 21F validation + selected_repo_resolution + 22A readiness.
 * Does not re-inspect git. open ≠ execution authority.
 *
 * @param {object} [input]
 * @param {object} [input.operatorPlanArtifactValidation]
 * @param {object} [input.selectedRepoResolution]
 * @param {object} [input.executionReadiness]
 * @param {object} [input.entryAuthority] collected entry-authority result
 * @param {object} [input.entryAuthorityInput] required raw pre-planning entry-authority input
 * @param {boolean} [input.requested=true] verify-op path
 */
function buildWorkerEntryGate({
  operatorPlanArtifactValidation,
  selectedRepoResolution,
  executionReadiness,
  entryAuthority,
  entryAuthorityInput,
  requested = true,
} = {}) {
  const gate = baseGate();

  if (requested !== true) {
    gate.verdict = "not_requested";
    gate.ok = false;
    gate.reasons = [{ code: "NOT_REQUESTED", detail: "worker entry gate not requested" }];
    return gate;
  }

  const validationOk =
    isPlainObject(operatorPlanArtifactValidation) && operatorPlanArtifactValidation.ok === true;
  const resolutionOk =
    isPlainObject(selectedRepoResolution) && selectedRepoResolution.ok === true;
  const readinessPresent = isPlainObject(executionReadiness);
  const readinessOk =
    readinessPresent
    && executionReadiness.ok === true
    && executionReadiness.verdict === "ready";
  const inspectionRan =
    readinessPresent && executionReadiness.runs_read_only_git_inspection === true;
  // Reflect readiness value into required_inputs (open requires this === false).
  const readinessExecutesChild =
    readinessPresent && executionReadiness.executes_child_commands === true;

  gate.required_inputs = {
    operator_plan_validation_ok: validationOk,
    selected_repo_resolution_ok: resolutionOk,
    execution_readiness_ok: readinessOk,
    read_only_git_inspection_ran: inspectionRan,
    entry_authority_verdict: "MISSING",
    executes_child_commands: readinessExecutesChild,
  };

  const reasons = [];
  const attachedEntryAuthority = isPlainObject(entryAuthority) ? entryAuthority : null;

  if (entryAuthorityInput === undefined) {
    gate.entry_authority = attachedEntryAuthority;
    gate.required_inputs.entry_authority_verdict = attachedEntryAuthority?.verdict || "MISSING";
    reasons.push({
      code: "ENTRY_AUTHORITY_INPUT_MISSING",
      detail: "worker entry requires live entry-authority input from an externally trusted expected identity",
    });
  } else {
    const evaluatedEntryAuthority = evaluateEntryAuthority(entryAuthorityInput);
    gate.entry_authority = evaluatedEntryAuthority;
    gate.required_inputs.entry_authority_verdict = evaluatedEntryAuthority.verdict;

    if (attachedEntryAuthority
      && (attachedEntryAuthority.verdict !== evaluatedEntryAuthority.verdict
        || attachedEntryAuthority.ok !== evaluatedEntryAuthority.ok)) {
      reasons.push({
        code: "ENTRY_AUTHORITY_RESULT_MISMATCH",
        detail: "attached entry-authority result does not match recomputation from raw input",
      });
    }

    if (evaluatedEntryAuthority.verdict !== "PASS_CURRENT" || evaluatedEntryAuthority.ok !== true) {
      reasons.push({
        code: `ENTRY_AUTHORITY_${evaluatedEntryAuthority.verdict}`,
        detail: evaluatedEntryAuthority.next_action,
      });
    }

    if (evaluatedEntryAuthority.mutates !== false
      || evaluatedEntryAuthority.executes_child_commands !== false
      || evaluatedEntryAuthority.network !== false) {
      reasons.push({
        code: "ENTRY_AUTHORITY_EVALUATOR_NOT_PURE",
        detail: "entry-authority evaluator must be read-only, process-free, and network-free",
      });
    }
  }

  if (!validationOk) {
    reasons.push({
      code: "OPERATOR_PLAN_VALIDATION_NOT_OK",
      detail: "operator_execution_plan_artifact_validation.ok must be true",
    });
  }
  if (!resolutionOk) {
    const code = selectedRepoResolution && selectedRepoResolution.code
      ? String(selectedRepoResolution.code)
      : "SELECTED_REPO_RESOLUTION_NOT_OK";
    const detail = selectedRepoResolution && selectedRepoResolution.detail
      ? String(selectedRepoResolution.detail)
      : "selected_repo_resolution.ok must be true";
    reasons.push({ code, detail });
  }
  if (!readinessPresent) {
    reasons.push({
      code: "EXECUTION_READINESS_MISSING",
      detail: "execution_readiness must be present on verify-op",
    });
  } else {
    if (!readinessOk) {
      const verdict = executionReadiness.verdict;
      const known = new Set([
        "ready",
        "not_requested",
        "artifact_invalid",
        "missing_repo",
        "ambiguous_repo",
        "not_git_repo",
        "dirty",
        "git_unavailable",
      ]);
      if (verdict === undefined || verdict === null || !known.has(String(verdict))) {
        reasons.push({
          code: "UNKNOWN_READINESS_VERDICT",
          detail: `execution_readiness.verdict is unknown or missing: ${String(verdict)}`,
        });
      } else if (verdict !== "ready" || executionReadiness.ok !== true) {
        reasons.push({
          code: "EXECUTION_READINESS_NOT_READY",
          detail: `execution_readiness must be ready+ok (verdict=${String(verdict)}, ok=${String(executionReadiness.ok)})`,
        });
      }
    }
    if (!inspectionRan) {
      reasons.push({
        code: "READ_ONLY_GIT_INSPECTION_NOT_RUN",
        detail: "execution_readiness.runs_read_only_git_inspection must be true",
      });
    }
    if (readinessExecutesChild) {
      reasons.push({
        code: "EXECUTES_CHILD_COMMANDS",
        detail: "execution_readiness.executes_child_commands must be false",
      });
    }
  }

  // Gate-level safety: always false (never grant execution).
  Object.assign(gate, safetyFlags());

  if (reasons.length === 0) {
    gate.verdict = "open";
    gate.ok = true;
    gate.reasons = [];
    return gate;
  }

  gate.verdict = "blocked";
  gate.ok = false;
  gate.reasons = reasons;
  return gate;
}

/**
 * Attach worker_entry_gate after 22A readiness on verify-op path.
 * Always emits open|blocked when called (fail-closed).
 */
function attachWorkerEntryGateToRollup(rollup) {
  if (!isPlainObject(rollup)) return rollup;
  const gate = buildWorkerEntryGate({
    operatorPlanArtifactValidation: rollup.operator_execution_plan_artifact_validation,
    selectedRepoResolution: rollup.selected_repo_resolution,
    executionReadiness: rollup.execution_readiness,
    entryAuthority: rollup.entry_authority,
    entryAuthorityInput: rollup.entry_authority_input,
    requested: true,
  });
  rollup.worker_entry_gate = gate;
  return rollup;
}

function renderWorkerEntryGateMarkdown(gate) {
  if (!gate) return [];
  const lines = ["", "## Worker Entry Gate", ""];
  lines.push(`- kind: ${gate.kind || "worker_entry_gate"}`);
  lines.push(`- verdict: ${gate.verdict}`);
  lines.push(`- ok: ${gate.ok}`);
  if (gate.required_inputs && typeof gate.required_inputs === "object") {
    lines.push("- required_inputs:");
    for (const [key, value] of Object.entries(gate.required_inputs)) {
      lines.push(`  - ${key}: ${value}`);
    }
  }
  if (gate.required_inputs
    && Object.prototype.hasOwnProperty.call(gate.required_inputs, "entry_authority_verdict")) {
    lines.push(`- entry_authority_verdict: ${gate.required_inputs.entry_authority_verdict}`);
  }
  lines.push(`- executes_child_commands: ${gate.executes_child_commands === false ? "false" : String(gate.executes_child_commands)}`);
  lines.push(`- mutates: ${gate.mutates === false ? "false" : String(gate.mutates)}`);
  if (Array.isArray(gate.reasons) && gate.reasons.length > 0) {
    lines.push("- reasons:");
    gate.reasons.forEach((r) => {
      lines.push(`  - ${r.code}: ${r.detail}`);
    });
  }
  return lines;
}

module.exports = {
  buildWorkerEntryGate,
  attachWorkerEntryGateToRollup,
  renderWorkerEntryGateMarkdown,
};
