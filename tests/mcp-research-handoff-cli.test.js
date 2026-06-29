"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertCliError, run, runRaw, tempDir, writeFile } = require("./helpers/cli");

const REPORT = `# Report

## Summary

The next slice should remain bounded, read-only, and deterministic.

## Claims

- A handoff can help a fresh worker choose the next slice without changing project truth.

## Recommendations

- Add a read-only decision-candidate handoff under mcp research.

## Risks

- Do not let pasted research write status or events.
- No write-enabled MCP tools should be added.

## Open Questions

- Should handoff output later feed worker reports?

## Decision Candidates

- Ship Phase 16D as a read-only research decision handoff.

## Constraints

- Keep the work under the existing mcp command surface.
- No local network calls are needed.
`;

const PROTECTED_FILES = {
  ".meta-harness/status.md": "# Status\n\nunchanged status\n",
  ".meta-harness/events.jsonl": "{\"event\":\"unchanged\"}\n",
  "docs/product/decision-log.md": "# Decision Log\n\nunchanged decisions\n",
  "docs/product/roadmap.md": "# Roadmap\n\nunchanged roadmap\n",
};

function writeProtectedFiles(cwd) {
  for (const [relativePath, content] of Object.entries(PROTECTED_FILES)) {
    writeFile(cwd, relativePath, content);
  }
}

function readProtectedFiles(cwd) {
  return Object.fromEntries(Object.keys(PROTECTED_FILES).map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(cwd, ...relativePath.split("/")), "utf8"),
  ]));
}

test("mcp research handoff emits stable markdown", () => {
  const cwd = tempDir("meta-harness-mcp-handoff-md-");
  writeFile(cwd, "reports/deep.md", REPORT);

  const output = run(cwd, [
    "mcp", "research", "handoff",
    "--report", "reports/deep.md",
    "--question", "What should Phase 16D ship?",
  ]);

  assert.match(output, /^# Research Decision Handoff\n/);
  assert.match(output, /## Handoff Status\n\nRead-only candidate handoff\. No official project truth was changed\./);
  assert.match(output, /## Recommended Decision Candidate\n\nShip Phase 16D as a read-only research decision handoff\./);
  assert.match(output, /## Not Changed\n\n- status\n- events\n- roadmap\n- decision log\n$/);
});

test("mcp research handoff emits deterministic JSON without writing official truth files", () => {
  const cwd = tempDir("meta-harness-mcp-handoff-json-");
  writeFile(cwd, "reports/deep.md", REPORT);
  writeProtectedFiles(cwd);
  const before = readProtectedFiles(cwd);

  const output = run(cwd, [
    "mcp", "research", "handoff",
    "--report", "reports/deep.md",
    "--question", "What should Phase 16D ship?",
    "--json",
  ]);
  const parsed = JSON.parse(output);
  const repeat = JSON.parse(run(cwd, [
    "mcp", "research", "handoff",
    "--report", "reports/deep.md",
    "--question", "What should Phase 16D ship?",
    "--json",
  ]));

  assert.deepEqual(parsed, repeat);
  assert.equal(parsed.schema_version, "1.0.0");
  assert.equal(parsed.question, "What should Phase 16D ship?");
  assert.equal(parsed.source_report_path, "reports/deep.md");
  assert.equal(parsed.handoff_status, "read_only_candidate");
  assert.equal(parsed.official_truth_changed, false);
  assert.equal(parsed.recommended_decision_candidate, "Ship Phase 16D as a read-only research decision handoff.");
  assert.deepEqual(parsed.supporting_claims, [
    "A handoff can help a fresh worker choose the next slice without changing project truth.",
  ]);
  assert.equal(parsed.recommended_next_slice, "Add a read-only decision-candidate handoff under mcp research.");
  assert.deepEqual(parsed.not_changed, ["status", "events", "roadmap", "decision_log"]);
  assert.deepEqual(readProtectedFiles(cwd), before);
});

test("mcp research handoff enforces report and question flags", () => {
  const cwd = tempDir("meta-harness-mcp-handoff-errors-");
  const missingReport = runRaw(cwd, ["mcp", "research", "handoff", "--question", "q"]);
  assertCliError(missingReport, "MH_USAGE", /mcp research handoff requires --report/);

  writeFile(cwd, "report.md", REPORT);
  const missingQuestion = runRaw(cwd, ["mcp", "research", "handoff", "--report", "report.md"]);
  assertCliError(missingQuestion, "MH_USAGE", /mcp research handoff requires --question/);
});
