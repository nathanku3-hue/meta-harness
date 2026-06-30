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
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-handoff-"));
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

function templateManifest(version = "1.0.0", hash = "hash-a") {
  return { version, templates: [{ source_path: "templates/a.md", content_hash: hash }] };
}

function templateManifestPath(root) {
  return path.join(root, ".meta-harness", "templates", "manifest.json");
}

function skillRegistry(version = "1.0.0") {
  return { version, skills: [{ id: "repo-adoption-doctor", version: "hash-a" }] };
}

function skillRegistryPath(root) {
  return path.join(root, ".meta-harness", "skill-registry.json");
}

function setupReadyChild(overrides = {}) {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);
  writeJson(readyPath(child), readyJson(overrides));
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [{ name: "child", path: child, role: "child" }] });
  return { parent, child };
}

function handoff(rollup) {
  return rollup.response_handoff;
}

function onlyItem(rollup) {
  assert.equal(handoff(rollup).items.length, 1);
  return handoff(rollup).items[0];
}

function assertReadOnlyItem(item) {
  assert.equal(item.mutates, false);
  assert.deepEqual(Object.keys(item), [
    "repo", "state", "reason", "sources", "drift_warning_ids", "readiness_check_ids", "mutates",
  ]);
}

test("empty and clean ready rollups have info handoff with no items", () => {
  const emptyParent = tempDir();
  ensureHarness(emptyParent);
  writeJson(path.join(emptyParent, ".meta-harness", "repos.json"), { repos: [] });
  assert.deepEqual(handoff(buildRepoRollup(emptyParent, { now: NOW })), {
    kind: "read_only_review_handoff",
    severity: "info",
    next_action: "none",
    items: [],
  });

  const { parent } = setupReadyChild();
  assert.deepEqual(handoff(buildRepoRollup(parent, { now: NOW })).items, []);
});

test("drift warnings produce deterministic read-only handoff items without changing ok", () => {
  const cases = [
    ["template", (parent, child) => {
      writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
      writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-a"));
    }, "child has template manifest drift", ["DRIFT_TEMPLATE_VERSION"]],
    ["security", (parent) => writeFile(path.join(parent, "SECURITY.md"), "# Security\n"), "child has security policy surface drift", ["DRIFT_SECURITY_FILE_MISSING"]],
    ["skill", (parent, child) => {
      writeJson(skillRegistryPath(parent), skillRegistry("1.0.0"));
      writeJson(skillRegistryPath(child), skillRegistry("0.9.0"));
    }, "child has skill registry drift", ["DRIFT_SKILL_REGISTRY_VERSION"]],
    ["governance", (_parent, _child, ready) => Object.assign(ready, { schema_version: "0.9.0" }), "child has governance compatibility drift", ["DRIFT_READY_SCHEMA_VERSION"]],
  ];

  for (const [_name, arrange, reason, warningIds] of cases) {
    const ready = readyJson();
    const parent = tempDir();
    const child = tempDir();
    ensureHarness(parent);
    ensureHarness(child);
    arrange(parent, child, ready);
    writeJson(readyPath(child), ready);
    writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [{ name: "child", path: child, role: "child" }] });
    const rollup = buildRepoRollup(parent, { now: NOW });
    const item = onlyItem(rollup);
    assert.equal(rollup.ok, true);
    assert.equal(rollup.repos[0].state, "ready");
    assert.equal(item.reason, reason);
    assert.deepEqual(item.drift_warning_ids, warningIds);
    assertReadOnlyItem(item);
  }
});

test("readiness states produce review handoff without changing state", () => {
  const parent = tempDir();
  const failed = tempDir();
  const warned = tempDir();
  const stale = tempDir();
  const invalid = tempDir();
  const unknown = tempDir();
  const missing = path.join(tempDir(), "missing");
  for (const dir of [parent, failed, warned, stale, invalid, unknown]) ensureHarness(dir);
  writeJson(readyPath(failed), readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  writeJson(readyPath(warned), readyJson({ warned: 1, checks: [{ id: "WARN_A", status: "warn" }] }));
  writeJson(readyPath(stale), readyJson({ expires_after: PAST }));
  writeFile(readyPath(invalid), "{not-json\n");
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [
    { name: "failed", path: failed, role: "child" },
    { name: "warned", path: warned, role: "child" },
    { name: "stale", path: stale, role: "child" },
    { name: "invalid", path: invalid, role: "child" },
    { name: "missing", path: missing, role: "child" },
    { name: "unknown", path: unknown, role: "child" },
  ] });

  const rollup = buildRepoRollup(parent, { now: NOW });
  const reasons = rollup.response_handoff.items.map((item) => item.reason);
  assert.deepEqual(rollup.repos.map((repo) => repo.state), ["failed", "warned", "stale", "invalid", "missing", "unknown"]);
  assert.deepEqual(reasons, [
    "child readiness failed",
    "child readiness has warnings",
    "child readiness evidence is stale",
    "child readiness evidence is invalid",
    "configured child repo path is missing",
    "child readiness state is unknown",
  ]);
  for (const item of rollup.response_handoff.items) assertReadOnlyItem(item);
});

test("handoff output is deterministic, markdown-rendered, and read-only", () => {
  const { parent, child } = setupReadyChild({ schema_version: "0.9.0" });
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));
  writeFile(path.join(parent, "SECURITY.md"), "# Security\n");
  const watched = [path.join(parent, ".meta-harness", "repos.json"), readyPath(child)];
  const before = Object.fromEntries(watched.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]));

  const rollup = buildRepoRollup(parent, { now: NOW });
  const item = onlyItem(rollup);
  const markdown = renderRepoRollupMarkdown(rollup);

  assert.deepEqual(item.drift_warning_ids, ["DRIFT_TEMPLATE_VERSION", "DRIFT_TEMPLATE_HASH", "DRIFT_SECURITY_FILE_MISSING", "DRIFT_READY_SCHEMA_VERSION"]);
  assert.match(markdown, /## Response Handoff\n\n- child warn — child has template manifest drift/);
  assert.match(markdown, /  - mutates: false/);
  assert.deepEqual(Object.fromEntries(watched.map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")])), before);
});
