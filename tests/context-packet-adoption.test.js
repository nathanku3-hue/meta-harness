"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { run, runRaw, tempDir, writeFile } = require("./helpers/cli");

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
      stop_rules: "Stop on blocked required gates.",
      freshness: "current",
      handoff: "Ready result explains next step.",
      decisions: [],
    },
    evidence: Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, [`evidence for ${dimension}`]])),
    ...overrides,
  };
}

function initAdoptedRepo() {
  const cwd = tempDir("meta-harness-context-packet-adoption-");
  run(cwd, ["init", "Context packet adoption"]);
  writeFile(cwd, ".meta-harness/contracts/context-adoption.md", "# Context Gate Adoption Contract\n");
  writeFile(cwd, ".meta-harness/status.md", [
    "# Status",
    "",
    "Phase:",
    "plan",
    "",
    "Current truth:",
    "Testing packet adoption.",
    "",
  ].join("\n"));
  return cwd;
}

function writeContextArtifact(root, roundId, content) {
  writeFile(root, `.meta-harness/local/context/${roundId}.json`, `${JSON.stringify(content, null, 2)}\n`);
}

test("worker packets block on required blocked gate while review packets inspect with warnings", () => {
  const cwd = initAdoptedRepo();
  writeContextArtifact(cwd, "ROUND-001", artifact());

  const worker = runRaw(cwd, ["context", "packet", "ROUND-001", "--for", "worker", "--json"]);
  assert.notEqual(worker.status, 0);
  assert.match(`${worker.stdout}\n${worker.stderr}`, /blocked by required context gate/);

  const review = run(cwd, ["context", "packet", "ROUND-001", "--for", "review", "--json"]);
  const packet = JSON.parse(review);
  assert.equal(packet.for, "review");
  assert.match(packet.warnings.join("\n"), /blocked/);
  assert.match(packet.packet_markdown, /## Warnings/);
});

test("review packets allow stale well-formed artifacts but reject malformed artifacts", () => {
  const cwd = initAdoptedRepo();
  writeContextArtifact(cwd, "ROUND-001", artifact({
    generated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    verdict: "proceed",
    overall_score: 8,
    structural_hard_blockers: [],
    questions: [],
  }));

  const review = run(cwd, ["context", "packet", "ROUND-001", "--for", "review", "--json"]);
  const packet = JSON.parse(review);
  assert.match(packet.warnings.join("\n"), /older than 7 days/);

  writeContextArtifact(cwd, "ROUND-002", {
    round_id: "ROUND-002",
    generated_at: new Date().toISOString(),
    transition: "plan->work",
  });
  const malformed = runRaw(cwd, ["context", "packet", "ROUND-002", "--for", "planning", "--json"]);
  assert.notEqual(malformed.status, 0);
  assert.match(`${malformed.stdout}\n${malformed.stderr}`, /failed validation/);
});
