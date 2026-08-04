"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ROOT, runRaw, tempDir } = require("./helpers/cli");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function repo(t) {
  const parent = tempDir("cli-work-");
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "CLI Work Test"]);
  git(root, ["config", "user.email", "cli-work@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function env(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

test("primary work command executes code and reports product fields before evidence", (t) => {
  const root = repo(t);
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--continue-dirty",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productResult, "Create the delivered result file.");
  assert.equal(parsed.workspace.mode, "current");
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
});

test("dry run selects isolation without creating a worktree and resume preserves the brief", (t) => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, "README.md"), "owner dirtiness\n", "utf8");
  const dry = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--dry-run",
    "--json",
  ], { env: env() });
  assert.equal(dry.status, 0, dry.stderr);
  const planned = JSON.parse(dry.stdout);
  assert.equal(planned.outcome, "READY");
  assert.equal(planned.workspace.mode, "isolated");
  assert.equal(planned.workspace.wouldCreate, true);
  assert.equal(fs.existsSync(planned.workspace.path), false);

  const executed = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(executed.status, 0, executed.stderr);
  const delivered = JSON.parse(executed.stdout);
  assert.equal(delivered.workspace.mode, "isolated");

  const resumed = runRaw(ROOT, ["work", root, "--resume", "--dry-run", "--json"], { env: env() });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).productResult, "Create the delivered result file.");
});

test("default help is one coding journey and advanced help contains internal commands", () => {
  const basic = runRaw(ROOT, ["--help"]);
  assert.equal(basic.status, 0, basic.stderr);
  assert.match(basic.stdout, /A coding system that carries one accepted product result/);
  assert.match(basic.stdout, /meta-harness work <repository> --goal/);
  assert.doesNotMatch(basic.stdout, /meta-harness gate scope/);
  assert.doesNotMatch(basic.stdout, /meta-harness governance snapshot/);

  const advanced = runRaw(ROOT, ["help", "--advanced"]);
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.match(advanced.stdout, /meta-harness advanced commands/);
  assert.match(advanced.stdout, /meta-harness gate scope/);
  assert.match(advanced.stdout, /meta-harness governance snapshot/);
});
