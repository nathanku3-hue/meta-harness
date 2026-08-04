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
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function session({ dirtyPolicy = "continue-in-scope", allowedPaths = ["src"], maxAttempts = 2 } = {}) {
  const check = [
    process.execPath,
    "-e",
    "const fs=require('fs'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)",
  ];
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
    validation: [{ argv: check, cwd: ".", timeoutSeconds: 30 }],
    maxAttempts,
  });
}

function workerEnv(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

test("work loop carries a product brief into code and exact validation", async (t) => {
  const root = repository(t);
  const result = await runWork({ repositoryPath: root, session: session(), env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "current");
  assert.equal(result.validation.length, 1);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "delivered\n");
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
});

test("unrelated dirtiness is preserved while work moves to an isolated branch", async (t) => {
  const root = repository(t);
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
