"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");

const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PAST = "2026-06-29T04:00:00.000Z";

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

function readyJson(overrides = {}) {
  return {
    schema_version: "1.0.0",
    generated_at: NOW,
    target: "/tmp/child",
    ok: true,
    redacted: true,
    expires_after: FUTURE,
    checks: [],
    passed: 1,
    failed: 0,
    warned: 0,
    skipped: 0,
    ...overrides,
  };
}

function readyPath(child) {
  return path.join(child, ".meta-harness", "ready.json");
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

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.schema_version, "1.0.0");
  assert.equal(rollup.generated_from, "local_files");
  assert.equal(rollup.ok, true);
  assert.deepEqual(rollup.summary, {
    total: 0,
    ready: 0,
    warned: 0,
    failed: 0,
    stale: 0,
    unknown: 0,
    missing: 0,
    invalid: 0,
    drift_warnings: 0,
    next_action_candidates: 0,
  });
  assert.deepEqual(rollup.response_handoff, {
    kind: "read_only_review_handoff",
    severity: "info",
    next_action: "none",
    items: [],
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

  writeJson(readyPath(readyChild), readyJson({ passed: 16, skipped: 1 }));
  writeJson(readyPath(warnedChild), readyJson({
    passed: 15,
    warned: 1,
    checks: [{
      id: "MH_SECURITY_001",
      name: "security",
      status: "warn",
      reason: "GitHub settings check skipped locally",
      next_action: "Verify repository security settings with GitHub API access",
    }],
  }));
  writeJson(readyPath(failedChild), readyJson({
    ok: false,
    passed: 14,
    failed: 1,
    checks: [{
      id: "MH_SYNC_001",
      name: "sync",
      status: "fail",
      reason: "5 templates missing",
      next_action: "Run sync apply",
    }],
  }));
  writeFile(path.join(statusChild, ".meta-harness", "status.md"), "# Status\n\nPhase:\nclosed\n\nUpdated:\n2026-06-30\n\nCurrent truth:\nPASS\n");
  writeFile(readyPath(invalidChild), "{not-json\n");
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

  const rollup = buildRepoRollup(parent, { now: NOW });
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
    stale: 0,
    unknown: 1,
    missing: 1,
    invalid: 1,
    drift_warnings: 0,
    next_action_candidates: 5,
  });

  const markdown = renderRepoRollupMarkdown(rollup);
  assert.match(markdown, /Generated from: local_files/);
  assert.match(markdown, /Read-only: child_repos, child_status, child_events, parent_status, parent_events/);
  assert.match(markdown, /ROLLUP: 2\/7 repos ready/);
  assert.match(markdown, /ready=2 warned=1 failed=1 stale=0 unknown=1 missing=1 invalid=1 drift_warnings=0 next_action_candidates=5/);
  assert.doesNotMatch(markdown, /patch_proposals/);
  assert.doesNotMatch(markdown, /  - PATCH /);
  assert.match(markdown, /ready-child\tready\tchild/);
  assert.match(markdown, /missing-child\tmissing\tchild/);
});

test("repo rollup validates ready freshness and required contract fields", () => {
  const missingExpires = readyJson();
  delete missingExpires.expires_after;
  const missingChecks = readyJson();
  delete missingChecks.checks;
  const cases = [
    [readyJson({ expires_after: NOW }), "stale", "ready.json expires_after is stale", "stale"],
    [readyJson({ expires_after: "not-a-date" }), "invalid", "ready.json expires_after is not a valid ISO timestamp", "invalid"],
    [missingExpires, "invalid", "ready.json missing expires_after", "invalid"],
    [readyJson({ redacted: false }), "invalid", "ready.json redacted must be true", "invalid"],
    [missingChecks, "invalid", "ready.json missing checks", "invalid"],
  ];
  for (const [ready, state, reason, countField] of cases) {
    const parent = tempDir();
    const child = tempDir();
    ensureHarness(parent);
    ensureHarness(child);
    writeJson(readyPath(child), ready);
    configureRepos(parent, [{ name: "child", path: child, role: "child" }]);
    const rollup = buildRepoRollup(parent, { now: NOW });
    assert.equal(rollup.ok, false);
    assert.equal(rollup.summary[countField], 1);
    assert.equal(rollup.repos[0].state, state);
    assert.equal(rollup.repos[0].reason, reason);
  }
});

test("repo rollup populates failed and warning ready check drilldown in source order", () => {
  const failedParent = tempDir();
  const failedChild = tempDir();
  ensureHarness(failedParent);
  ensureHarness(failedChild);
  writeJson(readyPath(failedChild), readyJson({ ok: false, failed: 2, checks: [
    { id: "MH_SYNC_001", name: "sync", status: "fail", reason: "5 templates missing", next_action: "Run sync apply" },
    { id: "MH_SECURITY_001", name: "security", status: "fail", reason: "missing SECURITY.md", next_action: "Restore SECURITY.md" },
    { id: "MH_QUALITY_001", name: "quality", status: "pass", reason: "", next_action: "" },
  ] }));
  configureRepos(failedParent, [{ name: "child", path: failedChild, role: "child" }]);
  const failed = buildRepoRollup(failedParent, { now: NOW });
  assert.equal(failed.repos[0].state, "failed");
  assert.deepEqual(failed.repos[0].failing_checks.map((check) => check.id), ["MH_SYNC_001", "MH_SECURITY_001"]);
  const markdown = renderRepoRollupMarkdown(failed);
  assert.match(markdown, /  - FAIL MH_SYNC_001 sync — 5 templates missing/);
  assert.match(markdown, /  - FAIL MH_SECURITY_001 security — missing SECURITY\.md/);

  const warnedParent = tempDir();
  const warnedChild = tempDir();
  ensureHarness(warnedParent);
  ensureHarness(warnedChild);
  writeJson(readyPath(warnedChild), readyJson({ warned: 1, checks: [
    { id: "MH_SECURITY_001", name: "security", status: "warn", reason: "GitHub settings check skipped locally", next_action: "Verify repository security settings with GitHub API access" },
    { id: "MH_SYNC_001", name: "sync", status: "pass", reason: "", next_action: "" },
  ] }));
  configureRepos(warnedParent, [{ name: "child", path: warnedChild, role: "child" }]);
  const warned = buildRepoRollup(warnedParent, { now: NOW });
  assert.equal(warned.ok, true);
  assert.equal(warned.repos[0].state, "warned");
  assert.deepEqual(warned.repos[0].warning_checks.map((check) => check.id), ["MH_SECURITY_001"]);
  assert.match(renderRepoRollupMarkdown(warned), /  - WARN MH_SECURITY_001 security — GitHub settings check skipped locally/);
});

test("repo rollup keeps invalid and stale ready.json authoritative over fallback files", () => {
  const parent = tempDir();
  const invalidChild = tempDir();
  const staleChild = tempDir();
  ensureHarness(parent);
  for (const child of [invalidChild, staleChild]) {
    ensureHarness(child);
    writeFile(path.join(child, ".meta-harness", "status.md"), "# Status\n\nPhase: closed\n\nCurrent truth: PASS\n");
    writeFile(path.join(child, ".meta-harness", "poll.md"), "# Poll Summary\n\nready fallback\n");
  }
  writeJson(readyPath(invalidChild), readyJson({ expires_after: "bad-date" }));
  writeJson(readyPath(staleChild), readyJson({ expires_after: PAST }));
  configureRepos(parent, [
    { name: "invalid-child", path: invalidChild, role: "child" },
    { name: "stale-child", path: staleChild, role: "child" },
  ]);

  const rollup = buildRepoRollup(parent, { now: NOW });
  const states = Object.fromEntries(rollup.repos.map((repo) => [repo.name, repo.state]));

  assert.equal(rollup.ok, false);
  assert.deepEqual(states, {
    "invalid-child": "invalid",
    "stale-child": "stale",
  });
  assert.equal(rollup.summary.ready, 0);
  assert.equal(rollup.summary.invalid, 1);
  assert.equal(rollup.summary.stale, 1);
  assert.equal(rollup.repos[0].source, ".meta-harness/ready.json");
  assert.equal(rollup.repos[1].source, ".meta-harness/ready.json");
});

test("repo rollup does not mutate parent or child files", () => {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);
  const watched = ["status.md", "events.jsonl", "poll.md"].map((name) => path.join(parent, ".meta-harness", name))
    .concat(["status.md", "events.jsonl", "ready.json"].map((name) => path.join(child, ".meta-harness", name)), path.join(child, "package.json"));
  ["# Status\n\nParent status stays put\n", "{\"parent\":true}\n", "parent poll stays put\n", "# Status\n\nPhase: closed\n", "{\"child\":true}\n"].forEach((content, index) => writeFile(watched[index], content));
  writeJson(watched[5], readyJson());
  writeJson(watched[6], { name: "child-package" });
  configureRepos(parent, [{ name: "child", path: child, role: "child" }]);
  const before = readSnapshot(watched);
  assert.equal(buildRepoRollup(parent, { now: NOW }).summary.ready, 1);
  assert.deepEqual(readSnapshot(watched), before);
});
