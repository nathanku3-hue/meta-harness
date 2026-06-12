"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { run, runRaw, tempDir } = require("./helpers/cli");

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

function artifact(overrides = {}) {
  const scores = Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, 8]));
  return {
    round_id: "ROUND-001",
    generated_at: new Date().toISOString(),
    transition: "plan->work",
    overall_score: 1,
    verdict: "blocked",
    structural_hard_blockers: ["proof missing"],
    evidence_gap_dimensions: [],
    unknown_dimensions: [],
    scores,
    correct_next_step: "Ask for proof.",
    questions: ["What proof command should run?"],
    hints_applied: [],
    ...overrides,
  };
}

function writeContextArtifact(root, roundId, content) {
  const contextDir = path.join(root, ".meta-harness", "local", "context");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, `${roundId}.json`), JSON.stringify(content), "utf8");
}

function readyJson(root, args = []) {
  const res = runRaw(root, ["ready", "--target", root, "--json", ...args]);
  return JSON.parse(res.stdout);
}

function contextCheck(data) {
  return data.checks.find((check) => check.id === "MH_CONTEXT_GATE_001");
}

test("ready validates context gate artifacts by shape without enforcing verdict", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Context gate target"]);
  writeContextArtifact(cwd, "ROUND-001", artifact());

  const check = contextCheck(readyJson(cwd, ["--quick", "--read-only"]));

  assert.equal(check.status, "pass");
  assert.equal(check.next_action, "");
  assert.match(check.reason, /verdict: blocked/);
});

test("ready validates the latest context gate artifact freshness", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Stale context gate target"]);
  writeContextArtifact(cwd, "ROUND-001", artifact());
  writeContextArtifact(cwd, "ROUND-002", artifact({
    round_id: "ROUND-002",
    generated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const check = contextCheck(readyJson(cwd, ["--quick", "--read-only"]));

  assert.equal(check.status, "fail");
  assert.match(check.reason, /ROUND-002/);
  assert.match(check.reason, /older than 7 days/);
});

test("ready treats missing context gate surface as not applicable in strict and release modes", () => {
  for (const mode of ["strict", "release"]) {
    const cwd = tempDir();
    run(cwd, ["init", `No context gate ${mode}`]);

    const check = contextCheck(readyJson(cwd, ["--mode", mode, "--read-only"]));

    assert.equal(check.status, "skip");
    assert.equal(check.applicable, false);
    assert.doesNotMatch(check.reason, /required in/);
  }
});
