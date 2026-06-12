"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { run, runRaw, tempDir } = require("./helpers/cli");
const { writePhase5SecurityFixture } = require("./helpers/security-fixture");

const READY_JSON_CHECK_IDS = Object.freeze([
  "MH_DOMAIN_GOVERNANCE_001",
  "MH_TEST_001",
  "MH_SYNC_001",
  "MH_TRUST_001",
  "MH_CONTRACT_001",
  "MH_STATE_001",
  "MH_BRIEF_001",
  "MH_CONTEXT_GATE_001",
  "MH_DECISION_001",
  "MH_QUALITY_001",
  "MH_SECURITY_001",
  "MH_NPM_SCRIPTS_001",
  "MH_REPRO_001",
  "MH_STATE_ROOT_LEAK_001",
  "MH_GITCHECK_001",
  "MH_PACKAGE_001",
  "MH_GITHUB_SETTINGS_001",
  "MH_SHIPGATE_001",
  "MH_READY_JSON_001",
]);

function readyJsonChecks(overrides = {}) {
  return READY_JSON_CHECK_IDS.map((id) => ({ id, status: "pass", ...(overrides[id] || {}) }));
}

test("ready command all pass scenario (local read-only quick mode)", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ready check target"]);
  run(cwd, ["templates", "install", "--allow-dirty"]);

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: {}
  }), "utf8");
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");
  writePhase5SecurityFixture(cwd);

  run(cwd, ["quality", "init"]);

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /READY: yes/);
  assert.match(res.stdout, /PASS  MH_SYNC_001/);
  assert.match(res.stdout, /SKIP  MH_GITCHECK_001/);
});

test("ready command failing scenario (missing templates)", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ready check target failing"]);
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only"]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /READY: no/);
  assert.match(res.stdout, /FAIL  MH_SYNC_001/);
  assert.match(res.stdout, /Next action:/);
});

test("ready command JSON output validation", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ready check JSON target"]);
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  assert.equal(res.status, 1);
  const data = JSON.parse(res.stdout);
  assert.equal(data.schema_version, "1.0.0");
  assert.equal(data.ok, false);
  assert.equal(data.passed < data.checks.length, true);
  assert.ok(data.checks.find(c => c.id === "MH_SYNC_001"));
});

test("ready command pregenerated ready.json override", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ready pregenerated target"]);

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: {}
  }), "utf8");
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");

  const { computeReadyStateHash } = require("../lib/ready-check");
  const stateHash = computeReadyStateHash(cwd);

  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), JSON.stringify({
    schema_version: "1.0.0",
    target: cwd.split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    expires_after: new Date(Date.now() + 60000).toISOString(),
    git_commit: null,
    state_hash: stateHash,
    mode: "local",
    redacted: true,
    ok: true,
    passed: 19, failed: 0, skipped: 0, warned: 0, unknown: 0, timed_out: 0,
    state_hash_algorithm: "sha256:ready-v1",
    checks: readyJsonChecks({
      MH_TEST_001: { reason: "overridden test", next_action: "" },
    })
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const testCheck = data.checks.find(c => c.id === "MH_TEST_001");
  assert.equal(testCheck.status, "pass");
  assert.equal(testCheck.reason, "overridden test");
});

test("ready command validates hyphenated --no-exec and --read-only flags", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Flags target"]);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    scripts: {}
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--no-exec", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  assert.equal(data.mode, "local");
  const testCheck = data.checks.find(c => c.id === "MH_TEST_001");
  assert.equal(testCheck.status, "skip");
  assert.match(testCheck.reason, /skipped/);
});

test("ready command rejects --quick in release mode", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Release target"]);
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--mode", "release"]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--quick is not allowed in release mode/);
});

test("stale ready.json is rejected due to git_commit mismatch (non-git target expects null commit)", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Stale ready target"]);
  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), JSON.stringify({
    schema_version: "1.0.0",
    target: cwd.split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    expires_after: new Date(Date.now() + 60000).toISOString(),
    git_commit: "0000000000000000000000000000000000000000",
    state_hash: "differentstate000000000000000000000000",
    mode: "local",
    redacted: true,
    ok: true,
    passed: 19, failed: 0, skipped: 0, warned: 0, unknown: 0, timed_out: 0,
    state_hash_algorithm: "sha256:ready-v1",
    checks: readyJsonChecks()
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const readyJsonCheck = data.checks.find(c => c.id === "MH_READY_JSON_001");
  assert.equal(readyJsonCheck.status, "fail");
  assert.match(readyJsonCheck.reason, /git_commit mismatch/);
});

test("stale ready.json is rejected due to git_commit mismatch (git target compares checkout commit)", () => {
  const cwd = tempDir();
  // Initialize git repo
  spawnSync("git", ["init"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  run(cwd, ["init", "Stale ready git target"]);

  // Create a commit
  fs.writeFileSync(path.join(cwd, "file.txt"), "hello", "utf8");
  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial commit"], { cwd });

  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), JSON.stringify({
    schema_version: "1.0.0",
    target: cwd.split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    expires_after: new Date(Date.now() + 60000).toISOString(),
    git_commit: "0000000000000000000000000000000000000000",
    state_hash: "differentstate000000000000000000000000",
    mode: "local",
    redacted: true,
    ok: true,
    passed: 19, failed: 0, skipped: 0, warned: 0, unknown: 0, timed_out: 0,
    state_hash_algorithm: "sha256:ready-v1",
    checks: readyJsonChecks()
  }), "utf8");

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const readyJsonCheck = data.checks.find(c => c.id === "MH_READY_JSON_001");
  assert.equal(readyJsonCheck.status, "fail");
  assert.match(readyJsonCheck.reason, /git_commit mismatch/);
});

test("missing ready.json binding fields are rejected", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Missing fields target"]);
  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), JSON.stringify({
    schema_version: "1.0.0",
    checks: []
  }), "utf8");
  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const readyJsonCheck = data.checks.find(c => c.id === "MH_READY_JSON_001");
  assert.equal(readyJsonCheck.status, "fail");
  assert.match(readyJsonCheck.reason, /missing target/);
});

test("ready.json count fields must match checks", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Count mismatch target"]);
  const { computeReadyStateHash } = require("../lib/ready-check");
  const checks = readyJsonChecks();
  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), JSON.stringify({
    schema_version: "1.0.0",
    target: cwd.split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    expires_after: new Date(Date.now() + 60000).toISOString(),
    git_commit: null,
    state_hash: computeReadyStateHash(cwd),
    mode: "local",
    redacted: true,
    ok: true,
    passed: 15,
    failed: 0,
    skipped: 0,
    warned: 0,
    unknown: 0,
    timed_out: 0,
    state_hash_algorithm: "sha256:ready-v1",
    checks
  }), "utf8");

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const readyJsonCheck = data.checks.find(c => c.id === "MH_READY_JSON_001");
  assert.equal(readyJsonCheck.status, "fail");
  assert.match(readyJsonCheck.reason, /check count mismatch for passed/);
});

test("CI workflows without npm ci warns or fails reproducibility check", () => {
  const cwd = tempDir();
  run(cwd, ["init", "CI fail target"]);

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0"
  }), "utf8");
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");

  fs.mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".github", "workflows", "ci.yml"), "steps:\n  - run: npm install", "utf8");

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const repro = data.checks.find(c => c.id === "MH_REPRO_001");
  assert.equal(repro.status, "fail");
  assert.match(repro.reason, /uses npm install instead of npm ci/);
});

test("ready --read-only standalone implies no-exec (skips tests)", () => {
  const cwd = tempDir();
  run(cwd, ["init", "ReadOnly check target"]);
  run(cwd, ["templates", "install", "--allow-dirty"]);

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: { test: "exit 1" } // test fails if executed
  }), "utf8");
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");

  run(cwd, ["quality", "init"]);

  // Without no-exec, read-only should still skip tests
  const res = runRaw(cwd, ["ready", "--target", cwd, "--read-only", "--json"]);
  const data = JSON.parse(res.stdout);
  const testCheck = data.checks.find(c => c.id === "MH_TEST_001");
  assert.equal(testCheck.status, "skip");
  assert.match(testCheck.reason, /skipped/);
});

test("npm pack --ignore-scripts side-effect regression test", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Ignore scripts target"]);

  const markerPath = path.join(cwd, "marker.txt");
  const argsPath = path.join(cwd, "npm-args.json");
  const fakeNpmPath = path.join(cwd, "fake-npm.js");
  fs.writeFileSync(fakeNpmPath, [
    "\"use strict\";",
    "const fs = require(\"node:fs\");",
    `const markerPath = ${JSON.stringify(markerPath)};`,
    `const argsPath = ${JSON.stringify(argsPath)};`,
    "const args = process.argv.slice(2);",
    "fs.writeFileSync(argsPath, JSON.stringify(args), \"utf8\");",
    "if (!args.includes(\"--ignore-scripts\")) fs.writeFileSync(markerPath, \"run\", \"utf8\");",
    "process.stdout.write(JSON.stringify([{ files: [{ path: \"package.json\" }] }]));"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: {}
  }), "utf8");

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--json"], {
    env: { ...process.env, npm_execpath: fakeNpmPath }
  });
  const data = JSON.parse(res.stdout);
  const packageCheck = data.checks.find(c => c.id === "MH_PACKAGE_001");

  assert.equal(packageCheck.status, "pass");
  assert.equal(fs.existsSync(markerPath), false, "Marker file should not be created when --ignore-scripts is passed");
  assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, "utf8")), ["pack", "--dry-run", "--json", "--ignore-scripts"]);
});

test("generated ready --json validates as ready.json", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Generated JSON target"]);

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: {}
  }), "utf8");
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");
  writePhase5SecurityFixture(cwd);
  fs.writeFileSync(path.join(cwd, ".npmignore"), ".meta-harness\n", "utf8");
  run(cwd, ["quality", "init"]);
  run(cwd, ["templates", "install", "--allow-dirty"]);

  const jsonOutput = run(cwd, ["ready", "--target", cwd, "--quick", "--json"]);

  fs.mkdirSync(path.join(cwd, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".meta-harness", "ready.json"), jsonOutput, "utf8");

  const verifyRes = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  assert.equal(verifyRes.status, 0);
  const data = JSON.parse(verifyRes.stdout);
  const readyJsonCheck = data.checks.find(c => c.id === "MH_READY_JSON_001");
  assert.equal(readyJsonCheck.status, "pass");
});

test("worktree Git detection integration test", () => {
  const cwd = tempDir();
  const gitCheck = spawnSync("git", ["--version"]);
  if (gitCheck.status !== 0) {
    return;
  }

  const mainRepo = path.join(cwd, "main");
  fs.mkdirSync(mainRepo);
  spawnSync("git", ["init"], { cwd: mainRepo });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: mainRepo });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: mainRepo });

  fs.writeFileSync(path.join(mainRepo, "package.json"), JSON.stringify({
    name: "main-target",
    version: "1.0.0",
    engines: { node: ">=20" },
    packageManager: "npm@10.0.0",
    scripts: {}
  }), "utf8");
  fs.writeFileSync(path.join(mainRepo, "package-lock.json"), JSON.stringify({
    name: "main-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");

  spawnSync("git", ["add", "."], { cwd: mainRepo });
  spawnSync("git", ["commit", "-m", "initial commit"], { cwd: mainRepo });

  const worktreePath = path.join(cwd, "worktree-branch");
  const wtRes = spawnSync("git", ["worktree", "add", "-b", "new-branch", worktreePath], { cwd: mainRepo });
  if (wtRes.status !== 0) {
    return;
  }

  const res = runRaw(worktreePath, ["ready", "--target", worktreePath, "--quick", "--json"]);
  const data = JSON.parse(res.stdout);
  const gitCheckRes = data.checks.find(c => c.id === "MH_GITCHECK_001");
  assert.equal(gitCheckRes.status, "pass");
});
