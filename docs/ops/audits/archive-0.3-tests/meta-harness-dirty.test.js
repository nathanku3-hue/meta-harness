"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { prepareInitInvocation } = require("./helpers/truth-authority");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-dirty-"));
}

function run(cwd, args) {
  const invocation = prepareInitInvocation(cwd, args);
  const result = spawnSync(process.execPath, [CLI, ...invocation], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${invocation.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

function initGitRepo(cwd) {
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
}

function writeFile(cwd, relativePath, text) {
  const fullPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text, "utf8");
}

function readJson(cwd, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(cwd, relativePath), "utf8"));
}

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function assertCliError(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(errorCode(result), "MH_USAGE", result.stderr);
  assert.match(result.stderr, pattern);
}

function commitBaseline(cwd) {
  writeFile(cwd, "src/owned.js", "const owned = 1;\n");
  writeFile(cwd, "notes/user note.md", "baseline\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "baseline"]);
}

function writeScope(cwd, body) {
  writeFile(cwd, ".meta-harness/scope.json", `${JSON.stringify(body, null, 2)}\n`);
}

function classify(cwd, extraArgs = []) {
  return run(cwd, [
    "dirty", "classify",
    "--before", ".meta-harness/snapshots/before.json",
    "--after", ".meta-harness/snapshots/after.json",
    "--scope", ".meta-harness/scope.json",
    "--out", ".meta-harness/dirty-work.json",
    ...extraArgs,
  ]);
}

test("dirty templates install with packaged contracts", () => {
  const cwd = tempDir();
  const list = run(cwd, ["templates", "list"]);
  assert.match(list, /skills\s+dirty-work-autopilot\.md/);
  assert.match(list, /contracts\s+dirty-work-contract\.md/);

  run(cwd, ["init", "Install dirty work templates"]);
  run(cwd, ["templates", "install"]);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "templates", "skills", "dirty-work-autopilot.md")), true);
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "templates", "contracts", "dirty-work-contract.md")), true);
});

test("dirty snapshot uses repo root from subdirectories and suppresses inherited outside-scope dirt", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  const subdir = path.join(cwd, "src", "nested");
  fs.mkdirSync(subdir, { recursive: true });

  writeFile(cwd, "notes/user note.md", "pre-existing user edit\n");
  run(subdir, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(cwd, "src/owned.js", "const owned = 2;\n");
  run(subdir, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(cwd, { owned_paths: ["src/owned.js"] });

  const output = classify(subdir);
  assert.match(output, /No current-scope blocker/);
  const dirty = readJson(cwd, ".meta-harness/dirty-work.json");
  assert.equal(dirty.classifications.find((item) => item.path === "notes/user note.md").classification, "inherited_dirty_outside_scope");
  assert.equal(dirty.classifications.find((item) => item.path === "notes/user note.md").pm_visible, false);
  assert.equal(dirty.classifications.find((item) => item.path === "src/owned.js").classification, "clean_owned_path_edit");
  assert.equal(fs.existsSync(path.join(cwd, ".meta-harness", "dirty-work-queue.json")), true);
});

test("dirty classify creates decision inbox and scope-sensitive decision hashes", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  writeFile(cwd, "src/owned.js", "pre-existing owned edit\n");
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);

  writeScope(cwd, { owned_paths: ["src/owned.js"] });
  classify(cwd);
  const first = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((item) => item.path === "src/owned.js");
  const inbox = readJson(cwd, ".meta-harness/decision-inbox.json");
  assert.equal(inbox.decisions.length, 1);
  assert.equal(inbox.decisions[0].state_hash, first.decision_state_hash);

  writeScope(cwd, { owned_paths: ["src/owned.js"], generated_paths: ["dist/"] });
  classify(cwd);
  const second = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((item) => item.path === "src/owned.js");
  assert.notEqual(first.decision_state_hash, second.decision_state_hash);
});

test("before-only inherited dirty cleanup is blocked by scope gate", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  writeFile(cwd, "notes/user note.md", "pre-existing user edit\n");
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(cwd, "notes/user note.md", "baseline\n");
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(cwd, { owned_paths: ["src/owned.js"] });
  classify(cwd);

  const item = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((entry) => entry.path === "notes/user note.md");
  assert.equal(item.classification, "inherited_dirty_removed_or_cleaned");
  assert.equal(item.action, "BLOCK");
  assertCliError(runRaw(cwd, ["gate", "scope", "--dirty", ".meta-harness/dirty-work.json", "--scope", ".meta-harness/scope.json"]), /scope gate failed/);
});

test("scope gate blocks staged outside-scope dirt and requires scope", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(cwd, "outside.js", "const outside = true;\n");
  git(cwd, ["add", "outside.js"]);
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(cwd, { owned_paths: ["src/owned.js"] });
  classify(cwd);

  const item = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((entry) => entry.path === "outside.js");
  assert.equal(item.classification, "staged_outside_scope");
  assertCliError(runRaw(cwd, ["gate", "scope", "--dirty", ".meta-harness/dirty-work.json"]), /gate scope requires --scope/);
  assertCliError(runRaw(cwd, ["gate", "scope", "--dirty", ".meta-harness/dirty-work.json", "--scope", ".meta-harness/scope.json"]), /scope gate failed/);
});

test("dirty classify escalates sensitive dirt by metadata", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(cwd, ".env.local", "DO_NOT_READ=1\n");
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(cwd, { owned_paths: ["src/owned.js"] });
  classify(cwd);

  const item = readJson(cwd, ".meta-harness/dirty-work.json")
    .classifications.find((entry) => entry.path === ".env.local");
  assert.equal(item.classification, "credential_provider_runtime_dirt");
  assert.equal(item.action, "ESCALATE");
});

test("dirty classify queues generated artifacts and passes clean owned edits", () => {
  const cwd = tempDir();
  initGitRepo(cwd);
  commitBaseline(cwd);
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(cwd, "src/owned.js", "const owned = 2;\n");
  writeFile(cwd, "dist/bundle.js", "generated\n");
  run(cwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(cwd, { owned_paths: ["src/owned.js"], generated_paths: ["dist/"] });
  classify(cwd);

  const dirty = readJson(cwd, ".meta-harness/dirty-work.json");
  assert.equal(dirty.classifications.find((item) => item.path === "src/owned.js").classification, "clean_owned_path_edit");
  assert.equal(dirty.classifications.find((item) => item.path === "dist/bundle.js").classification, "generated_cache_artifact");
  assert.match(run(cwd, ["gate", "scope", "--dirty", ".meta-harness/dirty-work.json", "--scope", ".meta-harness/scope.json"]), /Scope gate: PASS/);

  writeScope(cwd, { owned_paths: ["src/owned.js"] });
  assertCliError(runRaw(cwd, ["gate", "scope", "--dirty", ".meta-harness/dirty-work.json", "--scope", ".meta-harness/scope.json"]), /scope hash does not match/);
});

test("ship gate classifies queue only package risk and stale scope", () => {
  const queueCwd = tempDir();
  initGitRepo(queueCwd);
  commitBaseline(queueCwd);
  run(queueCwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(queueCwd, "dist/bundle.js", "generated\n");
  run(queueCwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(queueCwd, { owned_paths: ["src/owned.js"], generated_paths: ["dist/"] });
  classify(queueCwd);

  const queueGate = runRaw(queueCwd, [
    "gate", "ship",
    "--dirty", ".meta-harness/dirty-work.json",
    "--scope", ".meta-harness/scope.json",
    "--json",
  ]);
  assert.equal(queueGate.status, 0);
  const queueJson = JSON.parse(queueGate.stdout);
  assert.equal(queueJson.tier, "FAST");
  assert.equal(queueJson.resolution, "follow-up-queued");
  assert.deepEqual(queueJson.changed_paths, [".meta-harness/snapshots/before.json", "dist/bundle.js"]);

  const packageCwd = tempDir();
  initGitRepo(packageCwd);
  writeFile(packageCwd, "package.json", "{\"name\":\"demo\"}\n");
  git(packageCwd, ["add", "."]);
  git(packageCwd, ["commit", "-m", "baseline"]);
  run(packageCwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/before.json"]);
  writeFile(packageCwd, "package.json", "{\"name\":\"demo\",\"version\":\"1.0.0\"}\n");
  run(packageCwd, ["dirty", "snapshot", "--out", ".meta-harness/snapshots/after.json"]);
  writeScope(packageCwd, { owned_paths: ["package.json"] });
  classify(packageCwd);

  const packageGate = runRaw(packageCwd, [
    "gate", "ship",
    "--dirty", ".meta-harness/dirty-work.json",
    "--scope", ".meta-harness/scope.json",
    "--json",
    "--checks-status", "pass",
  ]);
  assert.equal(packageGate.status, 1);
  const packageJson = JSON.parse(packageGate.stdout);
  assert.equal(packageJson.tier, "SLOW");
  assert.equal(packageJson.resolution, "decision-needed");

  writeScope(packageCwd, { owned_paths: ["src/"] });
  const staleGate = runRaw(packageCwd, [
    "gate", "ship",
    "--dirty", ".meta-harness/dirty-work.json",
    "--scope", ".meta-harness/scope.json",
    "--json",
  ]);
  assert.equal(staleGate.status, 1);
  const staleJson = JSON.parse(staleGate.stdout);
  assert.equal(staleJson.tier, "BLOCK");
  assert.equal(staleJson.resolution, "blocked");
  assert.match(staleJson.reasons.join("\n"), /scope hash/);
});
