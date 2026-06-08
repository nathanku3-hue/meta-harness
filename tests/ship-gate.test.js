"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  SHIPGATE_CHECK_ID,
  classifyCurrentChangeSet,
  classifyDirtyResult,
  classifyPaths,
  classifyWorkerReport,
  normalizePath,
  _test,
} = require("../lib/ship-gate");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-ship-gate-"));
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

function dirtyResult(classifications, overrides = {}) {
  return {
    schema_version: "1.0.0",
    target: tempDir().split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    redacted: true,
    scope_hash: "scope-1",
    classifications,
    ...overrides,
  };
}

test("ship gate exports stable check ID", () => {
  assert.equal(SHIPGATE_CHECK_ID, "MH_SHIPGATE_001");
});

test("path classifier applies check status before returning ship", () => {
  assert.deepEqual(
    classifyPaths(["docs/guide.md"], { owned_paths: ["docs/"], checks_status: "pass" }),
    {
      tier: "FAST",
      resolution: "ship",
      changed_paths: ["docs/guide.md"],
      decision_required: false,
      reasons: ["docs/guide.md: docs-only owned path"],
    },
  );

  const unknown = classifyPaths(["docs/guide.md"], { owned_paths: ["docs/"] });
  assert.equal(unknown.tier, "FAST");
  assert.equal(unknown.resolution, "follow-up-queued");
  assert.match(unknown.reasons.join("\n"), /checks are unknown/);

  const failed = classifyPaths(["tests/ship.test.js"], { owned_paths: ["tests/"], checks_status: "fail" });
  assert.equal(failed.tier, "REVIEW");
  assert.equal(failed.resolution, "blocked");
  assert.match(failed.reasons.join("\n"), /checks failed/);
});

test("highest risk tier wins for mixed paths and workflow metadata", () => {
  const packageTouch = classifyPaths(["docs/guide.md", "package.json"], {
    owned_paths: ["docs/"],
    checks_status: "pass",
  });
  assert.equal(packageTouch.tier, "SLOW");
  assert.equal(packageTouch.resolution, "decision-needed");

  const credentialTouch = classifyPaths(["docs/guide.md", ".env.local"], {
    owned_paths: ["docs/"],
    checks_status: "pass",
  });
  assert.equal(credentialTouch.tier, "BLOCK");
  assert.equal(credentialTouch.resolution, "blocked");

  const workflowPermissionIncrease = classifyPaths([".github/workflows/ci.yml"], {
    workflow_permission_increase: true,
    checks_status: "pass",
  });
  assert.equal(workflowPermissionIncrease.tier, "BLOCK");
  assert.equal(workflowPermissionIncrease.resolution, "blocked");
});

test("normalizePath rejects hostile input", () => {
  assert.equal(normalizePath("docs\\guide.md"), "docs/guide.md");
  assert.throws(() => normalizePath("../outside.md"), /must not traverse/);
  assert.throws(() => normalizePath("/outside.md"), /repository-relative/);
  assert.throws(() => normalizePath("C:\\outside.md"), /repository-relative/);
  assert.throws(() => normalizePath("safe\0bad.md"), /NUL/);
});

test("dirty result keeps queue evidence deterministic and validates freshness", () => {
  const queueOnly = classifyDirtyResult(dirtyResult([
    { path: "dist/b.js", status: "??", action: "QUEUE", classification: "generated_cache_artifact" },
    { path: "dist/a.js", status: "??", action: "QUEUE", classification: "generated_cache_artifact" },
  ]));

  assert.equal(queueOnly.tier, "FAST");
  assert.equal(queueOnly.resolution, "follow-up-queued");
  assert.deepEqual(queueOnly.changed_paths, ["dist/a.js", "dist/b.js"]);
  assert.deepEqual(queueOnly.reasons, [
    "dist/a.js: queued dirty evidence retained (generated_cache_artifact)",
    "dist/b.js: queued dirty evidence retained (generated_cache_artifact)",
  ]);

  assert.throws(
    () => classifyDirtyResult(dirtyResult([], { generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })),
    /stale/,
  );
  assert.throws(
    () => classifyDirtyResult(dirtyResult([], { generated_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })),
    /future/,
  );
});

test("dirty result maps mixed queue and slow/block actions", () => {
  const mixed = classifyDirtyResult(dirtyResult([
    { path: "dist/bundle.js", status: "??", action: "QUEUE", classification: "generated_cache_artifact" },
    { path: "package.json", status: " M", action: "PASS", classification: "clean_owned_path_edit" },
  ], { target: undefined }), { checks_status: "pass" });

  assert.equal(mixed.tier, "SLOW");
  assert.equal(mixed.resolution, "decision-needed");
  assert.deepEqual(mixed.changed_paths, ["dist/bundle.js", "package.json"]);

  const blocked = classifyDirtyResult(dirtyResult([
    { path: ".env.local", status: "??", action: "BLOCK", classification: "credential_provider_runtime_dirt" },
  ]));
  assert.equal(blocked.tier, "BLOCK");
  assert.equal(blocked.resolution, "blocked");
});

test("worker report classifier maps accountability fields to tiers", () => {
  assert.equal(classifyWorkerReport({
    outcome: "DONE",
    requested_work_type: "docs",
    actual_work_type: "docs",
    checks_status: "pass",
  }).resolution, "ship");

  const docsUnknown = classifyWorkerReport({
    outcome: "DONE",
    requested_work_type: "docs",
    actual_work_type: "docs",
  });
  assert.equal(docsUnknown.tier, "FAST");
  assert.equal(docsUnknown.resolution, "follow-up-queued");

  const codeFailed = classifyWorkerReport({
    outcome: "DONE",
    requested_work_type: "code",
    actual_work_type: "code",
    checks_status: "fail",
  });
  assert.equal(codeFailed.tier, "REVIEW");
  assert.equal(codeFailed.resolution, "blocked");

  const rejected = classifyWorkerReport({
    outcome: "REJECTED",
    requested_work_type: "docs",
    actual_work_type: "none",
    checks_status: "pass",
  });
  assert.equal(rejected.tier, "BLOCK");
  assert.equal(rejected.resolution, "blocked");

  const provider = classifyWorkerReport({
    outcome: "DONE",
    requested_work_type: "provider_probe",
    actual_work_type: "provider_probe",
    provider_access_touched: true,
    checks_status: "pass",
  });
  assert.equal(provider.tier, "SLOW");
  assert.equal(provider.resolution, "decision-needed");
});

test("git porcelain rename/copy parsing classifies both target and original paths", () => {
  const paths = _test.parseStatusZ("R  .github/workflows/ci.yml\0docs/ci.md\0");
  assert.deepEqual(paths, [".github/workflows/ci.yml", "docs/ci.md"]);
  const result = classifyPaths(paths, { owned_paths: ["docs/"], checks_status: "pass" });
  assert.equal(result.tier, "SLOW");
});

test("current change classifier uses live git state and no-optional-locks-compatible status", () => {
  const gitCheck = spawnSync("git", ["--version"]);
  if (gitCheck.status !== 0) {
    return;
  }

  const cwd = tempDir();
  initGitRepo(cwd);
  writeFile(cwd, "docs/guide.md", "hello\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "baseline"]);
  writeFile(cwd, "docs/guide.md", "hello again\n");

  const result = classifyCurrentChangeSet({
    targetRoot: cwd,
    owned_paths: ["docs/"],
    checks_status: "pass",
  });

  assert.equal(result.tier, "FAST");
  assert.equal(result.resolution, "ship");
  assert.deepEqual(result.changed_paths, ["docs/guide.md"]);
});

test("current change classifier reads module path owners from owners.json", () => {
  const gitCheck = spawnSync("git", ["--version"]);
  if (gitCheck.status !== 0) {
    return;
  }

  const cwd = tempDir();
  initGitRepo(cwd);
  writeFile(cwd, "docs/architecture/owners.json", JSON.stringify({
    modules: [
      { path: "docs/", owner: "docs-team", risk: "docs" },
    ],
  }, null, 2));
  writeFile(cwd, "docs/guide.md", "hello\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "baseline"]);
  writeFile(cwd, "docs/guide.md", "hello again\n");

  const result = classifyCurrentChangeSet({
    targetRoot: cwd,
    checks_status: "pass",
  });

  assert.equal(result.tier, "FAST");
  assert.equal(result.resolution, "ship");
  assert.deepEqual(result.changed_paths, ["docs/guide.md"]);
});
