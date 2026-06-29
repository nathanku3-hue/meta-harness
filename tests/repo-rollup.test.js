"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-"));
}

function ensureHarness(root) {
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function configureRepos(parent, repos) {
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos });
}

function readSnapshot(paths) {
  return Object.fromEntries(paths.map((filePath) => [
    filePath,
    fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null,
  ]));
}

test("repo rollup returns an empty deterministic read-only schema", () => {
  const parent = tempDir();
  ensureHarness(parent);
  configureRepos(parent, []);

  const rollup = buildRepoRollup(parent);

  assert.equal(rollup.schema_version, "1.0.0");
  assert.equal(rollup.generated_from, "local_files");
  assert.equal(rollup.ok, true);
  assert.deepEqual(rollup.summary, {
    total: 0,
    ready: 0,
    warned: 0,
    failed: 0,
    unknown: 0,
    missing: 0,
    invalid: 0,
  });
  assert.deepEqual(rollup.repos, []);
  assert.deepEqual(rollup.not_changed, [
    "child_repos",
    "child_status",
    "child_events",
    "parent_status",
    "parent_events",
  ]);
  assert.match(renderRepoRollupMarkdown(rollup), /ROLLUP: 0\/0 repos ready/);
});

test("repo rollup classifies ready, warned, failed, status fallback, missing, and invalid repos", () => {
  const parent = tempDir();
  const readyChild = tempDir();
  const warnedChild = tempDir();
  const failedChild = tempDir();
  const statusChild = tempDir();
  const invalidChild = tempDir();
  const pollOnlyChild = tempDir();
  const missingChild = path.join(tempDir(), "does-not-exist");

  ensureHarness(parent);
  for (const child of [readyChild, warnedChild, failedChild, statusChild, invalidChild, pollOnlyChild]) {
    ensureHarness(child);
  }

  writeJson(path.join(readyChild, ".meta-harness", "ready.json"), {
    ok: true,
    passed: 16,
    failed: 0,
    warned: 0,
    skipped: 1,
    generated_at: "2026-06-30T00:00:00.000Z",
  });
  writeJson(path.join(warnedChild, ".meta-harness", "ready.json"), {
    ok: true,
    passed: 15,
    failed: 0,
    warned: 1,
  });
  writeJson(path.join(failedChild, ".meta-harness", "ready.json"), {
    ok: false,
    passed: 14,
    failed: 1,
    warned: 0,
  });
  writeFile(path.join(statusChild, ".meta-harness", "status.md"), "# Status\n\nPhase:\nclosed\n\nUpdated:\n2026-06-30\n\nCurrent truth:\nPASS\n");
  writeFile(path.join(invalidChild, ".meta-harness", "ready.json"), "{not-json\n");
  writeFile(path.join(pollOnlyChild, ".meta-harness", "poll.md"), "# Poll Summary\n\nchild evidence only\n");

  configureRepos(parent, [
    { name: "ready-child", path: readyChild, role: "child" },
    { name: "warned-child", path: warnedChild, role: "child" },
    { name: "failed-child", path: failedChild, role: "child" },
    { name: "status-child", path: statusChild, role: "child" },
    { name: "invalid-child", path: invalidChild, role: "child" },
    { name: "poll-only-child", path: pollOnlyChild, role: "child" },
    { name: "missing-child", path: missingChild, role: "child" },
  ]);

  const rollup = buildRepoRollup(parent);
  const states = Object.fromEntries(rollup.repos.map((repo) => [repo.name, repo.state]));

  assert.equal(rollup.ok, false);
  assert.deepEqual(states, {
    "ready-child": "ready",
    "warned-child": "warned",
    "failed-child": "failed",
    "status-child": "ready",
    "invalid-child": "invalid",
    "poll-only-child": "unknown",
    "missing-child": "missing",
  });
  assert.deepEqual(rollup.summary, {
    total: 7,
    ready: 2,
    warned: 1,
    failed: 1,
    unknown: 1,
    missing: 1,
    invalid: 1,
  });

  const markdown = renderRepoRollupMarkdown(rollup);
  assert.match(markdown, /Generated from: local_files/);
  assert.match(markdown, /Read-only: child_repos, child_status, child_events, parent_status, parent_events/);
  assert.match(markdown, /ROLLUP: 2\/7 repos ready/);
  assert.match(markdown, /ready-child\tready\tchild/);
  assert.match(markdown, /missing-child\tmissing\tchild/);
});

test("repo rollup does not mutate parent or child files", () => {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);

  const watched = [
    path.join(parent, ".meta-harness", "status.md"),
    path.join(parent, ".meta-harness", "events.jsonl"),
    path.join(parent, ".meta-harness", "poll.md"),
    path.join(child, ".meta-harness", "status.md"),
    path.join(child, ".meta-harness", "events.jsonl"),
    path.join(child, ".meta-harness", "ready.json"),
    path.join(child, "package.json"),
  ];

  writeFile(watched[0], "# Status\n\nParent status stays put\n");
  writeFile(watched[1], "{\"parent\":true}\n");
  writeFile(watched[2], "parent poll stays put\n");
  writeFile(watched[3], "# Status\n\nPhase: closed\n");
  writeFile(watched[4], "{\"child\":true}\n");
  writeJson(watched[5], { ok: true, passed: 1, failed: 0, warned: 0 });
  writeJson(watched[6], { name: "child-package" });
  configureRepos(parent, [{ name: "child", path: child, role: "child" }]);

  const before = readSnapshot(watched);
  const rollup = buildRepoRollup(parent);
  const after = readSnapshot(watched);

  assert.equal(rollup.summary.ready, 1);
  assert.deepEqual(after, before);
});
