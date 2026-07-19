"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { prepareInitInvocation } = require("./helpers/truth-authority");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-"));
}

function run(cwd, args, options = {}) {
  const invocation = prepareInitInvocation(cwd, args);
  const result = spawnSync(process.execPath, [CLI, ...invocation], {
    cwd,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${invocation.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    ...options,
  });
}

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function assertFailureCode(result, code, status) {
  assert.equal(result.status, status, result.stderr);
  assert.equal(errorCode(result), code, result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

test("CLI failures expose stable typed error codes and exit statuses", () => {
  const usageCwd = tempDir();
  assertFailureCode(runRaw(usageCwd, ["not-a-command"]), "MH_USAGE", 2);

  const configCwd = tempDir();
  run(configCwd, ["init", "Type config failures"]);
  fs.writeFileSync(path.join(configCwd, ".meta-harness", "repos.json"), "{not-json", "utf8");
  assertFailureCode(runRaw(configCwd, ["repos", "list"]), "MH_CONFIG", 2);

  const filesystemCwd = tempDir();
  run(filesystemCwd, ["init", "Type filesystem failures"]);
  fs.rmSync(path.join(filesystemCwd, ".meta-harness", "events.jsonl"));
  fs.mkdirSync(path.join(filesystemCwd, ".meta-harness", "events.jsonl"));
  assertFailureCode(runRaw(filesystemCwd, ["status", "--refresh"]), "MH_TRUTH_PATH", 1);

  const qualityCwd = tempDir();
  run(qualityCwd, ["quality", "init"]);
  fs.writeFileSync(
    path.join(qualityCwd, "new-monolith.js"),
    Array.from({ length: 501 }, (_, index) => `const line${index} = ${index};`).join("\n"),
    "utf8",
  );
  assertFailureCode(runRaw(qualityCwd, ["quality", "check"]), "MH_QUALITY_GATE", 1);
});

test("quality config and invocation failures expose precise typed error codes", () => {
  const missingContractCwd = tempDir();
  assertFailureCode(runRaw(missingContractCwd, ["quality", "check"]), "MH_CONFIG", 2);

  const invalidContractCwd = tempDir();
  run(invalidContractCwd, ["quality", "init"]);
  fs.writeFileSync(path.join(invalidContractCwd, ".meta-harness", "clean-code-contract.json"), "{not-json", "utf8");
  assertFailureCode(runRaw(invalidContractCwd, ["quality", "check"]), "MH_CONFIG", 2);

  const missingBaselineCwd = tempDir();
  run(missingBaselineCwd, ["quality", "init"]);
  fs.rmSync(path.join(missingBaselineCwd, ".meta-harness", "baseline", "quality-baseline.json"));
  assertFailureCode(runRaw(missingBaselineCwd, ["quality", "check"]), "MH_CONFIG", 2);

  const invalidBaselineCwd = tempDir();
  run(invalidBaselineCwd, ["quality", "init"]);
  fs.writeFileSync(
    path.join(invalidBaselineCwd, ".meta-harness", "baseline", "quality-baseline.json"),
    "{not-json",
    "utf8",
  );
  assertFailureCode(runRaw(invalidBaselineCwd, ["quality", "check"]), "MH_CONFIG", 2);

  const missingForceCwd = tempDir();
  run(missingForceCwd, ["quality", "init"]);
  assertFailureCode(runRaw(missingForceCwd, ["quality", "baseline"]), "MH_USAGE", 2);

  const unknownQualityActionCwd = tempDir();
  assertFailureCode(runRaw(unknownQualityActionCwd, ["quality", "not-a-command"]), "MH_USAGE", 2);
});
