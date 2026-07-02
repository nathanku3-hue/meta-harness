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
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-actions-"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureHarness(root) {
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
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

function configure(parent, child, ready = readyJson()) {
  ensureHarness(parent);
  ensureHarness(child);
  writeJson(readyPath(child), ready);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [{ name: "child", path: child, role: "child" }] });
}

function templateManifest(version = "1.0.0", hash = "hash-a") {
  return { version, templates: [{ source_path: "templates/a.md", content_hash: hash }] };
}

function templateManifestPath(root) {
  return path.join(root, ".meta-harness", "templates", "manifest.json");
}

function skillRegistry(version = "1.0.0", skillVersion = "1.0.0") {
  return { version, skills: [{ id: "repo-adoption-doctor", version: skillVersion }] };
}

function skillRegistryPath(root) {
  return path.join(root, ".meta-harness", "skill-registry.json");
}

function watchedSnapshot(root) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  }
  walk(root);
  return Object.fromEntries(files.map((filePath) => [path.relative(root, filePath), fs.readFileSync(filePath, "utf8")]));
}

function candidates(rollup, index = 0) {
  return rollup.repos[index].next_action_candidates;
}

function ids(rollup, index = 0) {
  return candidates(rollup, index).map((candidate) => candidate.id);
}

function assertCandidateSchema(candidate) {
  assert.deepEqual(Object.keys(candidate), [
    "id",
    "priority",
    "kind",
    "reason",
    "repo",
    "source_state",
    "source_warning_ids",
    "source_warning_kinds",
    "source_check_ids",
    "target_paths",
    "mutates",
  ]);
  assert.match(candidate.id, /^ACTION_REVIEW_/);
  assert.match(candidate.priority, /^(high|medium|low)$/);
  assert.equal(candidate.kind, "review");
  assert.equal(typeof candidate.reason, "string");
  assert.equal(candidate.repo, "child");
  assert.ok(candidate.source_state === null || typeof candidate.source_state === "string");
  assert.ok(Array.isArray(candidate.source_warning_ids));
  assert.ok(Array.isArray(candidate.source_warning_kinds));
  assert.ok(Array.isArray(candidate.source_check_ids));
  assert.ok(Array.isArray(candidate.target_paths));
  assert.equal(candidate.mutates, false);
}

test("ready repo with no drift has no next-action candidates", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child);

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.summary.next_action_candidates, 0);
  assert.deepEqual(rollup.repos[0].next_action_candidates, []);
  assert.equal(Object.hasOwn(rollup.summary, "action_candidates"), false);
  assert.equal(Object.hasOwn(rollup.repos[0], "action_candidates"), false);
  assert.equal(Object.hasOwn(rollup.summary, "patch_proposals"), false);
  assert.equal(Object.hasOwn(rollup.repos[0], "patch_proposals"), false);
});

test("readiness states emit deterministic read-only next-action candidates without changing state", () => {
  const cases = [
    [readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }), "failed", "ACTION_REVIEW_FAILED_READINESS", "high", "review failed child readiness evidence", ["FAIL_A"]],
    [readyJson({ warned: 1, checks: [{ id: "WARN_A", status: "warn" }] }), "warned", "ACTION_REVIEW_WARNED_READINESS", "medium", "review warned child readiness evidence", ["WARN_A"]],
    [readyJson({ expires_after: PAST }), "stale", "ACTION_REVIEW_STALE_READINESS", "medium", "refresh or review stale readiness evidence", []],
    [readyJson({ redacted: false }), "invalid", "ACTION_REVIEW_INVALID_READINESS", "high", "review invalid child readiness contract", []],
  ];

  for (const [ready, state, actionId, priority, reason, checkIds] of cases) {
    const parent = tempDir();
    const child = tempDir();
    configure(parent, child, ready);
    const rollup = buildRepoRollup(parent, { now: NOW });
    const candidate = candidates(rollup)[0];
    assert.equal(rollup.repos[0].state, state);
    assert.equal(candidate.id, actionId);
    assert.equal(candidate.priority, priority);
    assert.equal(candidate.reason, reason);
    assert.equal(candidate.source_state, state);
    assert.deepEqual(candidate.source_check_ids, checkIds);
    assert.deepEqual(candidate.source_warning_ids, []);
    assert.deepEqual(candidate.source_warning_kinds, []);
    assert.deepEqual(candidate.target_paths, [".meta-harness/ready.json"]);
    assertCandidateSchema(candidate);
  }
});

test("missing and unknown repos emit review next-action candidates", () => {
  const parent = tempDir();
  const unknown = tempDir();
  const missing = path.join(tempDir(), "missing");
  ensureHarness(parent);
  ensureHarness(unknown);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [
    { name: "missing", path: missing, role: "child" },
    { name: "child", path: unknown, role: "child" },
  ] });

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.deepEqual(rollup.repos.map((repo) => repo.state), ["missing", "unknown"]);
  assert.deepEqual(rollup.repos.map((repo) => repo.next_action_candidates[0].id), [
    "ACTION_REVIEW_MISSING_REPO",
    "ACTION_REVIEW_UNKNOWN_READINESS",
  ]);
  assert.equal(rollup.repos[0].next_action_candidates[0].priority, "high");
  assert.deepEqual(rollup.repos[0].next_action_candidates[0].target_paths, [".meta-harness/repos.json"]);
  assert.equal(rollup.repos[1].next_action_candidates[0].priority, "medium");
  assert.deepEqual(rollup.repos[1].next_action_candidates[0].target_paths, [".meta-harness/ready.json", ".meta-harness/status.md"]);
});

test("drift warnings emit source-specific low read-only next-action candidates after readiness candidates", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child, readyJson({ schema_version: "0.9.0", warned: 1, checks: [{ id: "WARN_A", status: "warn" }] }));
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));
  writeFile(path.join(parent, "SECURITY.md"), "parent\n");
  writeJson(skillRegistryPath(parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(child), skillRegistry("1.0.0", "0.9.0"));

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.repos[0].state, "warned");
  assert.deepEqual(ids(rollup), [
    "ACTION_REVIEW_WARNED_READINESS",
    "ACTION_REVIEW_TEMPLATE_DRIFT",
    "ACTION_REVIEW_TEMPLATE_DRIFT",
    "ACTION_REVIEW_SECURITY_DRIFT",
    "ACTION_REVIEW_SKILL_REGISTRY_DRIFT",
    "ACTION_REVIEW_SKILL_REGISTRY_DRIFT",
    "ACTION_REVIEW_GOVERNANCE_COMPATIBILITY_DRIFT",
  ]);
  assert.deepEqual(candidates(rollup).map((candidate) => candidate.priority), ["medium", "low", "low", "low", "low", "low", "low"]);
  for (const candidate of candidates(rollup)) assertCandidateSchema(candidate);
  assert.deepEqual(candidates(rollup)[1].source_warning_ids, ["DRIFT_TEMPLATE_VERSION"]);
  assert.deepEqual(candidates(rollup)[1].source_warning_kinds, ["template_manifest"]);
  assert.deepEqual(candidates(rollup)[1].target_paths.map(p => p.replace(/\\/g, "/")), [".meta-harness/templates/manifest.json"]);
});

test("drift-only next-action candidates do not make top-level ok false", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child);
  writeJson(templateManifestPath(parent), templateManifest());

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.repos[0].state, "ready");
  assert.deepEqual(ids(rollup), ["ACTION_REVIEW_TEMPLATE_DRIFT"]);
  assert.equal(candidates(rollup)[0].priority, "low");
  assert.equal(candidates(rollup)[0].source_state, null);
});

test("Markdown renders compact priority action lines", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child, readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", name: "fail-a", status: "fail", reason: "failed" }] }));

  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.match(markdown, /next_action_candidates=1/);
  assert.match(markdown, /  - ACTION high ACTION_REVIEW_FAILED_READINESS review — review failed child readiness evidence/);
  assert.doesNotMatch(markdown, /patch_proposals/);
  assert.doesNotMatch(markdown, /  - PATCH /);
});

test("rollup next-action routing does not mutate parent or child files", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child, readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  writeJson(templateManifestPath(parent), templateManifest());
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child, ".meta-harness", "status.md"), "# Child\n");

  const parentBefore = watchedSnapshot(parent);
  const childBefore = watchedSnapshot(child);
  const rollup = buildRepoRollup(parent, { now: NOW });
  renderRepoRollupMarkdown(rollup);

  assert.deepEqual(watchedSnapshot(parent), parentBefore);
  assert.deepEqual(watchedSnapshot(child), childBefore);
});
