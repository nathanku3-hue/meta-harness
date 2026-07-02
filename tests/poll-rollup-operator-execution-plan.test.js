"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildOperatorExecutionPlan } = require("../lib/repo-rollup-operator-execution-plan");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-operator-plan-"));
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

function setupFailedChild() {
  const parent = tempDir();
  const child = tempDir();
  const parentHarness = path.join(parent, ".meta-harness");
  const childHarness = path.join(child, ".meta-harness");
  fs.mkdirSync(parentHarness, { recursive: true });
  fs.mkdirSync(childHarness, { recursive: true });

  writeFile(path.join(parentHarness, "status.md"), "# Status\n\nParent status must not change\n");
  writeFile(path.join(parentHarness, "events.jsonl"), "{\"event\":\"parent\"}\n");
  writeFile(path.join(childHarness, "status.md"), "# Status\n\nPhase: active\n");
  writeFile(path.join(childHarness, "events.jsonl"), "{\"event\":\"child\"}\n");
  writeJson(path.join(childHarness, "ready.json"), {
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
  return { parent, child };
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

// pure builder unit-level test
test("unit test: verified validation pass but missing verifiedManualWorkPacket -> blocked", () => {
  const result = buildOperatorExecutionPlan({
    manualWorkPacketArtifactValidation: { verdict: "pass", ok: true, packet_id: "packet-1" },
    verifiedManualWorkPacket: null,
  });
  assert.equal(result.verdict, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.packet_id, "packet-1");
});

// Integration tests
test("1. no verify flag -> operator_execution_plan.verdict === not_requested", () => {
  const { parent } = setupFailedChild();
  const result = run(parent, ["poll", "--rollup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.ok(rollup.operator_execution_plan);
  assert.equal(rollup.operator_execution_plan.verdict, "not_requested");
  assert.equal(rollup.operator_execution_plan.ok, false);
});

test("2. missing artifact -> blocked", () => {
  const { parent } = setupFailedChild();
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.operator_execution_plan.verdict, "blocked");
  assert.equal(rollup.operator_execution_plan.ok, false);
});

test("3. invalid artifact -> blocked", () => {
  const { parent } = setupFailedChild();
  const output = path.join(parent, ".meta-harness", "manual-work-packet.json");
  writeFile(output, "{not json\n");
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.operator_execution_plan.verdict, "blocked");
  assert.equal(rollup.operator_execution_plan.ok, false);
});

test("4. blocked artifact verification -> blocked", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  artifact.manual_work_packet.verdict = "blocked";
  writeJson(output, artifact);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.operator_execution_plan.verdict, "blocked");
  assert.equal(rollup.operator_execution_plan.ok, false);
});

test("5. valid verified artifact -> ready_for_operator", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.operator_execution_plan.verdict, "ready_for_operator");
  assert.equal(rollup.operator_execution_plan.ok, true);
});

test("6. copies packet_id / repo / candidate / target paths from verified artifact packet", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const plan = rollup.operator_execution_plan;
  assert.equal(plan.packet_id, artifact.packet_id);
  assert.equal(plan.selected_repo, artifact.manual_work_packet.selected_repo);
  assert.equal(plan.selected_candidate_id, artifact.manual_work_packet.selected_candidate_id);
  assert.equal("repo" in plan, false);
  assert.equal("candidate" in plan, false);
  assert.deepEqual(plan.target_paths, artifact.manual_work_packet.target_paths);
});

test("7. copies source_check_ids and source_warning_ids from verified artifact packet", () => {
  const { parent } = setupFailedChild();
  const output = writeValidArtifact(parent);
  const artifact = readJson(output);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const plan = rollup.operator_execution_plan;
  assert.deepEqual(plan.source_check_ids, artifact.manual_work_packet.source_check_ids);
  assert.deepEqual(plan.source_warning_ids, artifact.manual_work_packet.source_warning_ids);
});

test("8. does not require approval receipt input", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  // We run without --autonomy-approval-receipt
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.operator_execution_plan.verdict, "ready_for_operator");
});

test("9. does not depend on current live manual_work_packet being ready", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  // Live manual_work_packet lacks approval receipt so it will be "missing_approval"
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.manual_work_packet.verdict, "missing_approval");
  assert.equal(rollup.operator_execution_plan.verdict, "ready_for_operator");
});

test("10. safety flags are all non-mutating", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const plan = rollup.operator_execution_plan;
  assert.equal(plan.mutates, false);
  assert.equal(plan.writes_files, false);
  assert.equal(plan.writes_parent_files, false);
  assert.equal(plan.writes_child_files, false);
  assert.equal(plan.executes_child_commands, false);
  assert.equal(plan.applies_patches, false);
  assert.equal(plan.creates_tasks, false);
  assert.equal(plan.creates_queues, false);
  assert.equal(plan.refreshes_readiness, false);
  assert.equal(plan.records_decision, false);
  assert.equal(plan.records_approval, false);
});

test("11. forbidden output/execution/apply/task/queue fields absent", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const plan = rollup.operator_execution_plan;
  const forbidden = [
    "patch_proposals", "patches", "commands", "child_commands", "task_files",
    "queue_files", "action_files", "apply", "execute", "write_plan_file",
    "decision_record", "approval_record", "readiness_refresh"
  ];
  for (const field of forbidden) {
    assert.equal(field in plan, false, `forbidden field ${field} should be absent`);
  }
});

test("12. stdout rollup behavior preserved", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.summary.total, 1);
  assert.equal(rollup.ok, false);
  assert.equal(rollup.manual_work_packet.verdict, "missing_approval");
  assert.equal(rollup.manual_work_packet_artifact_validation.verdict, "pass");
});

test("13. key ordering is manual_work_packet_artifact_validation -> operator_execution_plan -> repos", () => {
  const { parent } = setupFailedChild();
  writeValidArtifact(parent);
  const result = runVerify(parent);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  const keys = Object.keys(rollup);
  const vIndex = keys.indexOf("manual_work_packet_artifact_validation");
  const pIndex = keys.indexOf("operator_execution_plan");
  const rIndex = keys.indexOf("repos");
  assert.ok(vIndex !== -1, "missing manual_work_packet_artifact_validation");
  assert.ok(pIndex !== -1, "missing operator_execution_plan");
  assert.ok(rIndex !== -1, "missing repos");
  assert.equal(pIndex, vIndex + 1, "operator_execution_plan must follow validation");
  assert.equal(rIndex, pIndex + 1, "repos must follow operator_execution_plan");
});

test("14. generic poll --rollup --write remains rejected", () => {
  const { parent } = setupFailedChild();
  failure(run(parent, ["poll", "--rollup", "--json", "--write"]), /read-only/);
});
