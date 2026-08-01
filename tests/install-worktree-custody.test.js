"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  installProjection,
  summarizeRecords,
} = require("../scripts/install-worktree-custody");

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return String(result.stdout || "").trim();
}

function initRepo(parent, name = "repo") {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  git(["init"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "test"], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "x\n", "utf8");
  git(["add", "README.md"], repo);
  git(["commit", "-m", "init"], repo);
  return repo;
}

test("summarizeRecords counts projected but noncompliant records as failed", () => {
  const counts = summarizeRecords([
    { installed: false, projected: true, compliant: false, exemption: null },
    { installed: true, projected: true, compliant: true, exemption: null },
    { installed: false, exemption: "legacy exception" },
  ]);
  assert.deepEqual(counts, {
    repositories_installed: 1,
    repositories_exempted: 1,
    repositories_failed: 1,
  });
});

test("installProjection succeeds only when projection tests and custody pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-install-custody-pass-"));
  try {
    const repo = initRepo(root);
    const record = installProjection(repo, {
      stampLifecycle: false,
      auditCreatorRoots: false,
    });
    assert.equal(record.projected, true);
    assert.equal(record.projection_tests_passed, true);
    assert.equal(record.custody_check_status, "pass");
    assert.equal(record.compliant, true);
    assert.equal(record.installed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer exits nonzero and inventory fails a projected repository with an external worktree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-install-custody-fail-"));
  const repo = initRepo(root);
  const sibling = path.join(root, "repo-leak");
  const inventoryPath = path.join(root, "inventory.json");

  try {
    git(["worktree", "add", "--detach", sibling, "HEAD"], repo);
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "../scripts/install-worktree-custody.js"),
        root,
        `--inventory=${inventoryPath}`,
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        windowsHide: true,
      },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /FAIL .*repo installed=false .*custody=fail/);
    assert.doesNotMatch(result.stdout, /INSTALL .*repo /);
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
    const record = inventory.records.find((entry) => path.basename(entry.repository) === "repo");
    assert.ok(record, JSON.stringify(inventory, null, 2));
    assert.equal(record.projected, true);
    assert.equal(record.custody_check_status, "fail");
    assert.equal(record.compliant, false);
    assert.equal(record.installed, false);
    assert.ok(inventory.repositories_failed >= 1);
    assert.equal(inventory.repositories_installed, 0);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", sibling], {
      cwd: repo,
      windowsHide: true,
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
