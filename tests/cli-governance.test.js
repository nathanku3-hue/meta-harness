"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { runRaw, tempDir } = require("./helpers/cli");
const { installCanonicalFixtureTruth } = require("./helpers/canonical-truth-fixture");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");

function copyFixture(name = "complete") {
  const targetRoot = tempDir("cli-governance-");
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetRoot, { recursive: true });
  installCanonicalFixtureTruth(targetRoot);
  return targetRoot;
}

test("governance snapshot writes JSON snapshot result", () => {
  const root = tempDir("cli-governance-");

  const result = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(data.ok, true);
  assert.equal(data.action, "snapshot");
  assert.equal(data.target, root.split(path.sep).join("/"));
  assert.equal(typeof data.governance_hash, "string");
  assert.equal(typeof data.snapshot.governance_engine_hash, "string");
  assert.equal(fs.existsSync(path.join(root, ".meta-harness", "governance", "snapshots", "governance-snapshot.json")), true);
});

test("governance diff emits JSON and reports drift", () => {
  const root = tempDir("cli-governance-");
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0);
  const snapshotPath = JSON.parse(snapshotResult.stdout).path;

  const cleanResult = runRaw(root, ["governance", "diff", "--snapshot", snapshotPath, "--target", root, "--json"]);
  const clean = JSON.parse(cleanResult.stdout);
  assert.equal(cleanResult.status, 0);
  assert.equal(clean.ok, true);
  assert.equal(clean.counts.changes, 0);
  assert.deepEqual(clean.classification, {
    change_level: "NONE",
    breaking: false,
    migration_required: false,
    reasons: [],
  });
  assert.equal(Object.hasOwn(clean.classification, "changeLevel"), false);
  assert.equal(Object.hasOwn(clean.classification, "migrationRequired"), false);

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  snapshot.governance_engine_hash = "1".repeat(64);
  const driftPath = path.join(root, "drifted-governance.json");
  fs.writeFileSync(driftPath, JSON.stringify(snapshot, null, 2), "utf8");

  const driftResult = runRaw(root, ["governance", "diff", "--snapshot", driftPath, "--target", root, "--json"]);
  const drift = JSON.parse(driftResult.stdout);

  assert.equal(driftResult.status, 1);
  assert.equal(drift.ok, false);
  assert.equal(drift.changes.some((item) => item.category === "governance_engine_hash"), true);
  assert.equal(drift.classification.change_level, "MAJOR");
  assert.equal(drift.classification.breaking, true);
  assert.equal(drift.classification.migration_required, true);
});

test("governance replay emits a JSON match for an immediate context artifact", () => {
  const root = copyFixture();
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0);
  const snapshotPath = JSON.parse(snapshotResult.stdout).path;
  const checkResult = runRaw(root, [
    "context",
    "check",
    "--target",
    root,
    "--from",
    "plan",
    "--to",
    "work",
    "--round",
    "ROUND-001",
    "--json",
  ]);
  assert.equal(checkResult.status, 0, checkResult.stderr);
  const artifactPath = path.join(root, ".meta-harness", "local", "context", "ROUND-001.json");

  const result = runRaw(root, [
    "governance",
    "replay",
    "--snapshot",
    snapshotPath,
    "--artifact",
    artifactPath,
    "--target",
    root,
    "--json",
  ]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(data.ok, true);
  assert.equal(data.status, "match");
  assert.equal(data.replayable, true);
});
