"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PassThrough } = require("node:stream");
const { createMcpServer, extractFrames, runStdioServer, toolDescriptors, writeFrame } = require("../lib/mcp-server");
const { resolveWorkspacePath } = require("../lib/mcp-workspaces");
const { tempDir, writeFile } = require("./helpers/cli");

test("toolDescriptors exposes read-only strategic tools", () => {
  assert.deepEqual(toolDescriptors().map((tool) => tool.name), [
    "harness-status",
    "harness-research-prompt",
    "harness-insight-summary",
  ]);
});

test("mcp server handles initialize, list, and tool calls", async () => {
  const root = tempDir("meta-harness-mcp-server-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.2.3" }));
  writeFile(root, ".meta-harness/status.md", "# Status\n\nPhase:\nwork\n");
  writeFile(root, "lib/sample.js", "module.exports = 42;\n");
  const server = createMcpServer({ root, fs, path });

  const initialized = await server.handleRequest({ method: "initialize" });
  assert.equal(initialized.serverInfo.name, "meta-harness");

  const listed = await server.handleRequest({ method: "tools/list" });
  assert.equal(listed.tools.length, 3);

  const status = await server.callTool("harness-status", {});
  assert.match(status.content[0].text, /fixture/);

  const prompt = await server.callTool("harness-research-prompt", {
    question: "What should we test?",
    files: ["lib/sample.js"],
  });
  assert.match(prompt.content[0].text, /What should we test\?/);
  assert.match(prompt.content[0].text, /module\.exports = 42/);

  const insights = await server.callTool("harness-insight-summary", {
    diffText: "diff --git a/a.js b/a.js\n-old\n+new\n",
    json: true,
  });
  assert.match(insights.content[0].text, /"changed_files": 1/);
});

test("workspace path resolution blocks escapes", () => {
  const root = tempDir("meta-harness-mcp-path-");
  assert.throws(() => resolveWorkspacePath(root, "../outside.txt"), /outside workspace root/);
});

test("stdio framing extracts complete MCP messages", () => {
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => { captured += chunk.toString("utf8"); });
  writeFrame(output, { jsonrpc: "2.0", id: 1, result: { ok: true } });
  const parsed = extractFrames(captured);
  assert.equal(parsed.remaining, "");
  assert.deepEqual(JSON.parse(parsed.frames[0]), { jsonrpc: "2.0", id: 1, result: { ok: true } });
});

test("runStdioServer responds to framed tool list requests", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => { captured += chunk.toString("utf8"); });

  const done = runStdioServer({ input, output, server: createMcpServer({ root: tempDir() }) });
  writeFrame(input, { jsonrpc: "2.0", id: 7, method: "tools/list" });
  input.end();
  await done;

  const parsed = extractFrames(captured);
  const response = JSON.parse(parsed.frames[0]);
  assert.equal(response.id, 7);
  assert.equal(response.result.tools.length, 3);
});
