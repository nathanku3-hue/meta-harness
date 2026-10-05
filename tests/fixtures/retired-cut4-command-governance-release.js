"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { ConfigError } = require("../errors");
const { readGovernanceSnapshot } = require("../context-gate-governance");
const { collectArtifactsFromPaths } = require("../governance-migration-impact");
const { runReleaseCheck } = require("../governance-release-check");
const { generateReleaseReport } = require("../governance-release-report");
const { artifactPathsFromDir, singleOption } = require("./governance-migration");

function toSlash(value) {
  return String(value || "").split(path.sep).join("/");
}

function readJsonPath(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") throw new ConfigError(`${label} not found: ${filePath}`, { cause: error });
    if (error instanceof SyntaxError) throw new ConfigError(`invalid ${label} JSON: ${filePath}`, { cause: error });
    throw error;
  }
}

function releasePathOption(options, key, label, context) {
  return path.resolve(context.cwd, singleOption(options, key, label));
}

function printReleaseCheckHuman(context, result) {
  writeLine(context, `GOVERNANCE RELEASE CHECK: ${result.all_passed ? "ok" : "failed"}`);
  writeLine(context, `release_id ${result.release.release_id || "-"}`);
  writeLine(context, `version ${result.release.version || "-"}`);
  writeLine(context, `status ${result.release.status || "-"}`);
  for (const item of result.checks || []) writeLine(context, `${item.passed ? "PASS" : "FAIL"}\t${item.name}`);
}

async function runReleaseCheckCommand(context, options, release) {
  const beforePath = releasePathOption(options, "before", "governance release check --before", context);
  const snapshotPath = releasePathOption(options, "snapshot", "governance release check --snapshot", context);
  const migrationPath = releasePathOption(options, "migration", "governance release check --migration", context);
  let artifacts = [];
  if (options.artifactsDir !== undefined) {
    const rawArtifactsDir = singleOption(options, "artifactsDir", "governance release check --artifacts-dir");
    const artifactsDir = path.resolve(context.cwd, rawArtifactsDir);
    artifacts = collectArtifactsFromPaths(artifactPathsFromDir(artifactsDir, rawArtifactsDir));
  }
  const result = await runReleaseCheck(release, {
    before_snapshot: readGovernanceSnapshot(beforePath),
    snapshot: readGovernanceSnapshot(snapshotPath),
    migration: readJsonPath(migrationPath, "governance migration spec"),
    artifacts,
  });
  if (options.json) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else printReleaseCheckHuman(context, result);
  return { exitCode: result.all_passed ? 0 : 1 };
}

function optionalJsonInput(context, options, key, label) {
  return options[key] === undefined ? null : readJsonPath(releasePathOption(options, key, label, context), label);
}

function runReleaseReportCommand(context, options, release) {
  const report = generateReleaseReport({
    release,
    diff: optionalJsonInput(context, options, "diff", "governance diff"),
    impact: optionalJsonInput(context, options, "impact", "governance impact report"),
    migration_verification: optionalJsonInput(context, options, "migrationVerification", "governance migration verification"),
  });
  if (options.out !== undefined) {
    const outPath = releasePathOption(options, "out", "governance release report --out", context);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, "utf8");
    writeLine(context, `wrote ${toSlash(outPath)}`);
  } else {
    writeOut(context, report);
  }
  return { exitCode: 0 };
}

async function runGovernanceRelease(context, options, positional) {
  const releaseAction = positional[1];
  if (!["check", "report"].includes(releaseAction) || positional.length !== 2) {
    fail(`unknown governance release action: ${releaseAction || "missing"}`);
  }
  const releasePath = releasePathOption(options, "release", `governance release ${releaseAction} --release`, context);
  const release = readJsonPath(releasePath, "governance release manifest");
  return releaseAction === "check"
    ? runReleaseCheckCommand(context, options, release)
    : runReleaseReportCommand(context, options, release);
}

module.exports = { runGovernanceRelease };
