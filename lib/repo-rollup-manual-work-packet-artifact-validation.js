"use strict";

const VALIDATION_KIND = "approved_manual_work_packet_artifact_validation";
const VALIDATION_SOURCE = "manual_work_packet_artifact";
const ARTIFACT_KIND = "approved_manual_work_packet_artifact";
const ARTIFACT_SOURCE = "poll_rollup_manual_work_packet";
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
]);

const WRAPPER_SAFETY = Object.freeze({
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

const EMBEDDED_PACKET_SAFETY = Object.freeze({
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

function defaultManualWorkPacketArtifactValidation() {
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
  if (failed.length === 1 && failed[0] === "ARTIFACT_PACKET_READY_001") return "blocked";
  return "invalid";
}

function buildManualWorkPacketArtifactValidation(input = {}) {
  const requested = input.requested === true;
  if (!requested) return defaultManualWorkPacketArtifactValidation();

  const artifact = input.artifact;
  const readError = input.readError || null;
  const pathValue = typeof input.path === "string" ? input.path : null;
  const pathOk = input.pathOk !== false;
  const childPathOk = input.childPathOk !== false;

  const exists = readError !== "missing";
  const jsonOk = readError === null && isPlainObject(artifact);
  const packet = jsonOk && isPlainObject(artifact.manual_work_packet) ? artifact.manual_work_packet : null;
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
    "artifact kind is approved_manual_work_packet_artifact",
    "artifact kind must be approved_manual_work_packet_artifact"
  ));
  checks.push(check(
    "ARTIFACT_SOURCE_001",
    jsonOk && artifact.source === ARTIFACT_SOURCE,
    "artifact source is poll_rollup_manual_work_packet",
    "artifact source must be poll_rollup_manual_work_packet"
  ));
  checks.push(check(
    "ARTIFACT_PACKET_ID_MATCH_001",
    jsonOk && typeof artifact.packet_id === "string" && artifact.packet_id.length > 0 && packet && artifact.packet_id === packet.packet_id,
    "artifact packet_id matches embedded manual_work_packet.packet_id",
    "artifact packet_id must match embedded manual_work_packet.packet_id"
  ));
  checks.push(check(
    "ARTIFACT_PACKET_READY_001",
    packet && packet.verdict === "ready_for_manual_work",
    "embedded manual_work_packet is ready_for_manual_work",
    "embedded manual_work_packet must be ready_for_manual_work"
  ));
  checks.push(check(
    "ARTIFACT_WRAPPER_SAFETY_001",
    safetyMatches(artifact, WRAPPER_SAFETY),
    "artifact wrapper safety fields match approved parent-local write surface",
    "artifact wrapper safety fields must match approved parent-local write surface"
  ));
  checks.push(check(
    "ARTIFACT_EMBEDDED_PACKET_SAFETY_001",
    safetyMatches(packet, EMBEDDED_PACKET_SAFETY),
    "embedded manual_work_packet remains non-writing and non-mutating",
    "embedded manual_work_packet safety fields must remain non-writing and non-mutating"
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
    packet_id: packet && typeof packet.packet_id === "string" ? packet.packet_id : null,
    checks,
    ...VALIDATION_SAFETY,
  };
}

module.exports = {
  buildManualWorkPacketArtifactValidation,
  defaultManualWorkPacketArtifactValidation,
};
