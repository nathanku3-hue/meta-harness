"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { run, runRaw, tempDir } = require("./helpers/cli");
const { buildContextGateEvaluation } = require("../lib/ready-context-gate-evaluation");

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
    dimensions: SCORE_DIMENSIONS,
    valid_verdicts: ["blocked", "narrowed", "proceed", "excellent"],
    bypass_reason_codes: ["snapshot_override"],
    execution_transitions: ["verify->release"],
    default_max_artifact_age_days: 7,
  };
}

function writeContextArtifact(root, roundId, content) {
  const contextDir = path.join(root, ".meta-harness", "local", "context");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, `${roundId}.json`), JSON.stringify(content), "utf8");
}

function writeTrackedContextArtifact(root, roundId, content) {
  const contextDir = path.join(root, ".meta-harness", "context");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, `${roundId}.json`), JSON.stringify(content), "utf8");
}

function slashPath(value) {
  return value.split(path.sep).join("/");
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotFilesystem(root) {
  const entries = new Map();

  function walk(directoryPath) {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right))) {
      const itemPath = path.join(directoryPath, name);
      const relativePath = slashPath(path.relative(root, itemPath));
      const stat = fs.lstatSync(itemPath);

      if (stat.isDirectory()) {
        entries.set(relativePath, { type: "dir" });
        walk(itemPath);
      } else if (stat.isFile()) {
        entries.set(relativePath, {
          type: "file",
          sha256: hashFile(itemPath),
        });
      } else if (stat.isSymbolicLink()) {
        entries.set(relativePath, {
          type: "symlink",
          target: fs.readlinkSync(itemPath),
        });
      } else {
        entries.set(relativePath, { type: "other" });
      }
    }
  }

  walk(root);
  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function contextArtifactPaths(snapshot) {
  return Object.keys(snapshot).filter((entryPath) =>
    entryPath === ".meta-harness/local/context" ||
    entryPath.startsWith(".meta-harness/local/context/") ||
    entryPath === ".meta-harness/context" ||
    entryPath.startsWith(".meta-harness/context/")
  );
}

function assertFilesystemUnchanged(before, after) {
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(after, before);
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

test("ready evaluation validates snapshot-only transitions with snapshot governance", () => {
  const cwd = tempDir();
  const nowMs = Date.now();
  run(cwd, ["init", "Snapshot context gate target"]);
  writeContextArtifact(cwd, "ROUND-001", artifact({
    generated_at: new Date(nowMs).toISOString(),
    transition: "verify->release",
    verdict: "proceed",
    overall_score: 8,
    structural_hard_blockers: [],
    questions: [],
    correct_next_step: "Proceed through the snapshot transition.",
  }));

  const live = buildContextGateEvaluation({
    targetRoot: cwd,
    nowMs,
    expectedTransition: "verify->release",
    phase: "verify",
  });
  assert.equal(live.result.status, "fail");
  assert.match(live.result.reason, /transition must be a supported phase transition/);

  const snapshot = buildContextGateEvaluation({
    targetRoot: cwd,
    nowMs,
    expectedTransition: "verify->release",
    phase: "verify",
    governance: snapshotGovernance(),
  });
  assert.equal(snapshot.result.status, "pass", snapshot.result.reason);
  assert.equal(snapshot.adoption.required, true);
  assert.equal(snapshot.selectedArtifact.transition, "verify->release");
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

test("ready --quick --read-only --json does not create context artifacts when no context surface exists", () => {
  const cwd = tempDir();
  run(cwd, ["init", "No context gate read-only"]);

  const before = snapshotFilesystem(cwd);
  assert.deepEqual(contextArtifactPaths(before), []);

  const data = readyJson(cwd, ["--quick", "--read-only"]);

  const after = snapshotFilesystem(cwd);
  assertFilesystemUnchanged(before, after);
  assert.deepEqual(contextArtifactPaths(after), []);

  const check = contextCheck(data);
  assert.equal(check.status, "skip");
  assert.equal(check.applicable, false);
});

test("ready --quick --read-only --json does not mutate existing context artifacts", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Existing context gate read-only"]);
  writeContextArtifact(cwd, "ROUND-001", artifact());
  writeTrackedContextArtifact(cwd, "ROUND-002", artifact({ round_id: "ROUND-002" }));

  const before = snapshotFilesystem(cwd);
  assert.deepEqual(contextArtifactPaths(before), [
    ".meta-harness/context",
    ".meta-harness/context/ROUND-002.json",
    ".meta-harness/local/context",
    ".meta-harness/local/context/ROUND-001.json",
  ]);

  const data = readyJson(cwd, ["--quick", "--read-only"]);

  const after = snapshotFilesystem(cwd);
  assertFilesystemUnchanged(before, after);

  const check = contextCheck(data);
  assert.equal(check.status, "pass");
  assert.match(check.reason, /ROUND-002/);
});

test("ready --explain --read-only --json preserves explanation without filesystem mutation", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Existing context gate explain read-only"]);
  writeContextArtifact(cwd, "ROUND-001", artifact());

  const before = snapshotFilesystem(cwd);
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--explain", "--json"]);
  const data = JSON.parse(res.stdout);
  const after = snapshotFilesystem(cwd);

  assertFilesystemUnchanged(before, after);
  const check = contextCheck(data);
  assert.equal(check.status, "pass");
  assert.equal(check.explanation.artifact_examined.path, ".meta-harness/local/context/ROUND-001.json");
  assert.equal(check.explanation.freshness_determination.verdict, "fresh");
  assert.match(check.diagnostic, /Context gate diagnostic/);
});

test("ready --explain renders human-readable context gate diagnostics", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Context gate human explain"]);
  writeContextArtifact(cwd, "ROUND-001", artifact());

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--explain"]);

  assert.match(res.stdout, /Context gate diagnostic/);
  assert.match(res.stdout, /expected transition:/);
});
