"use strict";

const PLAN_KIND = "controlled_autonomy_dry_run_plan";
const PLAN_SOURCE = "proposal_review_export_safety_gate";
const SELECTED_ACTION_TYPE = "review_approved_manual_work_packet";
const APPROVAL_DECISION_ID = "approve_for_manual_work";

const NON_MUTATION_FLAGS = Object.freeze({
  mutates: false,
  dry_run: true,
  executes_child_commands: false,
  writes_parent_files: false,
  writes_child_files: false,
  creates_tasks: false,
  creates_queues: false,
  applies_patches: false,
  refreshes_readiness: false,
  required_human_approval: true,
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function hasAllowedDecision(options, id) {
  return Array.isArray(options && options.allowed_decisions)
    && options.allowed_decisions.some((decision) => decision && decision.id === id);
}

function blocker(id, reason) {
  return { id, status: "fail", reason };
}

function isPass(validation) {
  return validation && validation.ok === true && validation.verdict === "pass";
}

function firstPlainObject(...sources) {
  return sources.find(isPlainObject) || null;
}

function readChain({
  proposalReviewPacket,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewReceiptValidation,
  proposalReviewCopyBlockValidation,
  proposalReviewExportIntent,
  proposalReviewExportSafetyGate,
  rollup,
} = {}) {
  const sourceRollup = isPlainObject(rollup) ? rollup : {};
  return {
    packet: firstPlainObject(proposalReviewPacket, sourceRollup.proposal_review_packet),
    options: firstPlainObject(proposalReviewOptions, sourceRollup.proposal_review_options),
    receiptTemplate: firstPlainObject(proposalReviewReceiptTemplate, sourceRollup.proposal_review_receipt_template),
    receiptValidation: firstPlainObject(
      proposalReviewReceiptValidation,
      sourceRollup.proposal_review_receipt_validation,
      sourceRollup["proposal_review_" + "receipt_validation"]
    ),
    copyBlockValidation: firstPlainObject(proposalReviewCopyBlockValidation, sourceRollup.proposal_review_copy_block_validation),
    exportIntent: firstPlainObject(proposalReviewExportIntent, sourceRollup.proposal_review_export_intent),
    exportSafetyGate: firstPlainObject(proposalReviewExportSafetyGate, sourceRollup.proposal_review_export_safety_gate),
  };
}

function packetId(packet) {
  return packet && nonEmptyString(packet.packet_id) ? packet.packet_id : null;
}

function selectedRepo(packet) {
  return packet && nonEmptyString(packet.selected_repo) ? packet.selected_repo : null;
}

function selectedCandidateId(packet) {
  return packet && nonEmptyString(packet.selected_candidate_id) ? packet.selected_candidate_id : null;
}

function receiptTemplateIsEmpty(receiptTemplate) {
  const template = receiptTemplate && receiptTemplate.template;
  return receiptTemplate && receiptTemplate.records_decision === false
    && receiptTemplate.mutates === false
    && template
    && template.decision_id === null
    && template.reviewer === null
    && template.reviewed_at === null
    && template.reason === null;
}

function exportIntentIsReadOnly(intent) {
  return intent && intent.export_target === null
    && intent.writes_files === false
    && intent.records_decision === false
    && intent.mutates === false;
}

function basePlan({ verdict, selectedActionType, packet, blockers, plannedSteps }) {
  return {
    kind: PLAN_KIND,
    source: PLAN_SOURCE,
    selected_action_type: selectedActionType,
    verdict,
    ...NON_MUTATION_FLAGS,
    packet_id: packetId(packet),
    selected_repo: selectedRepo(packet),
    selected_candidate_id: selectedCandidateId(packet),
    blockers,
    planned_steps: plannedSteps,
  };
}

function readyPlannedSteps(packet) {
  const selected = `${selectedRepo(packet)} ${selectedCandidateId(packet)}`;
  return [
    "Review the existing proposal review packet.",
    "Confirm the allowed human decision approve_for_manual_work.",
    "Use the existing receipt template for explicit human decision evidence.",
    `Use the existing validated copy block as the manual work packet for ${selected}.`,
    "Stop before any command execution, file write, queue creation, task creation, patch generation, patch application, readiness refresh, or truth mutation.",
  ];
}

function buildBlockers(chain) {
  const blockers = [];
  const {
    packet,
    options,
    receiptTemplate,
    receiptValidation,
    copyBlockValidation,
    exportIntent,
    exportSafetyGate,
  } = chain;

  if (!packet) {
    blockers.push(blocker("AUTONOMY_PACKET_READY_001", "proposal_review_packet is required"));
  } else {
    if (packet.verdict !== "ready_for_review") {
      blockers.push(blocker("AUTONOMY_PACKET_READY_001", "proposal_review_packet verdict must be ready_for_review"));
    }
    if (!nonEmptyString(packet.packet_id)) {
      blockers.push(blocker("AUTONOMY_PACKET_FIELDS_001", "proposal_review_packet packet_id must be non-empty"));
    }
    if (!nonEmptyString(packet.selected_repo)) {
      blockers.push(blocker("AUTONOMY_PACKET_FIELDS_001", "proposal_review_packet selected_repo must be non-empty"));
    }
    if (!nonEmptyString(packet.selected_candidate_id)) {
      blockers.push(blocker("AUTONOMY_PACKET_FIELDS_001", "proposal_review_packet selected_candidate_id must be non-empty"));
    }
  }

  if (!options) {
    blockers.push(blocker("AUTONOMY_OPTIONS_APPROVAL_001", "proposal_review_options is required"));
  } else if (!hasAllowedDecision(options, APPROVAL_DECISION_ID)) {
    blockers.push(blocker("AUTONOMY_OPTIONS_APPROVAL_001", "proposal_review_options must allow approve_for_manual_work"));
  }

  if (!receiptTemplate) {
    blockers.push(blocker("AUTONOMY_RECEIPT_TEMPLATE_001", "proposal_review_receipt_template is required"));
  } else if (!receiptTemplateIsEmpty(receiptTemplate)) {
    blockers.push(blocker("AUTONOMY_RECEIPT_TEMPLATE_001", "proposal_review_receipt_template must be empty, non-mutating, and must not record a decision"));
  }

  if (!receiptValidation) {
    blockers.push(blocker("AUTONOMY_RECEIPT_VALIDATION_001", "proposal_review_receipt_validation is required"));
  } else if (!isPass(receiptValidation)) {
    blockers.push(blocker("AUTONOMY_RECEIPT_VALIDATION_001", "proposal_review_receipt_validation must pass"));
  }

  if (!copyBlockValidation) {
    blockers.push(blocker("AUTONOMY_COPY_BLOCK_VALIDATION_001", "proposal_review_copy_block_validation is required"));
  } else if (!isPass(copyBlockValidation)) {
    blockers.push(blocker("AUTONOMY_COPY_BLOCK_VALIDATION_001", "proposal_review_copy_block_validation must pass"));
  }

  if (!exportIntent) {
    blockers.push(blocker("AUTONOMY_EXPORT_INTENT_READ_ONLY_001", "proposal_review_export_intent is required"));
  } else if (!exportIntentIsReadOnly(exportIntent)) {
    blockers.push(blocker("AUTONOMY_EXPORT_INTENT_READ_ONLY_001", "proposal_review_export_intent must be read-only and must not write files or record decisions"));
  }

  if (!exportSafetyGate) {
    blockers.push(blocker("AUTONOMY_EXPORT_SAFETY_GATE_001", "proposal_review_export_safety_gate is required"));
  } else if (!isPass(exportSafetyGate)) {
    blockers.push(blocker("AUTONOMY_EXPORT_SAFETY_GATE_001", "proposal_review_export_safety_gate must pass"));
  }

  return blockers;
}

function buildAutonomyPlan(input = {}) {
  const chain = readChain(input);
  const { packet } = chain;

  if (packet && packet.verdict === "not_needed") {
    return basePlan({
      verdict: "not_needed",
      selectedActionType: null,
      packet,
      blockers: [],
      plannedSteps: [],
    });
  }

  const blockers = buildBlockers(chain);
  if (blockers.length > 0) {
    return basePlan({
      verdict: "blocked",
      selectedActionType: null,
      packet,
      blockers,
      plannedSteps: [],
    });
  }

  return basePlan({
    verdict: "ready_for_human_approval",
    selectedActionType: SELECTED_ACTION_TYPE,
    packet,
    blockers: [],
    plannedSteps: readyPlannedSteps(packet),
  });
}

function valueOrNone(value) {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function renderAutonomyPlanMarkdown(plan) {
  const safePlan = plan || basePlan({
    verdict: "blocked",
    selectedActionType: null,
    packet: null,
    blockers: [blocker("AUTONOMY_PLAN_001", "autonomy_plan is missing")],
    plannedSteps: [],
  });
  const lines = ["", "## Controlled Autonomy Dry-Run Plan", ""];
  lines.push(
    `- verdict: ${safePlan.verdict || "blocked"}`,
    `- selected_action_type: ${valueOrNone(safePlan.selected_action_type)}`,
    `- dry_run: ${safePlan.dry_run === true ? "true" : String(safePlan.dry_run)}`,
    `- mutates: ${safePlan.mutates === false ? "false" : String(safePlan.mutates)}`,
    `- required_human_approval: ${safePlan.required_human_approval === true ? "true" : String(safePlan.required_human_approval)}`,
    `- executes_child_commands: ${safePlan.executes_child_commands === false ? "false" : String(safePlan.executes_child_commands)}`,
    `- writes_parent_files: ${safePlan.writes_parent_files === false ? "false" : String(safePlan.writes_parent_files)}`,
    `- writes_child_files: ${safePlan.writes_child_files === false ? "false" : String(safePlan.writes_child_files)}`,
    `- creates_tasks: ${safePlan.creates_tasks === false ? "false" : String(safePlan.creates_tasks)}`,
    `- creates_queues: ${safePlan.creates_queues === false ? "false" : String(safePlan.creates_queues)}`,
    `- applies_patches: ${safePlan.applies_patches === false ? "false" : String(safePlan.applies_patches)}`,
    `- refreshes_readiness: ${safePlan.refreshes_readiness === false ? "false" : String(safePlan.refreshes_readiness)}`,
    `- packet_id: ${valueOrNone(safePlan.packet_id)}`,
    `- selected: ${safePlan.selected_repo && safePlan.selected_candidate_id ? `${safePlan.selected_repo} ${safePlan.selected_candidate_id}` : "none"}`,
    "- blockers:"
  );
  const blockers = asArray(safePlan.blockers);
  if (blockers.length === 0) lines.push("  - none");
  else for (const item of blockers) lines.push(`  - ${item.id || "unknown"} ${item.status || "fail"} — ${item.reason || "no reason provided"}`);

  lines.push("- planned steps:");
  const plannedSteps = asArray(safePlan.planned_steps);
  if (plannedSteps.length === 0) lines.push("  - none");
  else plannedSteps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  return lines;
}

module.exports = {
  buildAutonomyPlan,
  renderAutonomyPlanMarkdown,
  hasAllowedDecision,
};
