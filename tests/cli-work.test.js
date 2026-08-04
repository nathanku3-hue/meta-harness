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
  return String(result.stdout || "").trim();
}

function repo(t, { withValidation = true } = {}) {
  const parent = tempDir("cli-work-");
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "CLI Work Test"]);
  git(root, ["config", "user.email", "cli-work@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  if (withValidation) {
    fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
      scripts: { test: "node verify.js" },
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(root, "verify.js"), [
      '"use strict";',
      'const fs = require("node:fs");',
      'const value = fs.existsSync("src/result.txt") ? fs.readFileSync("src/result.txt", "utf8") : "missing";',
      'if (value !== "delivered\\n") process.exitCode = 7;',
      "",
    ].join("\n"), "utf8");
  }
  git(root, ["add", "."]);
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
  ], { env: env({ FAKE_WORKER_RETRY: "1" }) });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productResult, "Create the delivered result file.");
  assert.equal(parsed.workspace.mode, "current");
  assert.equal(parsed.attempts, 2);
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
  assert.deepEqual(parsed.delivery.commit, { status: "not_authorized" });
  assert.deepEqual(parsed.delivery.push, { status: "not_authorized" });
});

test("unsupported goal blocks before worker, workspace, or repository mutation", (t) => {
  const root = repo(t, { withValidation: false });
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 1, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "BLOCKED");
  assert.equal(parsed.workspace.mode, "not_created");
  assert.equal(parsed.attempts, 0);
  assert.deepEqual(parsed.changedPaths, []);
  assert.equal(parsed.delivery.validation, "unavailable");
  assert.equal(fs.existsSync(path.join(root, "src")), false);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
  assert.equal(git(root, ["status", "--short"]), "");

  const human = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
  ], { env: env() });
  assert.equal(human.status, 1, human.stderr);
  assert.match(human.stdout, /Validation: unavailable/);
  assert.doesNotMatch(human.stdout, /worker-reported/);
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
