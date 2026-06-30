"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup } = require("../lib/repo-rollup");

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

function ids(rollup) {
  return rollup.repos[0].action_candidates.map((candidate) => candidate.id);
}

test("ready repo with no drift has no action candidates", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child);

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.summary.action_candidates, 0);
  assert.deepEqual(rollup.repos[0].action_candidates, []);
});

test("readiness states emit deterministic read-only action candidates without changing state", () => {
  const cases = [
    [readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }), "failed", "ACTION_REVIEW_FAILED_READINESS"],
    [readyJson({ warned: 1, checks: [{ id: "WARN_A", status: "warn" }] }), "warned", "ACTION_REVIEW_WARNED_READINESS"],
    [readyJson({ expires_after: PAST }), "stale", "ACTION_REVIEW_STALE_READINESS"],
    [readyJson({ redacted: false }), "invalid", "ACTION_REVIEW_INVALID_READINESS"],
  ];

  for (const [ready, state, actionId] of cases) {
    const parent = tempDir();
    const child = tempDir();
    configure(parent, child, ready);
    const rollup = buildRepoRollup(parent, { now: NOW });
    assert.equal(rollup.repos[0].state, state);
    assert.equal(rollup.repos[0].action_candidates[0].id, actionId);
    assert.equal(rollup.repos[0].action_candidates[0].mutates, false);
  }
});

test("missing and unknown repos emit review action candidates", () => {
  const parent = tempDir();
  const unknown = tempDir();
  const missing = path.join(tempDir(), "missing");
  ensureHarness(parent);
  ensureHarness(unknown);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [
    { name: "missing", path: missing, role: "child" },
    { name: "unknown", path: unknown, role: "child" },
  ] });

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.deepEqual(rollup.repos.map((repo) => repo.state), ["missing", "unknown"]);
  assert.deepEqual(rollup.repos.map((repo) => repo.action_candidates[0].id), [
    "ACTION_REVIEW_MISSING_REPO",
    "ACTION_REVIEW_UNKNOWN_READINESS",
  ]);
});

test("drift warnings emit source-specific action candidates", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child, readyJson({ schema_version: "0.9.0" }));
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));
  writeFile(path.join(parent, "SECURITY.md"), "parent\n");
  writeJson(skillRegistryPath(parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(child), skillRegistry("1.0.0", "0.9.0"));

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.deepEqual(ids(rollup), [
    "ACTION_REVIEW_TEMPLATE_DRIFT",
    "ACTION_REVIEW_TEMPLATE_DRIFT",
    "ACTION_REVIEW_SECURITY_DRIFT",
    "ACTION_REVIEW_SKILL_DRIFT",
    "ACTION_REVIEW_SKILL_DRIFT",
    "ACTION_REVIEW_GOVERNANCE_DRIFT",
  ]);
  for (const candidate of rollup.repos[0].action_candidates) {
    assert.equal(candidate.kind, "review");
    assert.equal(candidate.severity, "info");
    assert.equal(candidate.mutates, false);
  }
});

test("action candidates from drift do not make top-level ok false", () => {
  const parent = tempDir();
  const child = tempDir();
  configure(parent, child);
  writeJson(templateManifestPath(parent), templateManifest());

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.repos[0].state, "ready");
  assert.deepEqual(ids(rollup), ["ACTION_REVIEW_TEMPLATE_DRIFT"]);
});
