"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const { CLI, ROOT, runRaw, tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const { writePassingProductProof } = require("./helpers/product-proof");
const { persistOwnerGoalIngress, persistWorkSession, prepareWorkspace } = require("../lib/work-git");
const { createGoalWorkSession } = require("../lib/work-session");
const { compileProductProofSpec } = require("../lib/work-proof-compiler");
const { renderHuman } = require("../lib/commands/work");
const { protocolRoot } = require("../lib/world-authority");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");
const OWNER_GOAL_PROOF_COMPILER = path.join(ROOT, "tests", "fixtures", "owner-goal-proof-compiler.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function persistedSession(root) {
  const directory = path.join(root, ".git", "meta-harness", "work-sessions");
  const pointer = JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8"));
  return JSON.parse(fs.readFileSync(path.join(directory, pointer.sessionFile), "utf8"));
}

function repo(t, { withValidation = true, withOrigin = true, withProductProof = true, tempParent = null } = {}) {
  const fixtureParent = tempParent || (process.platform === "linux" && os.tmpdir().startsWith("/mnt/") ? "/tmp" : null);
  const parent = fixtureParent
    ? fs.mkdtempSync(path.join(fixtureParent, "cli-work-"))
    : tempDir("cli-work-");
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
  if (withProductProof) writePassingProductProof(root);
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

function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${filePath}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function runAsync(cwd, args, options = {}) {
  const selectedEnv = { ...(options.env || process.env), META_HARNESS_INTERNAL_CLI: "1" };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: selectedEnv,
    ...options,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return { child, result: new Promise((resolve) => child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))) };
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
  assert.equal(parsed.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(parsed.attempts, 2);
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.equal(parsed.productProof.state, "PROVEN");
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
  assert.equal(parsed.delivery.commit.status, "committed");
  assert.deepEqual(parsed.delivery.commit.paths, ["src/result.txt"]);
  assert.deepEqual(parsed.delivery.push, { status: "not_authorized" });
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(parsed.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("bare invocation continues a direct owner goal after proof compilation is interrupted", async (t) => {
  const root = repo(t, { withProductProof: false, withOrigin: false, tempParent: os.tmpdir() === "/mnt/c/Users/Lenovo/AppData/Local/Temp" ? "/tmp" : null });
  const marker = path.join(root, "proof-compiler-started.txt");
  const commandEnv = env({
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, OWNER_GOAL_PROOF_COMPILER]),
    META_HARNESS_PROOF_COMPILER_MARKER: marker,
  });
  const first = runAsync(root, ["Create the delivered result file."], { env: commandEnv });
  t.after(() => {
    if (first.child.exitCode === null) first.child.kill("SIGKILL");
  });
  await waitForFile(marker);
  first.child.kill("SIGINT");
  const interrupted = await first.result;
  assert.equal(interrupted.status, 0, interrupted.stderr || interrupted.stdout);
  assert.match(interrupted.stdout, /Stopped safely/u);
  assert.equal(fs.existsSync(path.join(protocolRoot(root), "owner-goal-ingress.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness", "work-sessions", "latest.json")), false);

  const resumed = runRaw(root, [], { env: commandEnv });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /Done —/u);
  assert.equal(fs.existsSync(path.join(protocolRoot(root), "owner-goal-ingress.json")), false);
  const latest = persistedSession(root);
  assert.equal(latest.productResult, "Create the delivered result file.");
});

test("pre-worker compiled proof can establish DONE without a pre-existing repository verifier", (t) => {
  const root = repo(t, { withProductProof: false });
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productProof.state, "PROVEN");
  assert.equal(parsed.productProof.claims[0].state, "PASSED");
  const session = persistedSession(root);
  assert.equal(session.productProofSpec.source.type, "COMPILED");
  assert.deepEqual(session.productProofSpec.calibration, [{ claimId: "delivered-result", expected: "FAIL", observed: "FAIL" }]);
  assert.deepEqual(session.productProofSpec.claims[0].covers, ["productResult", "newlyTrueBehavior", "doneWhen"]);
});

test("banked work with unresolved material product-proof claims is a truthful non-success", (t) => {
  const root = repo(t, { withProductProof: false });
  const result = runRaw(root, ["Create the delivered result file."], { env: env({ FAKE_PROOF_COMPILER_GAP: "1" }) });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /^Banked — repository validation passed, but material product-proof claims remain unresolved\.$/m);
  const latest = JSON.parse(fs.readFileSync(path.join(root, ".git", "meta-harness", "work-sessions", "latest.json"), "utf8"));
  assert.notEqual(git(latest.workspace.path, ["rev-parse", "HEAD"]), git(root, ["rev-parse", "HEAD"]));
  assert.equal(git(latest.workspace.path, ["status", "--short"]), "");
});

test("miscalibrated generated proof is downgraded to a visible GAP instead of authorizing DONE", (t) => {
  const root = repo(t, { withProductProof: false });
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env({ FAKE_PROOF_COMPILER_BAD_CALIBRATION: "1" }) });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "BANKED_UNPROVEN");
  assert.equal(parsed.productProof.state, "GAP");
  const session = persistedSession(root);
  assert.equal(session.productProofSpec.source.type, "COMPILED");
  assert.equal(session.productProofSpec.program, null);
  assert.equal(session.productProofSpec.claims[0].disposition, "UNVERIFIABLE");
  assert.match(session.productProofSpec.claims[0].reason, /calibration/i);
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
  assert.match(human.stdout, /^Blocked:/m);
  assert.doesNotMatch(human.stdout, /Workspace:|Commit:|Push:|session|work-session/i);
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
  assert.equal(delivered.workspace.state, "TERMINAL_COMMITTED");
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
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD"]), parsed.delivery.commit.sha);
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD^"]), remoteHead);
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

test("ghost journey accepts one result, shows coarse liveness, validates, and banks locally", (t) => {
  const root = repo(t);
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const result = runRaw(root, ["Create the delivered result file."], {
    env: env({ FAKE_WORKER_RETRY: "1" }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Working…$/m);
  assert.match(result.stdout, /^Validating…$/m);
  assert.match(result.stdout, /^Repairing validation…$/m);
  assert.match(result.stdout, /^Done — /m);
  assert.doesNotMatch(result.stdout, /Outcome:|Workspace:|Commit:|Push:|sessionDigest|workspaceId|sha256:/i);

  const latest = JSON.parse(fs.readFileSync(path.join(root, ".git", "meta-harness", "work-sessions", "latest.json"), "utf8"));
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.notEqual(git(latest.workspace.path, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(latest.workspace.path, ["status", "--short"]), "");
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);

  const after = runRaw(root, [], { env: env() });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, "No active slice.\nUse the product.\nWait for observed real-use friction.\n");
});

test("bare meta-harness resumes the exact active generation even when repo planning has since been enabled", (t) => {
  const root = repo(t);
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const productDirection = require("../lib/product-direction").pinProductDirection(root);
  const productProofSpec = compileProductProofSpec({
    repositoryPath: root,
    productDirection,
    base,
    productResult: "Create the delivered result file.",
    newlyTrueBehavior: "Create the delivered result file.",
    doneWhen: "The requested behavior works in the repository and relevant validation passes.",
    allowModel: false,
  });
  const session = createGoalWorkSession({
    goal: "Create the delivered result file.",
    repositoryPath: root,
    productDirection,
    base,
    allowedPaths: ["."],
    validation: [{
      argv: [process.execPath, "-e", "const fs=require('fs'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
    delivery: { commit: true, push: false },
    productProofSpec,
  });
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");

  const result = runRaw(root, [], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Working…$/m);
  assert.match(result.stdout, /^Done — /m);
  assert.doesNotMatch(result.stdout, /resume|session|workspace|generation|actor|custody/i);
  assert.equal(git(workspace.workspacePath, ["status", "--short"]), "");
  assert.notEqual(git(workspace.workspacePath, ["rev-parse", "HEAD"]), session.base.commit);
});

test("bare meta-harness stops cleanly when no active result exists", (t) => {
  const root = repo(t);
  const result = runRaw(root, [], { env: env() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "No active slice.\nUse the product.\nWait for observed real-use friction.\n");
});

test("private host projection preserves human result text without exposing lifecycle topology", (t) => {
  const root = repo(t);
  const result = runRaw(root, [], { env: env({ META_HARNESS_INTERNAL_HOST_RESULT: "1" }) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: "meta-host-result/v1",
    kind: "USE_PRODUCT",
    externalPacketDigests: [],
    text: "No active slice.\nUse the product.\nWait for observed real-use friction.",
  });
  assert.doesNotMatch(result.stdout, /workspaceId|sessionDigest|claimDigest|generation/u);
});

test("inspect JSON exposes only semantic entry action and retained owner-goal result", (t) => {
  const root = repo(t);
  const beforeMeta = fs.existsSync(path.join(root, ".git", "meta-harness"));
  const idle = runRaw(root, ["inspect", "--json"], { env: env() });
  assert.equal(idle.status, 0, idle.stderr || idle.stdout);
  assert.deepEqual(JSON.parse(idle.stdout), {
    schemaVersion: "meta-entry/v1",
    action: "IDLE",
    result: null,
  });
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), beforeMeta);

  persistOwnerGoalIngress(root, "Create the delivered result file.");
  const active = runRaw(root, ["inspect", "--json"], { env: env() });
  assert.equal(active.status, 0, active.stderr || active.stdout);
  assert.deepEqual(JSON.parse(active.stdout), {
    schemaVersion: "meta-entry/v1",
    action: "CONTINUE",
    result: "Create the delivered result file.",
  });
  assert.doesNotMatch(active.stdout, /workspace|session|claim|generation|sha256|OWNER_GOAL|REPO_WAVE/i);
});

test("planner-managed repository entry stays topology-blind to the host", (t) => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");
  const result = runRaw(root, ["inspect", "--json"], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: "meta-entry/v1",
    action: "CONTINUE",
    result: null,
  });
  assert.doesNotMatch(result.stdout, /planner|repo.wave|claim|workspace|session/i);
});

test("inspect is a coarse diagnostic surface without lifecycle identifiers", (t) => {
  const root = repo(t);
  const result = runRaw(root, ["inspect"], { env: env() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "State: idle\nNext: state a product result when something is worth changing.\n");
  assert.doesNotMatch(result.stdout, /workspace|session|generation|custody|sha256|uuid/i);
});

test("owner attention is proof-controlled rather than punctuation-controlled", () => {
  const render = (result) => {
    let output = "";
    renderHuman({ stdout: { write: (chunk) => { output += String(chunk); } } }, result);
    return output;
  };
  assert.equal(render({
    outcome: "BLOCKED",
    blocker: "Date semantics require owner taste.",
    nextAction: "Should exported dates use local time or UTC?",
  }), "Blocked: Date semantics require owner taste.\nNext: Should exported dates use local time or UTC?\n");
  assert.equal(render({
    outcome: "OWNER_REQUIRED",
    blocker: "A genuine product-taste decision remains.",
    nextAction: "Should exported dates use local time or UTC?",
    forwardMotionProofDigest: `sha256:${"a".repeat(64)}`,
  }), "Need you: Should exported dates use local time or UTC?\n");
  assert.equal(render({
    outcome: "BLOCKED",
    blocker: "GitHub authentication is required.",
    nextAction: "gh auth login",
  }), "Blocked: GitHub authentication is required.\nRun: gh auth login\n");
});

test("default help is one coding journey and diagnostic help hides internal commands", () => {
  const basic = runRaw(ROOT, ["--help"]);
  assert.equal(basic.status, 0, basic.stderr);
  assert.match(basic.stdout, /A coding system that carries one accepted product result/);
  assert.match(basic.stdout, /meta-harness "<result>"/);
  assert.match(basic.stdout, /mechanically correct active work/i);
  assert.doesNotMatch(basic.stdout, /meta-harness gate scope/);
  assert.doesNotMatch(basic.stdout, /meta-harness governance snapshot/);

  const advanced = runRaw(ROOT, ["help", "--advanced"]);
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.match(advanced.stdout, /meta-harness diagnostics/);
  assert.match(advanced.stdout, /meta-harness inspect/);
  assert.doesNotMatch(advanced.stdout, /meta-harness gate scope/);
  assert.doesNotMatch(advanced.stdout, /meta-harness governance snapshot/);
});
