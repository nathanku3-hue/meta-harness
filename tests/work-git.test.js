"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { deliverValidatedChanges, hashAcceptedPaths } = require("../lib/work-git");
const { tempDir } = require("./helpers/cli");

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
  fs.writeFileSync(path.join(root, "accepted.txt"), "baseline accepted\n", "utf8");
  fs.writeFileSync(path.join(root, "staged.txt"), "baseline staged\n", "utf8");
  fs.writeFileSync(path.join(root, "dirty.txt"), "baseline dirty\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-u", "origin", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, origin, branch };
}

function remoteHead(root, branch) {
  const output = git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  return output.split(/\s+/)[0];
}

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
