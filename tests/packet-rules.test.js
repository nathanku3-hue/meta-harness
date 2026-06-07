"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  canPrependStaleHeader,
  classifyStaleExpertReport,
  copyFileWithPacketRules,
  isForbiddenPacketPath,
  isRawChatPath,
  validateOwnedPath,
} = require("../lib/packet-rules");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rules-"));
}

test("raw chat detection catches docs chats without catching charts", () => {
  const cwd = tempDir();
  assert.equal(isRawChatPath(cwd, "docs/chats/example.md"), true);
  assert.equal(isRawChatPath(cwd, "notes/raw-chat-log.txt"), true);
  assert.equal(isRawChatPath(cwd, "charts/example.md"), false);
  assert.equal(isRawChatPath(cwd, "docs/charts/example.md"), false);
});

test("forbidden packet paths cover secret provider and runtime locations", () => {
  const cwd = tempDir();
  for (const item of [".env", "secret.txt", "provider-config/foo", "runtime/output.json"]) {
    assert.equal(isForbiddenPacketPath(cwd, item), true, item);
    assert.throws(() => validateOwnedPath(cwd, item), /refusing forbidden owned path/);
  }
});

test("owned path validation rejects symlink escapes", (t) => {
  const cwd = tempDir();
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, "outside.txt"), "outside\n", "utf8");
  const link = path.join(cwd, "escape");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`symlink setup unavailable: ${error.message}`);
    return;
  }
  assert.throws(() => validateOwnedPath(cwd, "escape/outside.txt"), /must stay inside the current repository/);
});

test("stale markdown expert reports get headers but stale json stays parseable", () => {
  const cwd = tempDir();
  const referenceMtimeMs = Date.now();
  const markdown = path.join(cwd, "old-expert-report.md");
  const json = path.join(cwd, "old-expert-report.json");
  fs.writeFileSync(markdown, "# Expert Report\n\nOld finding.\n", "utf8");
  fs.writeFileSync(json, "{\n  \"finding\": \"old\"\n}\n", "utf8");
  const oldDate = new Date(referenceMtimeMs - 60_000);
  fs.utimesSync(markdown, oldDate, oldDate);
  fs.utimesSync(json, oldDate, oldDate);

  const mdStale = classifyStaleExpertReport(cwd, markdown, referenceMtimeMs);
  const jsonStale = classifyStaleExpertReport(cwd, json, referenceMtimeMs);
  assert.deepEqual(mdStale, { stale: true, headerAllowed: true });
  assert.deepEqual(jsonStale, { stale: true, headerAllowed: false });
  assert.equal(canPrependStaleHeader(markdown), true);
  assert.equal(canPrependStaleHeader(json), false);

  const outDir = path.join(cwd, "out");
  const mdResult = copyFileWithPacketRules(cwd, markdown, path.join(outDir, "old-expert-report.md"), {
    referenceMtimeMs,
  });
  const jsonResult = copyFileWithPacketRules(cwd, json, path.join(outDir, "old-expert-report.json"), {
    referenceMtimeMs,
  });
  assert.match(fs.readFileSync(path.join(outDir, "old-expert-report.md"), "utf8"), /^# STALE EXPERT REPORT/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "old-expert-report.json"), "utf8")), {
    finding: "old",
  });
  assert.match(mdResult.stale, /stale header prepended/);
  assert.match(jsonResult.stale, /manifest\/front-card warning only/);
});
