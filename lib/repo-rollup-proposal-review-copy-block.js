"use strict";

const COPY_BLOCK_KIND = "read_only_proposal_review_copy_block";
const COPY_BLOCK_SOURCE = "proposal_review_receipt_validation";
const INCLUDES = Object.freeze([
  "proposal_review_packet",
  "proposal_review_options",
  "proposal_review_receipt_template",
  "proposal_review_receipt_validation",
]);
const BLOCKED_REASON = "proposal review receipt validation did not pass";

function normalizePacketId(...sources) {
  for (const source of sources) {
    if (source && typeof source.packet_id === "string" && source.packet_id.length > 0) return source.packet_id;
  }
  return null;
}

function normalizeVerdict(source) {
  return source && typeof source.verdict === "string" && source.verdict.length > 0 ? source.verdict : "unknown";
}

function allowedDecisionIds(options) {
  if (!options || !Array.isArray(options.allowed_decisions)) return [];
  return options.allowed_decisions
    .map((decision) => (decision && typeof decision.id === "string" && decision.id.length > 0 ? decision.id : null))
    .filter(Boolean);
}

function requiredFields(receiptTemplate) {
  if (!receiptTemplate || !Array.isArray(receiptTemplate.required_fields)) return [];
  return receiptTemplate.required_fields.filter((field) => typeof field === "string" && field.length > 0);
}

function validationPassed(validation) {
  return validation && validation.ok === true && validation.verdict === "pass";
}

function baseCopyBlock({ packetId, validationVerdict }) {
  return {
    kind: COPY_BLOCK_KIND,
    source: COPY_BLOCK_SOURCE,
    packet_id: packetId,
    validation_verdict: validationVerdict,
    includes: [...INCLUDES],
    export_target: null,
    writes_files: false,
    records_decision: false,
    records_approval: false,
    mutates: false,
  };
}

function buildCopyText({ packetId, packetVerdict, optionDecisionIds, receiptRequiredFields }) {
  const lines = [
    "Proposal Review Copy Block",
    "",
    `packet_id: ${packetId === null ? "null" : packetId}`,
    "validation_verdict: pass",
    `packet_verdict: ${packetVerdict}`,
    "writes_files: false",
    "records_decision: false",
    "records_approval: false",
    "mutates: false",
    "",
    "Review context:",
    "- proposal_review_packet",
    "- proposal_review_options",
    "- proposal_review_receipt_template",
    "- proposal_review_receipt_validation",
    "",
    "Allowed decisions:",
  ];
  if (optionDecisionIds.length === 0) lines.push("- none");
  else for (const decisionId of optionDecisionIds) lines.push(`- ${decisionId}`);
  lines.push("", "Receipt template fields:");
  if (receiptRequiredFields.length === 0) lines.push("- none");
  else for (const field of receiptRequiredFields) lines.push(`- ${field}`);
  lines.push(
    "",
    "Boundary: read-only context for manual review. Do not write files, export files, create tasks, execute child commands, refresh readiness, or mutate parent/child repo truth.",
  );
  return lines.join("\n");
}

function buildProposalReviewCopyBlock({
  proposalReviewPacket,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewReceiptValidation,
} = {}) {
  const packetId = normalizePacketId(proposalReviewPacket, proposalReviewOptions, proposalReviewReceiptTemplate);
  const validationVerdict = validationPassed(proposalReviewReceiptValidation) ? "pass" : "fail";
  const block = baseCopyBlock({ packetId, validationVerdict });
  if (validationVerdict !== "pass") {
    return {
      ...block,
      copy_text: null,
      reason: BLOCKED_REASON,
    };
  }
  return {
    ...block,
    copy_text: buildCopyText({
      packetId,
      packetVerdict: normalizeVerdict(proposalReviewPacket),
      optionDecisionIds: allowedDecisionIds(proposalReviewOptions),
      receiptRequiredFields: requiredFields(proposalReviewReceiptTemplate),
    }),
  };
}

function renderProposalReviewCopyBlockMarkdown(copyBlock) {
  const safeBlock = copyBlock || buildProposalReviewCopyBlock();
  const lines = [
    "",
    "## Proposal Review Copy Block",
    "",
    `- packet_id: ${safeBlock.packet_id === null ? "null" : safeBlock.packet_id}`,
    `- validation_verdict: ${safeBlock.validation_verdict || "fail"}`,
    `- writes_files: ${safeBlock.writes_files === false ? "false" : String(safeBlock.writes_files)}`,
    `- records_decision: ${safeBlock.records_decision === false ? "false" : String(safeBlock.records_decision)}`,
    `- records_approval: ${safeBlock.records_approval === false ? "false" : String(safeBlock.records_approval)}`,
    `- mutates: ${safeBlock.mutates === false ? "false" : String(safeBlock.mutates)}`,
  ];
  if (safeBlock.copy_text === null || typeof safeBlock.copy_text !== "string") {
    lines.push("- copy_text: null", `- reason: ${safeBlock.reason || BLOCKED_REASON}`);
    return lines;
  }
  lines.push("", "```text", safeBlock.copy_text, "```");
  return lines;
}

module.exports = {
  buildProposalReviewCopyBlock,
  renderProposalReviewCopyBlockMarkdown,
};
