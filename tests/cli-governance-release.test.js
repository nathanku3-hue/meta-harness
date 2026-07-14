"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertCliError, runRaw, tempDir } = require("./helpers/cli");
const { applyMigrationToSnapshot, verifyMigration } = require("../lib/governance-migration");
const { analyzeMigrationImpact } = require("../lib/governance-migration-impact");
const { classifyGovernanceChanges } = require("../lib/governance-compatibility");
const { createRelease, promoteRelease } = require("../lib/governance-release");
const {
  CURRENT_PACKAGE_VERSION,
  NEXT_MINOR_VERSION,
} = require("./helpers/package-version");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeReleaseFixture(root) {
  const snapshotResult = runRaw(root, ["governance", "snapshot", "--target", root, "--json"]);
  assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
  const beforePath = JSON.parse(snapshotResult.stdout).path;
  const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const migration = {
    schema_version: "1",
    migration_id: "cli-release-migration",
    version_source: CURRENT_PACKAGE_VERSION,
    version_target: NEXT_MINOR_VERSION,
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
    impact_report: { ...impact, risk_level: "LOW", summary: "Version-only CLI release." },
    compat_result: compatibility,
    now: "2026-06-13T00:00:00.000Z",
    release_id: "release-cli",
  }), "CANDIDATE", { identity: "author" });

  const paths = {
    beforePath,
    afterPath: path.join(root, "after-governance.json"),
    migrationPath: path.join(root, "migration.json"),
    releasePath: path.join(root, "release.json"),
    impactPath: path.join(root, "impact.json"),
    migrationVerificationPath: path.join(root, "migration-verification.json"),
  };
  writeJson(paths.migrationPath, migration);
  writeJson(paths.afterPath, after);
  writeJson(paths.releasePath, release);
  writeJson(paths.impactPath, impact);
  writeJson(paths.migrationVerificationPath, migrationVerification);
  return paths;
}

test("governance release check emits snake_case JSON and computes verification", () => {
  const root = tempDir("cli-governance-release-");
  const paths = writeReleaseFixture(root);

  const result = runRaw(root, [
    "governance", "release", "check",
    "--release", paths.releasePath,
    "--before", paths.beforePath,
    "--snapshot", paths.afterPath,
    "--migration", paths.migrationPath,
    "--json",
  ]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(data.schema_version, "1");
  assert.equal(data.release.release_id, "release-cli");
  assert.equal(data.all_passed, true);
  assert.equal(data.promotable, true);
  assert.equal(Object.hasOwn(data, "allPassed"), false);
  assert.equal(data.checks.some((item) => item.name === "migration-verification" && item.passed), true);
});

test("governance release report writes Markdown", () => {
  const root = tempDir("cli-governance-release-");
  const paths = writeReleaseFixture(root);
  const outPath = path.join(root, "release-report.md");

  const result = runRaw(root, [
    "governance", "release", "report",
    "--release", paths.releasePath,
    "--impact", paths.impactPath,
    "--migration-verification", paths.migrationVerificationPath,
    "--out", outPath,
  ]);
  const report = fs.readFileSync(outPath, "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote .*release-report\.md/);
  assert.ok(report.includes(`# Governance Release ${NEXT_MINOR_VERSION}`));
  assert.match(report, /migration_verification_hash/);
  assert.match(report, /Version-only CLI release/);
});

test("governance release rejects unknown nested actions with usage errors", () => {
  const root = tempDir("cli-governance-release-");
  assertCliError(runRaw(root, ["governance", "release"]), "MH_USAGE", /unknown governance release action: missing/);
  assertCliError(runRaw(root, ["governance", "release", "nope"]), "MH_USAGE", /unknown governance release action: nope/);
});
