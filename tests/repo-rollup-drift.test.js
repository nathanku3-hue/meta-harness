"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup } = require("../lib/repo-rollup");

const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-drift-"));
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

function templateManifest(version = "1.0.0", hash = "hash-a", names = ["templates/a.md"]) {
  return {
    version,
    templates: names.map((name) => ({ source_path: name, content_hash: hash })),
  };
}

function templateManifestPath(root) {
  return path.join(root, ".meta-harness", "templates", "manifest.json");
}

function skillRegistry(version = "1.0.0", skillVersion = "1.0.0", ids = ["repo-adoption-doctor"]) {
  return {
    version,
    skills: ids.map((id) => ({ id, version: skillVersion })),
  };
}

function skillRegistryPath(root) {
  return path.join(root, ".meta-harness", "skill-registry.json");
}

function setupReadyChild() {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);
  writeJson(readyPath(child), readyJson());
  writeJson(path.join(parent, ".meta-harness", "repos.json"), {
    repos: [{ name: "child", path: child, role: "child" }],
  });
  return { parent, child };
}

test("matching parent and child template manifests have no template drift warning", () => {
  const { parent, child } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("1.0.0", "hash-a"));

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.summary.drift_warnings, 0);
  assert.deepEqual(rollup.repos[0].drift_warnings, []);
});

test("missing child template manifest emits template drift warning", () => {
  const { parent } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.summary.drift_warnings, 1);
  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(rollup.repos[0].drift_warnings[0].id, "DRIFT_TEMPLATE_MANIFEST_MISSING");
});

test("template version mismatch emits template version drift warning", () => {
  const { parent, child } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-a"));

  const warning = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings[0];

  assert.equal(warning.id, "DRIFT_TEMPLATE_VERSION");
  assert.equal(warning.expected, "1.0.0");
  assert.equal(warning.actual, "0.9.0");
});

test("template hash mismatch emits template hash drift warning", () => {
  const { parent, child } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("1.0.0", "hash-b"));

  const warning = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings[0];

  assert.equal(warning.id, "DRIFT_TEMPLATE_HASH");
  assert.equal(warning.expected, "hash-a");
  assert.equal(warning.actual, "hash-b");
});

test("missing child security file emits security drift warning when parent has file", () => {
  const { parent } = setupReadyChild();
  writeFile(path.join(parent, "SECURITY.md"), "parent security policy\n");

  const warning = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings[0];

  assert.equal(warning.id, "DRIFT_SECURITY_FILE_MISSING");
  assert.equal(warning.source, "SECURITY.md");
});

test("security file hash mismatch emits security drift warning", () => {
  const { parent, child } = setupReadyChild();
  writeFile(path.join(parent, "SECURITY.md"), "parent security policy\n");
  writeFile(path.join(child, "SECURITY.md"), "child security policy\n");

  const warning = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings[0];

  assert.equal(warning.id, "DRIFT_SECURITY_FILE_HASH");
  assert.equal(warning.kind, "security_surface");
  assert.notEqual(warning.expected, warning.actual);
});

test("skill registry version and skill version mismatch emit skill drift warnings", () => {
  const { parent, child } = setupReadyChild();
  writeJson(skillRegistryPath(parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(child), skillRegistry("1.0.0", "0.9.0"));

  const ids = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings.map((warning) => warning.id);

  assert.deepEqual(ids, ["DRIFT_SKILL_REGISTRY_VERSION", "DRIFT_SKILL_VERSION"]);
});

test("ready schema version mismatch emits governance drift warning", () => {
  const { parent, child } = setupReadyChild();
  writeJson(readyPath(child), readyJson({ schema_version: "0.9.0" }));

  const rollup = buildRepoRollup(parent, { now: NOW });
  const warning = rollup.repos[0].drift_warnings[0];

  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(warning.id, "DRIFT_READY_SCHEMA_VERSION");
  assert.equal(warning.kind, "governance_compatibility");
});

test("status without Phase marker emits governance drift warning without changing readiness state", () => {
  const parent = tempDir();
  const child = tempDir();
  ensureHarness(parent);
  ensureHarness(child);
  writeFile(path.join(child, ".meta-harness", "status.md"), "# Status\n\nCurrent truth: ready\n");
  writeJson(path.join(parent, ".meta-harness", "repos.json"), {
    repos: [{ name: "child", path: child, role: "child" }],
  });

  const rollup = buildRepoRollup(parent, { now: NOW });
  const warning = rollup.repos[0].drift_warnings[0];

  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(warning.id, "DRIFT_STATUS_PHASE_MARKER");
});

test("malformed optional drift JSON warns but does not invalidate readiness", () => {
  const { parent, child } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeFile(templateManifestPath(child), "{not-json\n");

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(rollup.repos[0].drift_warnings[0].id, "DRIFT_TEMPLATE_MANIFEST_INVALID");
});

test("drift warnings do not make top-level ok false when readiness is otherwise ready", () => {
  const { parent } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, true);
  assert.equal(rollup.summary.ready, 1);
  assert.equal(rollup.summary.drift_warnings, 1);
});

test("drift warning order is deterministic", () => {
  const { parent, child } = setupReadyChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));
  writeFile(path.join(parent, "SECURITY.md"), "parent security policy\n");
  writeJson(skillRegistryPath(parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(child), skillRegistry("1.0.0", "0.9.0"));
  writeFile(path.join(child, ".meta-harness", "status.md"), "# Status\n\nNo phase marker\n");
  writeJson(readyPath(child), readyJson({ schema_version: "0.9.0" }));

  const ids = buildRepoRollup(parent, { now: NOW }).repos[0].drift_warnings.map((warning) => warning.id);

  assert.deepEqual(ids, [
    "DRIFT_TEMPLATE_VERSION",
    "DRIFT_TEMPLATE_HASH",
    "DRIFT_SECURITY_FILE_MISSING",
    "DRIFT_SKILL_REGISTRY_VERSION",
    "DRIFT_SKILL_VERSION",
    "DRIFT_READY_SCHEMA_VERSION",
    "DRIFT_STATUS_PHASE_MARKER",
  ]);
});
