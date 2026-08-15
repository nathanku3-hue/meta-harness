"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const {
  acceptCandidate,
  deliverValidatedChanges,
  inspectWorkspace,
  latestWorkSessionState,
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
  publishBankedChanges,
  sealCandidate,
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

function acceptedCandidate(session, seal) {
  const body = {
    schemaVersion: "candidate-verification/v1",
    isolation: "linux-user-mount-net-pid-chroot/v1",
    candidateTreeOid: seal.candidateTreeOid,
    commands: session.validation.map((command) => ({
      argv: command.argv,
      cwd: command.cwd,
      passed: true,
      exitCode: 0,
      durationMs: 1,
      output: "",
    })),
  };
  return acceptCandidate({
    session,
    candidateSeal: seal,
    verification: {
      ...body,
      verificationDigest: domainDigest("meta-harness-candidate-verification/v1", body),
    },
  });
}

function isolatedSession(root, base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) }) {
  return sealWorkSession({
    schemaVersion: "work-session/v5",
    productDirection: directionFromContent(),
    origin: { type: "OWNER_GOAL" },
    base,
    productResult: "Create the isolated result.",
    journeyState: "Owner dirtiness must remain untouched.",
    doNow: "Prepare the isolated workspace.",
    newlyTrueBehavior: "A repository-local managed worktree is ready.",
    doneWhen: "The physical path is repo-local and registered by Git.",
    stopOnlyIf: ["Repository-local isolation cannot be established safely."],
    authorizedReversibleActions: ["Create a repository-local worktree.", "Inspect Git registration."],
    ownerOnlyActions: ["Delete legacy isolation residue."],
    allowedPaths: ["accepted.txt"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 1,
    delivery: { commit: false, push: false },
  });
}

test("isolated creator stays inside the repository and does not contaminate the parent", (t) => {
  const { parent, root } = repository(t);
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  const beforeParentEntries = fs.readdirSync(parent).sort();
  const session = isolatedSession(root);
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
    () => worktreePlan(unignored, isolatedSession(unignored)),
    (error) => error.code === "MH_WORK_WORKTREE_IGNORE",
  );
  assert.equal(fs.existsSync(path.join(unignored, ".worktrees")), false);

  const { parent, root } = repository(t);
  const outside = path.join(parent, "outside-worktrees");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, ".worktrees"), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  assert.throws(
    () => worktreePlan(root, isolatedSession(root)),
    (error) => ["MH_WORK_WORKTREE_IGNORE", "MH_WORK_WORKTREE_ROOT", "MH_WORK_WORKTREE_ESCAPE"].includes(error.code),
  );
});

test("resume binds repository, persisted workspace record, session identity, and Git registration", (t) => {
  const { parent, root } = repository(t);
  fs.writeFileSync(path.join(root, "dirty.txt"), "owner dirtiness\n", "utf8");
  const session = isolatedSession(root);
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

test("resume keeps its sealed base when origin and the source branch advance", (t) => {
  const { root, branch } = repository(t);
  const baseHead = git(root, ["rev-parse", "HEAD"]);
  const session = isolatedSession(root, {
    type: "REMOTE_REF",
    remote: "origin",
    ref: `refs/heads/${branch}`,
    commit: baseHead,
  });
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);

  fs.writeFileSync(path.join(root, "upstream.txt"), "advanced after session creation\n", "utf8");
  git(root, ["add", "upstream.txt"]);
  git(root, ["commit", "-m", "advance source and origin"]);
  git(root, ["push", "origin", "HEAD"]);
  const advancedHead = git(root, ["rev-parse", "HEAD"]);
  assert.notEqual(advancedHead, baseHead);
  assert.equal(remoteHead(root, branch), advancedHead);

  const resumed = loadLatestWorkSession(root);
  assert.equal(resumed.base.commit, baseHead);
  const plan = worktreePlan(root, resumed);
  assert.equal(plan.resumed, true);
  assert.equal(plan.baseHead, baseHead);
  assert.equal(git(plan.workspacePath, ["rev-parse", "HEAD"]), baseHead);
});

test("resume never adopts an unexpected dirty manifest even when the change is in-scope", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
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
  const session = isolatedSession(root);
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

test("BANK never writes through the source checkout even when legacy commit=false", (t) => {
  const { root, branch } = repository(t);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "accepted.txt"), "validated result\n", "utf8");
  const session = isolatedSession(root);

  assert.throws(
    () => deliverValidatedChanges({
      repositoryRoot: root,
      workspacePath: root,
      session,
      workspaceCustody: {},
      candidateSeal: null,
      stateDirectory: path.join(root, ".git", "meta-harness", "work-sessions"),
      delivery: { commit: false, push: false },
      productResult: "Write the validated result.",
    }),
    (error) => ["MH_WORK_DELIVERY_WORKSPACE", "MH_WORKSPACE_CUSTODY_SHAPE"].includes(error.code),
  );
  assert.equal(git(root, ["rev-parse", "HEAD"]), baseline);
  assert.equal(remoteHead(root, branch), baseline);
});

test("mutation after the durable Git candidate seal blocks BANK", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  const seal = sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });
  const candidateAcceptance = acceptedCandidate(session, seal);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "mutated after seal\n", "utf8");

  assert.throws(
    () => deliverValidatedChanges({
      repositoryRoot: root,
      workspacePath: workspace.workspacePath,
      session,
      workspaceCustody: workspace.custody,
      candidateSeal: seal,
      candidateAcceptance,
      stateDirectory: state.directory,
      delivery: { commit: true, push: false },
      productResult: "Write the validated result.",
    }),
    (error) => error.code === "MH_WORK_BANK_MUTATION",
  );
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), workspace.baseHead);
  assert.equal(git(workspace.workspacePath, ["diff", "--cached", "--name-only"]), "");
});

test("BANK rejects missing or tampered controller acceptance before touching Git", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  const seal = sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });
  const accepted = acceptedCandidate(session, seal);
  const beforeIndex = git(workspace.workspacePath, ["diff", "--cached", "--binary"]);

  for (const candidateAcceptance of [
    undefined,
    { ...accepted, verificationDigest: `sha256:${"0".repeat(64)}` },
  ]) {
    assert.throws(
      () => deliverValidatedChanges({
        repositoryRoot: root,
        workspacePath: workspace.workspacePath,
        session,
        workspaceCustody: workspace.custody,
        candidateSeal: seal,
        candidateAcceptance,
        stateDirectory: state.directory,
        delivery: { commit: true, push: false },
        productResult: "Write the validated result.",
      }),
      (error) => error.code === "MH_WORK_ACCEPTANCE",
    );
    assert.equal(git(workspace.workspacePath, ["diff", "--cached", "--binary"]), beforeIndex);
    assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), workspace.baseHead);
  }
});

test("foreign managed-worktree dirt after sealing blocks BANK without cleanup", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  const seal = sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });
  const candidateAcceptance = acceptedCandidate(session, seal);
  fs.writeFileSync(path.join(workspace.workspacePath, "staged.txt"), "foreign staged change\n", "utf8");
  git(workspace.workspacePath, ["add", "staged.txt"]);
  const stagedBefore = git(workspace.workspacePath, ["diff", "--cached", "--binary", "--", "staged.txt"]);

  assert.throws(
    () => deliverValidatedChanges({
      repositoryRoot: root,
      workspacePath: workspace.workspacePath,
      session,
      workspaceCustody: workspace.custody,
      candidateSeal: seal,
      candidateAcceptance,
      stateDirectory: state.directory,
      delivery: { commit: true, push: false },
      productResult: "Write the validated result.",
    }),
    (error) => error.code === "MH_WORK_BANK_MUTATION",
  );
  assert.equal(git(workspace.workspacePath, ["diff", "--cached", "--binary", "--", "staged.txt"]), stagedBefore);
  assert.equal(fs.readFileSync(path.join(workspace.workspacePath, "staged.txt"), "utf8"), "foreign staged change\n");
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), workspace.baseHead);
});

test("BANK commits the exact sealed Git tree and PUBLISH is a later operation", (t) => {
  const { root, branch: sourceBranch } = repository(t);
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  const seal = sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });
  const candidateAcceptance = acceptedCandidate(session, seal);

  const banked = deliverValidatedChanges({
    repositoryRoot: root,
    workspacePath: workspace.workspacePath,
    session,
    workspaceCustody: workspace.custody,
    candidateSeal: seal,
    candidateAcceptance,
    stateDirectory: state.directory,
    delivery: { commit: false, push: true },
    productResult: "Write the validated result.",
  });
  assert.equal(banked.validation, "passed");
  assert.equal(banked.commit.status, "committed");
  assert.deepEqual(banked.commit.paths, ["accepted.txt"]);
  assert.deepEqual(banked.push, { status: "not_attempted" });
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD^{tree}"]), seal.candidateTreeOid);
  assert.equal(git(workspace.workspacePath, ["diff", "--name-only", "--no-renames", workspace.baseHead, "HEAD"]), "accepted.txt");
  assert.equal(git(workspace.workspacePath, ["status", "--short"]), "");
  assert.equal(git(workspace.workspacePath, ["diff", "--cached", "--name-only"]), "");

  const published = publishBankedChanges({ workspacePath: workspace.workspacePath, commit: banked.commit, push: true });
  assert.equal(published.status, "remote_equal");
  assert.equal(remoteHead(root, workspace.branch), banked.commit.sha);
  assert.equal(remoteHead(root, sourceBranch), sourceHead);
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
});

test("ACTIVE custody deterministically recovers an exact BANK completed before terminalization", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  const seal = sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });
  const candidateAcceptance = acceptedCandidate(session, seal);
  const banked = deliverValidatedChanges({
    repositoryRoot: root,
    workspacePath: workspace.workspacePath,
    session,
    workspaceCustody: workspace.custody,
    candidateSeal: seal,
    candidateAcceptance,
    stateDirectory: state.directory,
    delivery: { commit: true, push: false },
    productResult: "Write the validated result.",
  });
  assert.equal(banked.commit.status, "committed");

  const recovered = latestWorkSessionState(root);
  assert.equal(recovered.state, "TERMINAL");
  assert.equal(recovered.custodyState, "TERMINAL_COMMITTED");
  assert.equal(git(workspace.workspacePath, ["status", "--short"]), "");
});

test("HEAD movement without an exact candidate-seal proof recovers as blocked, never committed", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "validated result\n", "utf8");
  const inspected = inspectWorkspace(workspace.workspacePath, session.allowedPaths);
  sealCandidate({
    stateDirectory: state.directory,
    session,
    workspace,
    boundary: { head: inspected.head, inspected },
    materializedPaths: ["accepted.txt"],
  });

  fs.writeFileSync(path.join(workspace.workspacePath, "dirty.txt"), "foreign committed change\n", "utf8");
  git(workspace.workspacePath, ["add", "accepted.txt", "dirty.txt"]);
  git(workspace.workspacePath, ["commit", "-m", "foreign commit"]);
  const movedHead = git(workspace.workspacePath, ["rev-parse", "HEAD"]);
  assert.notEqual(movedHead, workspace.baseHead);
  assert.equal(git(workspace.workspacePath, ["status", "--short"]), "");

  const recovered = latestWorkSessionState(root);
  assert.equal(recovered.state, "TERMINAL");
  assert.equal(recovered.custodyState, "TERMINAL_BLOCKED");
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), movedHead);
});
