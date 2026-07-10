"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildWorkerEntryGate,
  attachWorkerEntryGateToRollup,
  renderWorkerEntryGateMarkdown,
} = require("../lib/worker-entry-gate");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const tmp = (p = "mh-weg-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const wj = (fp, v) => {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(v, null, 2)}\n`);
};
const cli = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

function readyReadiness(over = {}) {
  return {
    kind: "execution_readiness",
    source: "operator_plan_artifact",
    verdict: "ready",
    ok: true,
    runs_read_only_git_inspection: true,
    executes_child_commands: false,
    mutates: false,
    ...over,
  };
}

function openInputs(over = {}) {
  return {
    operatorPlanArtifactValidation: { verdict: "pass", ok: true },
    selectedRepoResolution: { ok: true, name: "child-app", path: "child" },
    executionReadiness: readyReadiness(),
    requested: true,
    ...over,
  };
}

function assertSafetyFalse(gate) {
  assert.equal(gate.executes_child_commands, false);
  assert.equal(gate.mutates, false);
  assert.equal(gate.writes_files, false);
  assert.equal(gate.writes_parent_files, false);
  assert.equal(gate.writes_child_files, false);
  assert.equal(gate.applies_patches, false);
  assert.equal(gate.creates_tasks, false);
  assert.equal(gate.creates_queues, false);
  assert.equal(gate.refreshes_readiness, false);
  assert.equal(gate.records_decision, false);
  assert.equal(gate.records_approval, false);
}

test("open: all six conditions true", () => {
  const gate = buildWorkerEntryGate(openInputs());
  assert.equal(gate.kind, "worker_entry_gate");
  assert.equal(gate.verdict, "open");
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.required_inputs, {
    operator_plan_validation_ok: true,
    selected_repo_resolution_ok: true,
    execution_readiness_ok: true,
    read_only_git_inspection_ran: true,
    executes_child_commands: false,
  });
  assert.equal(gate.reasons.length, 0);
  assertSafetyFalse(gate);
});

test("blocked: validation.ok false", () => {
  const gate = buildWorkerEntryGate(openInputs({
    operatorPlanArtifactValidation: { verdict: "invalid", ok: false },
  }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.ok, false);
  assert.equal(gate.required_inputs.operator_plan_validation_ok, false);
  assert.ok(gate.reasons.some((r) => r.code === "OPERATOR_PLAN_VALIDATION_NOT_OK"));
});

test("blocked: resolution missing/not ok", () => {
  let gate = buildWorkerEntryGate(openInputs({ selectedRepoResolution: undefined }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.selected_repo_resolution_ok, false);

  gate = buildWorkerEntryGate(openInputs({
    selectedRepoResolution: { ok: false, code: "missing_repo", detail: "no" },
  }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.selected_repo_resolution_ok, false);
  assert.ok(gate.reasons.some((r) => r.code === "missing_repo"));
});

test("blocked: readiness not ready / dirty / not_git", () => {
  for (const verdict of ["dirty", "not_git_repo", "artifact_invalid"]) {
    const gate = buildWorkerEntryGate(openInputs({
      executionReadiness: readyReadiness({ verdict, ok: false }),
    }));
    assert.equal(gate.verdict, "blocked", verdict);
    assert.equal(gate.required_inputs.execution_readiness_ok, false);
    assert.ok(gate.reasons.some((r) => r.code === "EXECUTION_READINESS_NOT_READY"));
  }
});

test("blocked: read-only git inspection not run", () => {
  const gate = buildWorkerEntryGate(openInputs({
    executionReadiness: readyReadiness({ runs_read_only_git_inspection: false }),
  }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.read_only_git_inspection_ran, false);
  assert.ok(gate.reasons.some((r) => r.code === "READ_ONLY_GIT_INSPECTION_NOT_RUN"));
});

test("blocked: executes_child_commands true on readiness", () => {
  const gate = buildWorkerEntryGate(openInputs({
    executionReadiness: readyReadiness({ executes_child_commands: true }),
  }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.executes_child_commands, true);
  assert.equal(gate.executes_child_commands, false); // gate-level always false
  assert.ok(gate.reasons.some((r) => r.code === "EXECUTES_CHILD_COMMANDS"));
});

test("blocked: missing readiness object", () => {
  const gate = buildWorkerEntryGate(openInputs({ executionReadiness: undefined }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.execution_readiness_ok, false);
  assert.ok(gate.reasons.some((r) => r.code === "EXECUTION_READINESS_MISSING"));
});

test("blocked: unknown readiness verdict", () => {
  const gate = buildWorkerEntryGate(openInputs({
    executionReadiness: readyReadiness({ verdict: "totally_new", ok: true }),
  }));
  assert.equal(gate.verdict, "blocked");
  assert.ok(gate.reasons.some((r) => r.code === "UNKNOWN_READINESS_VERDICT"));
});

test("safety flags all false when open", () => {
  const gate = buildWorkerEntryGate(openInputs());
  assert.equal(gate.verdict, "open");
  assertSafetyFalse(gate);
});

test("not_requested when requested=false", () => {
  const gate = buildWorkerEntryGate(openInputs({ requested: false }));
  assert.equal(gate.verdict, "not_requested");
  assert.equal(gate.ok, false);
  assertSafetyFalse(gate);
});

test("attachWorkerEntryGateToRollup sets only worker_entry_gate key", () => {
  const rollup = {
    operator_execution_plan_artifact_validation: { ok: true },
    selected_repo_resolution: { ok: true },
    execution_readiness: readyReadiness(),
  };
  attachWorkerEntryGateToRollup(rollup);
  assert.ok(rollup.worker_entry_gate);
  assert.equal(rollup.worker_entry_gate.kind, "worker_entry_gate");
  assert.equal(rollup.worker_entry_gate.verdict, "open");
  assert.equal(Object.prototype.hasOwnProperty.call(rollup, "operator_work_gate"), false);
});

test("markdown renders section", () => {
  const lines = renderWorkerEntryGateMarkdown(buildWorkerEntryGate(openInputs()));
  assert.ok(lines.includes("## Worker Entry Gate"));
  assert.ok(lines.some((l) => l.includes("verdict: open")));
});

test("poll: validation failure always emits worker_entry_gate blocked", () => {
  const parent = tmp("mh-weg-p-");
  const ph = path.join(parent, ".meta-harness");
  fs.mkdirSync(ph, { recursive: true });
  fs.writeFileSync(path.join(ph, "status.md"), "# S\n");
  fs.writeFileSync(path.join(ph, "events.jsonl"), "{}\n");
  wj(path.join(ph, "repos.json"), { repos: [] });
  wj(path.join(ph, "bad.json"), { not: "valid" });

  const result = cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-operator-execution-plan", ".meta-harness/bad.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const roll = JSON.parse(result.stdout);
  assert.equal(roll.operator_execution_plan_artifact_validation.ok, false);
  assert.ok(roll.execution_readiness);
  assert.ok(roll.worker_entry_gate);
  assert.equal(roll.worker_entry_gate.kind, "worker_entry_gate");
  assert.equal(roll.worker_entry_gate.verdict, "blocked");
  assert.equal(roll.worker_entry_gate.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(roll, "operator_work_gate"), false);
});

test("poll: good artifact non-git child → gate blocked not open", () => {
  const parent = tmp("mh-weg-p2-");
  const child = tmp("mh-weg-c2-");
  const ph = path.join(parent, ".meta-harness");
  const ch = path.join(child, ".meta-harness");
  fs.mkdirSync(ph, { recursive: true });
  fs.mkdirSync(ch, { recursive: true });
  fs.writeFileSync(path.join(ph, "status.md"), "# S\n");
  fs.writeFileSync(path.join(ph, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(ch, "status.md"), "# S\n");
  fs.writeFileSync(path.join(ch, "events.jsonl"), "{}\n");
  wj(path.join(ch, "ready.json"), {
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
    checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "x" }],
  });
  wj(path.join(ph, "repos.json"), { repos: [{ name: "child-app", path: child, role: "child" }] });

  const initial = cli(parent, ["poll", "--rollup", "--json"]);
  assert.equal(initial.status, 0, initial.stderr);
  const receipt = {
    packet_id: JSON.parse(initial.stdout).autonomy_plan.packet_id,
    decision_id: "approve_for_manual_work",
    reviewer: "R",
    reviewed_at: "2026-07-02T00:00:00.000Z",
    reason: "ok",
  };
  assert.equal(cli(parent, [
    "poll", "--rollup", "--json",
    "--autonomy-approval-receipt", JSON.stringify(receipt),
    "--write-manual-work-packet", ".meta-harness/manual-work-packet.json",
  ]).status, 0);
  assert.equal(cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-manual-work-packet", ".meta-harness/manual-work-packet.json",
    "--write-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ]).status, 0);
  const verify = cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ]);
  assert.equal(verify.status, 0, verify.stderr);
  const roll = JSON.parse(verify.stdout);
  assert.equal(roll.operator_execution_plan_artifact_validation.ok, true);
  assert.equal(roll.execution_readiness.verdict, "not_git_repo");
  assert.ok(roll.worker_entry_gate);
  assert.equal(roll.worker_entry_gate.verdict, "blocked");
  assert.equal(roll.worker_entry_gate.ok, false);
  assert.equal(roll.worker_entry_gate.required_inputs.execution_readiness_ok, false);
});
