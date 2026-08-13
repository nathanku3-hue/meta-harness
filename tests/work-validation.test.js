"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  placeholderTestScript,
  resolveGoalValidation,
} = require("../lib/work-validation");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const root = tempDir("work-validation-");
  git(root, ["init"]);
  git(root, ["config", "user.name", "Work Validation Test"]);
  git(root, ["config", "user.email", "work-validation@example.invalid"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function commitTree(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "--allow-empty", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function writePackage(root, value) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("goal validation resolves one exact npm test command", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: { test: "node --test" } });
  const resolved = resolveGoalValidation(root, commitTree(root, "valid package"));
  assert.equal(resolved.supported, true);
  assert.deepEqual(resolved.validation, [{
    argv: ["npm", "test"],
    cwd: ".",
    timeoutSeconds: 300,
  }]);
  assert.equal(Object.isFrozen(resolved.validation[0].argv), true);
});

test("goal validation rejects missing, malformed, empty, and placeholder npm tests", (t) => {
  const root = repository(t);
  assert.equal(resolveGoalValidation(root, commitTree(root, "empty tree")).supported, false);

  fs.writeFileSync(path.join(root, "package.json"), "{not-json\n", "utf8");
  assert.equal(resolveGoalValidation(root, commitTree(root, "malformed package")).supported, false);

  writePackage(root, { scripts: {} });
  assert.equal(resolveGoalValidation(root, commitTree(root, "empty scripts")).supported, false);

  writePackage(root, { scripts: { test: "echo \"Error: no test specified\" && exit 1" } });
  assert.equal(resolveGoalValidation(root, commitTree(root, "placeholder test")).supported, false);
  assert.equal(placeholderTestScript("echo 'Error: no test specified' && exit 1"), true);
});

test("goal validation resolves one scope-nearest nested package", (t) => {
  const root = repository(t);
  const packageRoot = path.join(root, "learn-diff");
  writePackage(packageRoot, { scripts: { test: "node --test" } });
  fs.mkdirSync(path.join(packageRoot, "bin"));
  fs.mkdirSync(path.join(packageRoot, "test"));
  fs.writeFileSync(path.join(packageRoot, "bin", "cli.js"), "\n", "utf8");

  const commit = commitTree(root, "nested package");
  const resolved = resolveGoalValidation(root, commit, ["learn-diff/bin/cli.js", "learn-diff/test/new.test.js"]);
  assert.equal(resolved.supported, true);
  assert.deepEqual(resolved.validation, [{
    argv: ["npm", "test"],
    cwd: "learn-diff",
    timeoutSeconds: 300,
  }]);
});

test("goal validation fails closed when allowed paths span package roots", (t) => {
  const root = repository(t);
  writePackage(path.join(root, "apps", "one"), { scripts: { test: "node --test" } });
  writePackage(path.join(root, "apps", "two"), { scripts: { test: "node --test" } });
  fs.mkdirSync(path.join(root, "apps", "one", "src"));
  fs.mkdirSync(path.join(root, "apps", "two", "src"));

  const resolved = resolveGoalValidation(root, commitTree(root, "multiple packages"), ["apps/one/src", "apps/two/src"]);
  assert.equal(resolved.supported, false);
  assert.match(resolved.reason, /multiple package\.json files/i);
});

test("goal validation does not skip an invalid nearest package for a valid parent", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: { test: "node --test" } });
  writePackage(path.join(root, "nested"), { scripts: {} });
  fs.mkdirSync(path.join(root, "nested", "src"));

  const resolved = resolveGoalValidation(root, commitTree(root, "invalid nearest package"), ["nested/src"]);
  assert.equal(resolved.supported, false);
  assert.match(resolved.reason, /no non-empty scripts\.test/i);
});

test("goal validation rejects a symlinked package manifest in the sealed tree", (t) => {
  const root = repository(t);
  const target = path.join(root, "manifest.json");
  writePackage(root, { scripts: { test: "node --test" } });
  fs.renameSync(path.join(root, "package.json"), target);
  try {
    fs.symlinkSync(target, path.join(root, "package.json"), "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("file symlinks require unavailable Windows privilege");
      return;
    }
    throw error;
  }
  assert.equal(resolveGoalValidation(root, commitTree(root, "symlink package")).supported, false);
});

test("dirty or untracked package.json cannot influence validation derived from a sealed commit", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: { test: "node --test" } });
  fs.mkdirSync(path.join(root, "nested", "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "nested", "src", "tracked.js"), "module.exports = true;\n", "utf8");
  const sealed = commitTree(root, "trusted package tree");

  writePackage(path.join(root, "nested"), { scripts: {} });
  writePackage(root, { scripts: { test: "echo \"Error: no test specified\" && exit 1" } });

  const resolved = resolveGoalValidation(root, sealed, ["nested/src"]);
  assert.equal(resolved.supported, true);
  assert.deepEqual(resolved.validation, [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 300 }]);
});

test("validation follows the selected commit instead of the source checkout timeline", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: {} });
  const stale = commitTree(root, "stale package without test");
  writePackage(root, { scripts: { test: "node --test" } });
  const fresh = commitTree(root, "fresh package with test");

  assert.equal(resolveGoalValidation(root, stale).supported, false);
  assert.equal(resolveGoalValidation(root, fresh).supported, true);
});
