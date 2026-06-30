"use strict";

const GATE_KIND = "read_only_proposal_review_gate";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function selectedCandidateId(proposalDraft) {
  const value = proposalDraft && proposalDraft.selected_candidate_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function selectedRepo(proposalDraft) {
  const value = proposalDraft && proposalDraft.selected_repo;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function blockingCheckIds(proposalValidation) {
  return asArray(proposalValidation && proposalValidation.checks)
    .filter((check) => !check || check.status !== "pass")
    .map((check) => (check && typeof check.id === "string" && check.id.length > 0 ? check.id : "unknown"));
}

function buildProposalReviewGate({ proposalDraft, proposalValidation } = {}) {
  if (!proposalValidation || proposalValidation.ok !== true) {
    return {
      kind: GATE_KIND,
      verdict: "blocked",
      reason: "proposal validation failed",
      selected_candidate_id: selectedCandidateId(proposalDraft),
      selected_repo: selectedRepo(proposalDraft),
      blocking_check_ids: blockingCheckIds(proposalValidation),
      next_action: "fix_proposal_validation",
      mutates: false,
    };
  }

  const candidateId = selectedCandidateId(proposalDraft);
  if (!candidateId) {
    return {
      kind: GATE_KIND,
      verdict: "not_needed",
      reason: "no next-action candidate is selected",
      selected_candidate_id: null,
      selected_repo: null,
      blocking_check_ids: [],
      next_action: "none",
      mutates: false,
    };
  }

  return {
    kind: GATE_KIND,
    verdict: "ready_for_review",
    reason: "proposal draft is valid and has a selected next-action candidate",
    selected_candidate_id: candidateId,
    selected_repo: selectedRepo(proposalDraft),
    blocking_check_ids: [],
    next_action: "review_proposal_draft",
    mutates: false,
  };
}

function renderProposalReviewGateMarkdown(gate) {
  const lines = ["", "## Proposal Review Gate", ""];
  if (!gate) return [...lines, "- verdict: blocked", "- next_action: fix_proposal_validation", "- mutates: false", "- selected: none"];
  lines.push(
    `- verdict: ${gate.verdict}`,
    `- next_action: ${gate.next_action}`,
    `- mutates: ${gate.mutates === false ? "false" : String(gate.mutates)}`,
    gate.selected_candidate_id ? `- selected: ${gate.selected_repo || "unknown"} ${gate.selected_candidate_id}` : "- selected: none",
  );
  if (Array.isArray(gate.blocking_check_ids) && gate.blocking_check_ids.length > 0) lines.push(`- blocking_check_ids: ${gate.blocking_check_ids.join(", ")}`);
  return lines;
}

module.exports = { buildProposalReviewGate, renderProposalReviewGateMarkdown };
