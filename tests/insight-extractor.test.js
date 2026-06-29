"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractInsights, parseChangedFiles, renderInsightMarkdown } = require("../lib/insight-extractor");

const diffText = [
  "diff --git a/lib/a.js b/lib/b.js",
  "--- a/lib/a.js",
  "+++ b/lib/b.js",
  "-alpha",
  "+beta",
  "+gamma",
  "diff --git a/lib/command-registry.js b/lib/command-registry.js",
  "--- a/lib/command-registry.js",
  "+++ b/lib/command-registry.js",
  "-before",
  "+after",
].join("\n");

test("parseChangedFiles returns deterministic file stats", () => {
  assert.deepEqual(parseChangedFiles(diffText), [
    { path: "lib/b.js", previous_path: "lib/a.js", additions: 2, removals: 1 },
    { path: "lib/command-registry.js", previous_path: null, additions: 1, removals: 1 },
  ]);
});

test("extractInsights summarizes diffs and logs", () => {
  const insights = extractInsights({
    diffText,
    logText: "# Runtime delivered\n- tests passed\nTODO follow-up later\n",
  });

  assert.equal(insights.schema_version, "1.0.0");
  assert.equal(insights.summary.changed_files, 2);
  assert.equal(insights.summary.additions, 3);
  assert.equal(insights.summary.removals, 2);
  assert.deepEqual(insights.execution_signals.slice(0, 2), ["Runtime delivered", "tests passed"]);
  assert.ok(insights.risks.some((risk) => risk.includes("CLI command surface")));
  assert.ok(insights.risks.some((risk) => risk.includes("deferred-work")));
});

test("renderInsightMarkdown produces stable copy-paste output", () => {
  const markdown = renderInsightMarkdown(extractInsights({ diffText, logText: "# Done\n" }));
  assert.match(markdown, /^# Harness Insight Summary\n/);
  assert.match(markdown, /- lib\/command-registry\.js \(\+1 -1\)/);
  assert.match(markdown, /## Decision Candidates/);
});
