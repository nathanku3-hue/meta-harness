"use strict";

const VALIDATION_KIND = "operator_execution_plan_artifact_validation";
const VALIDATION_SOURCE = "operator_execution_plan_artifact";
const ARTIFACT_KIND = "operator_execution_plan_artifact";
const ARTIFACT_SOURCE = "poll_rollup_operator_execution_plan";
const SCHEMA_VERSION = "1.0.0";

const FORBIDDEN_FIELDS = Object.freeze([
  "patch_proposals",
  "proposal_files",
  "proposal_file",
  "proposal_path",
  "proposal_output",
  "export_files",
  "export_file",
  "export_path",
  "export_output",
  "queue_files",
  "queue_file",
  "queue_path",
  "queue_output",
  "action_files",
  "action_file",
  "action_path",
  "action_output",
  "task_files",
  "task_file",
  "task_path",
  "task_output",
  "decision_record",
  "approval_record",
  "readiness_refresh",
  "child_command",
  "child_commands",
  "execute",
  "apply",
  "commands",
  "patches",
  "execution",
  "actions",
  "command",
  "write_plan_file",
  "write_plan_artifact",
  "write_plan_output",
  "execute_plan",
  "operator_commands",
]);

const WRAPPER_SAFETY = Object.freeze({
  mutates: false,
  writes_files: true,
  writes_parent_files: true,
  writes_child_files: false,
  executes_child_commands: false,
  applies_patches: false,
  creates_tasks: false,
  creates_queues: false,
  refreshes_readiness: false,
  records_decision: false,
  records_approval: false,
});

const EMBEDDED_PLAN_SAFETY = Object.freeze({
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
});

const VALIDATION_SAFETY = Object.freeze({
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
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function check(id, passed, passReason, failReason) {
  return {
    id,
    status: passed ? "pass" : "fail",
    reason: passed ? passReason : failReason,
  };
}

function defaultOperatorExecutionPlanArtifactValidation() {
  return {
    kind: VALIDATION_KIND,
    source: VALIDATION_SOURCE,
    verdict: "not_requested",
    ok: false,
    requested: false,
    path: null,
    packet_id: null,
    checks: [],
    ...VALIDATION_SAFETY,
  };
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function safetyMatches(value, expected) {
  if (!isPlainObject(value)) return false;
  return Object.entries(expected).every(([field, expectedValue]) => value[field] === expectedValue);
}

function collectForbiddenFields(value, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFields(item, `${path}[${index}]`, found));
    return found;
  }
  if (!isPlainObject(value)) return found;
  for (const [field, childValue] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.includes(field)) found.push(`${path}.${field}`);
    collectForbiddenFields(childValue, `${path}.${field}`, found);
  }
  return found;
}

function verdictFromChecks(checks) {
  const failed = checks.filter((item) => item.status !== "pass").map((item) => item.id);
  if (failed.length === 0) return "pass";
  if (failed.includes("ARTIFACT_EXISTS_001")) return "missing";
  if (failed.includes("ARTIFACT_PLAN_READY_001")) return "blocked";
  return "invalid";
}

function buildOperatorExecutionPlanArtifactValidation(input = {}) {
  const requested = input.requested === true;
  if (!requested) return defaultOperatorExecutionPlanArtifactValidation();

  const artifact = input.artifact;
  const readError = input.readError || null;
  const pathValue = typeof input.path === "string" ? input.path : null;
  const pathOk = input.pathOk !== false;
  const childPathOk = input.childPathOk !== false;

  const exists = readError !== "missing";
  const jsonOk = readError === null && isPlainObject(artifact);
  const plan = jsonOk && isPlainObject(artifact.operator_execution_plan) ? artifact.operator_execution_plan : null;
  const validation = jsonOk && isPlainObject(artifact.manual_work_packet_artifact_validation) ? artifact.manual_work_packet_artifact_validation : null;
  const forbiddenFields = jsonOk ? collectForbiddenFields(artifact) : [];

  const checks = [];
  checks.push(check(
    "ARTIFACT_EXISTS_001",
    exists,
    "artifact file exists",
    "artifact file is missing"
  ));
  checks.push(check(
    "ARTIFACT_JSON_001",
    jsonOk,
    "artifact is a JSON object",
    readError === "parse" ? "artifact must be valid JSON object" : "artifact JSON object was not available"
  ));
  checks.push(check(
    "ARTIFACT_SCHEMA_VERSION_001",
    jsonOk && artifact.schema_version === SCHEMA_VERSION,
    "artifact schema_version is 1.0.0",
    "artifact schema_version must be 1.0.0"
  ));
  checks.push(check(
    "ARTIFACT_KIND_001",
    jsonOk && artifact.kind === ARTIFACT_KIND,
    "artifact kind is operator_execution_plan_artifact",
    "artifact kind must be operator_execution_plan_artifact"
  ));
  checks.push(check(
    "ARTIFACT_SOURCE_001",
    jsonOk && artifact.source === ARTIFACT_SOURCE,
    "artifact source is poll_rollup_operator_execution_plan",
    "artifact source must be poll_rollup_operator_execution_plan"
  ));
  checks.push(check(
    "ARTIFACT_PACKET_ID_MATCH_001",
    jsonOk &&
      typeof artifact.packet_id === "string" && artifact.packet_id.length > 0 &&
      plan && typeof plan.packet_id === "string" && plan.packet_id.length > 0 &&
      artifact.packet_id === plan.packet_id &&
      validation && typeof validation.packet_id === "string" && validation.packet_id.length > 0 &&
      validation.packet_id === artifact.packet_id,
    "artifact packet_id matches embedded plan and validation",
    "artifact packet_id must exactly match embedded operator_execution_plan.packet_id and manual_work_packet_artifact_validation.packet_id"
  ));
  checks.push(check(
    "ARTIFACT_MANUAL_VALIDATION_PASS_001",
    validation && validation.verdict === "pass" && validation.ok === true,
    "embedded manual_work_packet_artifact_validation is pass",
    "embedded manual_work_packet_artifact_validation must be pass"
  ));
  checks.push(check(
    "ARTIFACT_MANUAL_VALIDATION_KIND_001",
    validation && validation.kind === "approved_manual_work_packet_artifact_validation",
    "embedded manual validation kind is approved_manual_work_packet_artifact_validation",
    "embedded manual_work_packet_artifact_validation.kind must be approved_manual_work_packet_artifact_validation"
  ));
  checks.push(check(
    "ARTIFACT_MANUAL_VALIDATION_SOURCE_001",
    validation && validation.source === "manual_work_packet_artifact",
    "embedded manual validation source is manual_work_packet_artifact",
    "embedded manual_work_packet_artifact_validation.source must be manual_work_packet_artifact"
  ));
  checks.push(check(
    "ARTIFACT_MANUAL_VALIDATION_SAFETY_001",
    validation && safetyMatches(validation, {
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
    }),
    "embedded manual validation safety fields are all false",
    "embedded manual_work_packet_artifact_validation safety fields must all be false"
  ));
  checks.push(check(
    "ARTIFACT_MANUAL_VALIDATION_CHECKS_001",
    validation && Array.isArray(validation.checks) && validation.checks.length > 0 && validation.checks.every((c) => c && c.status === "pass"),
    "embedded manual validation has passing checks",
    "embedded manual_work_packet_artifact_validation.checks must be non-empty array of all pass"
  ));
  checks.push(check(
    "ARTIFACT_PLAN_READY_001",
    plan && plan.verdict === "ready_for_operator" && plan.ok === true,
    "embedded operator_execution_plan is ready_for_operator",
    "embedded operator_execution_plan must be ready_for_operator"
  ));
  checks.push(check(
    "ARTIFACT_WRAPPER_SAFETY_001",
    safetyMatches(artifact, WRAPPER_SAFETY),
    "artifact wrapper safety fields match approved parent-local write surface",
    "artifact wrapper safety fields must match approved parent-local write surface"
  ));
  checks.push(check(
    "ARTIFACT_EMBEDDED_PLAN_SAFETY_001",
    safetyMatches(plan, EMBEDDED_PLAN_SAFETY),
    "embedded operator_execution_plan remains non-writing and non-mutating",
    "embedded operator_execution_plan safety fields must remain non-writing and non-mutating"
  ));
  checks.push(check(
    "ARTIFACT_NO_FORBIDDEN_FIELDS_001",
    jsonOk && forbiddenFields.length === 0,
    "artifact contains no forbidden output, execution, task, queue, approval, decision, or readiness fields",
    forbiddenFields.length > 0 ? `artifact contains forbidden fields: ${forbiddenFields.join(", ")}` : "artifact forbidden-field scan did not pass"
  ));
  checks.push(check(
    "ARTIFACT_PATH_BOUNDARY_001",
    pathOk,
    "artifact path passed parent-local .meta-harness boundary checks",
    "artifact path must be relative and under .meta-harness/"
  ));
  checks.push(check(
    "ARTIFACT_CHILD_PATH_BOUNDARY_001",
    childPathOk,
    "artifact path is outside configured child repo roots",
    "artifact path must not target a configured child repo root"
  ));
  checks.push(check(
    "ARTIFACT_NO_MUTATION_001",
    true,
    "artifact verification is read-only and performs no mutation",
    "artifact verification must be read-only"
  ));

  const verdict = verdictFromChecks(checks);
  return {
    kind: VALIDATION_KIND,
    source: VALIDATION_SOURCE,
    verdict,
    ok: verdict === "pass",
    requested: true,
    path: pathValue,
    packet_id: plan && typeof plan.packet_id === "string" ? plan.packet_id : null,
    checks,
    ...VALIDATION_SAFETY,
  };
}

function renderOperatorExecutionPlanArtifactValidationMarkdown(validation) {
  const v = validation || { verdict: "not_requested" };
  const lines = ["", "## Operator Execution Plan Artifact Validation", ""];
  lines.push(`- verdict: ${v.verdict || "unknown"}`);
  lines.push(`- ok: ${v.ok === true ? "true" : "false"}`);
  lines.push(`- path: ${v.path || "none"}`);
  if (Array.isArray(v.checks) && v.checks.length > 0) {
    lines.push("- checks:");
    v.checks.forEach((c) => {
      const status = c.status || "unknown";
      lines.push(`  - ${c.id || "?"} ${status} — ${c.reason || ""}`);
    });
  } else {
    lines.push("- checks: none");
  }
  return lines;
}

module.exports = {
  buildOperatorExecutionPlanArtifactValidation,
  defaultOperatorExecutionPlanArtifactValidation,
  renderOperatorExecutionPlanArtifactValidationMarkdown,
};
