"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { run, runRaw, tempDir } = require("./helpers/cli");

test("MH_REPRO_001 fails when package-lock.json missing", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Repro fail target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0"
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const repro = data.checks.find(c => c.id === "MH_REPRO_001");
  assert.equal(repro.status, "fail");
  assert.match(repro.reason, /package-lock\.json missing/);
});

test("MH_NPM_SCRIPTS_001 fails when preinstall exists", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Scripts fail target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    scripts: {
      preinstall: "malicious-code"
    }
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const scriptsCheck = data.checks.find(c => c.id === "MH_NPM_SCRIPTS_001");
  assert.equal(scriptsCheck.status, "fail");
  assert.match(scriptsCheck.reason, /risky npm lifecycle scripts/);
});

test("MH_NPM_SCRIPTS_001 warns on prepare/prepack/postpack hooks and blocks package dry-run in local mode", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Scripts block pack target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    scripts: {
      prepare: "build-something"
    }
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--json"]);
  const data = JSON.parse(res.stdout);
  const scriptsCheck = data.checks.find(c => c.id === "MH_NPM_SCRIPTS_001");
  const packageCheck = data.checks.find(c => c.id === "MH_PACKAGE_001");

  assert.equal(scriptsCheck.status, "warn");
  assert.equal(packageCheck.status, "skip");
  assert.match(packageCheck.reason, /npm pack dry-run skipped/);
});

test("MH_NPM_SCRIPTS_001 warns on prepare/prepack/postpack hooks elevated to fail in strict mode", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Scripts block pack strict target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    scripts: {
      prepare: "build-something"
    }
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--mode", "strict", "--quick", "--json"]);
  const data = JSON.parse(res.stdout);
  const scriptsCheck = data.checks.find(c => c.id === "MH_NPM_SCRIPTS_001");
  const packageCheck = data.checks.find(c => c.id === "MH_PACKAGE_001");

  assert.equal(data.ok, false);
  assert.equal(scriptsCheck.status, "fail");
  assert.equal(packageCheck.status, "fail");
});

test("MH_NPM_SCRIPTS_001 allows safe prepublishOnly release check", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Scripts pass target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    scripts: {
      prepublishOnly: "node bin/meta-harness.js release check"
    }
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const scriptsCheck = data.checks.find(c => c.id === "MH_NPM_SCRIPTS_001");
  assert.equal(scriptsCheck.status, "pass");
});
