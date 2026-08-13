"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  deliverValidatedChanges,
  hashAcceptedPaths,
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
  worktreePlan,
} = require("../lib/work-git");
const { sealWorkSession } = require("../lib/work-session");
const { tempDir } = require("./helpers/cli");
const { directionFromContent } = require("./helpers/product-direction");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const parent = tempDir("work-git-");
  const root = path.join(parent, "repository");
  const origin = path.join(parent, "origin.git");
  fs.mkdirSync(root);
  git(parent, ["init", "--bare", origin]);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Work Git Test"]);
  git(root, ["config", "user.email", "work-git@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "accepted.txt"), "baseline accepted\n", "utf8");
  fs.writeFileSync(path.join(root, "staged.txt"), "baseline staged\n", "utf8");
  fs.writeFileSync(path.join(root, "dirty.txt"), "baseline dirty\n", "utf8");
  const { writeProductMd } = require("./helpers/product-direction");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-u", "origin", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, origin, branch };
}

function remoteHead(root, branch) {
  const output = git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  return output.split(/\s+/)[0];
}

function isolatedSession() {
  return sealWorkSession({
    schemaVersion: "work-session/v3",
    productDirection: directionFromContent(),
    origin: { type: "OWNER_GOAL" },
    productResult: "Create the isolated result.",
    journeyState: "Owner dirtiness must remain untouched.",
    doNow: "Prepare the isolated workspace.",
    newlyTrueBehavior: "A repository-local managed worktree is ready.",
    doneWhen: "The physical path is repo-local and registered by Git.",
    stopOnlyIf: ["Repository-local isolation cannot be established safely."],
    authorizedReversibleActions: ["Create a repository-local worktree.", "Inspect Git registration."],
    ownerOnlyActions: ["Delete legacy isolation residue."],
    allowedPaths: ["accepted.txt"],
    validation: [],
    maxAttempts: 1,
    delivery: { commit: false, push: false },
  });
}

test("isolated creator stays inside the repository and does not contaminate the parent", (t) => {
  const { parent, root } = repository(t);
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  const beforeParentEntries = fs.readdirSync(parent).sort();
  const session = isolatedSession();
  const plan = worktreePlan(root, session);
  assert.equal(plan.mode, "isolated");
  assert.equal(plan.legacyIsolationRoot, null);
  assert.match(path.basename(plan.workspacePath), /^meta-harness-[0-9a-f-]{36}$/u);

  const workspace = prepareWorkspace(root, session, plan);
  assert.equal(workspace.created, true);
  assert.equal(workspace.workspacePath, fs.realpathSync.native(plan.workspacePath));
  assert.equal(workspace.custody.state, "ACTIVE");
  assert.equal(workspace.custody.generation, 1);
  assert.equal(workspace.custody.workspaceId, workspace.workspaceId);
  assert.equal(fs.existsSync(path.join(parent, ".meta-harness-worktrees")), false);
  assert.deepEqual(fs.readdirSync(parent).sort(), beforeParentEntries);
  const listed = git(root, ["worktree", "list", "--porcelain"]).replace(/\\/g, "/");
  const expectedListed = plan.workspacePath.replace(/\\/g, "/");
  assert.match(listed, new RegExp(`worktree ${expectedListed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(git(root, ["status", "--short"]), /\.worktrees/u);
});

test("isolation refuses an unignored or linked repository-local worktree root", (t) => {
  const unignored = repository(t).root;
  fs.writeFileSync(path.join(unignored, ".gitignore"), "node_modules/\n", "utf8");
  fs.writeFileSync(path.join(unignored, "dirty.txt"), "owner dirtiness\n", "utf8");
  assert.throws(
    () => worktreePlan(unignored, isolatedSession()),
    (error) => error.code === "MH_WORK_WORKTREE_IGNORE",
  );
  assert.equal(fs.existsSync(path.join(unignored, ".worktrees")), false);

  const { parent, root } = repository(t);
  const outside = path.join(parent, "outside-worktrees");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, ".worktrees"), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  assert.throws(
    () => worktreePlan(root, isolatedSession()),
    (error) => ["MH_WORK_WORKTREE_IGNORE", "MH_WORK_WORKTREE_ROOT", "MH_WORK_WORKTREE_ESCAPE"].includes(error.code),
  );
});

test("resume binds repository, persisted workspace record, session identity, and Git registration", (t) => {
  const { parent, root } = repository(t);
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  const session = isolatedSession();
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  const legacyRoot = path.join(parent, ".meta-harness-worktrees");
  fs.mkdirSync(legacyRoot);

  const resumed = loadLatestWorkSession(root);
  const resumedPlan = worktreePlan(root, resumed);
  assert.equal(resumed.sessionDigest, session.sessionDigest);
  assert.equal(resumedPlan.workspacePath, workspace.workspacePath);
  assert.equal(resumedPlan.wouldCreate, false);
  assert.equal(resumedPlan.legacyIsolationRoot, legacyRoot);

  git(root, ["worktree", "remove", workspace.workspacePath]);
  fs.mkdirSync(workspace.workspacePath);
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => ["MH_WORK_RESUME", "MH_WORKSPACE_CUSTODY_MISMATCH", "MH_WORK_WORKTREE_MISSING"].includes(error.code),
  );

  const pointerPath = path.join(state.directory, "latest.json");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  pointer.workspace.path = path.join(parent, "substituted", path.basename(workspace.workspacePath));
  fs.writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => ["MH_WORK_RESUME", "MH_WORKSPACE_CUSTODY_MISMATCH", "MH_WORK_WORKTREE_ESCAPE"].includes(error.code),
  );
});

test("resume never adopts an unexpected dirty manifest even when the change is in-scope", (t) => {
  const { root } = repository(t);
  const session = isolatedSession();
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);

  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "unexpected in-scope mutation\n", "utf8");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_WORKSPACE_CUSTODY_MISMATCH",
  );
});

test("removing and recreating the same physical worktree path cannot inherit the old workspace identity", (t) => {
  const { root } = repository(t);
  const session = isolatedSession();
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const originalPath = workspace.workspacePath;
  const originalBranch = workspace.branch;
  const originalHead = workspace.baseHead;

  git(root, ["worktree", "remove", originalPath]);
  git(root, ["worktree", "add", originalPath, originalBranch]);
  assert.equal(git(originalPath, ["rev-parse", "HEAD"]), originalHead);
  assert.equal(git(originalPath, ["branch", "--show-current"]), originalBranch);
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => ["MH_WORK_WORKTREE_IDENTITY", "MH_WORKSPACE_CUSTODY_MISMATCH"].includes(error.code),
  );
});

test("delivery does not commit or push without exact authority", (t) => {
  const { root, branch } = repository(t);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "accepted.txt"), "validated result\n", "utf8");
  const acceptedPathHashes = hashAcceptedPaths(root, ["accepted.txt"]);

  const refused = deliverValidatedChanges({
    workspacePath: root,
    acceptedPathHashes,
    delivery: { commit: false, push: false },
    productResult: "Write the validated result.",
  });
  assert.deepEqual(refused.commit, { status: "not_authorized" });
  assert.deepEqual(refused.push, { status: "not_authorized" });
  assert.equal(git(root, ["rev-parse", "HEAD"]), baseline);
  assert.equal(remoteHead(root, branch), baseline);

  const committed = deliverValidatedChanges({
    workspacePath: root,
    acceptedPathHashes,
    delivery: { commit: true, push: false },
    productResult: "Write the validated result.",
  });
  assert.equal(committed.commit.status, "committed");
  assert.equal(committed.push.status, "not_authorized");
  assert.notEqual(committed.commit.sha, baseline);
  assert.equal(git(root, ["rev-parse", "HEAD"]), committed.commit.sha);
  assert.equal(remoteHead(root, branch), baseline);
});

test("mutation after accepted-path hashing blocks delivery", (t) => {
  const { root } = repository(t);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "accepted.txt"), "validated result\n", "utf8");
  const acceptedPathHashes = hashAcceptedPaths(root, ["accepted.txt"]);
  fs.writeFileSync(path.join(root, "accepted.txt"), "mutated after validation\n", "utf8");

  assert.throws(
    () => deliverValidatedChanges({
      workspacePath: root,
      acceptedPathHashes,
      delivery: { commit: true, push: false },
      productResult: "Write the validated result.",
    }),
    (error) => error.code === "MH_WORK_DELIVERY_MUTATION",
  );
  assert.equal(git(root, ["rev-parse", "HEAD"]), baseline);
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
});

test("delivery commits only accepted paths, preserves unrelated dirtiness, and verifies pushed HEAD", (t) => {
  const { root, branch } = repository(t);
  fs.writeFileSync(path.join(root, "staged.txt"), "owner staged change\n", "utf8");
  git(root, ["add", "staged.txt"]);
  const stagedBefore = git(root, ["diff", "--cached", "--binary", "--", "staged.txt"]);
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirty change\n", "utf8");
  fs.writeFileSync(path.join(root, "accepted.txt"), "validated result\n", "utf8");
  const acceptedPathHashes = hashAcceptedPaths(root, ["accepted.txt"]);

  const delivered = deliverValidatedChanges({
    workspacePath: root,
    acceptedPathHashes,
    delivery: { commit: true, push: true },
    productResult: "Write the validated result.",
  });

  assert.equal(delivered.validation, "passed");
  assert.equal(delivered.commit.status, "committed");
  assert.deepEqual(delivered.commit.paths, ["accepted.txt"]);
  assert.equal(delivered.push.status, "remote_equal");
  assert.equal(delivered.push.sha, delivered.commit.sha);
  assert.equal(remoteHead(root, branch), delivered.commit.sha);
  assert.equal(git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]), "accepted.txt");
  assert.equal(git(root, ["diff", "--cached", "--binary", "--", "staged.txt"]), stagedBefore);
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "staged.txt");
  assert.equal(git(root, ["diff", "--name-only"]), "dirty.txt");
  assert.equal(fs.readFileSync(path.join(root, "dirty.txt"), "utf8"), "owner dirty change\n");
});
