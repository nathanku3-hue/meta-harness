"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertCliError, runRaw, snapshotTree, tempDir } = require("./helpers/cli");
const { governanceHash } = require("../lib/context-gate-governance");
const {
  CURRENT_PACKAGE_VERSION,
  NEXT_MINOR_VERSION,
} = require("./helpers/package-version");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function contextArtifact(governance, overrides = {}) {
  return {
    round_id: "ROUND-001",
    generated_at: "2026-06-13T00:00:00.000Z",
    transition: "plan->work",
    overall_score: 8,
    verdict: "proceed",
    scores: Object.fromEntries(governance.dimensions.map((dimension) => [dimension, 8])),
    correct_next_step: "Continue.",
    structural_hard_blockers: [],
    evidence_gap_dimensions: [],
    unknown_dimensions: [],
    questions: [],
    hints_applied: [],
    fingerprint: {
      schema_version: "1",
      governance_hash: governanceHash(governance),
      evaluation_hash: "test",
      evidence_hash: "test",
      canonical_json: "test",
    },
    ...overrides,
  };
}

test("governance migration plans, applies, and verifies a snapshot-only migration", () => {
  const root = tempDir("cli-governance-migration-");
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
  const snapshotPath = JSON.parse(snapshotResult.stdout).path;
  const specPath = path.join(root, "migration.json");
  const outPath = path.join(root, "migrated-governance.json");
  writeJson(specPath, {
    schema_version: "1",
    migration_id: "cli-valid-verdict",
    version_source: CURRENT_PACKAGE_VERSION,
    version_target: NEXT_MINOR_VERSION,
    expected_change_level: "MINOR",
    actions: [{ type: "add_to_set", field: "valid_verdicts", value: "deferred" }],
  });

  const beforePlanTree = snapshotTree(root);
  const planResult = runRaw(root, ["governance", "migration", "plan", "--spec", specPath, "--snapshot", snapshotPath, "--json"]);
  const plan = JSON.parse(planResult.stdout);

  assert.equal(planResult.status, 0, planResult.stderr);
  assert.deepEqual(snapshotTree(root), beforePlanTree);
  assert.equal(plan.ok, true);
  assert.equal(plan.action, "migration_plan");
  assert.equal(plan.classification.change_level, "MINOR");
  assert.equal(plan.changes.some((item) => item.category === "valid_verdicts"), true);
  assert.equal(fs.existsSync(outPath), false);

  const applyResult = runRaw(root, ["governance", "migration", "apply", "--spec", specPath, "--snapshot", snapshotPath, "--out", outPath, "--json"]);
  const applied = JSON.parse(applyResult.stdout);
  const originalSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const migratedSnapshot = JSON.parse(fs.readFileSync(outPath, "utf8"));

  assert.equal(applyResult.status, 0, applyResult.stderr);
  assert.equal(applied.ok, true);
  assert.equal(applied.action, "migration_apply");
  assert.equal(applied.path, outPath.split(path.sep).join("/"));
  assert.equal(originalSnapshot.version, CURRENT_PACKAGE_VERSION);
  assert.equal(migratedSnapshot.version, NEXT_MINOR_VERSION);
  assert.equal(migratedSnapshot.valid_verdicts.includes("deferred"), true);

  const verifyResult = runRaw(root, ["governance", "migration", "verify", "--spec", specPath, "--before", snapshotPath, "--after", outPath, "--json"]);
  const verified = JSON.parse(verifyResult.stdout);

  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  assert.equal(verified.ok, true);
  assert.equal(verified.expected_hash, applied.after_hash);
  assert.equal(verified.actual_hash, applied.after_hash);
});

test("governance migration impact emits SAFE JSON for an empty artifacts directory", () => {
  const root = tempDir("cli-governance-impact-");
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
  const snapshotPath = JSON.parse(snapshotResult.stdout).path;
  const specPath = path.join(root, "migration.json");
  const artifactsDir = path.join(root, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  writeJson(specPath, { schema_version: "1", migration_id: "cli-impact-empty", version_source: CURRENT_PACKAGE_VERSION, version_target: NEXT_MINOR_VERSION, expected_change_level: "PATCH", actions: [] });

  const result = runRaw(root, ["governance", "migration", "impact", "--spec", specPath, "--snapshot", snapshotPath, "--artifacts-dir", artifactsDir, "--json"]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(data.action, "migration_impact");
  assert.equal(data.safety, "SAFE");
  assert.equal(data.counts.artifacts, 0);
});

test("governance migration impact keeps non-safe JSON parseable and exits nonzero", () => {
  const root = tempDir("cli-governance-impact-");
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
  const snapshotPath = JSON.parse(snapshotResult.stdout).path;
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const specPath = path.join(root, "migration.json");
  const artifactsDir = path.join(root, "artifacts");
  writeJson(specPath, { schema_version: "1", migration_id: "cli-impact-stale", version_source: CURRENT_PACKAGE_VERSION, version_target: NEXT_MINOR_VERSION, expected_change_level: "PATCH", actions: [] });
  writeJson(path.join(artifactsDir, "ROUND-001.json"), contextArtifact(snapshot));

  const result = runRaw(root, ["governance", "migration", "impact", "--spec", specPath, "--snapshot", snapshotPath, "--artifacts-dir", artifactsDir, "--json"]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.safety, "REQUIRES_REGENERATION");
  assert.equal(data.affectedArtifacts[0].status, "stale");
  assert.equal(data.requiresRegeneration.length, 1);
});

test("governance migration rejects bad inputs with usage errors", () => {
  const root = tempDir("cli-governance-migration-");
  assertCliError(runRaw(root, ["governance", "migration"]), "MH_USAGE", /unknown governance migration action: missing/);
  assertCliError(runRaw(root, ["governance", "migration", "nope"]), "MH_USAGE", /unknown governance migration action: nope/);
});
