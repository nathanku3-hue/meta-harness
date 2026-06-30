"use strict";

const OPTIONS_KIND = "read_only_proposal_review_options";
const KNOWN_VERDICTS = Object.freeze(["ready_for_review", "blocked", "not_needed"]);
const DECISION_LABELS = Object.freeze({
  approve_for_manual_work: "Approve for manual work",
  reject_packet: "Reject packet",
  defer_packet: "Defer packet",
  fix_proposal_validation: "Fix proposal validation",
  no_action: "No action",
});

function normalizePacketId(packet) {
  return packet && typeof packet.packet_id === "string" && packet.packet_id.length > 0 ? packet.packet_id : null;
}

function normalizeVerdict(packet) {
  const verdict = packet && typeof packet.verdict === "string" ? packet.verdict : "unknown";
  return KNOWN_VERDICTS.includes(verdict) ? verdict : "unknown";
}

function option(id) {
  return {
    id,
    label: DECISION_LABELS[id],
    requires_explicit_human_action: id !== "no_action",
    mutates: false,
  };
}

function decisionIdsForVerdict(verdict) {
  if (verdict === "ready_for_review") return ["approve_for_manual_work", "reject_packet", "defer_packet"];
  if (verdict === "blocked") return ["fix_proposal_validation", "defer_packet"];
  if (verdict === "not_needed") return ["no_action"];
  return ["defer_packet"];
}

function defaultDecisionForVerdict(verdict) {
  return verdict === "not_needed" ? "no_action" : "defer_packet";
}

function buildProposalReviewOptions({ proposalReviewPacket } = {}) {
  const verdict = normalizeVerdict(proposalReviewPacket);
  const decisionIds = decisionIdsForVerdict(verdict);
  return {
    kind: OPTIONS_KIND,
    packet_id: normalizePacketId(proposalReviewPacket),
    verdict,
    allowed_decisions: decisionIds.map(option),
    default_decision: defaultDecisionForVerdict(verdict),
    mutates: false,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function renderProposalReviewOptionsMarkdown(options) {
  const safeOptions = options || buildProposalReviewOptions();
  const lines = ["", "## Proposal Review Options", ""];
  lines.push(
    `- packet_id: ${safeOptions.packet_id === null ? "null" : safeOptions.packet_id}`,
    `- verdict: ${safeOptions.verdict || "unknown"}`,
    `- default_decision: ${safeOptions.default_decision || "defer_packet"}`,
    `- mutates: ${safeOptions.mutates === false ? "false" : String(safeOptions.mutates)}`,
  );
  for (const decision of asArray(safeOptions.allowed_decisions)) {
    lines.push(`- ${decision.id} — ${decision.label}`);
  }
  return lines;
}

module.exports = { buildProposalReviewOptions, renderProposalReviewOptionsMarkdown };
