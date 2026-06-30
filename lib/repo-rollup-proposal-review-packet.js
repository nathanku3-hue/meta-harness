"use strict";

const crypto = require("node:crypto");

const PACKET_KIND = "read_only_proposal_review_packet";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactStrings(values) {
  return asArray(values).filter((value) => value != null && value !== "").map(String);
}

function listText(values) {
  const items = compactStrings(values);
  return items.length > 0 ? items.join(", ") : "none";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function packetIdFor({ proposalDraft, proposalValidation, proposalReviewGate }) {
  const payload = {
    proposal_draft: proposalDraft || null,
    proposal_validation: proposalValidation || null,
    proposal_review_gate: proposalReviewGate || null,
  };
  return `sha256:${crypto.createHash("sha256").update(stableJson(payload), "utf8").digest("hex")}`;
}

function selectedCandidateId(proposalDraft, proposalReviewGate) {
  if (proposalReviewGate && Object.prototype.hasOwnProperty.call(proposalReviewGate, "selected_candidate_id")) {
    return proposalReviewGate.selected_candidate_id == null ? null : String(proposalReviewGate.selected_candidate_id);
  }
  return proposalDraft && proposalDraft.selected_candidate_id != null ? String(proposalDraft.selected_candidate_id) : null;
}

function selectedRepo(proposalDraft, proposalReviewGate) {
  if (proposalReviewGate && Object.prototype.hasOwnProperty.call(proposalReviewGate, "selected_repo")) {
    return proposalReviewGate.selected_repo == null ? null : String(proposalReviewGate.selected_repo);
  }
  return proposalDraft && proposalDraft.selected_repo != null ? String(proposalDraft.selected_repo) : null;
}

function packetVerdict(proposalValidation, proposalReviewGate) {
  if (!proposalValidation || proposalValidation.ok !== true) return "blocked";
  if (!proposalReviewGate || proposalReviewGate.verdict === "blocked") return "blocked";
  if (proposalReviewGate.verdict === "not_needed") return "not_needed";
  if (proposalReviewGate.verdict === "ready_for_review") return "ready_for_review";
  return "blocked";
}

function draftBody(draft) {
  if (!draft) return "proposal_draft is missing";
  const lines = [
    `selected: ${draft.selected_repo && draft.selected_candidate_id ? `${draft.selected_repo} ${draft.selected_candidate_id}` : "none"}`,
    `type: ${draft.proposal_type || "none"}`,
    `mutates: ${draft.mutates === false ? "false" : String(draft.mutates)}`,
    `diff: ${draft.diff === null ? "null" : String(draft.diff)}`,
    `target_paths: ${listText(draft.target_paths)}`,
  ];
  if (typeof draft.body === "string" && draft.body.length > 0) lines.push("", draft.body);
  return lines.join("\n");
}

function validationBody(validation) {
  if (!validation) return "proposal_validation is missing";
  const lines = [
    `verdict: ${validation.verdict || "fail"}`,
    `ok: ${validation.ok === true ? "true" : "false"}`,
    `mutates: ${validation.mutates === false ? "false" : String(validation.mutates)}`,
  ];
  for (const item of asArray(validation.checks)) {
    lines.push(`${item.id || "unknown"} ${item.status || "unknown"} — ${item.reason || "no reason provided"}`);
  }
  return lines.join("\n");
}

function gateBody(gate) {
  if (!gate) return "proposal_review_gate is missing";
  const selected = gate.selected_repo && gate.selected_candidate_id ? `${gate.selected_repo} ${gate.selected_candidate_id}` : "none";
  return [
    `verdict: ${gate.verdict || "blocked"}`,
    `next_action: ${gate.next_action || "none"}`,
    `mutates: ${gate.mutates === false ? "false" : String(gate.mutates)}`,
    `selected: ${selected}`,
    `blocking_check_ids: ${listText(gate.blocking_check_ids)}`,
    `reason: ${gate.reason || "none"}`,
  ].join("\n");
}

function buildProposalReviewPacket({ proposalDraft, proposalValidation, proposalReviewGate } = {}) {
  const verdict = packetVerdict(proposalValidation, proposalReviewGate);
  return {
    kind: PACKET_KIND,
    packet_id: packetIdFor({ proposalDraft, proposalValidation, proposalReviewGate }),
    verdict,
    selected_candidate_id: verdict === "not_needed" ? null : selectedCandidateId(proposalDraft, proposalReviewGate),
    selected_repo: verdict === "not_needed" ? null : selectedRepo(proposalDraft, proposalReviewGate),
    sections: [
      { id: "proposal_draft", title: "Proposal Draft", body: draftBody(proposalDraft) },
      { id: "proposal_validation", title: "Proposal Validation", body: validationBody(proposalValidation) },
      { id: "proposal_review_gate", title: "Proposal Review Gate", body: gateBody(proposalReviewGate) },
    ],
    mutates: false,
  };
}

function renderProposalReviewPacketMarkdown(packet) {
  const lines = ["", "## Proposal Review Packet", ""];
  if (!packet) {
    lines.push("- verdict: blocked", "- packet_id: none", "- mutates: false", "- selected: none");
    return lines;
  }
  const selected = packet.selected_repo && packet.selected_candidate_id ? `${packet.selected_repo} ${packet.selected_candidate_id}` : "none";
  lines.push(
    `- verdict: ${packet.verdict}`,
    `- packet_id: ${packet.packet_id}`,
    `- mutates: ${packet.mutates === false ? "false" : String(packet.mutates)}`,
    `- selected: ${selected}`,
  );
  for (const section of asArray(packet.sections)) {
    lines.push("", `### ${section.title || section.id || "Section"}`, "", section.body || "");
  }
  return lines;
}

module.exports = { buildProposalReviewPacket, renderProposalReviewPacketMarkdown };
