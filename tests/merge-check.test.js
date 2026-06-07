"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { CHECK_IDS, runMergeCheck } = require("../lib/merge-check");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-merge-check-"));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function writeFile(cwd, relativePath, text) {
  const fullPath = path.join(cwd, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text, "utf8");
}

function initRepo() {
  const cwd = tempDir();
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
  writeFile(cwd, "README.md", "base\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "base"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  return { base, cwd };
}

function commitFile(cwd, relativePath, text, message = "change") {
  writeFile(cwd, relativePath, text);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function checkById(result, id) {
  return result.checks.find((check) => check.id === id);
}

test("merge check passes a clean in-scope base/head comparison with verified checks", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "lib/merge-check.js", "\"use strict\";\n", "merge check");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "merge-protocol",
    expectedBase: base,
    checksStatus: "pass",
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed_files, 1);
  assert.deepEqual(result.changed_paths, ["lib/merge-check.js"]);
});

test("merge check fails closed when checks are unknown", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "lib/merge-check.js", "\"use strict\";\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "merge-protocol",
    expectedBase: base,
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.status).status, "fail");
});

test("merge check rejects paths outside the declared scope", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "docs/product/roadmap.md", "# Roadmap\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "phase7-prototype",
    expectedBase: base,
    checksStatus: "pass",
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.scope).status, "fail");
  assert.match(checkById(result, CHECK_IDS.scope).reason, /docs\/product\/roadmap\.md/);
});

test("merge check blocks oversize diffs", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "lib/merge-check.js", "\"use strict\";\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "merge-protocol",
    expectedBase: base,
    checksStatus: "pass",
    maxFiles: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.diffSize).status, "fail");
});

test("merge check blocks promotion without a decision", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, ".meta-harness/skill-registry.json", JSON.stringify({
    skills: [
      { name: "repo-adoption-doctor", status: "active" },
    ],
  }, null, 2) + "\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "phase7-prototype",
    expectedBase: base,
    checksStatus: "pass",
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.authority).status, "fail");
  assert.match(checkById(result, CHECK_IDS.authority).reason, /promotion/);
});

test("merge check blocks Phase 8 governance expansion without a decision", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "docs/product/roadmap.md", "# Roadmap\n\nPhase 8 is now active.\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "roadmap-docs",
    expectedBase: base,
    checksStatus: "pass",
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.authority).status, "fail");
  assert.match(checkById(result, CHECK_IDS.authority).reason, /Phase 8/);
});

test("merge check blocks unrelated local worktree edits", () => {
  const { base, cwd } = initRepo();
  const head = commitFile(cwd, "lib/merge-check.js", "\"use strict\";\n");
  writeFile(cwd, "README.md", "dirty\n");

  const result = runMergeCheck({
    targetRoot: cwd,
    base,
    head,
    scope: "merge-protocol",
    expectedBase: base,
    checksStatus: "pass",
  });

  assert.equal(result.ok, false);
  assert.equal(checkById(result, CHECK_IDS.worktree).status, "fail");
});
