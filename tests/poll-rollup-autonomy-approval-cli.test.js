"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-poll-approval-retired-"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, META_HARNESS_INTERNAL_CLI: "1" },
  });
}

function snapshot(paths) {
  return Object.fromEntries(paths.map((filePath) => [
    filePath,
    fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null,
  ]));
}

function setupFailedChild() {
  const parent = tempDir();
  const child = tempDir();
  const parentHarness = path.join(parent, ".meta-harness");
  const childHarness = path.join(child, ".meta-harness");
  fs.mkdirSync(parentHarness, { recursive: true });
  fs.mkdirSync(childHarness, { recursive: true });
  const watched = [
    path.join(parentHarness, "status.md"),
    path.join(parentHarness, "events.jsonl"),
    path.join(childHarness, "status.md"),
    path.join(childHarness, "events.jsonl"),
    path.join(childHarness, "ready.json"),
  ];
  writeFile(watched[0], "# Status\n\nParent status must not change\n");
  writeFile(watched[1], "{\"event\":\"parent\"}\n");
  writeFile(watched[2], "# Status\n\nPhase: active\n");
  writeFile(watched[3], "{\"event\":\"child\"}\n");
  writeJson(watched[4], {
    schema_version: "1.0.0",
    generated_at: "2026-06-30T04:00:00.000Z",
    expires_after: "2099-01-01T00:00:00.000Z",
    target: "/tmp/child",
    ok: false,
    redacted: true,
    passed: 0,
    failed: 1,
    warned: 0,
    skipped: 0,
    checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "manual review needed" }],
  });
  writeJson(path.join(parentHarness, "repos.json"), {
    repos: [{ name: "child-app", path: child, role: "child" }],
  });
  return { parent, watched };
}

function assertRetired(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, "");
  const failure = JSON.parse(result.stdout);
  assert.equal(
    failure.error.message,
    "autonomy approval receipt input is retired; manual work packets are derived directly from current rollup facts",
  );
}

test("poll --rollup derives manual work directly without approval state or mutation", () => {
  const { parent, watched } = setupFailedChild();
  const before = snapshot(watched);
  const result = run(parent, ["poll", "--rollup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.manual_work_packet.verdict, "ready_for_manual_work");
  assert.equal(rollup.manual_work_packet.source, "next_action_brief");
  assert.equal(rollup.manual_work_packet.records_decision, false);
  assert.equal(rollup.manual_work_packet.records_approval, false);
  assert.equal(Object.hasOwn(rollup, "autonomy_plan"), false);
  assert.equal(Object.hasOwn(rollup, "autonomy_approval_receipt_validation"), false);
  assert.deepEqual(snapshot(watched), before);
});

test("poll --rollup rejects retired inline autonomy approval receipt input", () => {
  const { parent } = setupFailedChild();
  assertRetired(run(parent, [
    "poll", "--rollup", "--json", "--autonomy-approval-receipt", "{}",
  ]));
});

test("poll --rollup rejects retired autonomy approval receipt file input without reading it", () => {
  const { parent } = setupFailedChild();
  writeFile(path.join(parent, "approval-receipt.json"), "not json\n");
  assertRetired(run(parent, [
    "poll", "--rollup", "--json", "--autonomy-approval-receipt-file", "approval-receipt.json",
  ]));
});
