"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { buildCodingPrompt } = require("../lib/coding-worker");
const {
  PRODUCT_DIRECTION_BLOCKED,
  pinProductDirection,
} = require("../lib/product-direction");
const { materializeWorkerChanges } = require("../lib/work-materializer");
const {
  createGoalWorkSession,
  sealWorkSession,
} = require("../lib/work-session");
const { loadLatestWorkSession, persistWorkSession, prepareWorkspace } = require("../lib/work-git");
const { ROOT, run, runRaw, tempDir } = require("./helpers/cli");
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

function sealedSession(root, overrides = {}) {
  const direction = pinProductDirection(root);
  return sealWorkSession({
    schemaVersion: "work-session/v2",
    productDirection: direction,
    productResult: "Create src/result.txt with delivered content.",
    journeyState: "Direction is pinned; coding may begin.",
    doNow: "Write src/result.txt.",
    newlyTrueBehavior: "src/result.txt exists.",
    doneWhen: "Validation passes.",
    stopOnlyIf: ["Allowed paths are insufficient."],
    authorizedReversibleActions: ["Edit src.", "Run validation."],
    ownerOnlyActions: ["Change PRODUCT.md."],
    allowedPaths: ["src", "PRODUCT.md"],
    dirtyPolicy: "continue-in-scope",
    validation: [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 2,
    delivery: { commit: false, push: false },
    ...overrides,
  });
}

test("--goal rejects missing PRODUCT.md before workspace or worker activity", (t) => {
  const root = npmRepo(t);
  fs.rmSync(path.join(root, "PRODUCT.md"));
  const result = runRaw(root, ["work", root, "--goal", "Add a visible result.", "--dry-run", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || result.stdout || ""), /PRODUCT\.md/i);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
});

test("--goal rejects malformed PRODUCT.md before workspace activity", (t) => {
  const root = npmRepo(t);
  fs.writeFileSync(path.join(root, "PRODUCT.md"), "# incomplete\n\n## Version\n\nv1\n", "utf8");
  const result = runRaw(root, ["work", root, "--goal", "Add a visible result.", "--dry-run", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || result.stdout || ""), /heading|PRODUCT\.md|section/i);
});

test("created v2 session contains exact PRODUCT.md bytes and matching digest", (t) => {
  const root = npmRepo(t);
  const live = pinProductDirection(root);
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    allowedPaths: ["src"],
    validation: [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 30 }],
  });
  assert.equal(session.schemaVersion, "work-session/v2");
  assert.equal(session.productDirection.content, live.content);
  assert.equal(session.productDirection.digest, live.digest);
  assert.equal(session.productDirection.content, SAMPLE_PRODUCT_MD);
});

test("fake-worker prompt receives exact direction bytes before result and context", (t) => {
  const root = npmRepo(t);
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    allowedPaths: ["src"],
    validation: [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 30 }],
  });
  const prompt = buildCodingPrompt(session, {
    attempt: 1,
    priorFailure: "previous validation failed",
    workspaceMode: "current",
  });
  const directionAt = prompt.indexOf(session.productDirection.content);
  const resultAt = prompt.indexOf(`Product result: ${session.productResult}`);
  const failureAt = prompt.indexOf("previous validation failed");
  assert.ok(directionAt >= 0);
  assert.ok(resultAt > directionAt);
  assert.ok(failureAt > resultAt);
});

test("validation repair prompt reuses unchanged product-direction snapshot bytes", (t) => {
  const root = npmRepo(t);
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    allowedPaths: ["src"],
    validation: [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 30 }],
  });
  const first = buildCodingPrompt(session, { attempt: 1, priorFailure: "", workspaceMode: "current" });
  const second = buildCodingPrompt(session, {
    attempt: 2,
    priorFailure: "npm test failed",
    workspaceMode: "current",
  });
  assert.equal(
    first.slice(first.indexOf("Product direction"), first.indexOf("Product result:")),
    second.slice(second.indexOf("Product direction"), second.indexOf("Product result:")),
  );
  assert.ok(second.includes(session.productDirection.content));
  assert.ok(second.includes("npm test failed"));
});

test("fresh --resume keeps unchanged bytes when live PRODUCT.md is unchanged", (t) => {
  const root = npmRepo(t);
  const session = sealedSession(root, { allowedPaths: ["src"] });
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const resumed = loadLatestWorkSession(root);
  assert.equal(resumed.sessionDigest, session.sessionDigest);
  assert.equal(resumed.productDirection.content, session.productDirection.content);
  assert.equal(resumed.productDirection.digest, session.productDirection.digest);
});

test("mid-session live PRODUCT.md change including deletion returns product-facing BLOCKED", (t) => {
  const root = npmRepo(t);
  const session = sealedSession(root, { allowedPaths: ["src"] });
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);

  fs.writeFileSync(path.join(root, "PRODUCT.md"), SAMPLE_PRODUCT_MD.replace("product-direction-v1", "product-direction-v2"), "utf8");
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_PRODUCT_DIRECTION_DRIFT"
      && String(error.message).includes("Product direction changed since this work session was created."),
  );

  writeProductMd(root);
  const restored = sealedSession(root, { allowedPaths: ["src"] });
  const restoredWorkspace = prepareWorkspace(root, restored);
  persistWorkSession(root, restored, restoredWorkspace);
  fs.rmSync(path.join(root, "PRODUCT.md"));
  assert.throws(
    () => loadLatestWorkSession(root),
    (error) => error.code === "MH_PRODUCT_DIRECTION_DRIFT"
      && String(error.message) === PRODUCT_DIRECTION_BLOCKED,
  );
});

test("worker proposal to mutate PRODUCT.md is rejected even when listed as allowed", (t) => {
  const root = npmRepo(t);
  assert.throws(
    () => materializeWorkerChanges(root, [{
      path: "PRODUCT.md",
      content: SAMPLE_PRODUCT_MD.replace("Solo developer", "rewritten by worker"),
    }], ["src", "PRODUCT.md"]),
    (error) => error.code === "MH_PRODUCT_DIRECTION_PROTECTED",
  );
  assert.equal(fs.readFileSync(path.join(root, "PRODUCT.md"), "utf8"), SAMPLE_PRODUCT_MD);
});

test("new init does not generate phase-map and absence does not break retained consumers", (t) => {
  const cwd = tempDir("init-no-phase-");
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(cwd, ["init"]);
  run(cwd, ["init"]);
  const harness = path.join(cwd, ".meta-harness");
  assert.equal(fs.existsSync(path.join(harness, "status.md")), true);
  assert.equal(fs.existsSync(path.join(harness, "phase-map.md")), false);

  const { readHarnessState } = require("../lib/context-gate-state");
  const state = readHarnessState(cwd);
  assert.equal(state.files.phaseMap, false);
  assert.equal(state.phaseMapText, "");
  assert.ok(ROOT);
});
