"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { attemptEntriesRoot } = require("../lib/world-authority");
const { loadLatestWorkSession } = require("../lib/work-git");
const { runWork } = require("../lib/work-loop");
const { sealWorkSession } = require("../lib/work-session");
const { ROOT, tempDir } = require("./helpers/cli");
const { directionFromContent } = require("./helpers/product-direction");

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
  const { writeProductMd } = require("./helpers/product-direction");
  writeProductMd(root);
  git(root, ["add", ".gitignore", "README.md", "PRODUCT.md"]);
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

function session(root, {
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
    schemaVersion: "work-session/v4",
    productDirection: directionFromContent(),
    origin: { type: "OWNER_GOAL" },
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    productResult: "Create the delivered result file.",
    journeyState: "The coding task is accepted.",
    doNow: "Create src/result.txt.",
    newlyTrueBehavior: "src/result.txt contains delivered.",
    doneWhen: "The exact file exists and validation passes.",
    stopOnlyIf: ["The allowed path is insufficient."],
    authorizedReversibleActions: ["Edit src.", "Run validation."],
    ownerOnlyActions: ["Publish the repository."],
    allowedPaths,
    validation: resolvedValidation,
    maxAttempts,
    delivery,
  });
}

function workerEnv(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_TEST_MODE: "1",
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

function workerResult(changes, status = "done") {
  return {
    result: {
      status,
      observableResult: "Prepared the requested result.",
      changes,
      validation: [],
      blocker: "",
      nextAction: "Use the result.",
    },
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
    session: session(root, { validation: [] }),
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
    session: session(root, { validation: [] }),
    dryRun: true,
    runner,
  });
  assert.equal(dry.outcome, "BLOCKED");
  assert.equal(workerCalls, 0);
});

test("durable AttemptEntry exists before worker execution", async (t) => {
  const root = repository(t);
  const workSession = session(root);
  let runnerCalls = 0;
  await assert.rejects(
    runWork({
      repositoryPath: root,
      session: workSession,
      runner: async ({ executionPermit }) => {
        runnerCalls += 1;
        const entryPath = path.join(attemptEntriesRoot(root), "owner", executionPermit.authority.workspaceId, "1.json");
        assert.equal(fs.existsSync(entryPath), true);
        const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
        assert.equal(entry.permitDigest, executionPermit.permitDigest);
        throw new Error("worker exploded after attempt entry");
      },
    }),
    /worker exploded after attempt entry/,
  );
  assert.equal(runnerCalls, 1);
});

test("work loop carries a product brief into a fresh isolated generation and exact validation", async (t) => {
  const root = repository(t);
  const result = await runWork({ repositoryPath: root, session: session(root), env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "isolated");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.validation.length, 1);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.equal(result.delivery.commit.status, "committed");
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.deepEqual(result.delivery.push, { status: "not_authorized" });
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
});

test("validated work commits and pushes only the terminal worktree branch with sealed authority", async (t) => {
  const root = repository(t);
  const sourceBranch = addOrigin(root);
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { delivery: { commit: true, push: true } }),
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.delivery.validation, "passed");
  assert.equal(result.delivery.commit.status, "committed");
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.equal(result.delivery.push.status, "remote_equal");
  assert.equal(result.delivery.push.branch, result.workspace.branch);
  assert.equal(git(root, ["branch", "--show-current"]), sourceBranch);
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(result.workspace.path, ["rev-parse", "HEAD"]), result.delivery.commit.sha);
  assert.equal(
    git(root, ["ls-remote", "--heads", "origin", `refs/heads/${result.workspace.branch}`]).split(/\s+/)[0],
    result.delivery.commit.sha,
  );
  assert.equal(git(result.workspace.path, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]), "src/result.txt");
  assert.equal(git(root, ["status", "--short"]), "");
});

test("worker-marked partial work is terminal and never delivered", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { delivery: { commit: true, push: false } }),
    env: workerEnv({ FAKE_WORKER_STATUS: "partial" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "PARTIAL");
  assert.equal(result.workspace.state, "TERMINAL_BLOCKED_DIRTY");
  assert.deepEqual(result.delivery.commit, { status: "not_attempted" });
  assert.deepEqual(result.delivery.push, { status: "not_attempted" });
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("passed controller validation advances generation before bounded completion", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { maxAttempts: 2 }),
    env: workerEnv({ FAKE_WORKER_PARTIAL_FIRST: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.executionPermits.map((permit) => permit.generation), [1, 2]);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("unrelated source dirtiness is preserved while every new session uses a fresh worktree", async (t) => {
  const root = repository(t);
  const parent = path.dirname(root);
  const parentEntries = fs.readdirSync(parent).sort();
  fs.writeFileSync(path.join(root, "README.md"), "owner dirtiness\n", "utf8");
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { allowedPaths: ["src"] }),
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "isolated");
  assert.equal(result.workspace.created, true);
  assert.match(result.workspace.branch, /^work\/create-the-delivered-result-file-/);
  assert.equal(path.dirname(path.dirname(result.workspace.path)), root);
  assert.match(path.basename(result.workspace.path), /^meta-harness-[0-9a-f-]{36}$/u);
  assert.equal(fs.existsSync(path.join(parent, ".meta-harness-worktrees")), false);
  assert.deepEqual(fs.readdirSync(parent).sort(), parentEntries);
  assert.match(git(root, ["worktree", "list", "--porcelain"]), /\.worktrees[\\/]meta-harness-/u);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "owner dirtiness\n");
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("new session never inherits coherent in-scope dirtiness from the source checkout", async (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "result.txt"), "unfinished\n", "utf8");
  const result = await runWork({ repositoryPath: root, session: session(root), env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.mode, "isolated");
  assert.equal(fs.readFileSync(path.join(root, "src", "result.txt"), "utf8"), "unfinished\n");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("clean terminal committed workspace cannot resume and cleanliness cannot resurrect authority", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { delivery: { commit: true, push: false } }),
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_WORKSPACE_NOT_EXECUTABLE",
  );
  git(result.workspace.path, ["reset", "--hard", "HEAD"]);
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_WORKSPACE_NOT_EXECUTABLE",
  );
});

test("legacy commit=false cannot disable automatic local banking", async (t) => {
  const root = repository(t);
  const workSession = session(root, { delivery: { commit: false, push: false } });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.delivery.commit.status, "committed");
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
  assert.notEqual(git(result.workspace.path, ["rev-parse", "HEAD"]), workSession.base.commit);
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_WORKSPACE_NOT_EXECUTABLE",
  );
});

test("candidate identity uses actual Git delta when a previously materialized path is restored", async (t) => {
  const root = repository(t);
  const workSession = session(root, { allowedPaths: ["README.md", "src"], maxAttempts: 2 });
  const runner = async ({ attempt }) => attempt === 1
    ? workerResult([{ path: "README.md", content: "temporary change\n" }])
    : workerResult([
      { path: "README.md", content: "baseline\n" },
      { path: "src/result.txt", content: "delivered\n" },
    ]);

  const result = await runWork({ repositoryPath: root, session: workSession, runner, timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.equal(git(result.workspace.path, ["diff", "--name-only", "--no-renames", workSession.base.commit, "HEAD"]), "src/result.txt");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "README.md"), "utf8"), "baseline\n");
});

test("validation that mutates accepted content invalidates the sealed Git candidate", async (t) => {
  const root = repository(t);
  const workSession = session(root, {
    validation: [{
      argv: [process.execPath, "-e", "require('fs').writeFileSync('src/result.txt','validator-mutated\\n')"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  await assert.rejects(
    runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 }),
    (error) => error.code === "MH_WORK_VALIDATION_MUTATION",
  );
});

test("validation that creates extra nonignored Git dirt invalidates the sealed candidate", async (t) => {
  const root = repository(t);
  const workSession = session(root, {
    validation: [{
      argv: [process.execPath, "-e", "require('fs').writeFileSync('src/generated.txt','generated\\n')"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  await assert.rejects(
    runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 }),
    (error) => error.code === "MH_WORK_VALIDATION_MUTATION",
  );
});

test("validation may create ignored artifacts without changing the bankable Git candidate", async (t) => {
  const root = repository(t);
  fs.appendFileSync(path.join(root, ".gitignore"), ".cache/\n", "utf8");
  git(root, ["add", ".gitignore"]);
  git(root, ["commit", "-m", "ignore validation cache"]);
  const workSession = session(root, {
    validation: [{
      argv: [
        process.execPath,
        "-e",
        "const fs=require('fs'); fs.mkdirSync('.cache',{recursive:true}); fs.writeFileSync('.cache/result','cache'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)",
      ],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, ".cache", "result"), "utf8"), "cache");
});

test("validation that changes Git file-mode representation invalidates the sealed candidate", async (t) => {
  const root = repository(t);
  if (git(root, ["config", "--bool", "core.filemode"]) !== "true") {
    t.skip("Git file-mode tracking is disabled on this filesystem");
    return;
  }
  const workSession = session(root, {
    validation: [{
      argv: [process.execPath, "-e", "require('fs').chmodSync('src/result.txt',0o755)"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  await assert.rejects(
    runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 }),
    (error) => error.code === "MH_WORK_VALIDATION_MUTATION",
  );
});

test("a no-change validated candidate closes without manufacturing an empty commit", async (t) => {
  const root = repository(t);
  const workSession = session(root, {
    allowedPaths: ["README.md"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async () => workerResult([{ path: "README.md", content: "baseline\n" }]),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.delivery.commit.status, "no_changes");
  assert.deepEqual(result.delivery.commit.paths, []);
  assert.deepEqual(result.changedPaths, []);
  assert.equal(git(result.workspace.path, ["rev-parse", "HEAD"]), workSession.base.commit);
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
});

test("publication failure does not downgrade a successfully banked local result", async (t) => {
  const root = repository(t);
  const workSession = session(root, { delivery: { commit: true, push: true } });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.delivery.commit.status, "committed");
  assert.equal(result.delivery.push.status, "failed");
  assert.equal(git(result.workspace.path, ["status", "--short"]), "");
  assert.notEqual(git(result.workspace.path, ["rev-parse", "HEAD"]), workSession.base.commit);
});

test("failed validation is returned to a fresh single-use permit for bounded repair", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { maxAttempts: 2 }),
    env: workerEnv({ FAKE_WORKER_RETRY: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.executionPermits.map((permit) => permit.generation), [1, 2]);
  assert.equal(new Set(result.executionPermits.map((permit) => permit.permitId)).size, 2);
  assert.ok(result.executionPermits.every((permit) => permit.state === "ENTERED"));
  assert.ok(result.executionPermits.every((permit) => /^sha256:[a-f0-9]{64}$/u.test(permit.attemptEntryDigest)));
});

test("direct worker writes invalidate the attempt generation before controller materialization", async (t) => {
  const root = repository(t);
  await assert.rejects(
    runWork({
      repositoryPath: root,
      session: session(root),
      env: workerEnv({ FAKE_WORKER_DIRECT_WRITE: "1" }),
      timeoutSeconds: 30,
    }),
    (error) => error.code === "MH_EXECUTION_PERMIT_STALE",
  );
});

test("live product-direction drift after permit consumption blocks before materialization", async (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, "README.md"), "unrelated owner dirtiness\n", "utf8");
  const runner = async ({ executionPermit }) => {
    assert.equal(executionPermit.state, "ISSUED");
    const productPath = path.join(root, "PRODUCT.md");
    const original = fs.readFileSync(productPath, "utf8");
    fs.writeFileSync(productPath, original.replace("product-direction-v1", "product-direction-v2"), "utf8");
    return {
      result: {
        status: "done",
        observableResult: "Prepared an in-scope change.",
        changes: [{ path: "src/result.txt", content: "delivered\n" }],
        validation: [],
        blocker: "",
        nextAction: "Use the result.",
      },
    };
  };

  await assert.rejects(
    runWork({ repositoryPath: root, session: session(root), runner }),
    (error) => error.code === "MH_PRODUCT_DIRECTION_DRIFT",
  );
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
});

test("worker path and Git-index escapes fail closed", async (t) => {
  const outsideRoot = repository(t);
  await assert.rejects(
    runWork({
      repositoryPath: outsideRoot,
      session: session(outsideRoot),
      env: workerEnv({ FAKE_WORKER_PATH: "outside.txt" }),
      timeoutSeconds: 30,
    }),
    (error) => error.code === "MH_WORK_BOUNDARY_PATH",
  );

  const stagedRoot = repository(t);
  await assert.rejects(
    runWork({
      repositoryPath: stagedRoot,
      session: session(stagedRoot),
      env: workerEnv({ FAKE_WORKER_STAGE: "1" }),
      timeoutSeconds: 30,
    }),
    (error) => error.code === "MH_WORK_BOUNDARY_INDEX",
  );
});
