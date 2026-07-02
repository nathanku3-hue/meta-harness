"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-manual-packet-verify-"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

function failure(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(JSON.parse(result.stdout).error.message, pattern);
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

function writeValidArtifact(parent) {
  const result = run(parent, [
    "poll",
    "--rollup",
    "--json",
    "--autonomy-approval-receipt",
    JSON.stringify(receipt(parent)),
    "--write-manual-work-packet",
    ".meta-harness/manual-work-packet.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  return path.join(parent, ".meta-harness", "manual-work-packet.json");
}

function runVerify(parent, artifactPath = ".meta-harness/manual-work-packet.json") {
  return run(parent, ["poll", "--rollup", "--json", "--verify-manual-work-packet", artifactPath]);
}

function validationFrom(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).manual_work_packet_artifact_validation;
}

function checkStatus(validation, id) {
  const item = validation.checks.find((check) => check.id === id);
  assert.ok(item, `missing check ${id}`);
  return item.status;
}

test("no verify flag returns not_requested validation shell", () => {
  const { parent } = setupFailedChild();
  const result = run(parent, ["poll", "--rollup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.deepEqual(rollup.manual_work_packet_artifact_validation, {
    kind: "approved_manual_work_packet_artifact_validation",
    source: "manual_work_packet_artifact",
    verdict: "not_requested",
    ok: false,
    requested: false,
    path: null,
    packet_id: null,
    checks: [],
    mutates: false,
    writes_files: false,
    writes_parent_files: false,
    writes_child_files: false,
    executes_child_commands: false,
    applies_patches: false,
    creates_tasks: false,
    creates_queues: false,
    refreshes_readiness: false,
    records_decision: false,
    records_approval: false,
  });
});

test("missing artifact path returns missing validation, not command crash", () => {
  const { parent } = setupFailedChild();
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.requested, true);
  assert.equal(validation.verdict, "missing");
  assert.equal(validation.ok, false);
  assert.equal(validation.path, ".meta-harness/manual-work-packet.json");
  assert.equal(checkStatus(validation, "ARTIFACT_EXISTS_001"), "fail");
});

test("valid artifact verifies pass without approval receipt input", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const validation = validationFrom(runVerify(parent));
  const artifact = readJson(output);
  assert.equal(validation.requested, true);
  assert.equal(validation.verdict, "pass");
  assert.equal(validation.ok, true);
  assert.equal(validation.packet_id, artifact.packet_id);
  assert.equal(validation.checks.every((item) => item.status === "pass"), true);
});

test("packet_id mismatch is invalid", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.packet_id = "sha256:mismatch";
  writeJson(output, artifact);
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_PACKET_ID_MATCH_001"), "fail");
});

test("embedded packet not ready_for_manual_work is blocked", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.manual_work_packet.verdict = "blocked";
  writeJson(output, artifact);
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "blocked");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_PACKET_READY_001"), "fail");
});

test("forbidden field anywhere is invalid", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.manual_work_packet.queue_files = [];
  writeJson(output, artifact);
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_NO_FORBIDDEN_FIELDS_001"), "fail");
});

test("absolute verify path is rejected at command layer", () => {
  const { parent } = setupFailedChild();
  const absolute = path.join(parent, ".meta-harness", "manual-work-packet.json");
  failure(runVerify(parent, absolute), /relative/);
});

test("outside .meta-harness verify path is rejected at command layer", () => {
  const { parent } = setupFailedChild();
  failure(runVerify(parent, "manual-work-packet.json"), /under \.meta-harness\//);
});

test("child repo verify path is rejected at command layer", () => {
  const { parent } = setupFailedChild({ childInsideHarness: true });
  failure(runVerify(parent, ".meta-harness/child-repo/manual-work-packet.json"), /child repo/);
});

test("verification does not write files", () => {
  const { parent, watched } = setupFailedChild();
  const output = writeValidArtifact(parent);
  watched.push(output);
  const before = snapshot(watched);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(watched), before);
});

test("stdout rollup behavior is preserved", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.summary.total, 1);
  assert.equal(rollup.ok, false);
  assert.equal(rollup.manual_work_packet.verdict, "missing_approval");
  assert.equal(rollup.manual_work_packet_artifact_validation.verdict, "pass");
  assert.deepEqual(Object.keys(rollup).slice(-3), ["manual_work_packet_artifact_validation", "repos", "not_changed"]);
});

test("invalid JSON artifact is invalid", () => {
  const { parent } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  writeFile(output, "{not json\n");
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_JSON_001"), "fail");
});

test("wrapper safety lie is invalid", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.writes_child_files = true;
  writeJson(output, artifact);
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_WRAPPER_SAFETY_001"), "fail");
});

test("embedded packet safety lie is invalid", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.manual_work_packet.executes_child_commands = true;
  writeJson(output, artifact);
  const validation = validationFrom(runVerify(parent));
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.equal(checkStatus(validation, "ARTIFACT_EMBEDDED_PACKET_SAFETY_001"), "fail");
});

test("generic poll --rollup --write remains rejected", () => {
  const { parent } = setupFailedChild();
  failure(run(parent, ["poll", "--rollup", "--json", "--write"]), /read-only/);
});
