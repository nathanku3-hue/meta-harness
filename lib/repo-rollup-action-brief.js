"use strict";

const PRIORITIES = Object.freeze(["high", "medium", "low"]);
const BOUNDARY = "read-only review only. Do not execute child commands, write files, apply patches, or mutate parent/child repo truth.";

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

function selectCandidate(repos) {
  for (const priority of PRIORITIES) {
    for (const repo of asArray(repos)) {
      for (const candidate of asArray(repo && repo.next_action_candidates)) {
        if (candidate && candidate.priority === priority) return candidate;
      }
    }
  }
  return null;
}

function noOpBody() {
  return [
    "No follow-up action is needed from the current rollup evidence.",
    "",
    `Boundary: ${BOUNDARY}`,
  ].join("\n");
}

function candidateBody(candidate) {
  return [
    `Review child repo evidence for ${candidate.repo}.`,
    "",
    `Candidate: ${candidate.id}`,
    `Priority: ${candidate.priority}`,
    `Reason: ${candidate.reason}`,
    `Source state: ${candidate.source_state || "none"}`,
    `Source warning IDs: ${listText(candidate.source_warning_ids)}`,
    `Source check IDs: ${listText(candidate.source_check_ids)}`,
    `Target paths: ${listText(candidate.target_paths)}`,
    "",
    `Boundary: ${BOUNDARY}`,
  ].join("\n");
}

function buildActionBrief(repos) {
  const candidate = selectCandidate(repos);
  if (!candidate) {
    return {
      kind: "read_only_worker_brief",
      selected_candidate_id: null,
      selected_repo: null,
      priority: null,
      reason: null,
      source_state: null,
      source_warning_ids: [],
      source_check_ids: [],
      target_paths: [],
      selection_reason: "no next-action candidates",
      body: noOpBody(),
      mutates: false,
    };
  }
  return {
    kind: "read_only_worker_brief",
    selected_candidate_id: candidate.id,
    selected_repo: candidate.repo,
    priority: candidate.priority,
    reason: candidate.reason,
    source_state: candidate.source_state || null,
    source_warning_ids: compactStrings(candidate.source_warning_ids),
    source_check_ids: compactStrings(candidate.source_check_ids),
    target_paths: compactStrings(candidate.target_paths),
    selection_reason: "selected highest-priority candidate using repo order and candidate order tie-breakers",
    body: candidateBody(candidate),
    mutates: false,
  };
}

module.exports = { buildActionBrief };
