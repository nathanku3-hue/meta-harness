"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSubagentPacket, rejectRawLogReturnSchema } = require("../lib/subagent-packet");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-subagent-"));
}

test("subagent packet has exact golden shape", () => {
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "spec.md"), "# Spec\n", "utf8");

  assert.deepEqual(buildSubagentPacket({
    cwd,
    goal: "Implement Dirty Work Autopilot v0",
    ownedPaths: ["docs/spec.md"],
    forbiddenPaths: [".env", "provider-config/*", "user-worktree/*"],
    requiredEvidence: ["dirty state snapshot", "scope diff gate result", "test output", "PM brief"],
    stopRule: "Stop if outside-scope or credential/provider/runtime dirt appears.",
    returnSchema: "PM brief + artifact paths + decision inbox entries only.",
  }), {
    goal: "Implement Dirty Work Autopilot v0",
    owned_paths: ["docs/spec.md"],
    forbidden_paths: [".env", "provider-config/*", "user-worktree/*"],
    required_evidence: ["dirty state snapshot", "scope diff gate result", "test output", "PM brief"],
    stop_rule: "Stop if outside-scope or credential/provider/runtime dirt appears.",
    return_schema: "PM brief + artifact paths + decision inbox entries only.",
  });
});

test("default owned paths come from copied-safe files only", () => {
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "spec.md"), "# Spec\n", "utf8");

  const packet = buildSubagentPacket({
    cwd,
    copiedSafeOwnedPaths: ["docs/spec.md"],
  });
  assert.deepEqual(packet.owned_paths, ["docs/spec.md"]);
  assert.equal(packet.owned_paths.includes("docs/chats/example.md"), false);
});

test("explicit bad owned paths are rejected", () => {
  const cwd = tempDir();
  for (const item of [".env", "secret.txt", "provider-config/foo", "runtime/output.json", "docs/chats/foo.md", "raw-chat-log.txt"]) {
    assert.throws(() => buildSubagentPacket({ cwd, ownedPaths: [item] }), /owned path|raw chat/);
  }
});

test("return schema rejects raw transcript variants", () => {
  for (const schema of [
    "PM brief plus raw logs",
    "return raw transcript",
    "return chat transcript",
    "return conversation transcript",
    "return conversation log",
    "return command transcript",
    "return full transcript",
    "return private transcripts",
  ]) {
    assert.throws(() => rejectRawLogReturnSchema(schema), /must exclude raw logs/);
  }
});
