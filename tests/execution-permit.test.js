"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  assertPermitCapability,
  enterExecutionAttempt,
  issueExecutionPermit,
  validateExecutionPermit,
} = require("../lib/execution-permit");
const {
  prepareWorkspace,
  stateDirectory,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const { captureBoundary } = require("../lib/work-loop");
const { sealWorkSession } = require("../lib/work-session");
const {
  acquireWorkspaceExecutionLease,
  releaseWorkspaceExecutionLease,
} = require("../lib/workspace-custody");
const { tempDir } = require("./helpers/cli");
const { directionFromContent, writeProductMd } = require("./helpers/product-direction");
const { gapProofSpec } = require("./helpers/product-proof");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const parent = tempDir("execution-permit-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Execution Permit Test"]);
  git(root, ["config", "user.email", "execution-permit@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  writeProductMd(root);
  git(root, ["add", ".gitignore", "README.md", "PRODUCT.md"]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function session(root) {
  const productDirection = directionFromContent();
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const productResult = "Create one visible result.";
  const newlyTrueBehavior = "The result file exists.";
  const doneWhen = "The result file exists and validation passes.";
  return sealWorkSession({
    schemaVersion: "work-session/v7",
    productDirection,
    origin: { type: "OWNER_GOAL" },
    base,
    productResult,
    journeyState: "The result is accepted and not yet delivered.",
    doNow: "Create src/result.txt.",
    newlyTrueBehavior,
    doneWhen,
    productProofSpec: gapProofSpec({ productDirection, base, productResult, newlyTrueBehavior, doneWhen }),
    stopOnlyIf: ["The allowed path is insufficient."],
    authorizedReversibleActions: ["Edit src.", "Run validation."],
    ownerOnlyActions: ["Publish the repository."],
    allowedPaths: ["src"],
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 2,
    delivery: { commit: false, push: false },
  });
}

function leasedWorkspace(t, root, workSession) {
  const workspace = prepareWorkspace(root, workSession);
  const registryDir = workspaceRegistryDirectory(root);
  const workspaceLease = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  t.after(() => releaseWorkspaceExecutionLease({ registryDir, lease: workspaceLease }));
  return { workspace, registryDir, workspaceLease };
}

test("ExecutionPermit is generation-bound, single-use, lease-bound, and capability-limited", (t) => {
  const root = repository(t);
  const workSession = session(root);
  const { workspace, registryDir, workspaceLease } = leasedWorkspace(t, root, workSession);
  const boundary = captureBoundary(workspace.workspacePath, workSession.allowedPaths);
  const permit = issueExecutionPermit({
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    session: workSession,
    attempt: 1,
    boundary,
    workspaceCustody: workspace.custody,
    workspaceLease,
    workspaceRegistryDir: registryDir,
    stateDirectory: stateDirectory(root),
  });

  assert.equal(validateExecutionPermit(permit).generation, 1);
  assert.equal(permit.authority.workspaceId, workspace.workspaceId);
  assert.equal(permit.authority.workspaceCustodyDigest, workspace.custody.recordDigest);
  assert.equal(permit.authority.workspaceLeaseDigest, workspaceLease.leaseDigest);
  assert.equal(Object.isFrozen(permit), true);
  assert.equal(Object.isFrozen(permit.authority), true);
  assert.equal(Object.isFrozen(permit.capabilities), true);
  assert.deepEqual(permit.capabilities, [
    "CODE_PROPOSE",
    "CONTROLLER_MATERIALIZE",
    "CONTROLLER_VALIDATE",
    "CONTROLLER_COMMIT",
  ]);
  const entry = enterExecutionAttempt({ stateDirectory: stateDirectory(root), permit, session: workSession });
  assert.equal(entry.origin.type, "OWNER_GOAL");
  assert.equal(entry.permitDigest, permit.permitDigest);
  assert.equal(
    assertEnteredPermitCapability({
      stateDirectory: stateDirectory(root),
      permit,
      attemptEntry: entry,
      capability: "CONTROLLER_VALIDATE",
    }).permitDigest,
    permit.permitDigest,
  );
  assert.throws(
    () => enterExecutionAttempt({ stateDirectory: stateDirectory(root), permit, session: workSession }),
    (error) => error.code === "MH_EXECUTION_PERMIT_REPLAY",
  );
  assert.throws(
    () => assertPermitCapability(permit, "CONTROLLER_PUSH"),
    (error) => error.code === "MH_EXECUTION_CAPABILITY_DENIED",
  );
  assert.throws(
    () => assertPermitCapability(permit, "OUTCOME_READ"),
    (error) => error.code === "MH_EXECUTION_CAPABILITY_DENIED",
  );
  assert.throws(
    () => assertPermitCapability(permit, "ROOT_SHELL"),
    (error) => error.code === "MH_EXECUTION_PERMIT_CAPABILITY",
  );
});

test("ExecutionPermit generation baseline fails closed before material execution", (t) => {
  const root = repository(t);
  const workSession = session(root);
  const { workspace, registryDir, workspaceLease } = leasedWorkspace(t, root, workSession);
  const boundary = captureBoundary(workspace.workspacePath, workSession.allowedPaths);
  const permit = issueExecutionPermit({
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    session: workSession,
    attempt: 1,
    boundary,
    workspaceCustody: workspace.custody,
    workspaceLease,
    workspaceRegistryDir: registryDir,
    stateDirectory: stateDirectory(root),
  });

  fs.mkdirSync(path.join(workspace.workspacePath, "src"));
  fs.writeFileSync(path.join(workspace.workspacePath, "src", "surprise.txt"), "external mutation\n", "utf8");
  const changedBoundary = captureBoundary(workspace.workspacePath, workSession.allowedPaths);

  assert.throws(
    () => assertExecutionPermitCurrent({
      permit,
      session: workSession,
      repositoryRoot: workspace.repositoryRoot,
      workspacePath: workspace.workspacePath,
      workspaceCustody: workspace.custody,
      workspaceLease,
      workspaceRegistryDir: registryDir,
      boundary: changedBoundary,
      requireInitialDirtyManifest: true,
    }),
    (error) => error.code === "MH_EXECUTION_PERMIT_STALE",
  );
});

test("dead controller execution lease is recoverable immediately", (t) => {
  const root = repository(t);
  const workSession = session(root);
  const workspace = prepareWorkspace(root, workSession);
  const registryDir = workspaceRegistryDirectory(root);
  const modulePath = require.resolve("../lib/workspace-custody");
  const child = spawnSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(modulePath)}).acquireWorkspaceExecutionLease(${JSON.stringify({ registryDir, workspaceId: workspace.workspaceId })})`,
  ], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const recovered = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  t.after(() => releaseWorkspaceExecutionLease({ registryDir, lease: recovered }));
  assert.equal(recovered.workspaceId, workspace.workspaceId);
});

test("workspace execution lease prevents two controllers from executing the same ACTIVE generation", (t) => {
  const root = repository(t);
  const workSession = session(root);
  const workspace = prepareWorkspace(root, workSession);
  const registryDir = workspaceRegistryDirectory(root);
  const first = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  t.after(() => releaseWorkspaceExecutionLease({ registryDir, lease: first }));

  assert.throws(
    () => acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId }),
    (error) => error.code === "MH_WORKSPACE_BUSY",
  );
});
