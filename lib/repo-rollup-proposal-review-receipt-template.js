"use strict";

const RECEIPT_TEMPLATE_KIND = "read_only_proposal_review_receipt_template";
const RECEIPT_TEMPLATE_SOURCE = "proposal_review_options";
const REQUIRED_FIELDS = Object.freeze([
  "packet_id",
  "decision_id",
  "reviewer",
  "reviewed_at",
  "reason",
]);

function normalizePacketId(options) {
  return options && typeof options.packet_id === "string" && options.packet_id.length > 0 ? options.packet_id : null;
}

function normalizeVerdict(options) {
  return options && typeof options.verdict === "string" && options.verdict.length > 0 ? options.verdict : "unknown";
}

function allowedDecisionIds(options) {
  if (!options || !Array.isArray(options.allowed_decisions)) return [];
  return options.allowed_decisions
    .map((decision) => (decision && typeof decision.id === "string" ? decision.id : null))
    .filter(Boolean);
}

function buildReceiptTemplate(packetId) {
  return {
    packet_id: packetId,
    decision_id: null,
    reviewer: null,
    reviewed_at: null,
    reason: null,
  };
}

function buildProposalReviewReceiptTemplate({ proposalReviewOptions } = {}) {
  const packetId = normalizePacketId(proposalReviewOptions);
  return {
    kind: RECEIPT_TEMPLATE_KIND,
    source: RECEIPT_TEMPLATE_SOURCE,
    packet_id: packetId,
    verdict: normalizeVerdict(proposalReviewOptions),
    allowed_decision_ids: allowedDecisionIds(proposalReviewOptions),
    required_fields: [...REQUIRED_FIELDS],
    template: buildReceiptTemplate(packetId),
    records_decision: false,
    mutates: false,
  };
}

function renderProposalReviewReceiptTemplateMarkdown(template) {
  const safeTemplate = template || buildProposalReviewReceiptTemplate();
  const allowedIds = Array.isArray(safeTemplate.allowed_decision_ids) ? safeTemplate.allowed_decision_ids : [];
  const requiredFields = Array.isArray(safeTemplate.required_fields) ? safeTemplate.required_fields : REQUIRED_FIELDS;
  return [
    "",
    "## Proposal Review Receipt Template",
    "",
    `- packet_id: ${safeTemplate.packet_id === null ? "null" : safeTemplate.packet_id}`,
    `- verdict: ${safeTemplate.verdict || "unknown"}`,
    `- records_decision: ${safeTemplate.records_decision === false ? "false" : String(safeTemplate.records_decision)}`,
    `- mutates: ${safeTemplate.mutates === false ? "false" : String(safeTemplate.mutates)}`,
    `- allowed_decision_ids: ${allowedIds.length > 0 ? allowedIds.join(", ") : "none"}`,
    `- required_fields: ${requiredFields.join(", ")}`,
  ];
}

module.exports = {
  buildProposalReviewReceiptTemplate,
  renderProposalReviewReceiptTemplateMarkdown,
};
