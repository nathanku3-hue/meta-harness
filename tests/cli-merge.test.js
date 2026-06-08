"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { runRaw, tempDir } = require("./helpers/cli");

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

test("merge check CLI emits machine-readable JSON for base/head mode", () => {
  const cwd = tempDir("meta-harness-cli-merge-");
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
  writeFile(cwd, "README.md", "base\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "base"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  writeFile(cwd, "lib/merge-check.js", "\"use strict\";\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "merge check"]);
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const result = runRaw(cwd, [
    "merge",
    "check",
    "--base", base,
    "--head", head,
    "--scope", "merge-protocol",
    "--expected-base", base,
    "--checks-status", "pass",
    "--json",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  assert.equal(data.scope, "merge-protocol");
  assert.equal(data.changed_files, 1);
});
