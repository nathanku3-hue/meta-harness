"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { gitExecutableForWorkspace } = require("../lib/git-command");
const { analyzeQuality } = require("../lib/quality");
const { pathIdentity, scanRepositoryLayout } = require("../lib/root-leak-check");
const { runReadyCheck } = require("../lib/ready-check");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function createRepo() {
  const root = tempDir("layout-custody-");
  git(root, ["init"]);
  git(root, ["config", "user.email", "layout@example.invalid"]);
  git(root, ["config", "user.name", "Layout Fixture"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

function addManagedWorktree(root, name = "registered") {
  const worktreePath = path.join(root, ".worktrees", name);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(root, ["worktree", "add", "-b", `fixture-${name}`, worktreePath, "HEAD"]);
  return worktreePath;
}

function replaceAdministrationPointer(root, worktreePath, pointer) {
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const adminGitdir = path.join(commonDir, "worktrees", path.basename(worktreePath), "gitdir");
  fs.chmodSync(adminGitdir, 0o666);
  fs.writeFileSync(adminGitdir, pointer, "utf8");
}

test("path identity treats Windows and WSL spellings as one path", () => {
  assert.equal(pathIdentity("E:\\Code\\meta-harness"), pathIdentity("/mnt/e/Code/meta-harness"));
});

test("Git inspection uses native Git for WSL-mounted repositories", () => {
  const executable = gitExecutableForWorkspace({
    cwd: "/mnt/e/Code/meta-harness",
    fs,
    platform: "linux",
    spawn() {
      throw new Error("Windows Git must not be probed for a native WSL path");
    },
  });

  assert.equal(executable, "git");
});

test("Git inspection probes Windows Git for Windows-spelled repositories", () => {
  const calls = [];
  const executable = gitExecutableForWorkspace({
    cwd: "E:/Code/meta-harness",
    fs,
    platform: "linux",
    spawn(command, args) {
      calls.push([command, args]);
      return { status: 0, error: null };
    },
  });

  assert.equal(executable, "git.exe");
  assert.deepEqual(calls, [["git.exe", ["--version"]]]);
});

test("Git inspection retains native Git for ordinary Linux repositories", () => {
  const executable = gitExecutableForWorkspace({
    cwd: "/tmp/meta-harness",
    fs: {
      lstatSync() {
        throw new Error("no .git pointer");
      },
    },
    platform: "linux",
    spawn() {
      throw new Error("Windows Git must not be probed");
    },
  });

  assert.equal(executable, "git");
});

test("repository layout detects an empty physical orphan", () => {
  const root = createRepo();
  fs.mkdirSync(path.join(root, ".worktrees", "orphan"), { recursive: true });

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.registered_managed, 0);
  assert.equal(result.counts.physical_managed, 1);
  assert.equal(result.counts.physical_only, 1);
  assert.equal(result.items.some((entry) => entry.classification === "physical-orphan"), true);
});

test("repository layout detects a registered path that is missing", () => {
  const root = createRepo();
  const worktreePath = addManagedWorktree(root, "missing");
  fs.rmSync(worktreePath, { recursive: true, force: true });

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.registered_managed, 1);
  assert.equal(result.counts.registered_only, 1);
  assert.equal(result.items.some((entry) => entry.classification === "registered-missing"), true);
});

test("repository layout detects a broken worktree git pointer", () => {
  const root = createRepo();
  const worktreePath = addManagedWorktree(root, "broken");
  replaceAdministrationPointer(root, worktreePath, "E:/definitely-missing/layout-custody/.git\n");

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.registered_managed, 1);
  assert.equal(result.counts.physical_managed, 1);
  assert.equal(result.counts.physical_only, 1);
  assert.equal(result.counts.broken_pointers >= 1, true);
  assert.equal(result.items.some((entry) => entry.classification === "broken-git-pointer"), true);
});

test("repository layout rejects a registered worktree outside owner custody", () => {
  const root = createRepo();
  const externalPath = `${root}-external-worktree`;
  git(root, ["worktree", "add", "-b", "fixture-external", externalPath, "HEAD"]);

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.registered_only, 1);
  assert.equal(result.items.some((entry) => entry.classification === "noncanonical-managed-path"), true);
});

test("repository layout rejects arbitrary untracked root directories", () => {
  const root = createRepo();
  fs.mkdirSync(path.join(root, "mcps"));

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.unexpected_root_entries, 1);
  assert.equal(result.items.some((entry) => entry.classification === "unexpected-root-entry" && entry.path.endsWith("/mcps")), true);
});

test("repository layout reproduces the 14 physical, one registered, 13 physical-only topology", () => {
  const root = createRepo();
  addManagedWorktree(root, "registered");
  for (let index = 1; index <= 13; index += 1) {
    fs.mkdirSync(path.join(root, ".worktrees", `orphan-${String(index).padStart(2, "0")}`));
  }

  const result = scanRepositoryLayout({ targetRoot: root, creatorRoots: [] });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.counts.registered_managed, 1);
  assert.equal(result.counts.physical_managed, 14);
  assert.equal(result.counts.physical_only, 13);
  assert.equal(result.counts.broken_pointers, 0);
});

test("quality and path-collision walkers exclude managed and creator worktree roots", () => {
  const root = tempDir("layout-quality-");
  fs.writeFileSync(path.join(root, "source.js"), "module.exports = 1;\n", "utf8");
  for (const relative of [
    ".worktrees/orphan/huge.js",
    ".worktree-owners/replay/.worktrees/unit/huge.js",
    ".devspace/worktrees/unit/huge.js",
    ".cursor/worktrees/unit/huge.js",
  ]) {
    const filePath = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "const value = 1;\n".repeat(1000), "utf8");
  }

  const analysis = analyzeQuality(root, { budgets: { max_source_file_lines: 500 } });

  assert.deepEqual(analysis.files.map((entry) => entry.relative), ["source.js"]);
  assert.equal(analysis.complexity.findings.some((entry) => String(entry.file || "").includes("worktrees")), false);
});

test("read-only readiness executes repository layout custody and fails on an orphan", async () => {
  const root = createRepo();
  fs.mkdirSync(path.join(root, ".worktrees", "orphan"), { recursive: true });

  const result = await runReadyCheck({ targetRoot: root, quick: true, readOnly: true, mode: "local" });
  const layout = result.checks.find((check) => check.id === "MH_STATE_ROOT_LEAK_001");

  assert.equal(layout.name, "repository_layout");
  assert.equal(layout.status, "fail");
  assert.equal(layout.details.counts.physical_only, 1);
  assert.match(layout.next_action, /do not delete through readiness/i);
});
