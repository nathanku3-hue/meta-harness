"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { _test } = require("../lib/skill-distillation");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-distill-"));
}

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function assertCliError(result, code, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(errorCode(result), code, result.stderr);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

function readRegistry(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".meta-harness", "skill-distillations.json"), "utf8"));
}

function writeRegistry(cwd, body) {
  const registryPath = path.join(cwd, ".meta-harness", "skill-distillations.json");
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function addBaseDistillation(cwd, extraArgs = []) {
  return run(cwd, [
    "distill", "add",
    "--decision-id", "D-001",
    "--principle", "Inherited dirty work outside scope should be queued unless blocking.",
    "--skill", "dirty-work-autopilot",
    "--assumption", "path is outside owned scope",
    "--reopen-when", "path enters owned scope",
    "--out", ".meta-harness/skill-distillations.json",
    ...extraArgs,
  ]);
}

test("distill add creates valid v1 record with stable id and defaults", () => {
  const cwd = tempDir();
  const principle = "Inherited dirty work outside scope should be queued unless blocking.";
  const output = addBaseDistillation(cwd);
  assert.match(output, /Added distillation: S-[a-f0-9]{12}/);

  const registry = readRegistry(cwd);
  assert.equal(registry.v, 1);
  assert.equal(registry.distillations.length, 1);
  const [record] = registry.distillations;
  const expectedId = _test.makeDistillationId({
    source_decision_id: "D-001",
    principle,
    skill: "dirty-work-autopilot",
  });
  assert.equal(record.id, expectedId);
  assert.match(record.id, /^S-[a-f0-9]{12}$/);
  assert.equal(record.source_decision_id, "D-001");
  assert.equal(record.principle, principle);
  assert.equal(record.skill, "dirty-work-autopilot");
  assert.deepEqual(record.assumptions, ["path is outside owned scope"]);
  assert.equal(record.reopen_when, "path enters owned scope");
  assert.equal(record.enforcement, "human-only");
  assert.equal(record.owner, "orchestrator");
  assert.equal(record.status, "active");

  assert.match(addBaseDistillation(cwd), new RegExp(`Reused distillation: ${record.id}`));
  assert.equal(readRegistry(cwd).distillations.length, 1);
  assert.equal(readRegistry(cwd).distillations[0].id, expectedId);

  const list = run(cwd, ["distill", "list", "--in", ".meta-harness/skill-distillations.json"]);
  assert.match(list, new RegExp(`${record.id}\\s+active\\s+dirty-work-autopilot`));
});

test("distill add requires provenance fields", () => {
  const cwd = tempDir();
  const base = ["distill", "add", "--skill", "dirty-work-autopilot", "--out", ".meta-harness/skill-distillations.json"];
  assertCliError(runRaw(cwd, [
    ...base,
    "--principle", "A principle.",
    "--assumption", "an assumption",
    "--reopen-when", "when it changes",
  ]), "MH_USAGE", /--decision-id requires a value/);
  assertCliError(runRaw(cwd, [
    ...base,
    "--decision-id", "D-001",
    "--assumption", "an assumption",
    "--reopen-when", "when it changes",
  ]), "MH_USAGE", /--principle requires a value/);
  assertCliError(runRaw(cwd, [
    ...base,
    "--decision-id", "D-001",
    "--principle", "A principle.",
    "--reopen-when", "when it changes",
  ]), "MH_USAGE", /--assumption requires at least one value/);
  assertCliError(runRaw(cwd, [
    ...base,
    "--decision-id", "D-001",
    "--principle", "A principle.",
    "--assumption", "an assumption",
  ]), "MH_USAGE", /--reopen-when requires a value/);
});

test("distill add rejects remote or path skill names and invalid statuses", () => {
  const cwd = tempDir();
  for (const skill of ["https://example.com/skill.md", "../dirty-work-autopilot", "skills/dirty-work-autopilot", "dirty-work-autopilot.md", "C:\\skills\\dirty-work-autopilot"]) {
    assertCliError(runRaw(cwd, [
      "distill", "add",
      "--decision-id", "D-001",
      "--principle", "A principle.",
      "--skill", skill,
      "--assumption", "an assumption",
      "--reopen-when", "when it changes",
      "--out", ".meta-harness/skill-distillations.json",
    ]), "MH_USAGE", /skill must be a local capsule name/);
  }

  assertCliError(runRaw(cwd, [
    "distill", "add",
    "--decision-id", "D-001",
    "--principle", "A principle.",
    "--skill", "dirty-work-autopilot",
    "--assumption", "an assumption",
    "--reopen-when", "when it changes",
    "--status", "maybe",
    "--out", ".meta-harness/skill-distillations.json",
  ]), "MH_USAGE", /status must be one of: active\|superseded\|reopened/);
});

test("changed assumptions reopen the existing distillation record", () => {
  const cwd = tempDir();
  addBaseDistillation(cwd);
  const first = readRegistry(cwd).distillations[0];

  const output = run(cwd, [
    "distill", "add",
    "--decision-id", "D-001",
    "--principle", "Inherited dirty work outside scope should be queued unless blocking.",
    "--skill", "dirty-work-autopilot",
    "--assumption", "path is outside owned scope",
    "--assumption", "provider boundary is absent",
    "--reopen-when", "path enters owned scope",
    "--enforcement", "scope_diff_gate",
    "--out", ".meta-harness/skill-distillations.json",
  ]);
  assert.match(output, new RegExp(`Reopened distillation: ${first.id}`));
  const registry = readRegistry(cwd);
  assert.equal(registry.distillations.length, 1);
  assert.equal(registry.distillations[0].id, first.id);
  assert.equal(registry.distillations[0].status, "reopened");
  assert.deepEqual(registry.distillations[0].assumptions, [
    "path is outside owned scope",
    "provider boundary is absent",
  ]);
  assert.equal(registry.distillations[0].enforcement, "scope_diff_gate");
});

test("changed reopen condition reopens the existing distillation record", () => {
  const cwd = tempDir();
  addBaseDistillation(cwd);
  const first = readRegistry(cwd).distillations[0];

  const output = run(cwd, [
    "distill", "add",
    "--decision-id", "D-001",
    "--principle", "Inherited dirty work outside scope should be queued unless blocking.",
    "--skill", "dirty-work-autopilot",
    "--assumption", "path is outside owned scope",
    "--reopen-when", "provider or runtime boundary appears",
    "--out", ".meta-harness/skill-distillations.json",
  ]);
  assert.match(output, new RegExp(`Reopened distillation: ${first.id}`));
  const registry = readRegistry(cwd);
  assert.equal(registry.distillations.length, 1);
  assert.equal(registry.distillations[0].id, first.id);
  assert.equal(registry.distillations[0].status, "reopened");
  assert.equal(registry.distillations[0].reopen_when, "provider or runtime boundary appears");
});

test("distill check reports active records and rejects malformed registry records", () => {
  const cwd = tempDir();
  addBaseDistillation(cwd);
  const registry = readRegistry(cwd);
  const output = run(cwd, ["distill", "check", "--in", ".meta-harness/skill-distillations.json"]);
  assert.match(output, /Skill distillation registry: PASS/);
  assert.match(output, /Active records: 1/);
  assert.match(output, new RegExp(registry.distillations[0].id));

  const malformed = tempDir();
  writeRegistry(malformed, {
    v: 1,
    distillations: [{
      id: "S-badbadbadbad",
      source_decision_id: "D-001",
      skill: "dirty-work-autopilot",
      assumptions: ["an assumption"],
      reopen_when: "when it changes",
      enforcement: "human-only",
      owner: "orchestrator",
      status: "active",
    }],
  });
  assertCliError(
    runRaw(malformed, ["distill", "check", "--in", ".meta-harness/skill-distillations.json"]),
    "MH_CONFIG",
    /principle/,
  );
});
