"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const {
  assertWorkspaceCustodyExecutable,
  computeWorkspaceCustodyDigest,
} = require("../lib/workspace-custody");
const {
  acceptCandidate,
  captureWorkspaceBoundary,
  commonGitDirectory,
  createImmutableRunSnapshot,
  createImmutableSourceSnapshot,
  deliverValidatedChanges,
  inspectWorkspace,
  latestWorkSessionState,
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
  publishBankedChanges,
  publishBankedChangesJournaled,
  sealCandidate,
  worktreePlan,
} = require("../lib/work-git");
const { readRunJournal, runIdForSession } = require("../lib/run-journal");
const { sealWorkSession } = require("../lib/work-session");
const { publicRepositoryEntry, resolveRepositoryEntry } = require("../lib/repository-entry");
const { ensureRepositoryIdentity } = require("../lib/runtime-identity");
const { tempDir } = require("./helpers/cli");
const { directionFromContent } = require("./helpers/product-direction");
const { gapProofSpec } = require("./helpers/product-proof");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("../lib/semantic-authority");

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

test("workspace custody treats equivalent Windows and WSL paths as one identity without weakening other checks", () => {
  const body = {
    schemaVersion: "workspace-custody/v1",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    sessionDigest: `sha256:${"1".repeat(64)}`,
    repositoryRoot: "/mnt/e/code/meta-harness",
    workspacePath: "/mnt/e/code/meta-harness/.worktrees/meta-harness-11111111-1111-4111-8111-111111111111",
    baseHead: "a".repeat(40),
    branch: "work/test",
    gitWorktreeIdentityDigest: `sha256:${"2".repeat(64)}`,
    state: "ACTIVE",
    generation: 3,
    expectedDirtyManifestDigest: `sha256:${"3".repeat(64)}`,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:01.000Z",
    terminal: null,
  };
  const custody = { ...body, recordDigest: computeWorkspaceCustodyDigest(body) };
  const executable = assertWorkspaceCustodyExecutable({
    custody,
    sessionDigest: body.sessionDigest,
    repositoryRoot: "E:\\Code\\meta-harness",
    workspacePath: "E:\\Code\\meta-harness\\.worktrees\\meta-harness-11111111-1111-4111-8111-111111111111",
    branch: body.branch,
    baseHead: body.baseHead,
    generation: body.generation,
    dirtyManifestDigest: body.expectedDirtyManifestDigest,
  });
  assert.equal(executable.recordDigest, custody.recordDigest);

  assert.throws(
    () => assertWorkspaceCustodyExecutable({
      custody,
      sessionDigest: body.sessionDigest,
      repositoryRoot: "E:\\Code\\other-repository",
      workspacePath: "E:\\Code\\meta-harness\\.worktrees\\meta-harness-11111111-1111-4111-8111-111111111111",
      branch: body.branch,
      baseHead: body.baseHead,
      generation: body.generation,
      dirtyManifestDigest: body.expectedDirtyManifestDigest,
    }),
    (error) => error.code === "MH_WORKSPACE_CUSTODY_MISMATCH",
  );
  assert.throws(
    () => assertWorkspaceCustodyExecutable({
      custody,
      sessionDigest: body.sessionDigest,
      repositoryRoot: "E:\\Code\\meta-harness",
      workspacePath: "E:\\Code\\meta-harness\\.worktrees\\meta-harness-11111111-1111-4111-8111-111111111111",
      branch: body.branch,
      baseHead: body.baseHead,
      generation: body.generation + 1,
      dirtyManifestDigest: body.expectedDirtyManifestDigest,
    }),
    (error) => error.code === "MH_WORKSPACE_CUSTODY_MISMATCH",
  );
});

test("latest work-session recovery accepts retained WSL repository identity on Windows", { skip: process.platform !== "win32" }, (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const custodyPath = path.join(workspace.registryDir, `${workspace.workspaceId}.json`);
  const current = JSON.parse(fs.readFileSync(custodyPath, "utf8"));
  const toWsl = (value) => String(value).replace(/^([A-Za-z]):[\\/]/u, (_match, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/gu, "/");
  const terminalizedAt = "2026-09-05T00:00:02.000Z";
  const body = {
    ...current,
    repositoryRoot: toWsl(current.repositoryRoot),
    workspacePath: toWsl(current.workspacePath),
    state: "TERMINAL_BLOCKED",
    updatedAt: terminalizedAt,
    terminal: {
      terminalState: "TERMINAL_BLOCKED",
      resultDigest: `sha256:${"4".repeat(64)}`,
      validationDigest: `sha256:${"5".repeat(64)}`,
      finalDirtyManifestDigest: current.expectedDirtyManifestDigest,
      changedPathHashes: {},
      commitSha: null,
      terminalizedAt,
    },
  };
  delete body.recordDigest;
  const retained = { ...body, recordDigest: computeWorkspaceCustodyDigest(body) };
  fs.writeFileSync(custodyPath, `${JSON.stringify(retained, null, 2)}\n`, "utf8");

  const latest = latestWorkSessionState(root);
  assert.equal(latest.state, "TERMINAL");
  assert.equal(latest.custodyState, "TERMINAL_BLOCKED");
  const entry = resolveRepositoryEntry(root);
  assert.deepEqual(publicRepositoryEntry(entry), {
    schemaVersion: "meta-entry/v1",
    action: "CONTINUE",
    result: session.productResult,
  });
  assert.equal(entry.ingress.recovered, true);
});

test("immutable source snapshot captures only in-scope predecessor dirt without moving source HEAD, index, or working bytes", (t) => {
  const { root } = repository(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "round3.txt"), "round 3 predecessor\n", "utf8");
  fs.writeFileSync(path.join(root, "dirty.txt"), "unrelated owner dirt\n", "utf8");
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const sourceStatus = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const sourceIndex = git(root, ["diff", "--cached", "--binary"]);
  const unrelated = fs.readFileSync(path.join(root, "dirty.txt"), "utf8");

  const snapshot = createImmutableSourceSnapshot({ repositoryPath: root, allowedPaths: ["src"], env: {} });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.sourcePaths, ["src/round3.txt"]);
  assert.equal(snapshot.parentOid, sourceHead);
  assert.equal(git(root, ["show", `${snapshot.snapshotOid}:src/round3.txt`]), "round 3 predecessor");
  assert.equal(git(root, ["show", `${snapshot.snapshotOid}:dirty.txt`]), "baseline dirty");
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), sourceStatus);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), sourceIndex);
  assert.equal(fs.readFileSync(path.join(root, "dirty.txt"), "utf8"), unrelated);
});

test("content-addressed source snapshot ref cannot be rebound to different bytes", (t) => {
  const { root } = repository(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "round3.txt"), "round 3 predecessor\n", "utf8");
  const snapshot = createImmutableSourceSnapshot({ repositoryPath: root, allowedPaths: ["src"], env: {} });
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  assert.notEqual(snapshot.snapshotOid, sourceHead);
  git(root, ["update-ref", snapshot.ref, sourceHead]);

  assert.throws(
    () => createImmutableSourceSnapshot({ repositoryPath: root, allowedPaths: ["src"], env: {} }),
    (error) => error.code === "MH_SOURCE_SNAPSHOT_REF_CONFLICT",
  );
  assert.equal(git(root, ["rev-parse", snapshot.ref]), sourceHead);
});

test("immutable run snapshot captures working bytes without moving source or workspace HEAD", (t) => {
  const { root } = repository(t);
  const workSession = isolatedSession(root);
  const workspace = prepareWorkspace(root, workSession);
  const sourceHead = git(root, ["rev-parse", "HEAD"]);
  const sourceStatus = git(root, ["status", "--short"]);
  const workspaceHead = git(workspace.workspacePath, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "snapshotted mutation\n", "utf8");
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, workSession.allowedPaths);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: root,
    workspacePath: workspace.workspacePath,
    sessionDigest: workSession.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    treeOid: boundary.treeOid,
    parentOid: workSession.base.commit,
    env: {},
  });
  const repeated = createImmutableRunSnapshot({
    repositoryPath: root,
    workspacePath: workspace.workspacePath,
    sessionDigest: workSession.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    treeOid: boundary.treeOid,
    parentOid: workSession.base.commit,
    env: {},
  });

  assert.equal(repeated.snapshotOid, snapshot.snapshotOid);
  assert.equal(repeated.snapshotDigest, snapshot.snapshotDigest);
  assert.equal(git(root, ["rev-parse", snapshot.ref]), snapshot.snapshotOid);
  assert.equal(git(root, ["show", `${snapshot.snapshotOid}:accepted.txt`]), "snapshotted mutation");
  assert.equal(git(root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(root, ["status", "--short"]), sourceStatus);
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), workspaceHead);
  assert.match(git(workspace.workspacePath, ["status", "--short"]), /accepted\.txt/u);
  assert.match(snapshot.snapshotDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(snapshot.runtimeCapabilityDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(snapshot.repositoryId, ensureRepositoryIdentity(commonGitDirectory(root)).repositoryId);
});

test("content-addressed run snapshot ref cannot be rebound to a different commit", (t) => {
  const { root } = repository(t);
  const workSession = isolatedSession(root);
  const workspace = prepareWorkspace(root, workSession);
  fs.writeFileSync(path.join(workspace.workspacePath, "accepted.txt"), "snapshotted mutation\n", "utf8");
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, workSession.allowedPaths);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: root,
    workspacePath: workspace.workspacePath,
    sessionDigest: workSession.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    treeOid: boundary.treeOid,
    parentOid: workSession.base.commit,
    env: {},
  });
  git(root, ["update-ref", snapshot.ref, workSession.base.commit]);

  assert.throws(
    () => createImmutableRunSnapshot({
      repositoryPath: root,
      workspacePath: workspace.workspacePath,
      sessionDigest: workSession.sessionDigest,
      workspaceId: workspace.workspaceId,
      generation: workspace.generation,
      treeOid: boundary.treeOid,
      parentOid: workSession.base.commit,
      env: {},
    }),
    (error) => error.code === "MH_RUN_SNAPSHOT_REF_CONFLICT",
  );
  assert.equal(git(root, ["rev-parse", snapshot.ref]), workSession.base.commit);
});

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

function isolatedSession(
  root,
  base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
  delivery = { commit: false, push: false },
) {
  const productDirection = directionFromContent();
  const semanticAuthority = compileSemanticAuthority({ productDirection });
  const productResult = "Create the isolated result.";
  const newlyTrueBehavior = "A repository-local managed worktree is ready.";
  const doneWhen = "The physical path is repo-local and registered by Git.";
  return sealWorkSession({
    schemaVersion: "work-session/v8",
    productDirection,
    semanticState: semanticAuthority.semanticState,
    semanticProjection: semanticProjection(semanticAuthority),
    endgameProjection: endgameProjection(semanticAuthority),
    origin: { type: "OWNER_GOAL" },
    base,
    productResult,
    journeyState: "Owner dirtiness must remain untouched.",
    doNow: "Prepare the isolated workspace.",
    newlyTrueBehavior,
    doneWhen,
    productProofSpec: gapProofSpec({ productDirection, base, productResult, newlyTrueBehavior, doneWhen }),
    stopOnlyIf: ["Repository-local isolation cannot be established safely."],
    authorizedReversibleActions: ["Create a repository-local worktree.", "Inspect Git registration."],
    ownerOnlyActions: ["Delete legacy isolation residue."],
    allowedPaths: ["accepted.txt"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 1,
    delivery,
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
  const recoveredEntry = resolveRepositoryEntry(root);
  assert.deepEqual(publicRepositoryEntry(recoveredEntry), {
    schemaVersion: "meta-entry/v1",
    action: "CONTINUE",
    result: session.productResult,
  });
  assert.equal(recoveredEntry.kind, "OWNER_GOAL_INGRESS");
  assert.equal(recoveredEntry.ingress.recovered, true);
  assert.equal(recoveredEntry.ingress.sessionDigest, session.sessionDigest);

  const pointerPath = path.join(state.directory, "latest.json");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  pointer.workspace.path = path.join(parent, "substituted", path.basename(workspace.workspacePath));
  fs.writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => ["MH_WORK_RESUME", "MH_WORKSPACE_CUSTODY_MISMATCH", "MH_WORK_WORKTREE_ESCAPE"].includes(error.code),
  );
});

test("direct continuation derives from custody and immutable session truth, never latest.json", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  const pointerPath = path.join(state.directory, "latest.json");

  fs.rmSync(pointerPath);
  assert.equal(loadLatestWorkSession(root).sessionDigest, session.sessionDigest);

  fs.writeFileSync(pointerPath, "{ definitely-not-json\n", "utf8");
  assert.equal(loadLatestWorkSession(root).sessionDigest, session.sessionDigest);

  fs.writeFileSync(pointerPath, `${JSON.stringify({
    schemaVersion: "work-session-pointer/v1",
    sessionFile: "retired.json",
    workspacePath: "retired",
    mode: "current",
  }, null, 2)}\n`, "utf8");
  assert.equal(loadLatestWorkSession(root).sessionDigest, session.sessionDigest);
});

test("multiple ACTIVE direct custodories fail closed instead of guessing latest", (t) => {
  const { root } = repository(t);
  const first = isolatedSession(root);
  persistWorkSession(root, first, prepareWorkspace(root, first));

  fs.writeFileSync(path.join(root, "second-base.txt"), "second base\n", "utf8");
  git(root, ["add", "second-base.txt"]);
  git(root, ["commit", "-m", "second direct base"]);
  const second = isolatedSession(root);
  assert.notEqual(second.sessionDigest, first.sessionDigest);
  persistWorkSession(root, second, prepareWorkspace(root, second));

  assert.throws(
    () => latestWorkSessionState(root),
    (error) => error.code === "MH_WORK_RESUME_CONFLICT"
      && error.details?.workspaceIds?.length === 2,
  );
  const entry = resolveRepositoryEntry(root);
  assert.deepEqual(publicRepositoryEntry(entry), {
    schemaVersion: "meta-entry/v1",
    action: "IDLE",
    result: null,
  });
  assert.equal(entry.error?.code, "MH_WORK_RESUME_CONFLICT");
});

test("corrupt derived custody self-stabilizes to a fresh workspace without renegotiating the product", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root);
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const custodyPath = path.join(root, ".git", "meta-harness", "workspaces", `${workspace.workspaceId}.json`);
  fs.writeFileSync(custodyPath, "{ corrupt canonical custody\n", "utf8");

  const latest = latestWorkSessionState(root);
  assert.equal(latest.state, "ACTIVE");
  assert.equal(latest.session.sessionDigest, session.sessionDigest);
  const plan = worktreePlan(root, latest.session);
  assert.equal(plan.resumed, true);
  assert.notEqual(plan.workspaceId, workspace.workspaceId);
  assert.equal(plan.baseHead, session.base.commit);
  assert.equal(git(plan.workspacePath, ["status", "--short"]), "");

  const entry = resolveRepositoryEntry(root);
  assert.deepEqual(publicRepositoryEntry(entry), {
    schemaVersion: "meta-entry/v1",
    action: "CONTINUE",
    result: session.productResult,
  });
  assert.equal(entry.kind, "DIRECT_SESSION");
  assert.equal(entry.error, null);

  const again = latestWorkSessionState(root);
  assert.equal(again.state, "ACTIVE");
  assert.equal(again.session.sessionDigest, session.sessionDigest);
  assert.equal(worktreePlan(root, again.session).workspaceId, plan.workspaceId);
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

test("push intent survives a crash after remote success and replays the same observable effect identity", (t) => {
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
  const banked = deliverValidatedChanges({
    repositoryRoot: root,
    workspacePath: workspace.workspacePath,
    session,
    workspaceCustody: workspace.custody,
    candidateSeal: seal,
    candidateAcceptance: acceptedCandidate(session, seal),
    stateDirectory: state.directory,
    delivery: { commit: true, push: false },
    productResult: "Write the validated result.",
  });
  const gitDirectory = commonGitDirectory(root);
  const runId = runIdForSession(session.sessionDigest);

  assert.throws(
    () => publishBankedChangesJournaled({
      workspacePath: workspace.workspacePath,
      sessionDigest: session.sessionDigest,
      commit: banked.commit,
      push: true,
      publisher: (input) => {
        const result = publishBankedChanges(input);
        assert.equal(result.status, "remote_equal");
        assert.equal(remoteHead(root, workspace.branch), banked.commit.sha);
        throw new Error("simulated crash after remote success");
      },
    }),
    /simulated crash after remote success/u,
  );

  let events = readRunJournal({ gitCommonDirectory: gitDirectory, runId });
  const intended = events.filter((event) => event.type === "effect/intended");
  assert.equal(intended.length, 1);
  assert.equal(intended[0].data.kind, "GIT_PUSH");
  assert.equal(intended[0].data.replayClass, "OBSERVABLE");
  assert.equal(intended[0].data.commitSha, banked.commit.sha);
  assert.equal(intended[0].data.branch, workspace.branch);
  assert.equal(events.filter((event) => event.type === "effect/observed").length, 0);

  const replayed = publishBankedChangesJournaled({
    workspacePath: workspace.workspacePath,
    sessionDigest: session.sessionDigest,
    commit: banked.commit,
    push: true,
  });
  assert.equal(replayed.status, "remote_equal");
  assert.equal(remoteHead(root, workspace.branch), banked.commit.sha);

  events = readRunJournal({ gitCommonDirectory: gitDirectory, runId });
  assert.equal(events.filter((event) => event.type === "effect/intended").length, 1);
  const observed = events.filter((event) => event.type === "effect/observed");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].data.effectId, intended[0].data.effectId);
  assert.equal(observed[0].data.exactInputDigest, intended[0].data.exactInputDigest);
  assert.equal(observed[0].data.result.status, "remote_equal");
});

test("ACTIVE custody recovery publishes an exact BANK from durable intent before terminalization", (t) => {
  const { root } = repository(t);
  const session = isolatedSession(root, undefined, { commit: true, push: true });
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
  assert.equal(remoteHead(root, workspace.branch), banked.commit.sha);

  const events = readRunJournal({
    gitCommonDirectory: commonGitDirectory(root),
    runId: runIdForSession(session.sessionDigest),
  });
  const intended = events.findIndex((event) => event.type === "effect/intended" && event.data?.kind === "GIT_PUSH");
  const observed = events.findIndex((event) => event.type === "effect/observed");
  assert.ok(intended >= 0);
  assert.ok(observed > intended);
  assert.equal(events[intended].data.commitSha, banked.commit.sha);
  assert.equal(events[observed].data.effectId, events[intended].data.effectId);
  assert.equal(events[observed].data.result.status, "remote_equal");
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
