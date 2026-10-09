"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const { appendRunEvent, runIdForExecution } = require("../lib/run-journal");
const {
  captureWorkspaceBoundary,
  commonGitDirectory,
  createImmutableRunSnapshot,
  createImmutableSourceSnapshot,
  createReplacementWorkspaceFromJournal,
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
  runWorkSessionState,
} = require("../lib/work-git");
const {
  readWorkspaceCustody,
  terminalizeWorkspaceCustody,
} = require("../lib/workspace-custody");
const { pinProductDirection } = require("../lib/product-direction");
const { createGoalWorkSession } = require("../lib/work-session");
const {
  git,
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id = "a") {
  const value = proposal(id);
  return {
    id: value.id,
    productResult: value.productResult,
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: value.allowedPaths,
  };
}

function materializedRun(t, id = "a") {
  const { root } = repository(t);
  persistInitial(root);
  const prepared = preparePlannerCandidate(root, null, candidate(id));
  const materialized = materializePreparedPlannerRun(root, null, prepared);
  return { root, ...materialized };
}

test("immutable source snapshot captures in-scope dirt without moving source HEAD, index, or bytes", (t) => {
  const fixture = materializedRun(t);
  const target = path.join(fixture.root, "src", "a", "baseline.txt");
  fs.writeFileSync(target, "owner dirt\n", "utf8");
  const beforeHead = git(fixture.root, ["rev-parse", "HEAD"]);
  const beforeStatus = git(fixture.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const snapshot = createImmutableSourceSnapshot({
    repositoryPath: fixture.root,
    allowedPaths: ["src/a"],
    env: {},
  });
  assert.ok(snapshot?.snapshotOid);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), beforeHead);
  assert.equal(git(fixture.root, ["status", "--porcelain=v1", "--untracked-files=all"]), beforeStatus);
  assert.equal(fs.readFileSync(target, "utf8"), "owner dirt\n");
  assert.equal(git(fixture.root, ["show", `${snapshot.snapshotOid}:src/a/baseline.txt`]), "owner dirt");
});

test("fresh execution workspace starts from sealed immutable base and cannot contaminate source checkout", (t) => {
  const fixture = materializedRun(t);
  const sourceHead = git(fixture.root, ["rev-parse", "HEAD"]);
  const workspace = prepareWorkspace(fixture.root, fixture.session);
  assert.equal(workspace.baseHead, fixture.session.base.commit);
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), fixture.session.base.commit);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(path.dirname(workspace.workspacePath), path.join(fixture.root, ".worktrees"));
});

test("failed fresh workspace custody setup reclaims only its own clean worktree", (t) => {
  const fixture = materializedRun(t);
  const originalHead = git(fixture.root, ["rev-parse", "HEAD"]);
  const originalIndex = git(fixture.root, ["ls-files", "-s"]);
  const registry = path.join(commonGitDirectory(fixture.root), "meta-harness", "workspaces");
  assert.equal(fs.existsSync(registry), false);
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.writeFileSync(registry, "not a directory", "utf8");

  assert.throws(() => prepareWorkspace(fixture.root, fixture.session));
  const managed = path.join(fixture.root, ".worktrees");
  assert.deepEqual(fs.readdirSync(managed).filter((name) => name.startsWith("meta-harness-")), []);
  assert.equal(git(fixture.root, ["worktree", "list", "--porcelain"]).includes("meta-harness-"), false);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), originalHead);
  assert.equal(git(fixture.root, ["ls-files", "-s"]), originalIndex);
});

test("immutable run snapshot records candidate bytes without moving workspace or source HEAD", (t) => {
  const fixture = materializedRun(t);
  const workspace = prepareWorkspace(fixture.root, fixture.session);
  const target = path.join(workspace.workspacePath, "src", "a", "result.txt");
  fs.writeFileSync(target, "checkpointed\n", "utf8");
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, fixture.session.allowedPaths);
  const workspaceHead = git(workspace.workspacePath, ["rev-parse", "HEAD"]);
  const sourceHead = git(fixture.root, ["rev-parse", "HEAD"]);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: fixture.root,
    workspacePath: workspace.workspacePath,
    sessionDigest: fixture.session.sessionDigest,
    workspaceId: workspace.workspaceId,
    generation: 1,
    treeOid: boundary.treeOid,
    parentOid: fixture.session.base.commit,
    env: {},
  });
  assert.equal(git(workspace.workspacePath, ["rev-parse", "HEAD"]), workspaceHead);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(fixture.root, ["show", `${snapshot.snapshotOid}:src/a/result.txt`]), "checkpointed");
});

test("missing execution child is reconstructed from journaled Git snapshot under a fresh workspace identity", (t) => {
  const fixture = materializedRun(t);
  const workspaceA = prepareWorkspace(fixture.root, fixture.session);
  persistWorkSession(fixture.root, fixture.session, workspaceA);
  fs.writeFileSync(path.join(workspaceA.workspacePath, "src", "a", "result.txt"), "checkpointed\n", "utf8");
  const boundary = captureWorkspaceBoundary(workspaceA.workspacePath, fixture.session.allowedPaths);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: fixture.root,
    workspacePath: workspaceA.workspacePath,
    sessionDigest: fixture.session.sessionDigest,
    workspaceId: workspaceA.workspaceId,
    generation: 1,
    treeOid: boundary.treeOid,
    parentOid: fixture.session.base.commit,
    env: {},
  });
  appendRunEvent({
    gitCommonDirectory: commonGitDirectory(fixture.root),
    runId: runIdForExecution(fixture.session.sessionDigest, workspaceA.workspaceId),
    type: "mutation/result",
    data: {
      sessionDigest: fixture.session.sessionDigest,
      workspaceId: workspaceA.workspaceId,
      generation: 1,
      source: "test",
      materializedPaths: ["src/a/result.txt"],
      snapshotOid: snapshot.snapshotOid,
      snapshotDigest: snapshot.snapshotDigest,
      treeOid: snapshot.treeOid,
    },
  });

  fs.rmSync(workspaceA.workspacePath, { recursive: true, force: true });
  const workspaceB = createReplacementWorkspaceFromJournal(
    fixture.root,
    fixture.session,
    workspaceA.workspaceId,
    "test-recovery",
  );
  assert.notEqual(workspaceB.workspaceId, workspaceA.workspaceId);
  assert.equal(
    fs.readFileSync(path.join(workspaceB.workspacePath, "src", "a", "result.txt"), "utf8").replace(/\r\n/gu, "\n"),
    "checkpointed\n",
  );
});

test("direct active workspace drift is replaced from durable snapshot without overwriting foreign bytes", (t) => {
  const { root } = repository(t);
  const session = createGoalWorkSession({
    goal: "Deliver direct result.",
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths: ["src/a"],
    validation: [{ argv: ["node", "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    delivery: { push: false },
  });
  const workspaceA = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspaceA);
  const targetA = path.join(workspaceA.workspacePath, "src", "a", "result.txt");
  fs.writeFileSync(targetA, "checkpointed\n", "utf8");
  const boundary = captureWorkspaceBoundary(workspaceA.workspacePath, session.allowedPaths);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: root,
    workspacePath: workspaceA.workspacePath,
    sessionDigest: session.sessionDigest,
    workspaceId: workspaceA.workspaceId,
    generation: 1,
    treeOid: boundary.treeOid,
    parentOid: session.base.commit,
    env: {},
  });
  appendRunEvent({
    gitCommonDirectory: commonGitDirectory(root),
    runId: runIdForExecution(session.sessionDigest, workspaceA.workspaceId),
    type: "mutation/result",
    data: {
      sessionDigest: session.sessionDigest,
      workspaceId: workspaceA.workspaceId,
      generation: 1,
      source: "test",
      materializedPaths: ["src/a/result.txt"],
      snapshotOid: snapshot.snapshotOid,
      snapshotDigest: snapshot.snapshotDigest,
      treeOid: snapshot.treeOid,
    },
  });

  fs.writeFileSync(targetA, "foreign editor drift\n", "utf8");
  const resumed = loadLatestWorkSession(root);
  assert.equal(resumed.sessionDigest, session.sessionDigest);
  const workspaceB = prepareWorkspace(root, resumed);
  assert.notEqual(workspaceB.workspaceId, workspaceA.workspaceId);
  assert.equal(fs.readFileSync(targetA, "utf8"), "foreign editor drift\n");
  assert.equal(
    fs.readFileSync(path.join(workspaceB.workspacePath, "src", "a", "result.txt"), "utf8").replace(/\r\n/gu, "\n"),
    "checkpointed\n",
  );
});

test("terminal abandoned workspace is replaceable from run state rather than becoming product authority", (t) => {
  const fixture = materializedRun(t);
  const workspace = prepareWorkspace(fixture.root, fixture.session);
  persistWorkSession(fixture.root, fixture.session, workspace);
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, fixture.session.allowedPaths);
  const custody = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
  terminalizeWorkspaceCustody({
    registryDir: workspace.registryDir,
    custody,
    terminalState: "TERMINAL_ABANDONED",
    resultDigest: `sha256:${"1".repeat(64)}`,
    validationDigest: `sha256:${"2".repeat(64)}`,
    finalDirtyManifestDigest: boundary.dirtyManifestDigest,
    changedPathHashes: {},
    commitSha: null,
  });
  const recovered = runWorkSessionState(fixture.root, fixture.session);
  assert.equal(recovered.state, "ACTIVE");
  assert.notEqual(recovered.workspaceId, workspace.workspaceId);
});
