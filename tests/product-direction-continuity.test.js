"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { buildCodingPrompt } = require("../lib/coding-worker");
const {
  pinProductDirection,
  projectProductDirectionForPlanner,
} = require("../lib/product-direction");
const { materializeWorkerOperations } = require("../lib/work-materializer");
const { resolveRepositoryEntry } = require("../lib/repository-entry");
const {
  bindWorkSessionToRepository,
  createGoalWorkSession,
  WORK_SESSION_SCHEMA,
} = require("../lib/work-session");
const {
  captureWorkspaceBoundary,
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
} = require("../lib/work-git");
const {
  readWorkspaceCustody,
  terminalizeWorkspaceCustody,
} = require("../lib/workspace-custody");
const { runRaw, tempDir } = require("./helpers/cli");
const { SAMPLE_PRODUCT_MD, writeProductMd } = require("./helpers/product-direction");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function npmRepo(t) {
  const parent = tempDir("pdc-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "PDC Test"]);
  git(root, ["config", "user.email", "pdc@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "pdc-fixture",
    private: true,
    scripts: { test: "node -e \"process.exit(0)\"" },
  }, null, 2), "utf8");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function goalSession(root, goal = "Add a visible result.", allowedPaths = ["src"]) {
  return createGoalWorkSession({
    goal,
    repositoryPath: root,
    productDirection: pinProductDirection(root),
    base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
    allowedPaths,
    validation: [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 30 }],
  });
}

test("--goal rejects missing PRODUCT.md before workspace or worker activity", (t) => {
  const root = npmRepo(t);
  fs.rmSync(path.join(root, "PRODUCT.md"));
  const result = runRaw(root, ["work", root, "--goal", "Add a visible result.", "--dry-run", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || result.stdout || ""), /PRODUCT\.md/iu);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
});

test("--goal rejects malformed PRODUCT.md before workspace activity", (t) => {
  const root = npmRepo(t);
  fs.writeFileSync(path.join(root, "PRODUCT.md"), "# incomplete\n\n## Version\n\nv1\n", "utf8");
  const result = runRaw(root, ["work", root, "--goal", "Add a visible result.", "--dry-run", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || result.stdout || ""), /heading|PRODUCT\.md|section/iu);
});

test("planner PRODUCT projection preserves exact CRLF section text", (t) => {
  const root = npmRepo(t);
  const crlf = SAMPLE_PRODUCT_MD.replace(/\n/gu, "\r\n");
  fs.writeFileSync(path.join(root, "PRODUCT.md"), crlf, "utf8");
  const direction = pinProductDirection(root);
  const frame = projectProductDirectionForPlanner(direction);
  const endgameStart = crlf.indexOf("## Endgame\r\n") + "## Endgame\r\n".length;
  const endgameEnd = crlf.indexOf("## Target user\r\n");
  assert.equal(frame.endgame, crlf.slice(endgameStart, endgameEnd));
  assert.match(frame.endgame, /\r\n/u);
  assert.equal(frame.productDirectionDigest, direction.digest);
  assert.equal(frame.version, direction.version);
});

test("current session pins exact PRODUCT bytes and carries no semantic or proof authority", (t) => {
  const root = npmRepo(t);
  const live = pinProductDirection(root);
  const session = goalSession(root);
  assert.equal(session.schemaVersion, WORK_SESSION_SCHEMA);
  assert.equal(session.productDirection.content, live.content);
  assert.equal(session.productDirection.digest, live.digest);
  assert.equal(session.productDirection.content, SAMPLE_PRODUCT_MD);
  for (const retired of ["productProofSpec", "semanticState", "semanticProjection", "endgameProjection"]) {
    assert.equal(Object.hasOwn(session, retired), false, retired);
  }
});

test("coding prompt receives exact owner direction before product result", (t) => {
  const root = npmRepo(t);
  const session = goalSession(root);
  const prompt = buildCodingPrompt(session, {
    attempt: 1,
    priorFailure: "previous validation failed",
    workspaceMode: "isolated",
  });
  const directionAt = prompt.indexOf(session.productDirection.content);
  const resultAt = prompt.indexOf(`Product result: ${session.productResult}`);
  const failureAt = prompt.indexOf("previous validation failed");
  assert.ok(directionAt >= 0);
  assert.ok(resultAt > directionAt);
  assert.ok(failureAt > resultAt);
});

test("resume binds unchanged PRODUCT bytes and rejects live direction drift", (t) => {
  const root = npmRepo(t);
  const session = goalSession(root);
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  assert.equal(loadLatestWorkSession(root).sessionDigest, session.sessionDigest);

  fs.appendFileSync(path.join(root, "PRODUCT.md"), "\nOwner changed direction.\n", "utf8");
  assert.throws(
    () => bindWorkSessionToRepository(session, root),
    (error) => /PRODUCT|direction|digest/iu.test(String(error.message)),
  );
});

test("direct owner-goal recovery uses run journal without a latest-session pointer", (t) => {
  const root = npmRepo(t);
  const session = goalSession(root);
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);

  const sessionStem = session.sessionDigest.slice("sha256:".length);
  assert.equal(
    fs.existsSync(path.join(root, ".git", "meta-harness", "runs", `run-${sessionStem}`, "session.json")),
    true,
  );
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness", "work-sessions", "latest.json")), false);

  const custody = readWorkspaceCustody(workspace.registryDir, workspace.workspaceId);
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, session.allowedPaths);
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

  const entry = resolveRepositoryEntry(root);
  assert.equal(entry.action, "CONTINUE");
  assert.equal(entry.kind, "OWNER_GOAL_INGRESS");
  assert.equal(entry.result, session.productResult);
  assert.equal(entry.ingress.sessionDigest, session.sessionDigest);
  assert.equal(entry.ingress.source, "RUN_JOURNAL_INTENT");
});

test("PRODUCT.md mutation is rejected even when a caller includes it in allowed paths", (t) => {
  const root = npmRepo(t);
  const session = goalSession(root, "Create src/result.txt.", ["src", "PRODUCT.md"]);
  const workspace = prepareWorkspace(root, session);
  assert.throws(
    () => materializeWorkerOperations(
      workspace.workspacePath,
      [{ type: "WRITE", path: "PRODUCT.md", content: "worker rewrite\n" }],
      session.allowedPaths,
    ),
    (error) => /PRODUCT|protected/iu.test(String(error.message)),
  );
});
