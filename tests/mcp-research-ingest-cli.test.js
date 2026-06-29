"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertCliError, run, runRaw, tempDir, writeFile } = require("./helpers/cli");

const REPORT = `# Report

## Summary

The evidence loop should remain read-only and deterministic.

## Claims

- The harness can ingest pasted research as evidence.

## Recommendations

- Keep the implementation under the existing mcp command surface.

## Risks

- No local network calls should be introduced.

## Decision Candidates

- Consider promoting this report into a human-reviewed decision later.
`;

test("mcp research ingest emits deterministic JSON without writing harness state", () => {
  const cwd = tempDir("meta-harness-mcp-ingest-");
  writeFile(cwd, "reports/deep.md", REPORT);

  const output = run(cwd, [
    "mcp", "research", "ingest",
    "--report", "reports/deep.md",
    "--question", "How should evidence ingest work?",
    "--json",
  ]);
  const parsed = JSON.parse(output);

  assert.equal(parsed.schema_version, "1.0.0");
  assert.equal(parsed.question, "How should evidence ingest work?");
  assert.equal(parsed.source_report_path, "reports/deep.md");
  assert.deepEqual(parsed.claims, ["The harness can ingest pasted research as evidence."]);
  assert.ok(parsed.repo_constraints_matched.includes("No local network calls."));
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness")), false);
});

test("mcp research summarize emits markdown without requiring question", () => {
  const cwd = tempDir("meta-harness-mcp-summarize-");
  writeFile(cwd, "report.md", REPORT);

  const output = run(cwd, ["mcp", "research", "summarize", "--report", "report.md"]);

  assert.match(output, /^# Research Evidence Ingest\n/);
  assert.match(output, /## Question\n\nNot provided\./);
  assert.match(output, /## Claims\n\n- The harness can ingest pasted research as evidence\./);
});

test("mcp research ingest enforces report and question flags", () => {
  const cwd = tempDir("meta-harness-mcp-ingest-errors-");
  const missingReport = runRaw(cwd, ["mcp", "research", "ingest", "--question", "q"]);
  assertCliError(missingReport, "MH_USAGE", /mcp research ingest requires --report/);

  writeFile(cwd, "report.md", REPORT);
  const missingQuestion = runRaw(cwd, ["mcp", "research", "ingest", "--report", "report.md"]);
  assertCliError(missingQuestion, "MH_USAGE", /mcp research ingest requires --question/);
});

test("mcp research summarize enforces report flag", () => {
  const cwd = tempDir("meta-harness-mcp-summarize-errors-");
  const result = runRaw(cwd, ["mcp", "research", "summarize"]);
  assertCliError(result, "MH_USAGE", /mcp research summarize requires --report/);
});
