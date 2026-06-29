"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { run, tempDir, writeFile } = require("./helpers/cli");

test("mcp serve --list-tools prints registered read-only tools", () => {
  const output = run(tempDir("meta-harness-mcp-tools-"), ["mcp", "serve", "--list-tools"]);
  const parsed = JSON.parse(output);
  assert.equal(parsed.schema_version, "1.0.0");
  assert.deepEqual(parsed.tools.map((tool) => tool.name), [
    "harness-status",
    "harness-research-prompt",
    "harness-insight-summary",
  ]);
});

test("mcp init writes local ignored config idempotently", () => {
  const cwd = tempDir("meta-harness-mcp-init-");
  const first = run(cwd, ["mcp", "init"]);
  assert.match(first, /Wrote MCP config:/);
  const configPath = path.join(cwd, ".meta-harness", "local", "mcp", "config.json");
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(parsed.transport, "stdio");
  assert.deepEqual(parsed.tools, [
    "harness-status",
    "harness-research-prompt",
    "harness-insight-summary",
  ]);

  const second = run(cwd, ["mcp", "init"]);
  assert.match(second, /already exists/);
  const third = run(cwd, ["mcp", "init", "--overwrite"]);
  assert.match(third, /Wrote MCP config:/);
});

test("mcp research prompt reads selected workspace files", () => {
  const cwd = tempDir("meta-harness-mcp-research-");
  writeFile(cwd, "lib/topic.js", "module.exports = 'topic';\n");
  const output = run(cwd, [
    "mcp", "research", "prompt",
    "--question", "How should this be tested?",
    "--files", "lib/topic.js",
  ]);
  assert.match(output, /^# Deep Research Prompt\n/);
  assert.match(output, /How should this be tested\?/);
  assert.match(output, /module\.exports = 'topic'/);
});

test("mcp insight extract can emit JSON from a git diff", () => {
  const output = run(path.resolve(__dirname, ".."), ["mcp", "insight", "extract", "--diff", "HEAD", "--json"]);
  const parsed = JSON.parse(output);
  assert.equal(parsed.schema_version, "1.0.0");
  assert.ok(Array.isArray(parsed.changed_files));
});
