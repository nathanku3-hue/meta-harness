"use strict";

const PACKET_KIND = "approved_manual_work_packet";
const PACKET_SOURCE = "autonomy_approval_receipt_validation";
const READY_PLAN_VERDICT = "ready_for_human_approval";
const APPROVED_VALIDATION_VERDICT = "approved_for_manual_work";
const SELECTED_ACTION_TYPE = "review_approved_manual_work_packet";

const SAFETY_FLAGS = Object.freeze({
  mutates: false,
  writes_files: false,
  writes_parent_files: false,
  writes_child_files: false,
  executes_child_commands: false,
  creates_tasks: false,
  creates_queues: false,
  applies_patches: false,
  refreshes_readiness: false,
  records_decision: false,
  records_approval: false,
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactStrings(values) {
  return asArray(values).filter((value) => value != null && value !== "").map(String);
}

function firstPlainObject(...sources) {
  return sources.find(isPlainObject) || null;
}

function textOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function listText(values) {
  const items = compactStrings(values);
  return items.length > 0 ? items.join(", ") : "none";
}

function receiptField(validation, field) {
  return validation && validation.receipt ? textOrNull(validation.receipt[field]) : null;
}

function selectedActionType(plan, validation) {
  if (validation && validation.selected_action_type === SELECTED_ACTION_TYPE) return SELECTED_ACTION_TYPE;
  if (plan && plan.selected_action_type === SELECTED_ACTION_TYPE) return SELECTED_ACTION_TYPE;
  return null;
}

function selectedRepo({ plan, packet, brief }) {
  return textOrNull(plan && plan.selected_repo)
    || textOrNull(packet && packet.selected_repo)
    || textOrNull(brief && brief.selected_repo);
}

function selectedCandidateId({ plan, packet, brief }) {
  return textOrNull(plan && plan.selected_candidate_id)
    || textOrNull(packet && packet.selected_candidate_id)
    || textOrNull(brief && brief.selected_candidate_id);
}

function packetId({ plan, validation, packet }) {
  return textOrNull(validation && validation.packet_id)
    || textOrNull(plan && plan.packet_id)
    || textOrNull(packet && packet.packet_id);
}

function sourceFields(brief) {
  return {
    priority: textOrNull(brief && brief.priority),
    reason: textOrNull(brief && brief.reason),
    source_state: textOrNull(brief && brief.source_state),
    source_warning_ids: compactStrings(brief && brief.source_warning_ids),
    source_check_ids: compactStrings(brief && brief.source_check_ids),
    target_paths: compactStrings(brief && brief.target_paths),
  };
}

function manualInstructions(fields) {
  return [
    `Review child repo evidence for ${fields.selected_repo || "selected repo"}.`,
    `Manual work scope: ${fields.selected_candidate_id || "selected candidate"}.`,
    `Target paths: ${listText(fields.target_paths)}.`,
    `Source check IDs: ${listText(fields.source_check_ids)}.`,
    `Source warning IDs: ${listText(fields.source_warning_ids)}.`,
    "Use this packet as stdout-only operator guidance; do not treat it as recorded approval persistence.",
    "Do not execute child commands, write files, create queues or tasks, apply patches, refresh readiness, or mutate parent/child repo truth from poll --rollup.",
  ];
}

function packetFields({ plan, validation, packet, brief }) {
  const source = sourceFields(brief);
  return {
    packet_id: packetId({ plan, validation, packet }),
    selected_action_type: selectedActionType(plan, validation),
    selected_repo: selectedRepo({ plan, packet, brief }),
    selected_candidate_id: selectedCandidateId({ plan, packet, brief }),
    reviewer: receiptField(validation, "reviewer"),
    reviewed_at: receiptField(validation, "reviewed_at"),
    approval_reason: receiptField(validation, "reason"),
    ...source,
  };
}

function basePacket(verdict, fields, instructions = []) {
  return {
    kind: PACKET_KIND,
    source: PACKET_SOURCE,
    verdict,
    packet_id: fields.packet_id || null,
    selected_action_type: fields.selected_action_type || null,
    selected_repo: fields.selected_repo || null,
    selected_candidate_id: fields.selected_candidate_id || null,
    priority: fields.priority || null,
    reason: fields.reason || null,
    target_paths: compactStrings(fields.target_paths),
    source_state: fields.source_state || null,
    source_check_ids: compactStrings(fields.source_check_ids),
    source_warning_ids: compactStrings(fields.source_warning_ids),
    reviewer: fields.reviewer || null,
    reviewed_at: fields.reviewed_at || null,
    approval_reason: fields.approval_reason || null,
    instructions,
    ...SAFETY_FLAGS,
  };
}

function buildManualWorkPacket(input = {}) {
  const plan = firstPlainObject(input.autonomyPlan, input.rollup && input.rollup.autonomy_plan);
  const validation = firstPlainObject(
    input.autonomyApprovalReceiptValidation,
    input.rollup && input.rollup.autonomy_approval_receipt_validation
  );
  const packet = firstPlainObject(input.proposalReviewPacket, input.rollup && input.rollup.proposal_review_packet);
  const brief = firstPlainObject(input.nextActionBrief, input.rollup && input.rollup.next_action_brief);
  const fields = packetFields({ plan, validation, packet, brief });

  if (plan && plan.verdict === "not_needed") return basePacket("not_needed", fields);
  if (!plan || plan.verdict === "blocked" || plan.verdict !== READY_PLAN_VERDICT) return basePacket("blocked", fields);
  if (!validation || validation.verdict === "missing") return basePacket("missing_approval", fields);
  if (validation.verdict !== APPROVED_VALIDATION_VERDICT || validation.ok !== true) return basePacket("invalid", fields);
  return basePacket("ready_for_manual_work", fields, manualInstructions(fields));
}

function valueOrNone(value) {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function renderManualWorkPacketMarkdown(packet) {
  const safePacket = packet || buildManualWorkPacket();
  const lines = ["", "## Approved Manual Work Packet", ""];
  const selected = safePacket.selected_repo && safePacket.selected_candidate_id
    ? `${safePacket.selected_repo} ${safePacket.selected_candidate_id}`
    : "none";
  lines.push(
    `- verdict: ${safePacket.verdict || "blocked"}`,
    `- packet_id: ${valueOrNone(safePacket.packet_id)}`,
    `- selected_action_type: ${valueOrNone(safePacket.selected_action_type)}`,
    `- selected: ${selected}`,
    `- reviewer: ${valueOrNone(safePacket.reviewer)}`,
    `- reviewed_at: ${valueOrNone(safePacket.reviewed_at)}`,
    `- approval_reason: ${valueOrNone(safePacket.approval_reason)}`,
    `- target_paths: ${listText(safePacket.target_paths)}`,
    `- source_check_ids: ${listText(safePacket.source_check_ids)}`,
    `- source_warning_ids: ${listText(safePacket.source_warning_ids)}`,
    `- mutates: ${safePacket.mutates === false ? "false" : String(safePacket.mutates)}`,
    `- writes_files: ${safePacket.writes_files === false ? "false" : String(safePacket.writes_files)}`,
    `- executes_child_commands: ${safePacket.executes_child_commands === false ? "false" : String(safePacket.executes_child_commands)}`,
    `- applies_patches: ${safePacket.applies_patches === false ? "false" : String(safePacket.applies_patches)}`,
    `- records_decision: ${safePacket.records_decision === false ? "false" : String(safePacket.records_decision)}`,
    `- records_approval: ${safePacket.records_approval === false ? "false" : String(safePacket.records_approval)}`,
    "- instructions:"
  );
  const instructions = compactStrings(safePacket.instructions);
  if (instructions.length === 0) lines.push("  - none");
  else instructions.forEach((instruction, index) => lines.push(`  ${index + 1}. ${instruction}`));
  return lines;
}

module.exports = {
  buildManualWorkPacket,
  renderManualWorkPacketMarkdown,
};
