"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  runContextGate,
  validateContextGateArtifact,
} = require("../lib/context-gate");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");
const SCHEMA_PATH = path.resolve(__dirname, "..", "templates", "contracts", "context-gate-schema.json");
const NOW = "2026-06-12T08:30:00.000Z";

const DIMENSIONS = [
  "product_outcome",
  "scope_boundary",
  "repo_and_stack",
  "owned_surface",
  "evidence_plan",
  "risk_and_stop_rules",
  "freshness",
  "handoff_completeness",
];

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-context-gate-"));
}

function copyFixture(name) {
  const targetRoot = tempDir();
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetRoot, { recursive: true });
  return targetRoot;
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function installHints(root, fixtureName) {
  const hints = fs.readFileSync(path.join(FIXTURE_ROOT, fixtureName), "utf8");
  writeFile(root, ".meta-harness/local/context/hints.json", hints);
}

async function runGate(root, options = {}) {
  const result = await runContextGate({
    cwd: root,
    targetRoot: root,
    from: "plan",
    to: "work",
    roundId: "ROUND-001",
    now: NOW,
    write: false,
    ...options,
  });
  return result.artifact || result.output || result.gate || result.context || result;
}

function assertScoreShape(output) {
  assert.equal(typeof output.scores, "object");
  assert.deepEqual(Object.keys(output.scores).sort(), DIMENSIONS.toSorted());
  for (const dimension of DIMENSIONS) {
    assert.equal(Number.isInteger(output.scores[dimension]), true, dimension);
    assert.equal(output.scores[dimension] >= 1, true, dimension);
    assert.equal(output.scores[dimension] <= 10, true, dimension);
  }
}

function assertSchemaValid(output) {
  assert.ok(fs.existsSync(SCHEMA_PATH));
  const result = validateContextGateArtifact(output, { now: new Date(NOW), maxAgeDays: null });
  if (result === true) {
    return;
  }
  assert.equal(result.ok, true, result.errors ? result.errors.join("\n") : JSON.stringify(result));
}

test("context gate computes scores from a complete harness fixture", async () => {
  const root = copyFixture("complete");

  const output = await runGate(root);

  assert.equal(output.round_id, "ROUND-001");
  assert.equal(output.transition, "plan->work");
  assert.match(output.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assertScoreShape(output);
  assert.equal(output.unknown_dimensions.length, 0);
  assert.equal(output.structural_hard_blockers.length, 0);
  assert.ok(["narrowed", "proceed", "excellent"].includes(output.verdict));
  assert.equal(output.scores.product_outcome >= 6, true);
  assert.equal(output.scores.scope_boundary >= 6, true);
  assert.equal(output.scores.repo_and_stack >= 6, true);
  assert.equal(output.questions.length <= 3, true);
  assertSchemaValid(output);
});

test("context gate separates structural hard blockers from evidence gaps", async () => {
  const root = copyFixture("missing-context");

  const output = await runGate(root);

  assert.equal(output.verdict, "blocked");
  assert.equal(output.overall_score, 1);
  assert.equal(output.scores.repo_and_stack, 1);
  assert.ok(output.unknown_dimensions.includes("repo_and_stack"));
  assert.ok(output.structural_hard_blockers.some((item) => /repo|stack/i.test(item)));
  assert.equal(output.questions.length <= 3, true);
  assertSchemaValid(output);
});

test("unknown dimensions remain integer-scored and force overall score to 1", async () => {
  const root = copyFixture("evidence-gap");

  const output = await runGate(root);

  assert.equal(output.verdict, "blocked");
  assert.equal(output.overall_score, 1);
  assert.ok(output.unknown_dimensions.includes("freshness"));
  assert.equal(output.scores.freshness, 1);
  assertSchemaValid(output);
});

test("valid hints can satisfy evidence gaps and are recorded with provenance", async () => {
  const root = copyFixture("evidence-gap");
  installHints(root, "hints-valid.json");

  const output = await runGate(root);
  const freshnessHint = output.hints_applied.find((hint) => hint.dimension === "freshness");

  assert.ok(freshnessHint);
  assert.equal(freshnessHint.from, 1);
  assert.equal(freshnessHint.to, 9);
  assert.match(freshnessHint.reason, /Confirmed Phase 13A/);
  assert.equal(output.unknown_dimensions.includes("freshness"), false);
  assert.equal(output.evidence_gap_dimensions.includes("freshness"), false);
  assert.equal(output.scores.freshness, 9);
  assertSchemaValid(output);
});

test("hints cannot clear structural hard blockers", async () => {
  const root = copyFixture("missing-context");
  installHints(root, "hints-structural.json");

  const output = await runGate(root);

  assert.equal(output.verdict, "blocked");
  assert.equal(output.overall_score, 1);
  assert.equal(output.scores.repo_and_stack, 1);
  assert.ok(output.unknown_dimensions.includes("repo_and_stack"));
  assert.ok(output.structural_hard_blockers.some((item) => /repo|stack/i.test(item)));
  assert.equal(output.hints_applied.some((hint) => hint.dimension === "repo_and_stack"), false);
});

test("expired hints are ignored and leave the evidence gap blocked", async () => {
  const root = copyFixture("evidence-gap");
  installHints(root, "hints-expired.json");

  const output = await runGate(root);

  assert.equal(output.verdict, "blocked");
  assert.equal(output.hints_applied.some((hint) => hint.dimension === "freshness"), false);
  assert.ok(output.unknown_dimensions.includes("freshness"));
  assert.equal(output.scores.freshness, 1);
});

test("hints cannot raise a dimension above 9", async () => {
  const root = copyFixture("evidence-gap");
  installHints(root, "hints-ceiling.json");

  const output = await runGate(root);
  const freshnessHint = output.hints_applied.find((hint) => hint.dimension === "freshness");

  assert.ok(freshnessHint);
  assert.equal(freshnessHint.to, 9);
  assert.equal(output.scores.freshness, 9);
});

test("prebuilt gate output validates against the packaged schema", () => {
  const output = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "outputs", "ROUND-001.json"), "utf8"));

  assertSchemaValid(output);
});

test("missing harness files degrade to blocked context instead of throwing", async () => {
  const root = tempDir();

  const output = await runGate(root);

  assert.equal(output.verdict, "blocked");
  assert.equal(output.overall_score, 1);
  assert.equal(output.questions.length <= 3, true);
  assertScoreShape(output);
});
