"use strict";

const INTENT_KIND = "read_only_proposal_review_export_intent";
const INTENT_SOURCE = "proposal_review_copy_block_validation";

function normalizePacketId(...sources) {
  for (const source of sources) {
    if (source && typeof source.packet_id === "string" && source.packet_id.length > 0) return source.packet_id;
  }
  return null;
}

function validationPassed(validation) {
  return validation && validation.ok === true && validation.verdict === "pass";
}

function buildProposalReviewExportIntent({
  proposalReviewPacket,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewReceiptValidation,
  proposalReviewCopyBlock,
  proposalReviewCopyBlockValidation,
  rollup,
} = {}) {
  const packetId = normalizePacketId(
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation
  );
  const copyBlockValidationPassed = validationPassed(proposalReviewCopyBlockValidation);
  const validationVerdict = copyBlockValidationPassed ? "pass" : "fail";

  return {
    kind: INTENT_KIND,
    source: INTENT_SOURCE,
    packet_id: packetId,
    validation_verdict: validationVerdict,
    export_target: null,
    declared_intent: copyBlockValidationPassed ? "none" : null,
    writes_files: false,
    records_decision: false,
    mutates: false,
  };
}

function renderProposalReviewExportIntentMarkdown(intent) {
  const safeIntent = intent || buildProposalReviewExportIntent();
  const lines = [
    "",
    "## Proposal Review Export Intent",
    "",
    `- packet_id: ${safeIntent.packet_id === null ? "null" : safeIntent.packet_id}`,
    `- validation_verdict: ${safeIntent.validation_verdict || "fail"}`,
    `- export_target: ${safeIntent.export_target === null ? "null" : String(safeIntent.export_target)}`,
    `- declared_intent: ${safeIntent.declared_intent === null ? "null" : safeIntent.declared_intent}`,
    `- writes_files: ${safeIntent.writes_files === false ? "false" : String(safeIntent.writes_files)}`,
    `- records_decision: ${safeIntent.records_decision === false ? "false" : String(safeIntent.records_decision)}`,
    `- mutates: ${safeIntent.mutates === false ? "false" : String(safeIntent.mutates)}`,
  ];
  return lines;
}

module.exports = {
  buildProposalReviewExportIntent,
  renderProposalReviewExportIntentMarkdown,
};
