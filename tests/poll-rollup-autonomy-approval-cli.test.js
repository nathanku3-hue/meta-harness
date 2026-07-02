"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-poll-approval-"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
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

function approvalReceipt(packetId) {
  return {
    packet_id: packetId,
    decision_id: "approve_for_manual_work",
    reviewer: "Runtime Reviewer",
    reviewed_at: "2026-07-02T00:00:00.000Z",
    reason: "Manual work packet reviewed and approved.",
  };
}

function initialRollup(parent) {
  const result = run(parent, ["poll", "--rollup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.autonomy_plan.verdict, "ready_for_human_approval");
  assert.equal(rollup.autonomy_approval_receipt_validation.verdict, "missing");
  assert.equal(rollup.manual_work_packet.verdict, "missing_approval");
  assert.equal(rollup.manual_work_packet.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  return rollup;
}

function assertApproved(result, receipt, before, after) {
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.autonomy_approval_receipt_validation.verdict, "approved_for_manual_work");
  assert.equal(rollup.autonomy_approval_receipt_validation.ok, true);
  assert.deepEqual(rollup.autonomy_approval_receipt_validation.receipt, receipt);
  assert.equal(rollup.manual_work_packet.verdict, "ready_for_manual_work");
  assert.equal(rollup.manual_work_packet.source, "autonomy_approval_receipt_validation");
  assert.equal(rollup.manual_work_packet.packet_id, receipt.packet_id);
  assert.equal(rollup.manual_work_packet.selected_repo, "child-app");
  assert.equal(rollup.manual_work_packet.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  for (const field of ["mutates", "records_decision", "records_approval", "executes_child_commands", "writes_parent_files", "writes_child_files", "creates_tasks", "creates_queues", "applies_patches", "refreshes_readiness"]) {
    assert.equal(rollup.autonomy_approval_receipt_validation[field], false);
    assert.equal(rollup.manual_work_packet[field], false);
  }
  assert.equal(rollup.manual_work_packet.writes_files, false);
  assert.deepEqual(after, before);
}

test("poll --rollup accepts inline autonomy approval receipt without mutating files", () => {
  const { parent, watched } = setupFailedChild();
  const receipt = approvalReceipt(initialRollup(parent).autonomy_plan.packet_id);
  const before = snapshot(watched);
  const result = run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(receipt)]);
  assertApproved(result, receipt, before, snapshot(watched));
});

test("poll --rollup accepts autonomy approval receipt file without mutating files", () => {
  const { parent, watched } = setupFailedChild();
  const receipt = approvalReceipt(initialRollup(parent).autonomy_plan.packet_id);
  const receiptPath = path.join(parent, "approval-receipt.json");
  writeJson(receiptPath, receipt);
  watched.push(receiptPath);
  const before = snapshot(watched);
  const result = run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt-file", "approval-receipt.json"]);
  assertApproved(result, receipt, before, snapshot(watched));
});

test("poll --rollup rejects malformed autonomy approval receipt JSON", () => {
  const { parent } = setupFailedChild();
  const result = run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", "not-json"]);
  assert.notEqual(result.status, 0);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.error.message, "--autonomy-approval-receipt must be valid JSON");
});
