"use strict";

const { ingestResearchReport } = require("./research-report-ingest");

const HANDOFF_SCHEMA_VERSION = "1.0.0";
const HANDOFF_STATUS = "read_only_candidate";
const NOT_CHANGED = ["status", "events", "roadmap", "decision_log"];
const NO_DECISION_CANDIDATE = "No decision candidate detected.";
const NO_RECOMMENDED_NEXT_SLICE = "No recommended next slice detected.";

function cloneItems(items) {
  return Array.isArray(items) ? items.slice() : [];
}

function firstOrDefault(items, fallback) {
  return Array.isArray(items) && items.length > 0 ? items[0] : fallback;
}

function buildResearchDecisionHandoff(input = {}) {
  const evidence = ingestResearchReport(input);
  return {
    schema_version: HANDOFF_SCHEMA_VERSION,
    question: evidence.question,
    source_report_path: evidence.source_report_path,
    handoff_status: HANDOFF_STATUS,
    official_truth_changed: false,
    recommended_decision_candidate: firstOrDefault(evidence.decision_candidates, NO_DECISION_CANDIDATE),
    supporting_claims: cloneItems(evidence.claims),
    recommended_next_slice: firstOrDefault(evidence.recommendations, NO_RECOMMENDED_NEXT_SLICE),
    risks: cloneItems(evidence.risks),
    open_questions: cloneItems(evidence.open_questions),
    repo_constraints_matched: cloneItems(evidence.repo_constraints_matched),
    not_changed: NOT_CHANGED.slice(),
  };
}

function pushBulletSection(lines, title, items, emptyText = "none detected") {
  lines.push("", `## ${title}`, "");
  if (!Array.isArray(items) || items.length === 0) {
    lines.push(`- ${emptyText}`);
    return;
  }
  for (const item of items) lines.push(`- ${item}`);
}

function renderResearchDecisionHandoffMarkdown(handoff) {
  const lines = [
    "# Research Decision Handoff",
    "",
    "## Question",
    "",
    handoff.question || "Not provided.",
    "",
    "## Handoff Status",
    "",
    "Read-only candidate handoff. No official project truth was changed.",
    "",
    "## Recommended Decision Candidate",
    "",
    handoff.recommended_decision_candidate || NO_DECISION_CANDIDATE,
  ];

  pushBulletSection(lines, "Supporting Claims", handoff.supporting_claims);
  lines.push("", "## Recommended Next Slice", "", handoff.recommended_next_slice || NO_RECOMMENDED_NEXT_SLICE);
  pushBulletSection(lines, "Risks / Guardrails", handoff.risks);
  pushBulletSection(lines, "Open Questions", handoff.open_questions);
  pushBulletSection(lines, "Matched Repo Constraints", handoff.repo_constraints_matched);
  pushBulletSection(lines, "Not Changed", ["status", "events", "roadmap", "decision log"]);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  HANDOFF_SCHEMA_VERSION,
  NOT_CHANGED,
  buildResearchDecisionHandoff,
  renderResearchDecisionHandoffMarkdown,
};
