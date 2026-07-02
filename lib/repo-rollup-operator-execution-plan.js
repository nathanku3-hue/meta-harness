"use strict";

const PLAN_KIND = "operator_execution_plan";
const PLAN_SOURCE = "manual_work_packet_artifact_validation";
const READY_PACKET_VERDICT = "ready_for_manual_work";

const SAFETY_FLAGS = Object.freeze({
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

const READY_STEPS = Object.freeze([
  "Open the selected child repo manually.",
  "Review the source checks and target paths listed in the approved packet.",
  "Perform only the approved manual work scope.",
  "Do not run parent-rollup-driven child commands.",
  "Re-run child readiness manually after work is complete.",
  "Return to the parent harness and run poll --rollup again.",
]);

const READY_CONSTRAINTS = Object.freeze([
  "Use the verified artifact as scope, not live inferred scope.",
  "Do not expand target paths unless a human reviewer approves a new packet.",
  "Do not apply patches generated outside this packet.",
  "Do not treat artifact verification as execution approval.",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compactStrings(value) {
  return Array.isArray(value) ? value.filter((item) => item != null && item !== "").map(String) : [];
}

function textOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyPlan(verdict, fields = {}) {
  return {
    kind: PLAN_KIND,
    source: PLAN_SOURCE,
    verdict,
    ok: false,
    packet_id: fields.packet_id || null,
    selected_repo: fields.selected_repo || null,
    selected_candidate_id: fields.selected_candidate_id || null,
    target_paths: compactStrings(fields.target_paths),
    source_check_ids: compactStrings(fields.source_check_ids),
    source_warning_ids: compactStrings(fields.source_warning_ids),
    steps: compactStrings(fields.steps),
    constraints: compactStrings(fields.constraints),
    ...SAFETY_FLAGS,
  };
}

function packetFields(packet) {
  return {
    packet_id: textOrNull(packet.packet_id),
    selected_repo: textOrNull(packet.selected_repo),
    selected_candidate_id: textOrNull(packet.selected_candidate_id),
    target_paths: compactStrings(packet.target_paths),
    source_check_ids: compactStrings(packet.source_check_ids),
    source_warning_ids: compactStrings(packet.source_warning_ids),
  };
}

function buildOperatorExecutionPlan(input = {}) {
  const validation = isPlainObject(input.manualWorkPacketArtifactValidation)
    ? input.manualWorkPacketArtifactValidation
    : null;
  if (!validation || validation.verdict === "not_requested") {
    return emptyPlan("not_requested");
  }
  if (validation.verdict !== "pass" || validation.ok !== true) {
    return emptyPlan("blocked", { packet_id: textOrNull(validation.packet_id) });
  }

  const packet = isPlainObject(input.verifiedManualWorkPacket) ? input.verifiedManualWorkPacket : null;
  if (!packet || packet.verdict !== READY_PACKET_VERDICT) {
    return emptyPlan("blocked", { packet_id: textOrNull(validation.packet_id) });
  }

  const fields = packetFields(packet);
  return {
    ...emptyPlan("ready_for_operator", {
      ...fields,
      steps: READY_STEPS,
      constraints: READY_CONSTRAINTS,
    }),
    ok: true,
  };
}

function valueOrNone(value) {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function listText(values) {
  const items = compactStrings(values);
  return items.length > 0 ? items.join(", ") : "none";
}

function renderOperatorExecutionPlanMarkdown(plan) {
  const safePlan = plan || buildOperatorExecutionPlan();
  const selected = safePlan.selected_repo && safePlan.selected_candidate_id
    ? `${safePlan.selected_repo} ${safePlan.selected_candidate_id}`
    : "none";
  const lines = ["", "## Operator Execution Plan", ""];
  lines.push(
    `- verdict: ${safePlan.verdict || "blocked"}`,
    `- packet_id: ${valueOrNone(safePlan.packet_id)}`,
    `- selected: ${selected}`,
    `- target_paths: ${listText(safePlan.target_paths)}`,
    `- source_check_ids: ${listText(safePlan.source_check_ids)}`,
    `- source_warning_ids: ${listText(safePlan.source_warning_ids)}`,
    `- mutates: ${safePlan.mutates === false ? "false" : String(safePlan.mutates)}`,
    `- writes_files: ${safePlan.writes_files === false ? "false" : String(safePlan.writes_files)}`,
    `- executes_child_commands: ${safePlan.executes_child_commands === false ? "false" : String(safePlan.executes_child_commands)}`,
    `- applies_patches: ${safePlan.applies_patches === false ? "false" : String(safePlan.applies_patches)}`,
    `- records_decision: ${safePlan.records_decision === false ? "false" : String(safePlan.records_decision)}`,
    `- records_approval: ${safePlan.records_approval === false ? "false" : String(safePlan.records_approval)}`,
    "- steps:"
  );
  const steps = compactStrings(safePlan.steps);
  if (steps.length === 0) lines.push("  - none");
  else steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  lines.push("- constraints:");
  const constraints = compactStrings(safePlan.constraints);
  if (constraints.length === 0) lines.push("  - none");
  else constraints.forEach((constraint) => lines.push(`  - ${constraint}`));
  return lines;
}

module.exports = {
  buildOperatorExecutionPlan,
  renderOperatorExecutionPlanMarkdown,
};
