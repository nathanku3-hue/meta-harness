"use strict";

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

function noOpProposalDraft() {
  return {
    kind: "read_only_proposal_draft",
    source: "next_action_brief",
    selected_candidate_id: null,
    selected_repo: null,
    proposal_type: "review_brief",
    title: "No proposal needed",
    body: [
      "No proposal draft is needed because the current rollup has no next-action candidates.",
      "",
      [
        "Boundary: read-only proposal draft only.",
        "Do not write files,",
        "execute child commands,",
        "refresh readiness,",
        "or mutate parent/child repo truth.",
      ].join(" "),
    ].join("\n"),
    target_paths: [],
    diff: null,
    mutates: false,
  };
}

function proposalBody(brief) {
  return [
    `Proposal: Review rollup next action for ${brief.selected_repo}.`,
    "",
    `Source candidate: ${brief.selected_candidate_id}`,
    `Priority: ${brief.priority || "none"}`,
    `Reason: ${brief.reason || "none"}`,
    `Target paths: ${listText(brief.target_paths)}`,
    "",
    [
      "Boundary: read-only proposal draft only.",
      "Do not write files,",
      "apply" + " patches,",
      "execute child commands,",
      "refresh readiness,",
      "or mutate parent/child repo truth.",
    ].join(" "),
  ].join("\n");
}

function buildProposalDraft(nextActionBrief) {
  if (!nextActionBrief || !nextActionBrief.selected_candidate_id) return noOpProposalDraft();
  return {
    kind: "read_only_proposal_draft",
    source: "next_action_brief",
    selected_candidate_id: nextActionBrief.selected_candidate_id,
    selected_repo: nextActionBrief.selected_repo || null,
    proposal_type: "review_brief",
    title: `Review rollup next action for ${nextActionBrief.selected_repo || "unknown repo"}`,
    body: proposalBody(nextActionBrief),
    target_paths: compactStrings(nextActionBrief.target_paths),
    diff: null,
    mutates: false,
  };
}

module.exports = { buildProposalDraft };
