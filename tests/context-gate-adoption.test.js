"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { readJsonl, runRaw } = require("./helpers/cli");
const { artifact, contextGateCheck, initAdoptedRepo, readyJson, writeContextArtifact, writeOverrideEvent } = require("./helpers/context-gate-adoption");
const {
  expectedTransitionFromStatus,
  isGateOptional,
  isGateRequired,
  validateBypass,
} = require("../lib/context-gate-adoption");

function snapshotGovernance() {
  return {
    allowed_transitions: ["plan->work", "verify->release"],
    required_gate_transitions: ["verify->release"],
    optional_gate_transitions: ["plan->work"],
    phase_to_expected_transition: {
      plan: "plan->work",
      verify: "verify->release",
      release: null,
    },
    dimensions: [
      "product_outcome",
      "scope_boundary",
      "repo_and_stack",
      "owned_surface",
      "evidence_plan",
      "risk_and_stop_rules",
      "freshness",
      "handoff_completeness",
    ],
    valid_verdicts: ["blocked", "narrowed", "proceed", "excellent"],
    bypass_reason_codes: ["snapshot_override"],
    execution_transitions: ["verify->release"],
    default_max_artifact_age_days: 7,
  };
}

test("adopted ready fails when latest artifact is unrelated to the expected required transition", () => {
  const cwd = initAdoptedRepo("plan");
  writeContextArtifact(cwd, "ROUND-002", artifact({
    round_id: "ROUND-002",
    transition: "work->verify",
    verdict: "proceed",
    overall_score: 8,
    structural_hard_blockers: [],
    questions: [],
  }));

  const check = contextGateCheck(readyJson(cwd));

  assert.equal(check.status, "fail");
  assert.match(check.reason, /required transition plan->work/);
  assert.doesNotMatch(check.reason, /verdict: proceed/);
});

test("adoption helpers use snapshot governance when supplied", () => {
  const cwd = initAdoptedRepo("verify");
  const governance = snapshotGovernance();

  assert.deepEqual(expectedTransitionFromStatus(cwd, { governance }), {
    phase: "verify",
    transition: "verify->release",
  });
  assert.equal(isGateRequired("verify->release", { governance }), true);
  assert.equal(isGateRequired("plan->work", { governance }), false);
  assert.equal(isGateOptional("plan->work", { governance }), true);

  const accepted = validateBypass({
    reason: "Snapshot replay accepted this override.",
    code: "snapshot_override",
    actor: "human",
  }, { governance });
  assert.equal(accepted.ok, true, accepted.reason);

  const rejected = validateBypass({
    reason: "Live code is not in this snapshot.",
    code: "human_override",
    actor: "human",
  }, { governance });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /snapshot_override/);
});

test("lookback phase has no expected context transition and is not applicable", () => {
  const cwd = initAdoptedRepo("lookback");
  writeContextArtifact(cwd, "ROUND-001", artifact({
    transition: "handoff->lookback",
    verdict: "blocked",
  }));

  const check = contextGateCheck(readyJson(cwd));

  assert.equal(check.status, "skip");
  assert.equal(check.applicable, false);
  assert.match(check.reason, /lookback/);
});

test("required narrowed verdict passes with narrowed-scope caution", () => {
  const cwd = initAdoptedRepo("plan");
  writeContextArtifact(cwd, "ROUND-001", artifact({
    verdict: "narrowed",
    overall_score: 7,
    structural_hard_blockers: [],
    questions: [],
    correct_next_step: "Proceed only inside narrowed scope.",
  }));

  const check = contextGateCheck(readyJson(cwd));

  assert.equal(check.status, "pass");
  assert.match(check.reason, /passed with narrowed scope/);
  assert.match(check.next_action, /narrowed scope/);
});

test("old matching override event does not validate a newer blocked artifact", () => {
  const cwd = initAdoptedRepo("plan");
  const generatedAt = new Date().toISOString();
  const olderTs = new Date(Date.parse(generatedAt) - 1000).toISOString();
  writeContextArtifact(cwd, "ROUND-001", artifact({
    generated_at: generatedAt,
    override: {
      reason: "Accept the known gap for this run.",
      code: "human_override",
      actor: "human",
    },
  }));
  writeOverrideEvent(cwd, {
    ts: olderTs,
    time: olderTs,
    actor: "human",
    stream: "coding",
    phase: "plan",
    action: "context-gate-override",
    result: "override accepted: human_override",
    transition: "plan->work",
    reason: "Accept the known gap for this run.",
    code: "human_override",
    round_id: "ROUND-001",
    verdict: "blocked",
    evidence: ".meta-harness/local/context/ROUND-001.json",
    next_action: "Answer the blocker-clearing questions before proceeding.",
  });

  const check = contextGateCheck(readyJson(cwd));

  assert.equal(check.status, "fail");
  assert.match(check.reason, /no matching context-gate-override event at or after artifact generation/);
});

test("fresh matching override event validates a blocked required artifact", () => {
  const cwd = initAdoptedRepo("plan");
  const generatedAt = new Date(Date.now() - 1000).toISOString();
  const eventTs = new Date().toISOString();
  writeContextArtifact(cwd, "ROUND-001", artifact({
    generated_at: generatedAt,
    override: {
      reason: "Accept the known gap for this run.",
      code: "human_override",
      actor: "human",
    },
  }));
  writeOverrideEvent(cwd, {
    ts: eventTs,
    time: eventTs,
    actor: "human",
    stream: "coding",
    phase: "plan",
    action: "context-gate-override",
    result: "override accepted: human_override",
    transition: "plan->work",
    reason: "Accept the known gap for this run.",
    code: "human_override",
    round_id: "ROUND-001",
    verdict: "blocked",
    evidence: ".meta-harness/local/context/ROUND-001.json",
    next_action: "Answer the blocker-clearing questions before proceeding.",
  });

  const check = contextGateCheck(readyJson(cwd));

  assert.equal(check.status, "pass");
  assert.match(check.reason, /overridden with human_override/);
});

test("context check override requires reason code and records an event", () => {
  const cwd = initAdoptedRepo("plan");

  const missingCode = runRaw(cwd, [
    "context",
    "check",
    "--from",
    "plan",
    "--to",
    "work",
    "--override-context-gate",
    "Need to proceed.",
  ]);
  assert.notEqual(missingCode.status, 0);
  assert.match(missingCode.stderr, /override code/);

  const result = runRaw(cwd, [
    "context",
    "check",
    "--from",
    "plan",
    "--to",
    "work",
    "--round",
    "ROUND-001",
    "--override-context-gate",
    "Need to proceed.",
    "--override-context-gate-code",
    "human_override",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Context gate overridden/);
  const gate = JSON.parse(result.stdout);
  assert.deepEqual(gate.override, {
    reason: "Need to proceed.",
    code: "human_override",
    actor: "human",
  });

  const events = readJsonl(path.join(cwd, ".meta-harness", "events.jsonl"));
  const overrideEvent = events.find((event) => event.action === "context-gate-override");
  assert.ok(overrideEvent);
  assert.equal(overrideEvent.round_id, "ROUND-001");
  assert.equal(overrideEvent.transition, "plan->work");
  assert.equal(overrideEvent.code, "human_override");
  assert.equal(overrideEvent.evidence, ".meta-harness/local/context/ROUND-001.json");
});

test("context check records satisfied provenance idempotently", () => {
  const cwd = initAdoptedRepo("plan");
  const args = [
    "context",
    "check",
    "--from",
    "plan",
    "--to",
    "work",
    "--round",
    "ROUND-001",
    "--override-context-gate",
    "Need to proceed.",
    "--override-context-gate-code",
    "human_override",
    "--json",
  ];

  const first = runRaw(cwd, args);
  const second = runRaw(cwd, args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);

  const events = readJsonl(path.join(cwd, ".meta-harness", "events.jsonl"));
  const satisfied = events.filter((event) =>
    event.action === "context-gate-satisfied" &&
    event.round_id === "ROUND-001" &&
    event.transition === "plan->work" &&
    event.evidence === ".meta-harness/local/context/ROUND-001.json"
  );

  assert.equal(satisfied.length, 1);
  assert.equal(satisfied[0].verdict, "blocked");
});
