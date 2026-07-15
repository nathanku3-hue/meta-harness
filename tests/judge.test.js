"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const judge = require("../lib/judge");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-judge-"));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function initRepo() {
  const root = tempDir();
  run(root, "git", ["init"]);
  run(root, "git", ["config", "user.name", "Meta Harness Test"]);
  run(root, "git", ["config", "user.email", "meta-harness@example.test"]);
  writeFile(root, "package.json", JSON.stringify({
    name: "judge-fixture",
    version: "1.0.0",
    bin: { "judge-fixture": "bin/meta-harness.js" },
    files: ["bin/", "lib/", "package.json"],
  }, null, 2));
  writeFile(root, "bin/meta-harness.js", "#!/usr/bin/env node\nconsole.log('meta-harness help')\n");
  writeFile(root, "lib/command-registry.js", "module.exports = { commandRegistry: [] };\n");
  writeFile(root, "lib/feature.js", "function kept() { return true; }\nmodule.exports = { kept };\n");
  run(root, "git", ["add", "."]);
  run(root, "git", ["commit", "-m", "base"]);
  const discovered = run(root, "git", ["rev-parse", "--show-toplevel"]).trim();
  assert.equal(fs.realpathSync(discovered), fs.realpathSync(root));
  return root;
}

function judgeInput(overrides = {}) {
  return {
    version: 1,
    round: "ROUND-014",
    model: "gpt-5.5",
    base_ref: "HEAD",
    scope: {
      files: ["lib/feature.js"],
      line_budget: 20,
    },
    old_symbols: [],
    smoke_checks: [],
    exceptions: [],
    ...overrides,
  };
}

function byId(result, id) {
  return result.checks.find((check) => check.check_id === id);
}

test("judge passes for scoped local changes and emits stable envelope", async () => {
  const root = initRepo();
  writeFile(root, "lib/feature.js", "function kept() { return true; }\nfunction localThing() { return kept(); }\nmodule.exports = { kept, localThing };\n");

  const result = await judge.check({ target: root, input: judgeInput() });

  assert.equal(result.schema_version, "1.0.0");
  assert.equal(result.tool, "meta-harness-judge");
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.status, "pass");
  assert.deepEqual(result.errors, []);
  assert.equal(byId(result, "JUDGE_SCOPE_001").status, "pass");
  assert.deepEqual(result.traits_triggered, []);
  assert.deepEqual(result.candidate_profile_events, []);
});

test("judge reads untracked files and flags scope plus defensive helper residue", async () => {
  const root = initRepo();
  writeFile(root, "lib/feature.js", "function kept() { return true; }\nfunction normalizeConfig(value) { return value || {}; }\n// oldFunctionName is stale code residue\nmodule.exports = { kept, normalizeConfig };\n");
  writeFile(root, "docs/Ship fast 诊断.md", "oldFunctionName still mentioned\n");

  const result = await judge.check({
    target: root,
    input: judgeInput({ old_symbols: ["oldFunctionName"] }),
  });

  assert.equal(result.ok, false);
  assert.equal(byId(result, "JUDGE_DEFENSIVE_001").status, "fail");
  assert.deepEqual(byId(result, "JUDGE_SCOPE_001").files, ["docs/Ship fast 诊断.md"]);
  assert.equal(byId(result, "JUDGE_RESIDUE_001").status, "fail");
  assert.deepEqual(byId(result, "JUDGE_RESIDUE_001").files, ["lib/feature.js"]);
  assert.ok(result.target.untracked_files.includes("docs/Ship fast 诊断.md"));
  assert.ok(result.traits_triggered.includes("over-defensive-abstraction"));
  assert.ok(result.candidate_profile_events.some((event) => event.check_id === "JUDGE_DEFENSIVE_001"));
});

test("judge compares candidate changes against merge base instead of base branch tip", async () => {
  const root = initRepo();
  run(root, "git", ["branch", "candidate"]);
  run(root, "git", ["checkout", "-b", "base-ref"]);
  writeFile(root, "docs/upstream.md", "upstream-only base branch change\n");
  run(root, "git", ["add", "."]);
  run(root, "git", ["commit", "-m", "upstream base change"]);
  run(root, "git", ["checkout", "candidate"]);
  writeFile(root, "lib/feature.js", "function kept() { return true; }\nfunction localThing() { return kept(); }\nmodule.exports = { kept, localThing };\n");

  const result = await judge.check({
    target: root,
    input: judgeInput({ base_ref: "base-ref" }),
  });

  assert.equal(result.ok, true);
  assert.equal(byId(result, "JUDGE_SCOPE_001").status, "pass");
  assert.deepEqual(result.target.changed_files, ["lib/feature.js"]);
  assert.notEqual(result.target.base_sha, result.target.merge_base);
});

test("helper budget ignores tests and scripts while residue scan ignores docs and tests", async () => {
  const root = initRepo();
  writeFile(root, "tests/new-feature.test.js", [
    "const helperOne = () => true;",
    "const helperTwo = () => true;",
    "const helperThree = () => true;",
    "oldFunctionName regression fixture",
  ].join("\n"));
  writeFile(root, "scripts/migrate.js", [
    "const helperFour = () => true;",
    "const helperFive = () => true;",
  ].join("\n"));
  writeFile(root, "docs/residue.md", "oldFunctionName is documented as a removed symbol\n");

  const result = await judge.check({
    target: root,
    input: judgeInput({
      scope: {
        files: ["tests/new-feature.test.js", "scripts/migrate.js", "docs/residue.md"],
        line_budget: 20,
      },
      old_symbols: ["oldFunctionName"],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(byId(result, "JUDGE_DEFENSIVE_003").status, "pass");
  assert.match(byId(result, "JUDGE_DEFENSIVE_003").evidence, /0$/);
  assert.equal(byId(result, "JUDGE_RESIDUE_001").status, "pass");
});

test("machine-readable exceptions downgrade fully covered failures to warnings", async () => {
  const root = initRepo();
  writeFile(root, "lib/feature.js", "function normalizeConfig(value) { return value || {}; }\nmodule.exports = { normalizeConfig };\n");

  const result = await judge.check({
    target: root,
    input: judgeInput({
      exceptions: [{
        check_id: "JUDGE_DEFENSIVE_001",
        file: "lib/feature.js",
        reason: "Boundary parser for user-provided config.",
      }],
    }),
  });

  const defensive = byId(result, "JUDGE_DEFENSIVE_001");
  assert.equal(defensive.status, "warn");
  assert.equal(defensive.exception_applied, true);
  assert.equal(result.status, "warn");
});

test("judge rejects unsafe input paths and raw invalid smoke IDs with stable JSON errors", async () => {
  const root = initRepo();

  const pathResult = await judge.check({
    target: root,
    input: judgeInput({ scope: { files: ["../escape.js"], line_budget: 20 } }),
  });
  assert.equal(pathResult.ok, false);
  assert.equal(pathResult.errors[0].code, "JUDGE_INPUT_PATH_INVALID");
  assert.deepEqual(pathResult.checks, []);

  const smokeResult = await judge.check({
    target: root,
    input: judgeInput({ smoke_checks: ["npm test"] }),
  });
  assert.equal(smokeResult.ok, false);
  assert.equal(smokeResult.errors[0].code, "JUDGE_INPUT_SMOKE_UNKNOWN");
  assert.deepEqual(smokeResult.checks, []);
});

test("invalid git and base-ref states fail closed in the stable envelope", async () => {
  const notGit = tempDir();
  const notGitResult = await judge.check({ target: notGit, input: judgeInput() });
  assert.equal(notGitResult.ok, false);
  assert.equal(notGitResult.errors[0].code, "JUDGE_INPUT_TARGET_NOT_GIT");

  const root = initRepo();
  const missingBase = await judge.check({
    target: root,
    input: judgeInput({ base_ref: "origin/not-present" }),
  });
  assert.equal(missingBase.ok, false);
  assert.equal(missingBase.errors[0].code, "JUDGE_INPUT_BASE_REF_UNAVAILABLE");

  const stale = await judge.check({
    target: root,
    input: judgeInput({ base_ref_freshness: { status: "stale" } }),
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.errors[0].code, "JUDGE_INPUT_BASE_REF_STALE");
});

test("Meta-Harness package smoke IDs use hardcoded local commands", async () => {
  const root = initRepo();
  const input = judgeInput({
    smoke_checks: ["cli_help", "require_command_registry"],
  });
  writeJson(root, ".meta-harness/local/judge/ROUND-014.json", input);

  const result = await judge.check({
    target: root,
    inputPath: path.join(root, ".meta-harness", "local", "judge", "ROUND-014.json"),
  });

  assert.equal(result.ok, true);
  assert.equal(byId(result, "JUDGE_SMOKE_CLI_HELP").status, "pass");
  assert.equal(byId(result, "JUDGE_SMOKE_COMMAND_REGISTRY").status, "pass");
  assert.equal(result.input.source.endsWith(".meta-harness/local/judge/ROUND-014.json"), true);
});
