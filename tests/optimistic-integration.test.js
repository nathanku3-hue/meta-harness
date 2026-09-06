"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  PRODUCT_HEAD_REF,
  compareAndSwapIntegrationHead,
  initializeIntegrationHead,
  prepareCandidateAgainstObservedHead,
  readIntegrationHead,
} = require("../lib/optimistic-integration");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-optimistic-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init"]);
  git(root, ["config", "user.name", "Optimistic Integration Test"]);
  git(root, ["config", "user.email", "optimistic@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

function siblingCommit(root, parent, message) {
  const tree = git(root, ["rev-parse", `${parent}^{tree}`]);
  return git(root, ["commit-tree", tree, "-p", parent, "-m", message]);
}

function candidateCommit(root, parent, relativePath, content, message) {
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "mh-optimistic-candidate-"));
  try {
    git(root, ["worktree", "add", "--detach", holder, parent]);
    const target = path.join(holder, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    git(holder, ["add", relativePath]);
    git(holder, ["commit", "-m", message]);
    return git(holder, ["rev-parse", "HEAD"]);
  } finally {
    git(root, ["worktree", "remove", "--force", holder]);
    fs.rmSync(holder, { recursive: true, force: true });
  }
}

test("independent candidates work from one snapshot, replay onto the newer head, and land by native CAS", (t) => {
  const root = repository(t);
  const base = git(root, ["rev-parse", "HEAD"]);
  const candidateA = candidateCommit(root, base, "a.txt", "A\n", "candidate-a");
  const candidateB = candidateCommit(root, base, "b.txt", "B\n", "candidate-b");

  const initialized = initializeIntegrationHead({ repositoryPath: root, baseCommit: base });
  assert.equal(initialized.state, "INITIALIZED");
  assert.equal(initialized.ref, PRODUCT_HEAD_REF);

  const preparedA = prepareCandidateAgainstObservedHead({
    repositoryPath: root,
    candidateBase: base,
    candidateHead: candidateA,
    observedHead: base,
  });
  assert.equal(preparedA.state, "PREPARED");
  assert.equal(preparedA.preparedHead, candidateA);
  assert.equal(compareAndSwapIntegrationHead({
    repositoryPath: root,
    expectedHead: base,
    candidateHead: preparedA.preparedHead,
  }).state, "LANDED");

  const staleB = compareAndSwapIntegrationHead({
    repositoryPath: root,
    expectedHead: base,
    candidateHead: candidateB,
  });
  assert.equal(staleB.state, "CONFLICT");
  assert.equal(staleB.observedHead, candidateA);

  const preparedB = prepareCandidateAgainstObservedHead({
    repositoryPath: root,
    candidateBase: base,
    candidateHead: candidateB,
    observedHead: staleB.observedHead,
  });
  assert.equal(preparedB.state, "PREPARED");
  assert.equal(git(root, ["rev-parse", `${preparedB.preparedHead}^`]), candidateA);
  assert.equal(git(root, ["show", `${preparedB.preparedHead}:a.txt`]), "A");
  assert.equal(git(root, ["show", `${preparedB.preparedHead}:b.txt`]), "B");

  const landedB = compareAndSwapIntegrationHead({
    repositoryPath: root,
    expectedHead: candidateA,
    candidateHead: preparedB.preparedHead,
  });
  assert.equal(landedB.state, "LANDED");
  assert.equal(readIntegrationHead(root), preparedB.preparedHead);
});

test("same-file optimistic replay returns conflict paths as repair input instead of blocking the product", (t) => {
  const root = repository(t);
  const base = git(root, ["rev-parse", "HEAD"]);
  const candidateA = candidateCommit(root, base, "README.md", "A\n", "candidate-a-readme");
  const candidateB = candidateCommit(root, base, "README.md", "B\n", "candidate-b-readme");
  initializeIntegrationHead({ repositoryPath: root, baseCommit: base });
  assert.equal(compareAndSwapIntegrationHead({
    repositoryPath: root,
    expectedHead: base,
    candidateHead: candidateA,
  }).state, "LANDED");

  const replay = prepareCandidateAgainstObservedHead({
    repositoryPath: root,
    candidateBase: base,
    candidateHead: candidateB,
    observedHead: candidateA,
  });
  assert.equal(replay.state, "CONFLICT");
  assert.deepEqual(replay.conflictPaths, ["README.md"]);
  assert.equal(replay.preparedHead, null);
  assert.equal(readIntegrationHead(root), candidateA);
});

test("initialization is idempotent and reports incompatible existing product head as conflict", (t) => {
  const root = repository(t);
  const base = git(root, ["rev-parse", "HEAD"]);
  const other = siblingCommit(root, base, "other");

  assert.equal(initializeIntegrationHead({ repositoryPath: root, baseCommit: base }).state, "INITIALIZED");
  assert.equal(initializeIntegrationHead({ repositoryPath: root, baseCommit: base }).state, "READY");
  assert.equal(compareAndSwapIntegrationHead({
    repositoryPath: root,
    expectedHead: base,
    candidateHead: other,
  }).state, "LANDED");

  const incompatible = initializeIntegrationHead({ repositoryPath: root, baseCommit: base });
  assert.equal(incompatible.state, "CONFLICT");
  assert.equal(incompatible.expectedHead, base);
  assert.equal(incompatible.observedHead, other);
});

test("integration CAS rejects refs outside the internal Meta-Harness namespace", (t) => {
  const root = repository(t);
  const base = git(root, ["rev-parse", "HEAD"]);
  assert.throws(
    () => initializeIntegrationHead({ repositoryPath: root, baseCommit: base, ref: "refs/heads/main" }),
    (error) => error.code === "MH_OPTIMISTIC_REF",
  );
});
