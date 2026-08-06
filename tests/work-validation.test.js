"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  placeholderTestScript,
  resolveGoalValidation,
} = require("../lib/work-validation");
const { tempDir } = require("./helpers/cli");

function repository(t) {
  const root = tempDir("work-validation-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePackage(root, value) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("goal validation resolves one exact npm test command", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: { test: "node --test" } });
  const resolved = resolveGoalValidation(root);
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
  assert.equal(resolveGoalValidation(root).supported, false);

  fs.writeFileSync(path.join(root, "package.json"), "{not-json\n", "utf8");
  assert.equal(resolveGoalValidation(root).supported, false);

  writePackage(root, { scripts: {} });
  assert.equal(resolveGoalValidation(root).supported, false);

  writePackage(root, { scripts: { test: "echo \"Error: no test specified\" && exit 1" } });
  assert.equal(resolveGoalValidation(root).supported, false);
  assert.equal(placeholderTestScript("echo 'Error: no test specified' && exit 1"), true);
});

test("goal validation resolves one scope-nearest nested package", (t) => {
  const root = repository(t);
  const packageRoot = path.join(root, "learn-diff");
  writePackage(packageRoot, { scripts: { test: "node --test" } });
  fs.mkdirSync(path.join(packageRoot, "bin"));
  fs.mkdirSync(path.join(packageRoot, "test"));
  fs.writeFileSync(path.join(packageRoot, "bin", "cli.js"), "\n", "utf8");

  const resolved = resolveGoalValidation(root, ["learn-diff/bin/cli.js", "learn-diff/test/new.test.js"]);
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

  const resolved = resolveGoalValidation(root, ["apps/one/src", "apps/two/src"]);
  assert.equal(resolved.supported, false);
  assert.match(resolved.reason, /multiple package\.json files/i);
});

test("goal validation does not skip an invalid nearest package for a valid parent", (t) => {
  const root = repository(t);
  writePackage(root, { scripts: { test: "node --test" } });
  writePackage(path.join(root, "nested"), { scripts: {} });
  fs.mkdirSync(path.join(root, "nested", "src"));

  const resolved = resolveGoalValidation(root, ["nested/src"]);
  assert.equal(resolved.supported, false);
  assert.match(resolved.reason, /no non-empty scripts\.test/i);
});

test("goal validation rejects a symlinked package manifest", (t) => {
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
  assert.equal(resolveGoalValidation(root).supported, false);
});
