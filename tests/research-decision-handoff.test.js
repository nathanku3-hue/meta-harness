"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HANDOFF_SCHEMA_VERSION,
  NOT_CHANGED,
  buildResearchDecisionHandoff,
  renderResearchDecisionHandoffMarkdown,
} = require("../lib/research-decision-handoff");

const REPORT = `# External Deep Research Report

## Executive Summary

A read-only handoff should turn evidence into a human-reviewable next-slice candidate.

## Claims

- Research output can help a fresh worker choose the next slice.
- Existing ingest buckets are enough for deterministic handoff generation.

## Recommendations

1. Add a read-only decision-candidate handoff under mcp research.
2. Keep official project truth behind human review.

## Risks

- Do not write status, events, roadmap, or decision log from pasted research.
- No write-enabled MCP tools should be added.

## Open Questions

- Should handoff output be attached to worker reports later?

## Decision Candidates

- Authorize Phase 16D as a read-only decision-candidate handoff.
- Defer write-enabled decision tooling.

## Constraints

- Keep the work under the existing mcp command surface.
- No local network calls are needed.
`;

test("buildResearchDecisionHandoff maps ingest output into read-only handoff JSON", () => {
  const handoff = buildResearchDecisionHandoff({
    question: "What should Phase 16D ship?",
    sourceReportPath: "reports/research.md",
    reportText: REPORT,
  });

  assert.equal(handoff.schema_version, HANDOFF_SCHEMA_VERSION);
  assert.equal(handoff.question, "What should Phase 16D ship?");
  assert.equal(handoff.source_report_path, "reports/research.md");
  assert.equal(handoff.handoff_status, "read_only_candidate");
  assert.equal(handoff.official_truth_changed, false);
  assert.equal(handoff.recommended_decision_candidate, "Authorize Phase 16D as a read-only decision-candidate handoff.");
  assert.deepEqual(handoff.supporting_claims, [
    "Research output can help a fresh worker choose the next slice.",
    "Existing ingest buckets are enough for deterministic handoff generation.",
  ]);
  assert.equal(handoff.recommended_next_slice, "Add a read-only decision-candidate handoff under mcp research.");
  assert.deepEqual(handoff.risks, [
    "Do not write status, events, roadmap, or decision log from pasted research.",
    "No write-enabled MCP tools should be added.",
  ]);
  assert.deepEqual(handoff.open_questions, ["Should handoff output be attached to worker reports later?"]);
  assert.ok(handoff.repo_constraints_matched.includes("No local network calls."));
  assert.ok(handoff.repo_constraints_matched.includes("No write-enabled MCP tools."));
  assert.deepEqual(handoff.not_changed, NOT_CHANGED);
});

test("buildResearchDecisionHandoff is deterministic", () => {
  const input = {
    question: "What should Phase 16D ship?",
    sourceReportPath: "reports/research.md",
    reportText: REPORT,
  };

  assert.deepEqual(buildResearchDecisionHandoff(input), buildResearchDecisionHandoff(input));
});

test("buildResearchDecisionHandoff renders clear empty-state fields", () => {
  const handoff = buildResearchDecisionHandoff({
    question: "What should happen next?",
    sourceReportPath: "empty.md",
    reportText: "# Empty Report\n\nNo structured sections here.\n",
  });

  assert.equal(handoff.recommended_decision_candidate, "No decision candidate detected.");
  assert.equal(handoff.recommended_next_slice, "No recommended next slice detected.");
  assert.deepEqual(handoff.supporting_claims, []);
  assert.deepEqual(handoff.risks, []);
  assert.deepEqual(handoff.open_questions, []);
  assert.deepEqual(handoff.repo_constraints_matched, []);
  assert.equal(handoff.official_truth_changed, false);
});

test("renderResearchDecisionHandoffMarkdown emits stable human-reviewable sections", () => {
  const handoff = buildResearchDecisionHandoff({
    question: "What should Phase 16D ship?",
    sourceReportPath: "reports/research.md",
    reportText: REPORT,
  });
  const markdown = renderResearchDecisionHandoffMarkdown(handoff);

  assert.match(markdown, /^# Research Decision Handoff\n/);
  assert.match(markdown, /## Question\n\nWhat should Phase 16D ship\?/);
  assert.match(markdown, /## Handoff Status\n\nRead-only candidate handoff\. No official project truth was changed\./);
  assert.match(markdown, /## Recommended Decision Candidate\n\nAuthorize Phase 16D as a read-only decision-candidate handoff\./);
  assert.match(markdown, /## Supporting Claims\n\n- Research output can help a fresh worker choose the next slice\./);
  assert.match(markdown, /## Recommended Next Slice\n\nAdd a read-only decision-candidate handoff under mcp research\./);
  assert.match(markdown, /## Risks \/ Guardrails\n\n- Do not write status, events, roadmap, or decision log from pasted research\./);
  assert.match(markdown, /## Open Questions\n\n- Should handoff output be attached to worker reports later\?/);
  assert.match(markdown, /## Matched Repo Constraints\n/);
  assert.match(markdown, /## Not Changed\n\n- status\n- events\n- roadmap\n- decision log\n$/);
});
