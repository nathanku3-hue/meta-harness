"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  assertMutationTargetAllowed,
  canonicalMutationTarget,
  managedMarkerPath,
} = require("../lib/mutation-guard");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function managedRepository(t) {
  const parent = tempDir("mutation-guard-");
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Mutation Guard Test"]);
  git(root, ["config", "user.email", "mutation-guard@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  const commonDir = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  fs.mkdirSync(path.join(commonDir, "meta-harness"), { recursive: true });
  fs.writeFileSync(managedMarkerPath(commonDir), "managed-v1\n", "utf8");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, commonDir };
}

test("mutation guard evaluates the actual target, not the opened parent workspace", (t) => {
  const { parent, root } = managedRepository(t);
  assert.throws(
    () => assertMutationTargetAllowed(path.join(root, "src", "new.txt")),
    (error) => error.code === "MH_DEVSPACE_MUTATION_DENIED",
  );
  assert.throws(
    () => assertMutationTargetAllowed(path.join(parent, "repo", "README.md")),
    (error) => error.code === "MH_DEVSPACE_MUTATION_DENIED",
  );
});

test("mutation guard resolves symlink aliases before deciding managed identity", (t) => {
  const { parent, root } = managedRepository(t);
  const alias = path.join(parent, "alias");
  fs.symlinkSync(root, alias, "dir");
  assert.equal(canonicalMutationTarget(path.join(alias, "README.md")), path.join(root, "README.md"));
  assert.throws(
    () => assertMutationTargetAllowed(path.join(alias, "README.md")),
    (error) => error.code === "MH_DEVSPACE_MUTATION_DENIED",
  );
});

test("mutation guard fails closed when canonicalization cannot resolve the target", (t) => {
  const { parent } = managedRepository(t);
  const broken = path.join(parent, "broken-link");
  fs.symlinkSync(path.join(parent, "does-not-exist"), broken, "file");
  assert.throws(
    () => assertMutationTargetAllowed(broken),
    (error) => error.code === "MH_DEVSPACE_MUTATION_CANONICALIZATION_DENIED",
  );
});
