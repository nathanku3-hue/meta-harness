"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildLiveGovernance,
  governanceHash,
  readGovernanceSnapshot,
  validateGovernance,
  writeGovernanceSnapshot,
} = require("../lib/context-gate-governance");
const { tempDir } = require("./helpers/cli");

test("governance hash is deterministic and excludes generated_at", () => {
  const first = buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
  const second = buildLiveGovernance({ generatedAt: "2026-06-13T01:00:00.000Z" });

  assert.notEqual(first.generated_at, second.generated_at);
  assert.equal(governanceHash(first), governanceHash(second));
  assert.equal(validateGovernance(first).ok, true);
  assert.equal(validateGovernance(first).graph.status, "pass");
});

test("governance hash includes governance engine hash", () => {
  const snapshot = buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
  const changed = {
    ...snapshot,
    governance_engine_hash: "0".repeat(64),
  };

  assert.notEqual(governanceHash(snapshot), governanceHash(changed));
});

test("write and read governance snapshot through canonical path", () => {
  const root = tempDir("governance-snapshot-");
  const result = writeGovernanceSnapshot({
    targetRoot: root,
    generatedAt: "2026-06-13T00:00:00.000Z",
  });

  assert.equal(fs.existsSync(result.path), true);
  assert.equal(path.relative(root, result.path).split(path.sep).join("/"), ".meta-harness/governance/snapshots/governance-snapshot.json");
  const readBack = readGovernanceSnapshot(result.path);
  assert.equal(governanceHash(readBack), result.governance_hash);
  assert.equal(readBack.governance_engine_hash, result.snapshot.governance_engine_hash);
});
