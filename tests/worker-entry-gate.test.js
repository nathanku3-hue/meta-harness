"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildControllerExpectedIdentity } = require("../lib/entry-authority");
const {
  buildWorkerEntryGate,
  attachWorkerEntryGateToRollup,
  renderWorkerEntryGateMarkdown,
} = require("../lib/worker-entry-gate");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const ENTRY_COMMIT = "1111111111111111111111111111111111111111";
const tmp = (p = "mh-weg-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const wj = (fp, v) => {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(v, null, 2)}\n`);
};
const cli = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
const git = (cwd, args) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return String(result.stdout || "").trim();
};

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

function entryRunSpec(head = ENTRY_COMMIT, repository = {}) {
  return {
    schemaVersion: "run-spec/v1",
    runId: "R3-WORKER-ENTRY",
    repository: {
      repositoryId: "github:example/child",
      objectFormat: "sha1",
      expectedBaseRevision: head,
      ...repository,
    },
    objective: "Verify worker entry authority",
    scope: { allow: [".meta-harness/status.md"], deny: [] },
    validation: {
      commands: [{
        argv: ["node", "--test", "tests/worker-entry-gate.test.js"],
        cwdRelative: ".",
        timeoutSeconds: 120,
        networkPolicy: "denied",
        environmentPolicy: { allow: [] },
      }],
    },
    changePolicy: "forbid-noop",
  };
}

function entryAuthorityInput(overObserved = {}) {
  const expected = buildControllerExpectedIdentity({
    authority: { path: "E:/Code/child", ref: "refs/heads/main" },
    runSpec: entryRunSpec(),
  });
  return {
    expected,
    observed: {
      repositoryId: "github:example/child",
      objectFormat: "sha1",
      observedHeadRevision: ENTRY_COMMIT,
      repositoryRoot: "E:/Code/child",
      ref: "refs/heads/main",
      clean: true,
      productBytesPresent: false,
      productBytesReachableFromNamedAuthority: true,
      ...overObserved,
    },
  };
}

function openInputs(over = {}) {
  return {
    operatorPlanArtifactValidation: { verdict: "pass", ok: true },
    selectedRepoResolution: { ok: true, name: "child-app", path: "child" },
    executionReadiness: readyReadiness(),
    entryAuthorityInput: entryAuthorityInput(),
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

test("open: readiness and mandatory entry authority all pass", () => {
  const gate = buildWorkerEntryGate(openInputs());
  assert.equal(gate.kind, "worker_entry_gate");
  assert.equal(gate.verdict, "open");
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.required_inputs, {
    operator_plan_validation_ok: true,
    selected_repo_resolution_ok: true,
    execution_readiness_ok: true,
    read_only_git_inspection_ran: true,
    entry_authority_verdict: "PASS_CURRENT",
    executes_child_commands: false,
  });
  assert.equal(gate.reasons.length, 0);
  assertSafetyFalse(gate);
});

test("blocked: missing entry authority input fails closed", () => {
  const gate = buildWorkerEntryGate(openInputs({ entryAuthorityInput: undefined }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.entry_authority_verdict, "MISSING");
  assert.ok(gate.reasons.some((r) => r.code === "ENTRY_AUTHORITY_INPUT_MISSING"));
});

test("blocked: forged attached result cannot override recomputation", () => {
  const gate = buildWorkerEntryGate(openInputs({
    entryAuthority: { verdict: "PASS_CURRENT", ok: true },
    entryAuthorityInput: entryAuthorityInput({ repositoryRoot: "E:/Code/other" }),
  }));
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.required_inputs.entry_authority_verdict, "REDIRECT");
  assert.ok(gate.reasons.some((r) => r.code === "ENTRY_AUTHORITY_RESULT_MISMATCH"));
  assert.ok(gate.reasons.some((r) => r.code === "ENTRY_AUTHORITY_REDIRECT"));
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
    entry_authority_input: entryAuthorityInput(),
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

function setupManagedPollPath() {
  const parent = tmp("mh-weg-live-parent-");
  const child = tmp("mh-weg-live-child-");
  const parentHarness = path.join(parent, ".meta-harness");
  const childHarness = path.join(child, ".meta-harness");
  fs.mkdirSync(parentHarness, { recursive: true });
  fs.mkdirSync(childHarness, { recursive: true });
  fs.writeFileSync(path.join(parentHarness, "status.md"), "# Parent\n");
  fs.writeFileSync(path.join(parentHarness, "events.jsonl"), "{}\n");
  fs.writeFileSync(path.join(childHarness, "status.md"), "# Child\n\nPhase: work\n");
  fs.writeFileSync(path.join(childHarness, "events.jsonl"), "{}\n");
  wj(path.join(childHarness, "ready.json"), {
    schema_version: "1.0.0",
    generated_at: "2026-07-22T00:00:00.000Z",
    expires_after: "2099-01-01T00:00:00.000Z",
    target: child,
    ok: false,
    redacted: true,
    passed: 0,
    failed: 1,
    warned: 0,
    skipped: 0,
    checks: [{
      id: "MH_PRODUCT_001",
      name: "product slice",
      status: "fail",
      reason: "bounded product work remains",
      next_action: "complete bounded product work",
    }],
  });
  git(child, ["init", "-b", "main"]);
  git(child, ["config", "user.email", "entry@example.invalid"]);
  git(child, ["config", "user.name", "Entry Test"]);
  git(child, ["add", "."]);
  git(child, ["commit", "-m", "seed managed child"]);
  git(child, ["remote", "add", "origin", "https://github.com/example/child.git"]);
  const head = git(child, ["rev-parse", "HEAD"]);
  wj(path.join(parentHarness, "repos.json"), {
    repos: [{ name: "child-app", path: child, role: "child" }],
  });

  const initial = cli(parent, ["poll", "--rollup", "--json"]);
  assert.equal(initial.status, 0, initial.stderr);
  const receipt = {
    packet_id: JSON.parse(initial.stdout).autonomy_plan.packet_id,
    decision_id: "approve_for_manual_work",
    reviewer: "controller",
    reviewed_at: "2026-07-22T01:00:00.000Z",
    reason: "bounded worker entry",
  };
  let result = cli(parent, [
    "poll", "--rollup", "--json",
    "--autonomy-approval-receipt", JSON.stringify(receipt),
    "--write-manual-work-packet", ".meta-harness/manual-work-packet.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  result = cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-manual-work-packet", ".meta-harness/manual-work-packet.json",
    "--write-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  return { parent, child, head };
}

function liveControllerInput(child, head, over = {}) {
  return {
    runSpec: entryRunSpec(head, over.repository || {}),
    authority: {
      path: child.replace(/\\/g, "/"),
      ref: "refs/heads/main",
      ...(over.authority || {}),
    },
  };
}

function verifyManagedPath(parent, controllerInput) {
  const args = [
    "poll", "--rollup", "--json",
    "--verify-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
  ];
  if (controllerInput !== undefined) {
    args.push("--entry-authority-run-spec", JSON.stringify(controllerInput));
  }
  const result = cli(parent, args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("poll production path collects live authority and opens only the correct checkout", () => {
  const { parent, child, head } = setupManagedPollPath();
  const rollup = verifyManagedPath(parent, liveControllerInput(child, head));
  assert.equal(rollup.execution_readiness.verdict, "ready");
  assert.equal(rollup.entry_authority.verdict, "PASS_CURRENT");
  assert.equal(rollup.entry_authority_collection.runs_read_only_git_inspection, true);
  assert.equal(rollup.entry_authority_collection.spawns_process, true);
  assert.equal(rollup.worker_entry_gate.verdict, "open");
});

test("poll production path redirects a non-authority checkout", () => {
  const { parent, child, head } = setupManagedPollPath();
  const authorityPath = `${child}-accepted`;
  const rollup = verifyManagedPath(parent, liveControllerInput(child, head, {
    authority: { path: authorityPath.replace(/\\/g, "/") },
  }));
  assert.equal(rollup.entry_authority.verdict, "REDIRECT");
  assert.equal(rollup.entry_authority.redirect.path, authorityPath.replace(/\\/g, "/"));
  assert.equal(rollup.worker_entry_gate.verdict, "blocked");
});

test("poll production path blocks raw self-attested expected identity", () => {
  const { parent, child, head } = setupManagedPollPath();
  const rawExpected = buildControllerExpectedIdentity(liveControllerInput(child, head));
  rawExpected.source = { kind: "authenticated_operator", verified: true, reference: "self-asserted" };
  const rollup = verifyManagedPath(parent, rawExpected);
  assert.equal(rollup.entry_authority.verdict, "BLOCK");
  assert.ok(rollup.entry_authority.reasons.some((item) => item.code === "ENTRY_CONTROLLER_INPUT_SHAPE"));
  assert.equal(rollup.worker_entry_gate.verdict, "blocked");
});

test("poll does not retain the old raw expected-identity flag", () => {
  const { parent, child, head } = setupManagedPollPath();
  const rawExpected = buildControllerExpectedIdentity(liveControllerInput(child, head));
  const result = cli(parent, [
    "poll", "--rollup", "--json",
    "--verify-operator-execution-plan", ".meta-harness/operator-execution-plan.json",
    "--entry-authority-expected", JSON.stringify(rawExpected),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.entry_authority.verdict, "BLOCK");
  assert.equal(rollup.worker_entry_gate.verdict, "blocked");
  assert.ok(rollup.worker_entry_gate.reasons.some((item) => item.code === "ENTRY_AUTHORITY_INPUT_MISSING"));
});

test("poll production path fails closed when trusted expected identity is absent", () => {
  const { parent } = setupManagedPollPath();
  const rollup = verifyManagedPath(parent);
  assert.equal(rollup.entry_authority.verdict, "BLOCK");
  assert.equal(rollup.worker_entry_gate.verdict, "blocked");
  assert.ok(rollup.worker_entry_gate.reasons.some((item) => item.code === "ENTRY_AUTHORITY_INPUT_MISSING"));
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
