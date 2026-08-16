"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { attemptEntriesRoot } = require("../lib/world-authority");
const { loadLatestWorkSession, persistWorkSession, prepareWorkspace } = require("../lib/work-git");
const { runWork } = require("../lib/work-loop");
const { sealWorkSession } = require("../lib/work-session");
const { ROOT, tempDir } = require("./helpers/cli");
const { directionFromContent } = require("./helpers/product-direction");
const { writePassingProductProof } = require("./helpers/product-proof");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t, { withProductProof = true } = {}) {
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
  if (withProductProof) writePassingProductProof(root);
  git(root, ["add", "."]);
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
    schemaVersion: "work-session/v5",
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

function workerResult(operations, status = "done") {
  return {
    result: {
      status,
      observableResult: "Prepared the requested result.",
      operations,
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
  assert.equal(result.verification.schemaVersion, "candidate-verification/v1");
  assert.equal(result.verification.isolation, "linux-user-mount-net-pid-chroot/v1");
  assert.match(result.verification.verificationDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.productProof.schemaVersion, "product-proof/v1");
  assert.equal(result.productProof.state, "PROVEN");
  assert.match(result.productProof.productProofDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.acceptance.schemaVersion, "candidate-acceptance/v1");
  assert.equal(result.acceptance.verificationDigest, result.verification.verificationDigest);
  assert.match(result.acceptance.acceptanceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.metrics.schemaVersion, "work-metrics/v1");
  assert.equal(result.metrics.continuation, "NEW");
  assert.equal(result.metrics.repairAttempts, 0);
  assert.equal(result.metrics.attempts.length, 1);
  assert.equal(result.metrics.attempts[0].operationCount, 1);
  assert.deepEqual(result.metrics.attempts[0].operationTypes, { WRITE: 1, DELETE: 0, MOVE: 0 });
  assert.ok(result.metrics.firstProposalMs >= 0);
  assert.ok(result.metrics.verifierMs >= result.metrics.validationCommandMs);
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

test("worker-marked partial cannot veto controller acceptance", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { delivery: { commit: true, push: false } }),
    env: workerEnv({ FAKE_WORKER_STATUS: "partial" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.delivery.commit.status, "committed");
  assert.deepEqual(result.delivery.push, { status: "not_authorized" });
  assert.equal(git(root, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("passed controller validation completes without a worker-status repair round", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, { maxAttempts: 2 }),
    env: workerEnv({ FAKE_WORKER_PARTIAL_FIRST: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.executionPermits.map((permit) => permit.generation), [1]);
  assert.equal(result.validation[0].passed, true);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("work metrics distinguish mechanical RESUME from NEW without owner input", async (t) => {
  const root = repository(t);
  const workSession = session(root);
  const prepared = prepareWorkspace(root, workSession);
  persistWorkSession(root, workSession, prepared);
  const resumedSession = loadLatestWorkSession(root);

  const result = await runWork({
    repositoryPath: root,
    session: resumedSession,
    env: workerEnv(),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.workspace.workspaceId, prepared.workspaceId);
  assert.equal(result.metrics.continuation, "RESUME");
  assert.equal(result.metrics.repairAttempts, 0);
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
    ? workerResult([{ type: "WRITE", path: "README.md", content: "temporary change\n" }])
    : workerResult([
      { type: "WRITE", path: "README.md", content: "baseline\n" },
      { type: "WRITE", path: "src/result.txt", content: "delivered\n" },
    ]);

  const result = await runWork({ repositoryPath: root, session: workSession, runner, timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.deepEqual(result.delivery.commit.paths, ["src/result.txt"]);
  assert.equal(git(result.workspace.path, ["diff", "--name-only", "--no-renames", workSession.base.commit, "HEAD"]), "src/result.txt");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "README.md"), "utf8"), "baseline\n");
});

test("v5 transaction banks DELETE and MOVE through the same sealed candidate", async (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "old.txt"), "move-me\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "delete.txt"), "delete-me\n", "utf8");
  git(root, ["add", "src"]);
  git(root, ["commit", "-m", "typed mutation fixture"]);
  const workSession = session(root, {
    validation: [{
      argv: [
        process.execPath,
        "-e",
        "const fs=require('fs'); if(fs.existsSync('src/old.txt')||fs.existsSync('src/delete.txt')||fs.readFileSync('src/new.txt','utf8')!=='move-me\\n') process.exit(19)",
      ],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async () => workerResult([
      { type: "MOVE", from: "src/old.txt", to: "src/new.txt" },
      { type: "DELETE", path: "src/delete.txt" },
    ]),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.deepEqual(result.changedPaths, ["src/delete.txt", "src/new.txt", "src/old.txt"]);
  assert.equal(fs.existsSync(path.join(result.workspace.path, "src", "old.txt")), false);
  assert.equal(fs.existsSync(path.join(result.workspace.path, "src", "delete.txt")), false);
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "new.txt"), "utf8"), "move-me\n");
});

test("candidate validation receives a scrubbed disposable environment", async (t) => {
  const root = repository(t);
  const workSession = session(root, {
    validation: [{
      argv: [
        process.execPath,
        "-e",
        "if(process.env.META_HARNESS_TEST_MODE||process.env.META_HARNESS_WORKER_COMMAND_JSON) process.exit(9); if(process.env.HOME!=='/home'||process.env.TMP!=='/tmp') process.exit(8)",
      ],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.validation[0].passed, true);
});

test("candidate verifier mounts only source dependency directories read-only", async (t) => {
  const root = repository(t);
  const dependencyRoot = path.join(root, "node_modules", "local-dep");
  fs.mkdirSync(dependencyRoot, { recursive: true });
  fs.writeFileSync(path.join(dependencyRoot, "index.js"), "module.exports = 'isolated-dependency';\n", "utf8");
  fs.writeFileSync(path.join(dependencyRoot, "package.json"), "{\"name\":\"local-dep\",\"main\":\"index.js\"}\n", "utf8");
  const workSession = session(root, {
    validation: [{
      argv: [process.execPath, "-e", "if(require('local-dep')!=='isolated-dependency') process.exit(17)"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
  });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.validation[0].passed, true);
  assert.equal(fs.existsSync(path.join(result.workspace.path, "node_modules")), false);
  assert.equal(fs.readFileSync(path.join(dependencyRoot, "index.js"), "utf8"), "module.exports = 'isolated-dependency';\n");
});

test("candidate verifier permits loopback-only test servers without an external route", async (t) => {
  const root = repository(t);
  const probe = [
    "const http=require('node:http');",
    "const timer=setTimeout(()=>process.exit(23),3000);",
    "const server=http.createServer((req,res)=>res.end('ok'));",
    "server.listen(0,'127.0.0.1',()=>{",
    "http.get({host:'127.0.0.1',port:server.address().port,path:'/'},res=>{",
    "let body=''; res.on('data',chunk=>body+=chunk); res.on('end',()=>{clearTimeout(timer); server.close(()=>process.exit(body==='ok'?0:24));});",
    "}).on('error',()=>process.exit(25));",
    "});",
  ].join("");
  const workSession = session(root, {
    validation: [{ argv: [process.execPath, "-e", probe], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.validation[0].passed, true);
});

test("candidate verifier cannot address host files, host network routes, or retained namespace capabilities", async (t) => {
  const root = repository(t);
  const hostSentinel = path.join(path.dirname(root), "host-secret.txt");
  fs.writeFileSync(hostSentinel, "must-not-be-readable\n", "utf8");
  const probe = [
    "const fs=require('node:fs');",
    `if(fs.existsSync(${JSON.stringify(hostSentinel)})) process.exit(11);`,
    "const caps=/^CapEff:\\s*([0-9a-f]+)$/mi.exec(fs.readFileSync('/proc/self/status','utf8'))?.[1];",
    "if(!caps||!/^[0]+$/.test(caps)) process.exit(12);",
    "const routes=fs.readFileSync('/proc/net/route','utf8').trim().split(/\\r?\\n/).filter(Boolean);",
    "if(routes.length>1) process.exit(13);",
  ].join("");
  const workSession = session(root, {
    validation: [{ argv: [process.execPath, "-e", probe], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({ repositoryPath: root, session: workSession, env: workerEnv(), timeoutSeconds: 30 });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.validation[0].passed, true);
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
  assert.equal(fs.existsSync(path.join(result.workspace.path, ".cache", "result")), false);
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

test("failed product proof enters the existing bounded repair loop", async (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.js"), [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const target = path.join(process.env.META_HARNESS_CANDIDATE_ROOT, "src", "result.txt");',
    'if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== "delivered\\n") { console.error("product result is not delivered"); process.exit(61); }',
    "",
  ].join("\n"), "utf8");
  git(root, ["add", ".meta-harness/product-proof.js"]);
  git(root, ["commit", "-m", "discriminating product proof fixture"]);
  const workSession = session(root, {
    maxAttempts: 2,
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async ({ attempt }) => workerResult([{ type: "WRITE", path: "src/result.txt", content: attempt === 1 ? "wrong\n" : "delivered\n" }]),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.equal(result.metrics.repairAttempts, 1);
  assert.equal(result.productProof.state, "PROVEN");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("candidate replacement of the apparent proof program cannot replace base-owned proof authority", async (t) => {
  const root = repository(t);
  fs.mkdirSync(path.join(root, "proof"));
  fs.writeFileSync(path.join(root, "proof", "product-proof.js"), [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const target = path.join(process.env.META_HARNESS_CANDIDATE_ROOT, "src", "result.txt");',
    'if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== "delivered\\n") { console.error("trusted base proof rejected candidate"); process.exit(71); }',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v1",
    programPath: "proof/product-proof.js",
    runtime: process.execPath,
    timeoutSeconds: 30,
  }, null, 2)}\n`, "utf8");
  git(root, ["add", ".meta-harness/product-proof.json", "proof/product-proof.js"]);
  git(root, ["commit", "-m", "movable proof program fixture"]);
  const trustedProgramOid = git(root, ["rev-parse", "HEAD:proof/product-proof.js"]);
  const workSession = session(root, {
    allowedPaths: ["."],
    maxAttempts: 1,
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async () => workerResult([
      { type: "WRITE", path: "src/result.txt", content: "wrong\n" },
      { type: "WRITE", path: "proof/product-proof.js", content: "process.exit(0);\n" },
    ]),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "PARTIAL");
  assert.equal(result.productProof.state, "FAILED");
  assert.equal(result.productProof.program.blobOid, trustedProgramOid);
  assert.equal(result.acceptance, null);
  assert.equal(result.delivery.commit.status, "not_attempted");
  assert.equal(fs.readFileSync(path.join(result.workspace.path, "proof", "product-proof.js"), "utf8"), "process.exit(0);\n");
});

test("trivial green validation without product proof banks honestly without claiming DONE", async (t) => {
  const root = repository(t, { withProductProof: false });
  const workSession = session(root, {
    allowedPaths: ["README.md"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
  });
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async () => workerResult([{ type: "WRITE", path: "README.md", content: "baseline\n" }]),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "BANKED_UNPROVEN");
  assert.equal(result.productProof.state, "UNAVAILABLE");
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
  assert.equal(result.metrics.repairAttempts, 1);
  assert.equal(result.metrics.attempts.length, 2);
  assert.ok(result.metrics.attempts.every((item) => item.operationCount === 1));
  assert.ok(result.metrics.workerMs >= result.metrics.firstProposalMs);
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
        operations: [{ type: "WRITE", path: "src/result.txt", content: "delivered\n" }],
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
