"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ROOT, runRaw, tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repo(t, { withValidation = true, withOrigin = true } = {}) {
  const parent = tempDir("cli-work-");
  const root = path.join(parent, "repo");
  const origin = path.join(parent, "origin.git");
  fs.mkdirSync(root);
  if (withOrigin) git(parent, ["init", "--bare", origin]);
  git(root, ["init"]);
  git(root, ["config", "user.name", "CLI Work Test"]);
  git(root, ["config", "user.email", "cli-work@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  writeProductMd(root);
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
  if (withOrigin) {
    git(root, ["remote", "add", "origin", origin]);
    git(root, ["push", "-u", "origin", "HEAD"]);
    const branch = git(root, ["branch", "--show-current"]);
    git(parent, ["--git-dir", origin, "symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  }
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function env(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_TEST_MODE: "1",
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

test("primary work command executes in a fresh workspace and reports product fields before evidence", (t) => {
  const root = repo(t);
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env({ FAKE_WORKER_RETRY: "1" }) });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productResult, "Create the delivered result file.");
  assert.equal(parsed.workspace.mode, "isolated");
  assert.equal(parsed.workspace.state, "TERMINAL_SEALED_DIRTY");
  assert.equal(parsed.attempts, 2);
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
  assert.deepEqual(parsed.delivery.commit, { status: "not_authorized" });
  assert.deepEqual(parsed.delivery.push, { status: "not_authorized" });
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(parsed.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("duplicate normalized allow paths fail before workspace or worker activity", (t) => {
  const root = repo(t);
  const duplicate = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--allow", "./src/",
    "--json",
  ], { env: env() });
  assert.equal(duplicate.status, 2, duplicate.stderr);
  const error = JSON.parse(duplicate.stdout);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, "MH_USAGE");
  assert.match(error.error.message, /duplicate --allow path after normalization/i);
  assert.equal(fs.existsSync(path.join(root, "src")), false);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
  assert.equal(git(root, ["status", "--short"]), "");

  const distinct = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--allow", "tests",
    "--dry-run",
    "--json",
  ], { env: env() });
  assert.equal(distinct.status, 0, distinct.stderr);
  assert.equal(JSON.parse(distinct.stdout).outcome, "READY");
});

test("missing allow values fail before validation, workspace, worker, or repository mutation", (t) => {
  const root = repo(t);
  const cases = [
    ["--allow"],
    ["--allow", "src", "--allow"],
  ];

  for (const allowArgs of cases) {
    const result = runRaw(ROOT, [
      "work", root,
      "--goal", "Create the delivered result file.",
      ...allowArgs,
      "--dry-run",
      "--json",
    ], { env: env() });
    assert.equal(result.status, 2, result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.ok, false);
    assert.equal(error.error.code, "MH_USAGE");
    assert.match(error.error.message, /--allow requires a path/i);
    assert.equal(fs.existsSync(path.join(root, "src")), false);
    assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
    assert.equal(git(root, ["status", "--short"]), "");
  }
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

test("dry run previews fresh isolation; completed terminal workspace cannot resume or be reused", (t) => {
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
  assert.equal(path.dirname(path.dirname(planned.workspace.path)), root);
  assert.match(path.basename(planned.workspace.path), /^meta-harness-[0-9a-f-]{36}$/u);
  assert.equal(fs.existsSync(planned.workspace.path), false);
  const parent = path.dirname(root);
  const parentEntries = fs.readdirSync(parent).sort();

  const executed = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(executed.status, 0, executed.stderr);
  const delivered = JSON.parse(executed.stdout);
  assert.equal(delivered.workspace.mode, "isolated");
  assert.notEqual(delivered.workspace.path, planned.workspace.path);
  assert.equal(delivered.workspace.state, "TERMINAL_SEALED_DIRTY");
  assert.equal(fs.existsSync(path.join(parent, ".meta-harness-worktrees")), false);
  assert.deepEqual(fs.readdirSync(parent).sort(), parentEntries);

  const resumed = runRaw(ROOT, ["work", root, "--resume", "--dry-run", "--json"], { env: env() });
  assert.notEqual(resumed.status, 0);
  assert.match(`${resumed.stdout}\n${resumed.stderr}`, /workspace is terminal or inactive|not executable/i);

  const second = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(second.status, 0, second.stderr);
  const secondResult = JSON.parse(second.stdout);
  assert.notEqual(secondResult.workspace.workspaceId, delivered.workspace.workspaceId);
  assert.notEqual(secondResult.workspace.path, delivered.workspace.path);
});

test("dirty stale diverged source uses fresh remote authority and sealed-tree validation without source mutation", (t) => {
  const root = repo(t);
  const parent = path.dirname(root);
  const origin = git(root, ["remote", "get-url", "origin"]);
  const producer = path.join(parent, "producer");
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const sourceBranch = git(root, ["branch", "--show-current"]);
  assert.equal(git(root, ["rev-parse", `refs/remotes/origin/${sourceBranch}`]), baseline);

  git(parent, ["clone", origin, producer]);
  git(producer, ["config", "user.name", "Remote Producer"]);
  git(producer, ["config", "user.email", "remote-producer@example.invalid"]);

  fs.writeFileSync(path.join(root, "LOCAL_ONLY.md"), "local divergent commit\n", "utf8");
  git(root, ["add", "LOCAL_ONLY.md"]);
  git(root, ["commit", "-m", "local divergent source commit"]);
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(producer, "REMOTE_ONLY.md"), "fresh remote base\n", "utf8");
  git(producer, ["add", "REMOTE_ONLY.md"]);
  git(producer, ["commit", "-m", "advance remote base"]);
  git(producer, ["push", "origin", "HEAD"]);
  const remoteHead = git(producer, ["rev-parse", "HEAD"]);
  assert.notEqual(remoteHead, sourceHead);

  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    scripts: { test: "echo \"Error: no test specified\" && exit 1" },
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "owner dirty README\n", "utf8");
  fs.writeFileSync(path.join(root, "source-only.tmp"), "owner untracked state\n", "utf8");
  const beforeStatus = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const beforeIndex = git(root, ["diff", "--cached", "--binary"]);
  const beforePackage = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const beforeReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.workspace.baseHead, remoteHead);
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD"]), remoteHead);
  assert.equal(fs.existsSync(path.join(parsed.workspace.path, "REMOTE_ONLY.md")), true);
  assert.equal(fs.existsSync(path.join(parsed.workspace.path, "LOCAL_ONLY.md")), false);
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.equal(git(root, ["merge-base", sourceHead, remoteHead]), baseline);
  assert.equal(git(root, ["rev-list", "--left-right", "--count", `${sourceHead}...${remoteHead}`]), "1\t1");

  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(root, ["rev-parse", `refs/remotes/origin/${sourceBranch}`]), baseline);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), beforeStatus);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), beforeIndex);
  assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), beforePackage);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), beforeReadme);
});

test("explicit --base HEAD is the deliberate local-authority escape hatch", (t) => {
  const root = repo(t, { withOrigin: false });
  const head = git(root, ["rev-parse", "HEAD"]);

  const defaultResult = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--dry-run",
    "--json",
  ], { env: env() });
  assert.notEqual(defaultResult.status, 0);

  const explicit = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--base", "HEAD",
    "--dry-run",
    "--json",
  ], { env: env() });
  assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
  const parsed = JSON.parse(explicit.stdout);
  assert.equal(parsed.outcome, "READY");
  assert.equal(parsed.workspace.wouldCreate, true);
  assert.equal(fs.existsSync(parsed.workspace.path), false);
  assert.equal(git(root, ["rev-parse", "HEAD"]), head);
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
