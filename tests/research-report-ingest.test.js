"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ingestResearchReport,
  matchedRepoConstraints,
  parseReportSections,
  renderResearchEvidenceMarkdown,
  summarizeResearchReport,
} = require("../lib/research-report-ingest");

const REPORT = `# External Deep Research Report

## Executive Summary

A section-based read-only ingest closes the local evidence loop without adding network behavior.

## Claims

- Read-only ingest closes the paste-back evidence loop.
- Section headings are enough for deterministic local extraction.

## Recommendations

1. Keep parser deterministic and section-based.
2. Keep the feature under the existing mcp command surface.

## Risks

- Do not let report ingestion write status or events.
- No write-enabled MCP tools should be added.
- No local network calls or proprietary LLM API calls are needed.

## Open Questions

- Should ingested evidence later flow into worker reports?

## Decision Candidates

- Authorize Phase 16B as a read-only evidence candidate generator.

## Constraints

- Preserve readiness and governance gates.
`;

test("ingestResearchReport extracts deterministic evidence buckets", () => {
  const result = ingestResearchReport({
    question: "How should report ingest work?",
    sourceReportPath: "reports/deep-research.md",
    reportText: REPORT,
  });

  assert.equal(result.schema_version, "1.0.0");
  assert.equal(result.question, "How should report ingest work?");
  assert.equal(result.source_report_path, "reports/deep-research.md");
  assert.deepEqual(result.claims, [
    "Read-only ingest closes the paste-back evidence loop.",
    "Section headings are enough for deterministic local extraction.",
  ]);
  assert.match(result.evidence_summary, /read-only ingest closes the local evidence loop/);
  assert.ok(result.recommendations.includes("Keep parser deterministic and section-based."));
  assert.ok(result.risks.includes("Do not let report ingestion write status or events."));
  assert.ok(result.open_questions.includes("Should ingested evidence later flow into worker reports?"));
  assert.ok(result.decision_candidates.includes("Authorize Phase 16B as a read-only evidence candidate generator."));
  assert.ok(result.repo_constraints_matched.includes("No local network calls."));
  assert.ok(result.repo_constraints_matched.includes("No write-enabled MCP tools."));
  assert.ok(result.repo_constraints_matched.includes("Preserve readiness and governance gates."));
});

test("Phase 16C dogfood fixture ingests stable next-slice evidence", () => {
  const sourceReportPath = "tests/fixtures/research/phase16c-dogfood-report.md";
  const reportText = fs.readFileSync(path.join(__dirname, "fixtures", "research", "phase16c-dogfood-report.md"), "utf8");
  const result = ingestResearchReport({
    question: "What is the highest-leverage next product slice after read-only MCP and research evidence ingest?",
    sourceReportPath,
    reportText,
  });

  assert.equal(result.source_report_path, sourceReportPath);
  assert.ok(result.claims.includes("The remaining product gap is not more infrastructure; it is turning evidence into a bounded human decision that a fresh worker can continue from."));
  assert.ok(result.recommendations.includes("Make the next implementation slice a read-only decision-candidate handoff under the existing mcp command surface."));
  assert.ok(result.risks.includes("Do not let report ingestion write status or events automatically, because that would let pasted research silently change official project truth."));
  assert.ok(result.open_questions.includes("Should the next handoff remain only a rendered evidence section, or should it become a named sub-action under the existing mcp research surface after approval?"));
  assert.ok(result.decision_candidates.includes("Authorize Phase 16D as a read-only decision-candidate handoff slice under the existing mcp command surface, with no automatic status, events, roadmap, or decision-log writes."));
  assert.deepEqual(result.repo_constraints_matched, [
    "Keep work under the existing mcp command surface.",
    "No credentials or provider access.",
    "No HTTP/SSE, OAuth, or tunnel surface.",
    "No local network calls.",
    "No new package dependencies.",
    "No proprietary LLM API calls.",
    "No shell execution tools.",
    "No write-enabled MCP tools.",
    "Preserve readiness and governance gates.",
  ]);
});

test("summarizeResearchReport permits reports without an ingest question", () => {
  const result = summarizeResearchReport({ sourceReportPath: "report.md", reportText: REPORT });
  assert.equal(result.question, "");
  assert.equal(result.source_report_path, "report.md");
  assert.ok(result.claims.length > 0);
});

test("parseReportSections deduplicates and classifies numbered bullets", () => {
  const sections = parseReportSections("## Findings\n1. Same claim\n- Same claim\n## Next Steps\n1. Add tests\n");
  assert.deepEqual(sections.claims, ["Same claim"]);
  assert.deepEqual(sections.recommendations, ["Add tests"]);
});

test("matchedRepoConstraints returns sorted known local constraints", () => {
  assert.deepEqual(matchedRepoConstraints("Avoid dependencies. No shell execution tools."), [
    "No new package dependencies.",
    "No shell execution tools.",
  ]);
});

test("renderResearchEvidenceMarkdown emits stable sections", () => {
  const result = summarizeResearchReport({ sourceReportPath: "report.md", reportText: REPORT });
  const markdown = renderResearchEvidenceMarkdown(result);
  assert.match(markdown, /^# Research Evidence Ingest\n/);
  assert.match(markdown, /## Source Report\n\nreport\.md/);
  assert.match(markdown, /## Decision Candidates/);
});

test("ingestResearchReport rejects missing question", () => {
  assert.throws(() => ingestResearchReport({ reportText: REPORT }), /requires a question/);
});
