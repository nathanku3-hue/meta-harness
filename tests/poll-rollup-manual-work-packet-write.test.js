"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-manual-packet-write-"));
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

function setupFailedChild(options = {}) {
  const parent = tempDir();
  const child = options.childInsideHarness ? path.join(parent, ".meta-harness", "child-repo") : tempDir();
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
  return { parent, child, watched };
}

function receipt(parent) {
  const initial = run(parent, ["poll", "--rollup", "--json"]);
  assert.equal(initial.status, 0, initial.stderr);
  const rollup = JSON.parse(initial.stdout);
  assert.equal(rollup.manual_work_packet.verdict, "missing_approval");
  return {
    packet_id: rollup.autonomy_plan.packet_id,
    decision_id: "approve_for_manual_work",
    reviewer: "Runtime Reviewer",
    reviewed_at: "2026-07-02T00:00:00.000Z",
    reason: "Manual work packet reviewed and approved.",
  };
}

function failure(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(JSON.parse(result.stdout).error.message, pattern);
}

function runWrite(parent, approval, extra = []) {
  return run(parent, [
    "poll",
    "--rollup",
    "--json",
    "--autonomy-approval-receipt",
    JSON.stringify(approval),
    "--write-manual-work-packet",
    ".meta-harness/manual-work-packet.json",
    ...extra,
  ]);
}

test("no narrow write flag means no packet artifact", () => {
  const { parent, watched } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  watched.push(output);
  const before = snapshot(watched);
  const result = run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(receipt(parent))]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(snapshot(watched), before);
});

test("write requires ready manual packet", () => {
  const { parent, watched } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  watched.push(output);
  const before = snapshot(watched);
  const result = run(parent, ["poll", "--rollup", "--json", "--write-manual-work-packet", ".meta-harness/manual-work-packet.json"]);
  failure(result, /ready_for_manual_work/);
  assert.deepEqual(snapshot(watched), before);
});

test("valid approval writes one parent artifact with honest wrapper safety", () => {
  const { parent, watched } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  const before = snapshot(watched);
  const result = runWrite(parent, receipt(parent));
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const artifact = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(artifact.schema_version, "1.0.0");
  assert.equal(artifact.kind, "approved_manual_work_packet_artifact");
  assert.equal(artifact.source, "poll_rollup_manual_work_packet");
  assert.equal(artifact.rollup_schema_version, rollup.schema_version);
  assert.equal(artifact.packet_id, rollup.manual_work_packet.packet_id);
  assert.deepEqual(artifact.manual_work_packet, rollup.manual_work_packet);
  assert.equal(artifact.writes_files, true);
  assert.equal(artifact.writes_parent_files, true);
  assert.equal(artifact.writes_child_files, false);
  assert.equal(artifact.manual_work_packet.writes_files, false);
  assert.equal(artifact.manual_work_packet.writes_parent_files, false);
  assert.equal(artifact.manual_work_packet.writes_child_files, false);
  assert.equal(artifact.executes_child_commands, false);
  assert.equal(artifact.applies_patches, false);
  assert.equal(artifact.refreshes_readiness, false);
  assert.equal(artifact.records_decision, false);
  assert.equal(artifact.records_approval, false);
  assert.deepEqual(snapshot(watched), before);
});

test("rejects unsafe output paths", () => {
  const { parent, child } = setupFailedChild({ childInsideHarness: true });
  const approval = receipt(parent);
  failure(run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(approval), "--write-manual-work-packet", "manual-work-packet.json"]), /under \.meta-harness\//);
  failure(run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(approval), "--write-manual-work-packet", path.join(parent, ".meta-harness", "manual-work-packet.json")]), /relative/);
  failure(run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(approval), "--write-manual-work-packet", ".meta-harness"]), /file path/);
  failure(run(parent, ["poll", "--rollup", "--json", "--autonomy-approval-receipt", JSON.stringify(approval), "--write-manual-work-packet", ".meta-harness/child-repo/manual-work-packet.json"]), /child repo/);
  assert.equal(fs.existsSync(path.join(child, "manual-work-packet.json")), false);
});

test("force is required for deterministic overwrite", () => {
  const { parent } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  writeFile(output, "existing\n");
  const approval = receipt(parent);
  failure(runWrite(parent, approval), /already exists/);
  const first = runWrite(parent, approval, ["--force"]);
  assert.equal(first.status, 0, first.stderr);
  const firstText = fs.readFileSync(output, "utf8");
  const second = runWrite(parent, approval, ["--force"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(output, "utf8"), firstText);
});

test("artifact excludes legacy output field names and generic write stays rejected", () => {
  const { parent } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  const result = runWrite(parent, receipt(parent));
  assert.equal(result.status, 0, result.stderr);
  const artifactText = fs.readFileSync(output, "utf8");
  for (const field of ["patch_" + "proposals", "proposal_" + "files", "export_" + "files", "queue_" + "files", "action_" + "files"]) {
    assert.equal(artifactText.includes(`\"${field}\"`), false, field);
  }
  failure(run(parent, ["poll", "--rollup", "--json", "--write"]), /read-only/);
});
