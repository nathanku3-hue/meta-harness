"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { readJsonl, run, runRaw, tempDir, writeFile } = require("./helpers/cli");

const SCORE_DIMENSIONS = Object.freeze([
  "product_outcome",
  "scope_boundary",
  "repo_and_stack",
  "owned_surface",
  "evidence_plan",
  "risk_and_stop_rules",
  "freshness",
  "handoff_completeness",
]);

function scores(value = 8) {
  return Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, value]));
}

function artifact(overrides = {}) {
  return {
    round_id: "ROUND-001",
    generated_at: new Date().toISOString(),
    transition: "plan->work",
    overall_score: 1,
    verdict: "blocked",
    structural_hard_blockers: ["proof missing"],
    evidence_gap_dimensions: [],
    unknown_dimensions: [],
    scores: scores(),
    correct_next_step: "Answer the blocker-clearing questions before proceeding.",
    questions: ["What proof command should run?"],
    hints_applied: [],
    context_summary: {
      goal: "Adopt context gate enforcement.",
      scope: "Phase 13C adoption surface only.",
      stack: "Node.js",
      owned_surface: "context gate readiness",
      evidence_required: "node --test",
      stop_rules: "Stop on blocked required gate.",
      freshness: "current",
      handoff: "Ready result explains next step.",
      decisions: [],
    },
    evidence: Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, [`evidence for ${dimension}`]])),
    ...overrides,
  };
}

function initAdoptedRepo(phase = "plan") {
  const cwd = tempDir("meta-harness-context-adoption-");
  run(cwd, ["init", "Context gate adoption"]);
  writeFile(cwd, ".meta-harness/contracts/context-adoption.md", "# Context Gate Adoption Contract\n");
  writeStatusPhase(cwd, phase);
  return cwd;
}

function writeStatusPhase(root, phase) {
  writeFile(root, ".meta-harness/status.md", [
    "# Status",
    "",
    "Goal:",
    "Adopt context gate enforcement.",
    "",
    "Phase:",
    phase,
    "",
    "Current truth:",
    "Testing Phase 13C adoption.",
    "",
    "Next action:",
    "Run context gate readiness.",
    "",
    "Stop criteria:",
    "Stop on blocked required gates.",
    "",
  ].join("\n"));
}

function writeContextArtifact(root, roundId, content) {
  writeFile(root, `.meta-harness/local/context/${roundId}.json`, `${JSON.stringify(content, null, 2)}\n`);
}

function writeOverrideEvent(root, event) {
  const eventsPath = path.join(root, ".meta-harness", "events.jsonl");
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

function readyJson(root) {
  const res = runRaw(root, ["ready", "--target", root, "--quick", "--read-only", "--json"]);
  return JSON.parse(res.stdout);
}

function contextGateCheck(data) {
  return data.checks.find((check) => check.id === "MH_CONTEXT_GATE_001");
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
