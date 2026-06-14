"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildLiveGovernance } = require("../lib/context-gate-governance");
const { applyMigrationToSnapshot, verifyMigration } = require("../lib/governance-migration");
const { analyzeMigrationImpact } = require("../lib/governance-migration-impact");
const { classifyGovernanceChanges } = require("../lib/governance-compatibility");
const { createRelease, promoteRelease } = require("../lib/governance-release");
const { runReleaseCheck } = require("../lib/governance-release-check");

function fixture() {
  const before = buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
  const migration = {
    schema_version: "1",
    migration_id: "release-check-migration",
    version_source: "0.1.0",
    version_target: "0.2.0",
    expected_change_level: "PATCH",
    actions: [],
  };
  const after = applyMigrationToSnapshot(before, migration);
  const migrationVerification = verifyMigration(migration, before, after);
  const impact = analyzeMigrationImpact(before, migration, []);
  const compatibility = classifyGovernanceChanges(impact.changes);
  const release = promoteRelease(createRelease({
    snapshot: after,
    migration,
    migration_verification: migrationVerification,
    impact_report: {
      ...impact,
      risk_level: "LOW",
      summary: "Version-only release check.",
    },
    compat_result: compatibility,
    now: "2026-06-13T00:00:00.000Z",
    release_id: "release-check",
  }), "CANDIDATE", { identity: "author" });
  return { before, after, migration, release };
}

test("release check computes migration verification and promotable status", async () => {
  const { before, after, migration, release } = fixture();

  const result = await runReleaseCheck(release, {
    before_snapshot: before,
    snapshot: after,
    migration,
  });

  assert.equal(result.schema_version, "1");
  assert.equal(result.all_passed, true);
  assert.equal(result.promotable, true);
  assert.equal(result.checks.every((item) => item.passed), true);
  assert.equal(result.checks.find((item) => item.name === "artifact-replay").skipped, true);
});

test("release check derives compatibility from impact changes, not verify diff", async () => {
  const { before, after, migration, release } = fixture();
  const tampered = {
    ...release,
    change_type: "MAJOR",
    compatibility: {
      ...release.compatibility,
      change_level: "MAJOR",
      breaking: true,
      migration_required: true,
      is_backward_compatible: false,
    },
  };
  tampered.provenance = {
    ...tampered.provenance,
    content_hash: release.provenance.content_hash,
  };

  const result = await runReleaseCheck(tampered, {
    before_snapshot: before,
    snapshot: after,
    migration,
  });
  const compatibility = result.checks.find((item) => item.name === "compatibility");

  assert.equal(result.all_passed, false);
  assert.equal(compatibility.passed, false);
  assert.equal(compatibility.issues.some((item) => item.code === "change_type"), true);
});
