"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { run, runRaw, tempDir, writeFile } = require("./cli");
const { mintReceiptForTarget } = require("./truth-authority");

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
  const issuedAt = new Date().toISOString();
  const receipt = mintReceiptForTarget(root, {
    phase,
    action: "set context adoption truth",
    goal: "Adopt context gate enforcement.",
    result: "Testing Phase 13C adoption.",
    next_action: "Run context gate readiness.",
    stop_criteria: "Stop on blocked required gates.",
    occurred_at: issuedAt,
  });
  const receiptPath = writeFile(root, ".meta-harness/local/context-adoption-authority-receipt.json", `${JSON.stringify(receipt)}\n`);
  run(root, ["event", "--canonical", "--authority-receipt-file", receiptPath]);
}

function writeContextArtifact(root, roundId, content) {
  writeFile(root, `.meta-harness/local/context/${roundId}.json`, `${JSON.stringify(content, null, 2)}\n`);
}

function writeOverrideEvent(root, event) {
  const eventsPath = path.join(root, ".meta-harness", "events.jsonl");
  fs.appendFileSync(eventsPath, `${JSON.stringify({
    ts: new Date().toISOString(),
    actor: "human",
    stream: "coding",
    phase: "plan",
    result: "override accepted: human_override",
    ...event,
  })}\n`, "utf8");
}

function readyJson(root) {
  return JSON.parse(runRaw(root, ["ready", "--target", root, "--quick", "--read-only", "--json"]).stdout);
}

function contextGateCheck(data) {
  return data.checks.find((check) => check.id === "MH_CONTEXT_GATE_001");
}

module.exports = {
  artifact,
  contextGateCheck,
  initAdoptedRepo,
  readyJson,
  writeContextArtifact,
  writeOverrideEvent,
};
