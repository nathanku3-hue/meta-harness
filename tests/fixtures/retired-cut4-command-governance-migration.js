"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { writeJsonFile } = require("../json");
const {
  applyMigrationToSnapshot,
  planMigration,
  readMigrationSpec,
  verifyMigration,
} = require("../governance-migration");
const {
  analyzeMigrationImpact,
  collectArtifactsFromPaths,
} = require("../governance-migration-impact");
const { readGovernanceSnapshot } = require("../context-gate-governance");

function toSlash(value) {
  return String(value || "").split(path.sep).join("/");
}

function singleOption(options, key, label) {
  const value = options[key];
  if (Array.isArray(value)) fail(`${label} must be provided once`);
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    fail(`${label} requires a value`);
  }
  return String(value);
}

function migrationPathOption(options, key, label, context) {
  return path.resolve(context.cwd, singleOption(options, key, label));
}

function printMigrationHuman(context, result) {
  const verb = String(result.action || "migration").replace(/^migration_/, "");
  writeLine(context, `GOVERNANCE MIGRATION ${verb.toUpperCase()}: ${result.ok ? "ok" : "failed"}`);
  writeLine(context, `migration_id ${result.migration_id}`);
  if (result.classification) writeLine(context, `change_level ${result.classification.change_level}`);
  for (const issue of result.issues || []) writeLine(context, `${issue.code}\t${issue.message}`);
}

function artifactPathsFromDir(artifactsDir, rawValue) {
  let stat;
  try {
    stat = fs.lstatSync(artifactsDir);
  } catch (error) {
    if (error && error.code === "ENOENT") fail(`--artifacts-dir must be an existing directory: ${rawValue}`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`--artifacts-dir must be an existing directory: ${rawValue}`);
  return fs.readdirSync(artifactsDir)
    .filter((name) => /^ROUND-\d{3}\.json$/.test(name))
    .sort()
    .map((name) => path.join(artifactsDir, name));
}

function printMigrationImpactHuman(context, result) {
  writeLine(context, `GOVERNANCE MIGRATION IMPACT: ${result.safety}`);
  writeLine(context, `migration_id ${result.migration_id}`);
  writeLine(context, `changeType ${result.changeType}`);
  writeLine(context, `safety ${result.safety}`);
  writeLine(context, `artifacts ${result.counts.artifacts}`);
  if (result.requiresRegeneration.length > 0) {
    writeLine(context, "REGENERATION REQUIRED:");
    for (const artifactPath of result.requiresRegeneration) writeLine(context, `  ${artifactPath}`);
  }
  for (const issue of result.issues || []) writeLine(context, `${issue.code}\t${issue.message}`);
}

function emitResult(context, options, result, printer) {
  if (options.json) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else printer(context, result);
}

function runGovernanceMigration(context, options, positional) {
  const migrationAction = positional[1];
  if (!["plan", "apply", "verify", "impact"].includes(migrationAction) || positional.length !== 2) {
    fail(`unknown governance migration action: ${migrationAction || "missing"}`);
  }

  const specPath = migrationPathOption(options, "spec", `governance migration ${migrationAction} --spec`, context);
  const spec = readMigrationSpec(specPath);
  if (migrationAction === "plan") {
    const snapshotPath = migrationPathOption(options, "snapshot", "governance migration plan --snapshot", context);
    const result = planMigration(readGovernanceSnapshot(snapshotPath), spec);
    emitResult(context, options, result, printMigrationHuman);
    return { exitCode: result.ok ? 0 : 1 };
  }
  if (migrationAction === "apply") {
    const snapshotPath = migrationPathOption(options, "snapshot", "governance migration apply --snapshot", context);
    const outPath = migrationPathOption(options, "out", "governance migration apply --out", context);
    const snapshot = readGovernanceSnapshot(snapshotPath);
    const plan = planMigration(snapshot, spec);
    if (!plan.ok) {
      const result = { ...plan, action: "migration_apply" };
      emitResult(context, options, result, printMigrationHuman);
      return { exitCode: 1 };
    }
    const migrated = applyMigrationToSnapshot(snapshot, spec);
    writeJsonFile(outPath, migrated);
    const result = { ...plan, action: "migration_apply", path: toSlash(outPath), snapshot: migrated };
    emitResult(context, options, result, printMigrationHuman);
    if (!options.json) writeLine(context, `wrote ${result.path}`);
    return { exitCode: 0 };
  }
  if (migrationAction === "impact") {
    const snapshotPath = migrationPathOption(options, "snapshot", "governance migration impact --snapshot", context);
    const rawArtifactsDir = singleOption(options, "artifactsDir", "governance migration impact --artifacts-dir");
    const artifactsDir = path.resolve(context.cwd, rawArtifactsDir);
    const artifacts = collectArtifactsFromPaths(artifactPathsFromDir(artifactsDir, rawArtifactsDir));
    const result = analyzeMigrationImpact(readGovernanceSnapshot(snapshotPath), spec, artifacts);
    emitResult(context, options, result, printMigrationImpactHuman);
    return { exitCode: result.ok && result.safety === "SAFE" ? 0 : 1 };
  }

  const beforePath = migrationPathOption(options, "before", "governance migration verify --before", context);
  const afterPath = migrationPathOption(options, "after", "governance migration verify --after", context);
  const result = verifyMigration(spec, readGovernanceSnapshot(beforePath), readGovernanceSnapshot(afterPath));
  emitResult(context, options, result, printMigrationHuman);
  return { exitCode: result.ok ? 0 : 1 };
}

module.exports = { runGovernanceMigration, artifactPathsFromDir, singleOption };
