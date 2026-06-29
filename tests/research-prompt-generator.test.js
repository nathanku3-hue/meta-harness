"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { generateResearchPrompt, normalizeFiles, truncateText } = require("../lib/research-prompt-generator");

test("generateResearchPrompt includes question, constraints, and sorted file context", () => {
  const prompt = generateResearchPrompt({
    question: "How should the MCP slice stay deterministic?",
    files: [
      { path: "z.js", content: "module.exports = 1;\n" },
      { path: "a.js", content: "module.exports = 2;\n" },
    ],
    goals: ["Keep runtime local."],
  });

  assert.match(prompt, /^# Deep Research Prompt\n/);
  assert.match(prompt, /How should the MCP slice stay deterministic\?/);
  assert.ok(prompt.indexOf("### a.js") < prompt.indexOf("### z.js"));
  assert.match(prompt, /No local network calls/);
  assert.match(prompt, /Concrete next implementation steps/);
});

test("normalizeFiles drops empty paths and marks truncated content", () => {
  const files = normalizeFiles([
    { path: "", content: "ignored" },
    { path: "lib/x.js", content: "abcdef" },
  ], 4);

  assert.equal(files.length, 1);
  assert.equal(files[0].path, "lib/x.js");
  assert.equal(files[0].truncated, true);
});

test("truncateText preserves short text", () => {
  assert.deepEqual(truncateText("abc", 10), { text: "abc", truncated: false });
});
