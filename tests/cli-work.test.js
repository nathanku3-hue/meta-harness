"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { CLI, ROOT, runRaw, tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const { persistOwnerGoalIngress, persistWorkSession, prepareWorkspace } = require("../lib/work-git");
const { readOwnerObjectiveState } = require("../lib/owner-objective-state");
const { createGoalWorkSession } = require("../lib/work-session");
const { hostKind, renderHuman } = require("../lib/commands/work");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");
const OPTIONAL_INTELLIGENCE_BLOCKER = path.join(ROOT, "tests", "fixtures", "block-optional-repo-intelligence.js");
const LEGACY_EXECUTION_PERMIT_BLOCKER = path.join(ROOT, "tests", "fixtures", "block-legacy-execution-permit.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repo(t, { withValidation = true, withOrigin = true, tempParent = null } = {}) {
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

function assertCompactHandoff(output) {
  const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length >= 1 && lines.length <= 4);
  assert.doesNotMatch(output, /^Status:|^Why:|^- Where:|^- Why now:|^- Lock:|^- Done when:|^- Why not other candidates:/mu);
  assert.doesNotMatch(output, /Outcome:|Worker accountability|On resume I detected|Validation \/ evidence|Decision needed:/iu);
}

function assertQuiescentHandoff(output) {
  assertCompactHandoff(output);
  assert.equal(output, "No current product gap.\n");
}

function assertDrainHandoff(output) {
  assertCompactHandoff(output);
  assert.equal(output, "Stopped safely — current product state is preserved.\n");
}

test("close on an untouched repository is a zero-side-effect detach before harness bootstrap", (t) => {
  const root = repo(t);
  const before = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness")), false);

  const result = runRaw(root, ["close"], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertDrainHandoff(result.stdout);
  assert.equal(fs.existsSync(path.join(root, ".meta-harness")), false);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), before);
});

test("primary work command executes in a fresh workspace and reports product fields before evidence", (t) => {
  const root = repo(t);
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env({ FAKE_WORKER_RETRY: "1" }) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productResult, "Create the delivered result file.");
  assert.equal(parsed.workspace.mode, "isolated");
  assert.equal(parsed.workspace.state, "TERMINAL_COMMITTED");
  assert.equal(parsed.attempts, 2);
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.equal(Object.hasOwn(parsed, "productProof"), false);
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
  assert.equal(parsed.delivery.commit.status, "committed");
  assert.deepEqual(parsed.delivery.commit.paths, ["src/result.txt"]);
  assert.deepEqual(parsed.delivery.push, { status: "not_requested" });
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.readFileSync(path.join(parsed.workspace.path, "src", "result.txt"), "utf8"), "delivered\n");
});

test("direct work completes with optional repo intelligence and legacy execution permits unavailable", (t) => {
  const root = repo(t);
  const result = runRaw(root, ["Create the delivered result file."], {
    env: env({
      NODE_OPTIONS: `--require=${OPTIONAL_INTELLIGENCE_BLOCKER} --require=${LEGACY_EXECUTION_PERMIT_BLOCKER}`,
    }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Done — /m);
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

test("unsupported validation route allows coding to produce a durable candidate before autonomous replan", (t) => {
  const root = repo(t, { withValidation: false });
  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 1, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "REPLAN_REQUIRED");
  assert.equal(parsed.workspace.mode, "isolated");
  assert.equal(parsed.attempts, 1);
  assert.deepEqual(parsed.changedPaths, ["src/result.txt"]);
  assert.equal(parsed.delivery.validation, "not_completed");
  assert.equal(parsed.delivery.commit.status, "not_attempted");
  assert.match(parsed.blocker, /durable candidate.*no deterministic validation command/iu);
  assert.equal(fs.existsSync(path.join(root, "src")), false);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), true);
  assert.equal(git(root, ["status", "--short"]), "");
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

test("dirty predecessor bytes become the immutable base of a fresh run without source mutation", (t) => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "round3.txt"), "round 3 predecessor\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "unrelated owner dirt\n", "utf8");
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const beforeStatus = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const beforeIndex = git(root, ["diff", "--cached", "--binary"]);

  const result = runRaw(ROOT, [
    "work", root,
    "--goal", "Create the delivered result file.",
    "--allow", "src",
    "--json",
  ], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.notEqual(parsed.workspace.baseHead, sourceHead);
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD^"]), parsed.workspace.baseHead);
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD^^"]), sourceHead);
  assert.equal(git(parsed.workspace.path, ["show", `${parsed.workspace.baseHead}:src/round3.txt`]), "round 3 predecessor");
  assert.equal(git(parsed.workspace.path, ["show", `${parsed.workspace.baseHead}:README.md`]), "baseline");
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), beforeStatus);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), beforeIndex);
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

  const managedWorktrees = fs.readdirSync(path.join(root, ".worktrees"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, ".worktrees", entry.name));
  assert.equal(managedWorktrees.length, 1);
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.notEqual(git(managedWorktrees[0], ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(managedWorktrees[0], ["status", "--short"]), "");
  assert.equal(fs.existsSync(path.join(root, "src", "result.txt")), false);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness", "work-sessions", "latest.json")), false);

  const after = runRaw(root, [], { env: env() });
  assert.equal(after.status, 0, after.stderr);
  assertQuiescentHandoff(after.stdout);
});

function activeSessionFixture(t) {
  const root = repo(t);
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const productDirection = require("../lib/product-direction").pinProductDirection(root);
  const session = createGoalWorkSession({
    goal: "Create the delivered result file.",
    repositoryPath: root,
    productDirection,
    base,
    allowedPaths: ["."],
    validation: [{
      argv: ["node", "-e", "const fs=require('fs'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
    delivery: { push: false },
  });
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");
  return { root, session, workspace };
}

for (const command of ["go:", "continue"]) {
  test(`${command} continues the active product result through disposable workspace recovery even when repo planning is enabled`, (t) => {
    const { root, session, workspace } = activeSessionFixture(t);
    const result = runRaw(root, [command], {
      env: env({ NODE_OPTIONS: `--require=${LEGACY_EXECUTION_PERMIT_BLOCKER}` }),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^Working…$/m);
    assert.match(result.stdout, /^Done — /m);
    assert.doesNotMatch(result.stdout, /resume|session|workspace|generation|actor|custody/i);

    const worktrees = fs.readdirSync(path.join(root, ".worktrees"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, ".worktrees", entry.name));
    const delivered = worktrees.filter((candidatePath) =>
      fs.existsSync(path.join(candidatePath, "src", "result.txt"))
        && fs.readFileSync(path.join(candidatePath, "src", "result.txt"), "utf8") === "delivered\n"
        && git(candidatePath, ["rev-parse", "HEAD"]) !== session.base.commit);
    assert.equal(delivered.length, 1);
    assert.equal(git(delivered[0], ["status", "--short"]), "");
    assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), session.base.commit);

    const after = runRaw(root, [], {
      env: env({ NODE_OPTIONS: `--require=${LEGACY_EXECUTION_PERMIT_BLOCKER}` }),
    });
    assert.equal(after.status, 0, after.stderr || after.stdout);
    assertQuiescentHandoff(after.stdout);
  });
}

test("close detaches without dispatch and the next bare invocation resumes the same result", (t) => {
  const { root, session, workspace } = activeSessionFixture(t);
  const closed = runRaw(root, ["close"], { env: env() });
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  assertDrainHandoff(closed.stdout);
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), session.base.commit);
  assert.equal(fs.existsSync(path.join(workspace.workspacePath, "src", "result.txt")), false);

  const resumed = runRaw(root, [], { env: env() });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /^Working…$/m);
  assert.match(resumed.stdout, /^Done — /m);
});

test("unexpected direct-workspace bytes are preserved while continuation self-heals in a fresh child", (t) => {
  const { root, session, workspace } = activeSessionFixture(t);
  const foreign = path.join(workspace.workspacePath, "foreign.tmp");
  fs.writeFileSync(foreign, "foreign live bytes\n", "utf8");

  const resumed = runRaw(root, ["go"], { env: env() });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /^Done — /m);
  assert.equal(fs.readFileSync(foreign, "utf8"), "foreign live bytes\n");
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), session.base.commit);

  const worktrees = fs.readdirSync(path.join(root, ".worktrees"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, ".worktrees", entry.name));
  const delivered = worktrees.filter((candidatePath) =>
    candidatePath !== workspace.workspacePath
      && fs.existsSync(path.join(candidatePath, "src", "result.txt"))
      && fs.readFileSync(path.join(candidatePath, "src", "result.txt"), "utf8") === "delivered\n");
  assert.equal(delivered.length, 1);

  const after = runRaw(root, [], { env: env() });
  assert.equal(after.status, 0, after.stderr || after.stdout);
  assertQuiescentHandoff(after.stdout);
});

test("go advances retained owner-goal ingress instead of becoming a replacement request", (t) => {
  const root = repo(t);
  persistOwnerGoalIngress(root, "Create the delivered result file.");

  const result = runRaw(root, ["go"], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Working…$/m);
  assert.match(result.stdout, /^Done — /m);
  assert.doesNotMatch(result.stdout, /Need you|different result|replace/iu);
});

test("bare meta-harness reports quiescent product observation when no result is active", (t) => {
  const root = repo(t);
  const result = runRaw(root, [], { env: env() });
  assert.equal(result.status, 0, result.stderr);
  assertQuiescentHandoff(result.stdout);
});

test("private host projection preserves human result text without exposing lifecycle topology", (t) => {
  const root = repo(t);
  const result = runRaw(root, [], { env: env({ META_HARNESS_INTERNAL_HOST_RESULT: "1" }) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schemaVersion, "meta-host-result/v2");
  assert.equal(parsed.kind, "USE_PRODUCT");
  assert.deepEqual(parsed.externalPacketDigests, []);
  assert.equal(parsed.handoff.status, "No product gap is currently observed.");
  assert.equal(parsed.handoff.presentation.kind, "TEXT");
  assert.equal(parsed.handoff.presentation.textMode, "QUIESCENT");
  assert.equal(parsed.presentation.schemaVersion, "human-presentation/v1");
  assert.equal(parsed.presentation.kind, "TEXT");
  assert.equal(parsed.presentation.text, parsed.text);
  assertQuiescentHandoff(parsed.text);
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

test("planner capability alone is idle and stays topology-blind to the host", (t) => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");
  const result = runRaw(root, ["inspect", "--json"], { env: env() });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: "meta-entry/v1",
    action: "IDLE",
    result: null,
  });
  assert.doesNotMatch(result.stdout, /planner|repo.wave|claim|workspace|session/i);
});

test("planner objective is temporary continuity and clears after a quiescent no-candidate pass", (t) => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");

  const result = runRaw(root, ["Deliver the next useful product change."], {
    env: env({ FAKE_PLANNER_CANDIDATES_JSON: "[]" }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertQuiescentHandoff(result.stdout);
  assert.equal(readOwnerObjectiveState(root, { optional: true }), null);

  const after = runRaw(root, ["inspect", "--json"], { env: env() });
  assert.equal(after.status, 0, after.stderr || after.stdout);
  assert.deepEqual(JSON.parse(after.stdout), {
    schemaVersion: "meta-entry/v1",
    action: "IDLE",
    result: null,
  });
});

test("inspect is a coarse diagnostic surface without lifecycle identifiers", (t) => {
  const root = repo(t);
  const result = runRaw(root, ["inspect"], { env: env() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "State: idle\nNext: state a product result when something is worth changing.\n");
  assert.doesNotMatch(result.stdout, /workspace|session|generation|custody|sha256|uuid/i);
});

test("owner attention requires a deterministic controller gate rather than punctuation or forward-motion proof", () => {
  const render = (result) => {
    let output = "";
    renderHuman({ stdout: { write: (chunk) => { output += String(chunk); } } }, result);
    return output;
  };
  const punctuationOnly = render({
    outcome: "BLOCKED",
    blocker: "Date semantics require owner taste.",
    nextAction: "Should exported dates use local time or UTC?",
  });
  assert.match(punctuationOnly, /Date semantics require owner taste\./u);
  assert.match(punctuationOnly, /Next — Should exported dates use local time or UTC\?/u);
  assert.doesNotMatch(punctuationOnly, /Need you:/u);

  const legacyProofOwner = render({
    outcome: "OWNER_REQUIRED",
    blocker: "A legacy forward-motion proof claimed product-taste authority.",
    nextAction: "Should exported dates use local time or UTC?",
    forwardMotionProofDigest: `sha256:${"a".repeat(64)}`,
  });
  assert.doesNotMatch(legacyProofOwner, /Need you:/u);
  assert.match(legacyProofOwner, /legacy forward-motion proof claimed product-taste authority/i);

  const command = render({
    outcome: "BLOCKED",
    blocker: "GitHub authentication is required.",
    nextAction: "gh auth login",
  });
  assert.match(command, /GitHub authentication is required\./u);
  assert.match(command, /^Next — gh auth login$/mu);
  assert.doesNotMatch(command, /Decision needed:/u);
});

test("normal work output projects product consequence instead of lifecycle labels", () => {
  const render = (result) => {
    let output = "";
    renderHuman({ stdout: { write: (chunk) => { output += String(chunk); } } }, result);
    return output;
  };
  const forbidden = /current repository truth|durable Claim authority|constitutional owner authority|REPLAN_REQUIRED|\bReplan:|hard blocked|repository planner|delegation gate/iu;

  const done = render({
    outcome: "DONE",
    observableResult: "The parser now accepts the bounded valid input shape",
    productResult: "Repair the parser.",
  });
  assert.match(done, /parser now accepts the bounded valid input shape/u);
  assert.doesNotMatch(done, forbidden);

  const ready = render({
    outcome: "READY",
    productResult: "Repair the parser.",
    nextAction: "Run the same command without --dry-run.",
  });
  assert.match(ready, /Nothing changed yet/u);
  assert.match(ready, /reversible execution path/u);
  assert.match(ready, /Run the same command without --dry-run\./u);
  assert.doesNotMatch(ready, /Ready —|workflow decision/iu);
  assert.doesNotMatch(ready, forbidden);

  for (const internalSchedulingNext of [
    "Decision needed: choose lane A or B.",
    "Choose a lane for the sibling handoff.",
    "Select lane B after the producer finishes.",
  ]) {
    const projected = render({
      outcome: "READY",
      productResult: "Close the requested product gap.",
      nextAction: internalSchedulingNext,
    });
    assert.doesNotMatch(projected, /Decision needed|choose lane|choose a lane|select lane|sibling handoff/iu);
  }

  const exhausted = render({
    outcome: "REPLAN_REQUIRED",
    blocker: "All currently available implementation means failed.",
    nextAction: "Replan the Outcome autonomously from the durable forward-motion evidence.",
  });
  assert.match(exhausted, /All currently available implementation means failed\./u);
  assert.doesNotMatch(exhausted, /Replan the Outcome|durable forward-motion/u);
  assert.doesNotMatch(exhausted, forbidden);
});

test("repo-wave egress uses product meaning and host owner attention agrees with Need you", () => {
  const render = (result) => {
    let output = "";
    renderHuman({ stdout: { write: (chunk) => { output += String(chunk); } } }, result);
    return output;
  };
  const result = {
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "PARTIAL",
    delegationGate: {
      kind: "FORWARD_GATE",
      statement: "Retained delegation is exhausted; the repository planner owns any fresh work.",
      ownerRequest: null,
    },
    outcomes: [
      { state: "LANDED", desiredState: "The parser accepts the bounded valid input shape." },
      { state: "RUNNING_ELSEWHERE", desiredState: "The cache repair reaches validation." },
      { state: "BLOCKED", desiredState: "The package is published." },
      { state: "REPLAN_REQUIRED", desiredState: "The migration is generated." },
    ],
  };
  const output = render(result);
  for (const text of [
    "The parser accepts the bounded valid input shape.",
    "The cache repair reaches validation.",
    "The package is published.",
    "The migration is generated.",
  ]) assert.match(output, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(output, /current repository truth|Claim authority|constitutional owner authority|REPLAN_REQUIRED|\bReplan:|hard blocked|repository planner|delegation/iu);

  const ownerResult = {
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "REPLAN_REQUIRED",
    delegationGate: {
      kind: "OWNER_DECISION",
      statement: "Legacy surfaced evidence only.",
      ownerRequest: { question: "This legacy gate must not control owner attention." },
    },
    ownerEffect: {
      kind: "MATERIAL_PRODUCT_CHOICE",
      question: "Use UTC or local time?",
    },
    outcomes: [],
  };
  const ownerOutput = render(ownerResult);
  assert.equal(ownerOutput, [
    "Need input — Use UTC or local time?",
    "Why — This choice changes product behavior.",
    "Then — The same work continues.",
    "",
  ].join("\n"));
  assertCompactHandoff(ownerOutput);
  assert.equal(hostKind(ownerResult, []), "OWNER_REQUIRED");
  assert.equal(hostKind(ownerResult, [`sha256:${"b".repeat(64)}`]), "EXTERNAL_OPEN");

  const outcomeOwnerResult = {
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "PARTIAL",
    delegationGate: null,
    outcomes: [{
      state: "OWNER_REQUIRED",
      desiredState: "The export date convention is selected.",
      ownerRequest: { question: "Use UTC or local time?" },
    }],
  };
  assert.doesNotMatch(render(outcomeOwnerResult), /Need you:/u);
  assert.equal(hostKind(outcomeOwnerResult, []), "WORKING");

  const legacyGateOnly = {
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "OWNER_REQUIRED",
    delegationGate: {
      kind: "OWNER_DECISION",
      statement: "Legacy surfaced evidence only.",
      ownerRequest: { question: "Should this legacy gate interrupt the owner?" },
    },
    outcomes: [],
  };
  assert.doesNotMatch(render(legacyGateOnly), /Need you:/u);
  assert.equal(hostKind(legacyGateOnly, []), "WORKING");
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
