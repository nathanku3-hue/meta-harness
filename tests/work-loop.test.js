"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { runWork } = require("../lib/work-loop");
const { sealWorkSession } = require("../lib/work-session");
const { ROOT, tempDir } = require("./helpers/cli");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const parent = tempDir("work-loop-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Work Loop Test"]);
  git(root, ["config", "user.email", "work-loop@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", ".gitignore", "README.md"]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function addOrigin(root) {
  const origin = path.join(path.dirname(root), "origin.git");
  git(path.dirname(root), ["init", "--bare", origin]);
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-u", "origin", "HEAD"]);
  return git(root, ["branch", "--show-current"]);
}

function session({
  dirtyPolicy = "continue-in-scope",
  allowedPaths = ["src"],
  maxAttempts = 2,
  delivery = { commit: false, push: false },
  validation,
} = {}) {
  const check = [
    process.execPath,
    "-e",
    "const fs=require('fs'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)",
  ];
  const resolvedValidation = validation === undefined
    ? [{ argv: check, cwd: ".", timeoutSeconds: 30 }]
    : validation;
  return sealWorkSession({
    schemaVersion: "work-session/v1",
    intent: { version: "test-intent/v1", digest: "sha256:" + "2".repeat(64) },
    productResult: "Create the delivered result file.",
    journeyState: "The coding task is accepted.",
    doNow: "Create src/result.txt.",
    newlyTrueBehavior: "src/result.txt contains delivered.",
    doneWhen: "The exact file exists and validation passes.",
    stopOnlyIf: ["The allowed path is insufficient."],
    authorizedReversibleActions: ["Edit src.", "Run validation."],
    ownerOnlyActions: ["Publish the repository."],
    allowedPaths,
    dirtyPolicy,
    validation: resolvedValidation,
    maxAttempts,
    delivery,
  });
}

function workerEnv(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

test("zero validation blocks before workspace creation or worker launch", async (t) => {
  const root = repository(t);
  let workerCalls = 0;
  const runner = async () => {
    workerCalls += 1;
    throw new Error("worker must not launch");
  };
  const result = await runWork({
    repositoryPath: root,
    session: session({ validation: [] }),
    runner,
  });
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.workspace.mode, "not_created");
  assert.equal(result.attempts, 0);
  assert.equal(result.delivery.validation, "unavailable");
  assert.deepEqual(result.delivery.commit, { status: "not_attempted" });
  assert.equal(workerCalls, 0);
  assert.equal(git(root, ["status", "--short"]), "");

  const dry = await runWork({
    repositoryPath: root,
    session: session({ validation: [] }),
    dryRun: true,
    runner,
  });
  assert.equal(dry.outcome, "BLOCKED");
  assert.equal(workerCalls, 0);
});

test("work loop carries a product brief into code and exact validation", async (t) => {
  const root = repository(t);
  const result = await runWork({ repositoryPath: root, session: session(), env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "current");
  assert.equal(result.validation.length, 1);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.deepEqual(result.delivery.commit, { status: "not_authorized" });
  assert.deepEqual(result.delivery.push, { status: "not_authorized" });
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
});

test("validated work commits and pushes only with sealed delivery authority", async (t) => {
  const root = repository(t);
  const branch = addOrigin(root);
  const result = await runWork({
    repositoryPath: root,
    session: session({ delivery: { commit: true, push: true } }),
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.delivery.validation, "passed");
  assert.equal(result.delivery.commit.status, "committed");
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.equal(result.delivery.push.status, "remote_equal");
  assert.equal(result.delivery.push.branch, branch);
  assert.equal(git(root, ["rev-parse", "HEAD"]), result.delivery.commit.sha);
  assert.equal(
    git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0],
    result.delivery.commit.sha,
  );
  assert.equal(git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]), "src/result.txt");
  assert.equal(git(root, ["status", "--short"]), "");
});

test("worker-marked partial work is never delivered", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session({ delivery: { commit: true, push: false } }),
    env: workerEnv({ FAKE_WORKER_STATUS: "partial" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "PARTIAL");
  assert.deepEqual(result.delivery.commit, { status: "not_attempted" });
  assert.deepEqual(result.delivery.push, { status: "not_attempted" });
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
});

test("passed controller validation returns a worker-marked partial result for bounded completion", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session({ maxAttempts: 2 }),
    env: workerEnv({ FAKE_WORKER_PARTIAL_FIRST: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
});

test("unrelated dirtiness is preserved while work moves to a repo-local isolated branch", async (t) => {
  const root = repository(t);
  const parent = path.dirname(root);
  const parentEntries = fs.readdirSync(parent).sort();
  fs.writeFileSync(path.join(root, "README.md"), "owner dirtiness\n", "utf8");
  const result = await runWork({
    repositoryPath: root,
    session: session({ dirtyPolicy: "continue-in-scope", allowedPaths: ["src"] }),
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "isolated");
  assert.equal(result.workspace.created, true);
  assert.match(result.workspace.branch, /^work\/create-the-delivered-result-file-/);
  assert.equal(path.dirname(path.dirname(result.workspace.path)), root);
  assert.match(path.basename(result.workspace.path), /^meta-harness-[a-f0-9]{10}$/u);
  assert.equal(fs.existsSync(path.join(parent, ".meta-harness-worktrees")), false);
  assert.deepEqual(fs.readdirSync(parent).sort(), parentEntries);
  assert.match(git(root, ["worktree", "list", "--porcelain"]), /\.worktrees[\\/]meta-harness-/u);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "owner dirtiness\n");
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("coherent in-scope dirtiness is continued instead of becoming a blocker", async (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "result.txt"), "unfinished\n", "utf8");
  const result = await runWork({ repositoryPath: root, session: session(), env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "current");
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
});

test("failed validation is returned to the same worker session for bounded repair", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session({ maxAttempts: 2 }),
    env: workerEnv({ FAKE_WORKER_RETRY: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.equal(result.validation[0].passed, true);
});

test("worker path and Git-index escapes fail closed", async (t) => {
  const outsideRoot = repository(t);
  await assert.rejects(
    runWork({
      repositoryPath: outsideRoot,
      session: session(),
      env: workerEnv({ FAKE_WORKER_PATH: "outside.txt" }),
      timeoutSeconds: 30,
    }),
    (error) => error.code === "MH_WORK_BOUNDARY_PATH",
  );

  const stagedRoot = repository(t);
  await assert.rejects(
    runWork({
      repositoryPath: stagedRoot,
      session: session(),
      env: workerEnv({ FAKE_WORKER_STAGE: "1" }),
      timeoutSeconds: 30,
    }),
    (error) => error.code === "MH_WORK_BOUNDARY_INDEX",
  );
});
