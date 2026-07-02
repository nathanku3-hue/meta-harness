"use strict";

const VALIDATION_KIND = "controlled_autonomy_approval_receipt_validation";
const VALIDATION_SOURCE = "autonomy_plan";
const READY_VERDICT = "ready_for_human_approval";
const APPROVED_VERDICT = "approved_for_manual_work";
const SELECTED_ACTION_TYPE = "review_approved_manual_work_packet";
const APPROVAL_DECISION_ID = "approve_for_manual_work";

const NON_MUTATION_FLAGS = Object.freeze({
  mutates: false,
  records_decision: false,
  records_approval: false,
  executes_child_commands: false,
  writes_parent_files: false,
  writes_child_files: false,
  creates_tasks: false,
  creates_queues: false,
  applies_patches: false,
  refreshes_readiness: false,
});

const SAFETY_FIELDS = Object.freeze(Object.keys(NON_MUTATION_FLAGS));

const FORBIDDEN_OUTPUT_FIELDS = Object.freeze([
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
]);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseIsoTimestamp(value) {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function check(id, passed, passReason, failReason) {
  return {
    id,
    status: passed ? "pass" : "fail",
    reason: passed ? passReason : failReason,
  };
}

function normalizeTextField(value) {
  return typeof value === "string" ? value : null;
}

function normalizeReceipt(receipt) {
  if (!isPlainObject(receipt)) return null;
  return {
    packet_id: normalizeTextField(receipt.packet_id),
    decision_id: normalizeTextField(receipt.decision_id),
    reviewer: normalizeTextField(receipt.reviewer),
    reviewed_at: normalizeTextField(receipt.reviewed_at),
    reason: normalizeTextField(receipt.reason),
  };
}

function resolvePlan(input) {
  if (isPlainObject(input.autonomyPlan)) return input.autonomyPlan;
  if (isPlainObject(input.rollup) && isPlainObject(input.rollup.autonomy_plan)) return input.rollup.autonomy_plan;
  return null;
}

function resolveReceipt(input) {
  if (hasOwn(input, "autonomyApprovalReceipt")) return isPlainObject(input.autonomyApprovalReceipt) ? input.autonomyApprovalReceipt : null;
  if (isPlainObject(input.rollup) && hasOwn(input.rollup, "autonomy_approval_receipt")) {
    return isPlainObject(input.rollup.autonomy_approval_receipt) ? input.rollup.autonomy_approval_receipt : null;
  }
  return null;
}

function safetyFieldsAreAbsentOrFalse(receipt) {
  return SAFETY_FIELDS.every((field) => !hasOwn(receipt, field) || receipt[field] === false);
}

function hasForbiddenOutputField(receipt) {
  return FORBIDDEN_OUTPUT_FIELDS.some((field) => hasOwn(receipt, field));
}

function hasPatchProposals(receipt) {
  return hasOwn(receipt, "patch_" + "proposals");
}

function baseValidation({ verdict, ok, autonomyPlan, receipt, checks }) {
  const selectedActionType = autonomyPlan && autonomyPlan.selected_action_type === SELECTED_ACTION_TYPE
    ? SELECTED_ACTION_TYPE
    : null;
  return {
    kind: VALIDATION_KIND,
    source: VALIDATION_SOURCE,
    verdict,
    ok,
    ...NON_MUTATION_FLAGS,
    packet_id: autonomyPlan && typeof autonomyPlan.packet_id === "string" && autonomyPlan.packet_id.length > 0 ? autonomyPlan.packet_id : null,
    selected_action_type: selectedActionType,
    receipt: normalizeReceipt(receipt),
    checks,
  };
}

function buildReadyChecks(autonomyPlan, receipt) {
  return [
    check(
      "AUTONOMY_APPROVAL_PLAN_READY_001",
      autonomyPlan && autonomyPlan.verdict === READY_VERDICT,
      "autonomy_plan is ready_for_human_approval",
      "autonomy_plan must be ready_for_human_approval"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_PRESENT_001",
      isPlainObject(receipt),
      "approval receipt is supplied",
      "approval receipt is required"
    ),
  ];
}

function buildReceiptChecks(autonomyPlan, receipt) {
  const expectedPacketId = autonomyPlan && typeof autonomyPlan.packet_id === "string" ? autonomyPlan.packet_id : null;
  return [
    ...buildReadyChecks(autonomyPlan, receipt),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_PACKET_001",
      nonEmptyString(receipt && receipt.packet_id) && receipt.packet_id === expectedPacketId,
      "approval receipt packet_id matches autonomy_plan packet_id",
      "approval receipt packet_id must be non-empty and match autonomy_plan packet_id"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_DECISION_001",
      receipt && receipt.decision_id === APPROVAL_DECISION_ID,
      "approval receipt decision_id is approve_for_manual_work",
      "approval receipt decision_id must be approve_for_manual_work"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_REVIEWER_001",
      nonEmptyString(receipt && receipt.reviewer),
      "approval receipt reviewer is non-empty",
      "approval receipt reviewer must be non-empty"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_REVIEWED_AT_001",
      parseIsoTimestamp(receipt && receipt.reviewed_at) !== null,
      "approval receipt reviewed_at is a strict valid ISO timestamp",
      "approval receipt reviewed_at must be a strict valid ISO timestamp"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_REASON_001",
      nonEmptyString(receipt && receipt.reason),
      "approval receipt reason is non-empty",
      "approval receipt reason must be non-empty"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_NO_MUTATION_001",
      isPlainObject(receipt) && safetyFieldsAreAbsentOrFalse(receipt),
      "approval receipt has no mutation/safety fields set to unsafe values",
      "approval receipt mutation/safety fields may be absent; if present, they must be false"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_NO_OUTPUT_001",
      isPlainObject(receipt) && !hasForbiddenOutputField(receipt),
      "approval receipt contains no forbidden output fields",
      "approval receipt must not contain proposal/export/queue/action output fields"
    ),
    check(
      "AUTONOMY_APPROVAL_RECEIPT_NO_PATCH_001",
      isPlainObject(receipt) && !hasPatchProposals(receipt),
      "approval receipt contains no patch_proposals field",
      "approval receipt must not contain patch_proposals"
    ),
  ];
}

function buildAutonomyApprovalReceiptValidation(input = {}) {
  const autonomyPlan = resolvePlan(input);
  const receipt = resolveReceipt(input);

  if (autonomyPlan && autonomyPlan.verdict === "not_needed") {
    return baseValidation({
      verdict: "not_needed",
      ok: true,
      autonomyPlan,
      receipt: null,
      checks: [check(
        "AUTONOMY_APPROVAL_NOT_NEEDED_001",
        true,
        "autonomy_plan does not need approval",
        "autonomy_plan unexpectedly needs approval"
      )],
    });
  }

  if (!autonomyPlan || autonomyPlan.verdict !== READY_VERDICT) {
    return baseValidation({
      verdict: "blocked",
      ok: false,
      autonomyPlan,
      receipt,
      checks: [check(
        "AUTONOMY_APPROVAL_PLAN_READY_001",
        false,
        "autonomy_plan is ready_for_human_approval",
        "autonomy_plan must exist and be ready_for_human_approval"
      )],
    });
  }

  if (!isPlainObject(receipt)) {
    return baseValidation({
      verdict: "missing",
      ok: false,
      autonomyPlan,
      receipt: null,
      checks: buildReadyChecks(autonomyPlan, receipt),
    });
  }

  const checks = buildReceiptChecks(autonomyPlan, receipt);
  const ok = checks.every((item) => item.status === "pass");
  return baseValidation({
    verdict: ok ? APPROVED_VERDICT : "invalid",
    ok,
    autonomyPlan,
    receipt,
    checks,
  });
}

function valueOrNone(value) {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function renderAutonomyApprovalReceiptValidationMarkdown(validation) {
  const safeValidation = validation || baseValidation({
    verdict: "blocked",
    ok: false,
    autonomyPlan: null,
    receipt: null,
    checks: [check(
      "AUTONOMY_APPROVAL_VALIDATION_001",
      false,
      "autonomy approval receipt validation exists",
      "autonomy_approval_receipt_validation is missing"
    )],
  });
  const lines = ["", "## Controlled Autonomy Approval Receipt Validation", ""];
  lines.push(
    `- verdict: ${safeValidation.verdict || "blocked"}`,
    `- ok: ${safeValidation.ok === true ? "true" : "false"}`,
    `- packet_id: ${valueOrNone(safeValidation.packet_id)}`,
    `- selected_action_type: ${valueOrNone(safeValidation.selected_action_type)}`,
    `- mutates: ${safeValidation.mutates === false ? "false" : String(safeValidation.mutates)}`,
    `- records_decision: ${safeValidation.records_decision === false ? "false" : String(safeValidation.records_decision)}`,
    `- records_approval: ${safeValidation.records_approval === false ? "false" : String(safeValidation.records_approval)}`,
    `- executes_child_commands: ${safeValidation.executes_child_commands === false ? "false" : String(safeValidation.executes_child_commands)}`,
    `- writes_parent_files: ${safeValidation.writes_parent_files === false ? "false" : String(safeValidation.writes_parent_files)}`,
    `- writes_child_files: ${safeValidation.writes_child_files === false ? "false" : String(safeValidation.writes_child_files)}`,
    `- creates_tasks: ${safeValidation.creates_tasks === false ? "false" : String(safeValidation.creates_tasks)}`,
    `- creates_queues: ${safeValidation.creates_queues === false ? "false" : String(safeValidation.creates_queues)}`,
    `- applies_patches: ${safeValidation.applies_patches === false ? "false" : String(safeValidation.applies_patches)}`,
    `- refreshes_readiness: ${safeValidation.refreshes_readiness === false ? "false" : String(safeValidation.refreshes_readiness)}`
  );

  if (safeValidation.receipt) {
    lines.push(
      "- receipt:",
      `  - packet_id: ${valueOrNone(safeValidation.receipt.packet_id)}`,
      `  - decision_id: ${valueOrNone(safeValidation.receipt.decision_id)}`,
      `  - reviewer: ${valueOrNone(safeValidation.receipt.reviewer)}`,
      `  - reviewed_at: ${valueOrNone(safeValidation.receipt.reviewed_at)}`,
      `  - reason: ${valueOrNone(safeValidation.receipt.reason)}`
    );
  } else {
    lines.push("- receipt: none");
  }

  lines.push("- checks:");
  const checks = asArray(safeValidation.checks);
  if (checks.length === 0) lines.push("  - none");
  else for (const item of checks) lines.push(`  - ${item.id || "unknown"} ${item.status || "fail"} — ${item.reason || "no reason provided"}`);
  return lines;
}

module.exports = {
  buildAutonomyApprovalReceiptValidation,
  renderAutonomyApprovalReceiptValidationMarkdown,
  parseIsoTimestamp,
};
