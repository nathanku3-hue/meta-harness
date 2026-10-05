"use strict";

const path = require("node:path");

const { fail, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { diffGovernanceSnapshots } = require("../governance-diff");
const {
  buildLiveGovernance,
  defaultGovernanceSnapshotPath,
  writeGovernanceSnapshot,
  readGovernanceSnapshot,
} = require("../context-gate-governance");
const { runGovernanceMigration } = require("./governance-migration");
const { runGovernanceRelease } = require("./governance-release");

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

function optionalTargetRoot(options, context) {
  if (Array.isArray(options.target)) fail("--target must be provided once");
  const rawTarget = options.target === undefined ? "." : options.target;
  if (rawTarget === true || String(rawTarget).trim() === "") fail("--target requires an existing directory");
  const targetRoot = path.resolve(context.cwd, String(rawTarget));
  let stat;
  try {
    stat = context.fs.lstatSync(targetRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") fail(`--target must be an existing directory: ${rawTarget}`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`--target must be an existing directory: ${rawTarget}`);
  return targetRoot;
}

function snapshotPathFromOptions(options, targetRoot) {
  if (options.snapshot === undefined) return defaultGovernanceSnapshotPath(targetRoot);
  return path.resolve(targetRoot, singleOption(options, "snapshot", "--snapshot"));
}

function printJson(context, result) {
  writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
}

function printSnapshotHuman(context, result) {
  writeLine(context, `GOVERNANCE SNAPSHOT: wrote ${result.path}`);
  writeLine(context, `governance_hash ${result.governance_hash}`);
  writeLine(context, `governance_engine_hash ${result.snapshot.governance_engine_hash}`);
}

function snapshotResult(targetRoot, writeResult) {
  return {
    schema_version: "1",
    ok: true,
    action: "snapshot",
    target: toSlash(targetRoot),
    path: toSlash(writeResult.path),
    governance_hash: writeResult.governance_hash,
    snapshot: writeResult.snapshot,
  };
}

function printDiffHuman(context, result) {
  writeLine(context, `GOVERNANCE DIFF: ${result.ok ? "clean" : "drift"} (${result.counts.changes} change${result.counts.changes === 1 ? "" : "s"})`);
  for (const change of result.changes) writeLine(context, `${change.category}\t${change.label}`);
}

function diffResult(targetRoot, baselinePath, baseline, current) {
  return {
    ...diffGovernanceSnapshots(baseline, current),
    action: "diff",
    target: toSlash(targetRoot),
    snapshot: toSlash(baselinePath),
    governance_engine_hash: current.governance_engine_hash,
  };
}

async function runReplay(context, options) {
  const snapshotPath = path.resolve(context.cwd, singleOption(options, "snapshot", "governance replay --snapshot"));
  const artifactPath = path.resolve(context.cwd, singleOption(options, "artifact", "governance replay --artifact"));
  const targetRoot = optionalTargetRoot(options, context);
  const replayModule = require("../governance-replay");
  if (typeof replayModule.replayFromSnapshot !== "function") fail("governance replay module does not export replayFromSnapshot");
  const result = await replayModule.replayFromSnapshot({ snapshotPath, artifactPath, targetRoot });
  if (options.json) printJson(context, result);
  else writeLine(context, `GOVERNANCE REPLAY: ${result.status || (result.ok ? "match" : "mismatch")}`);
  return { exitCode: result.ok === false || result.replayable === false || result.matches_original === false ? 1 : 0 };
}

module.exports = async function runGovernance(argv, context) {
  const { positional, options } = parseArgs(argv);
  const action = positional[0];
  if (action === "migration") return runGovernanceMigration(context, options, positional);
  if (action === "release") return runGovernanceRelease(context, options, positional);
  if (!["snapshot", "diff", "replay"].includes(action) || positional.length !== 1) {
    fail(`unknown governance action: ${action || "missing"}`);
  }
  if (action === "replay") return runReplay(context, options);

  const targetRoot = optionalTargetRoot(options, context);
  if (action === "snapshot") {
    const out = options.out === undefined ? undefined : singleOption(options, "out", "governance snapshot --out");
    const result = snapshotResult(targetRoot, writeGovernanceSnapshot({ targetRoot, out }));
    if (options.json) printJson(context, result);
    else printSnapshotHuman(context, result);
    return { exitCode: 0 };
  }

  const baselinePath = snapshotPathFromOptions(options, targetRoot);
  const result = diffResult(targetRoot, baselinePath, readGovernanceSnapshot(baselinePath), buildLiveGovernance());
  if (options.json) printJson(context, result);
  else printDiffHuman(context, result);
  return { exitCode: result.ok ? 0 : 1 };
};
