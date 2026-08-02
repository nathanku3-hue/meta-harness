"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function createRepo() {
  const root = tempDir("layout-cli-fixture-");
  git(root, ["init"]);
  git(root, ["config", "user.email", "layout@example.invalid"]);
  git(root, ["config", "user.name", "Layout CLI Fixture"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "fixture"]);
  const target = path.join(root, ".worktrees", "cli-orphan");
  fs.mkdirSync(target, { recursive: true });
  return { root, target };
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("layout manifest and close CLI expose the real transaction", () => {
  const fixture = createRepo();
  const evidence = tempDir("layout-cli-evidence-");
  const manifest = path.join(evidence, "manifest.json");
  const copy = path.join(evidence, "manifest-copy.json");
  const receipt = path.join(evidence, "receipt.json");

  const manifestResult = runCli(fixture.root, [
    "layout",
    "manifest",
    "--target",
    fixture.root,
    "--output",
    manifest,
    "--copy",
    copy,
    "--json",
  ]);
  assert.equal(manifestResult.status, 0, manifestResult.stderr);
  assert.equal(manifestResult.stderr, "");
  const manifestSummary = JSON.parse(manifestResult.stdout);
  assert.equal(manifestSummary.ok, true);
  assert.equal(manifestSummary.target_classification, "primary-checkout");
  assert.equal(fs.existsSync(manifest), true);
  assert.equal(fs.readFileSync(manifest).equals(fs.readFileSync(copy)), true);

  const closeResult = runCli(fixture.root, [
    "layout",
    "close",
    "--target",
    fixture.target,
    "--manifest",
    manifest,
    "--manifest-copy",
    copy,
    "--receipt",
    receipt,
    "--json",
  ]);
  assert.equal(closeResult.status, 0, closeResult.stderr);
  assert.equal(closeResult.stderr, "");
  const closeSummary = JSON.parse(closeResult.stdout);
  assert.equal(closeSummary.verdict, "CLOSED");
  assert.equal(closeSummary.receipt_state, "closed");
  assert.equal(fs.existsSync(fixture.target), false);
  assert.equal(JSON.parse(fs.readFileSync(receipt, "utf8")).state, "closed");
});

test("layout command is registered and help shows both bounded actions", () => {
  const result = runCli(tempDir("layout-cli-help-"), ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /meta-harness layout manifest --target <repo> --output <path>/);
  assert.match(result.stdout, /meta-harness layout close --target <path> --manifest <path> --receipt <path>/);
});
