"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const os = require("node:os");

const {
  CHECK_ID,
  ensureLocalWorktreesExclude,
  hasLocalWorktreesExclude,
  assertManagedDestination,
  deriveManagedWorktreePath,
  checkWorktreeCustody,
  getContractDocument,
  nativePath,
  gitPath,
  comparisonKey,
  pathsEqual,
} = require("../lib/worktree-custody");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mh-wt-custody-"));
}

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function initRepo() {
  const cwd = tempDir();
  git(["init"], cwd);
  git(["config", "user.email", "test@example.com"], cwd);
  git(["config", "user.name", "test"], cwd);
  fs.writeFileSync(path.join(cwd, "README.md"), "x\n", "utf8");
  git(["add", "README.md"], cwd);
  git(["commit", "-m", "init"], cwd);
  return cwd;
}

test("contract document exposes MH_WORKTREE_001", () => {
  const doc = getContractDocument();
  assert.equal(doc.check_id, CHECK_ID);
  assert.equal(doc.local_exclude, "/.worktrees/");
});

test("ensureLocalWorktreesExclude installs exclude line", () => {
  const cwd = initRepo();
  assert.equal(hasLocalWorktreesExclude(cwd), false);
  ensureLocalWorktreesExclude(cwd);
  assert.equal(hasLocalWorktreesExclude(cwd), true);
  // idempotent
  ensureLocalWorktreesExclude(cwd);
  assert.equal(hasLocalWorktreesExclude(cwd), true);
});

test("assertManagedDestination accepts repo-local path and rejects C:", () => {
  const cwd = initRepo();
  const ok = assertManagedDestination(cwd, path.join(cwd, ".worktrees", "unit-a"));
  assert.equal(ok.ok, true);

  const badC = assertManagedDestination(cwd, "C:\\Users\\Lenovo\\.devspace\\worktrees\\unit-a");
  assert.equal(badC.ok, false);
  assert.ok(badC.findings.some((f) => f.code === "REJECT_C_DRIVE" || f.code === "REJECT_GLOBAL_CREATOR_ROOT" || f.code === "REJECT_NOT_UNDER_WORKTREES"));

  const badSibling = assertManagedDestination(cwd, path.join(path.dirname(cwd), `${path.basename(cwd)}-task`));
  assert.equal(badSibling.ok, false);
});

test("deriveManagedWorktreePath builds under .worktrees", () => {
  const cwd = initRepo();
  const dest = deriveManagedWorktreePath(cwd, "bounded-1");
  assert.ok(dest.toLowerCase().endsWith(`${path.sep}.worktrees${path.sep}bounded-1`.toLowerCase()) ||
    dest.toLowerCase().includes(".worktrees\\bounded-1") ||
    dest.toLowerCase().includes(".worktrees/bounded-1"));
});

test("path dialect adapter separates native, Git, and comparison identities", () => {
  const windowsForm = "E:/Code/meta-harness";
  const wslForm = "/mnt/e/Code/meta-harness";
  const native = nativePath(windowsForm);

  assert.equal(pathsEqual(windowsForm, wslForm), true);
  assert.equal(comparisonKey(windowsForm), comparisonKey(wslForm));
  if (process.platform === "win32") {
    assert.match(native, /^E:[\\/]Code[\\/]meta-harness$/i);
  } else {
    assert.equal(native, wslForm);
    assert.equal(gitPath(native, "C:/Program Files/Git/bin/git.exe"), windowsForm);
  }

  const repoLocal = assertManagedDestination(
    wslForm,
    `${wslForm}/.worktrees/unit-a`,
  );
  assert.equal(repoLocal.ok, true, JSON.stringify(repoLocal.findings));
});

test("checkWorktreeCustody fails without exclude when managed worktrees are enabled", () => {
  const cwd = initRepo();
  fs.mkdirSync(path.join(cwd, ".worktrees"), { recursive: true });
  const res = checkWorktreeCustody({ targetRoot: cwd, mode: "local", auditCreatorRoots: false });
  assert.equal(res.status, "fail");
  assert.match(res.reason, /exclude|MISSING_LOCAL_EXCLUDE|missing/i);
});

test("checkWorktreeCustody does not require an exclude before managed worktrees exist", () => {
  const cwd = initRepo();
  const res = checkWorktreeCustody({
    targetRoot: cwd,
    mode: "local",
    auditCreatorRoots: false,
  });
  assert.equal(res.status, "pass", res.reason);
  assert.equal(res.details.local_exclude_required, false);
  assert.equal(res.details.local_exclude, false);
});

test("checkWorktreeCustody passes clean repo with exclude and no linked worktrees", () => {
  const cwd = initRepo();
  ensureLocalWorktreesExclude(cwd);
  const res = checkWorktreeCustody({
    targetRoot: cwd,
    mode: "local",
    auditCreatorRoots: false,
  });
  assert.equal(res.status, "pass", res.reason);
});

test("checkWorktreeCustody fails noncanonical linked worktree path", () => {
  const cwd = initRepo();
  ensureLocalWorktreesExclude(cwd);
  const sibling = path.join(path.dirname(cwd), `mh-wt-sibling-${Date.now()}`);
  try {
    git(["worktree", "add", "--detach", sibling, "HEAD"], cwd);
    const res = checkWorktreeCustody({ targetRoot: cwd, mode: "ci" });
    assert.equal(res.status, "fail");
    assert.ok(
      res.findings.some((f) => f.code === "NONCANONICAL_WORKTREE_PATH"),
      JSON.stringify(res.findings),
    );
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", sibling], { cwd, windowsHide: true });
    try { fs.rmSync(sibling, { recursive: true, force: true }); } catch (_) {}
  }
});

test("positive create under .worktrees is approved by assertManagedDestination", () => {
  const cwd = initRepo();
  ensureLocalWorktreesExclude(cwd);
  const dest = path.join(cwd, ".worktrees", "positive-unit");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const verdict = assertManagedDestination(cwd, dest);
  assert.equal(verdict.ok, true);
  git(["worktree", "add", "--detach", dest, "HEAD"], cwd);
  const res = checkWorktreeCustody({
    targetRoot: cwd,
    mode: "local",
    requireLifecycle: false,
    auditCreatorRoots: false,
  });
  assert.equal(res.status, "pass", res.reason);
  git(["worktree", "remove", dest], cwd);
});
