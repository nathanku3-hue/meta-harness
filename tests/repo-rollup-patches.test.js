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

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-patches-")); }
function ensureHarness(root) { fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true }); }
function writeFile(filePath, content) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content, "utf8"); }
function writeJson(filePath, value) { writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function readyPath(child) { return path.join(child, ".meta-harness", "ready.json"); }
function templateManifestPath(root) { return path.join(root, ".meta-harness", "templates", "manifest.json"); }
function skillRegistryPath(root) { return path.join(root, ".meta-harness", "skill-registry.json"); }
function templateManifest(version = "1.0.0", hash = "hash-a", names = ["templates/a.md"]) { return { version, templates: names.map((source_path) => ({ source_path, content_hash: hash })) }; }
function skillRegistry(version = "1.0.0", skillVersion = "1.0.0", ids = ["repo-adoption-doctor"]) { return { version, skills: ids.map((id) => ({ id, version: skillVersion })) }; }
function readyJson(overrides = {}) {
  return { schema_version: "1.0.0", generated_at: NOW, target: "/tmp/child", ok: true, redacted: true, expires_after: FUTURE, checks: [], passed: 1, failed: 0, warned: 0, skipped: 0, ...overrides };
}
function setupReadyChild(ready = readyJson()) {
  const parent = tempDir(); const child = tempDir();
  ensureHarness(parent); ensureHarness(child);
  writeJson(readyPath(child), ready);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos: [{ name: "child", path: child, role: "child" }] });
  return { parent, child };
}
function readSnapshot(paths) { return Object.fromEntries(paths.map((filePath) => [filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null])); }
function proposals(rollup) { return rollup.repos[0].patch_proposals; }
function ids(rollup) { return proposals(rollup).map((proposal) => proposal.id); }
function only(rollup) { assert.equal(proposals(rollup).length, 1); return proposals(rollup)[0]; }
function assertReadOnly(proposal) {
  assert.deepEqual(Object.keys(proposal), ["id", "kind", "severity", "reason", "source_action_id", "target_path", "operation", "proposal", "diff", "mutates"]);
  assert.equal(proposal.kind, "docs_patch");
  assert.equal(proposal.severity, "info");
  assert.equal(proposal.diff, null);
  assert.equal(proposal.mutates, false);
  assert.equal(path.isAbsolute(proposal.target_path), false);
}

test("empty and clean ready rollups include patch proposal schema with no proposals", () => {
  const emptyParent = tempDir();
  ensureHarness(emptyParent);
  writeJson(path.join(emptyParent, ".meta-harness", "repos.json"), { repos: [] });
  const empty = buildRepoRollup(emptyParent, { now: NOW });
  assert.equal(empty.summary.patch_proposals, 0);
  assert.deepEqual(empty.repos, []);

  const clean = buildRepoRollup(setupReadyChild().parent, { now: NOW });
  assert.equal(clean.summary.patch_proposals, 0);
  assert.deepEqual(clean.repos[0].patch_proposals, []);
});

test("drift action mappings emit deterministic read-only docs patch proposals", () => {
  const cases = [
    ["PATCH_PROPOSE_STATUS_PHASE_MARKER", ".meta-harness/status.md", "insert", ({ child }) => writeFile(path.join(child, ".meta-harness", "status.md"), "# Status\n\nCurrent truth: ready\n")],
    ["PATCH_PROPOSE_READY_SCHEMA_REVIEW", ".meta-harness/ready.json", "review", ({ child }) => writeJson(readyPath(child), readyJson({ schema_version: "0.9.0" }))],
    ["PATCH_PROPOSE_TEMPLATE_MANIFEST_REVIEW", ".meta-harness/templates/manifest.json", "review", ({ parent }) => writeJson(templateManifestPath(parent), templateManifest())],
    ["PATCH_PROPOSE_SECURITY_FILE_REVIEW", "SECURITY.md", "review", ({ parent }) => writeFile(path.join(parent, "SECURITY.md"), "parent\n")],
    ["PATCH_PROPOSE_SECURITY_FILE_DIFF_REVIEW", "SECURITY.md", "review", ({ parent, child }) => { writeFile(path.join(parent, "SECURITY.md"), "parent\n"); writeFile(path.join(child, "SECURITY.md"), "child\n"); }],
    ["PATCH_PROPOSE_SKILL_REGISTRY_REVIEW", ".meta-harness/skill-registry.json", "review", ({ parent }) => writeJson(skillRegistryPath(parent), skillRegistry())],
  ];
  for (const [id, target, operation, arrange] of cases) {
    const context = setupReadyChild();
    arrange(context);
    const proposal = only(buildRepoRollup(context.parent, { now: NOW }));
    assert.equal(proposal.id, id);
    assert.equal(proposal.target_path, target);
    assert.equal(proposal.operation, operation);
    assertReadOnly(proposal);
  }

  const template = setupReadyChild();
  writeJson(templateManifestPath(template.parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(template.child), templateManifest("0.9.0", "hash-b"));
  assert.deepEqual(ids(buildRepoRollup(template.parent, { now: NOW })), ["PATCH_PROPOSE_TEMPLATE_DRIFT_REVIEW", "PATCH_PROPOSE_TEMPLATE_DRIFT_REVIEW"]);

  const skill = setupReadyChild();
  writeJson(skillRegistryPath(skill.parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(skill.child), skillRegistry("1.0.0", "0.9.0"));
  assert.deepEqual(ids(buildRepoRollup(skill.parent, { now: NOW })), ["PATCH_PROPOSE_SKILL_REGISTRY_DIFF_REVIEW", "PATCH_PROPOSE_SKILL_REGISTRY_DIFF_REVIEW"]);
});

test("readiness and missing repo actions emit review patch proposals", () => {
  for (const ready of [
    readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }),
    readyJson({ warned: 1, checks: [{ id: "WARN_A", status: "warn" }] }),
    readyJson({ expires_after: PAST }),
    readyJson({ redacted: false }),
  ]) {
    const proposal = only(buildRepoRollup(setupReadyChild(ready).parent, { now: NOW }));
    assert.equal(proposal.id, "PATCH_PROPOSE_READINESS_REVIEW");
    assert.equal(proposal.operation, "review");
    assertReadOnly(proposal);
  }

  const unknownParent = tempDir(); const unknown = tempDir();
  ensureHarness(unknownParent); ensureHarness(unknown);
  writeJson(path.join(unknownParent, ".meta-harness", "repos.json"), { repos: [{ name: "unknown", path: unknown, role: "child" }] });
  assert.equal(only(buildRepoRollup(unknownParent, { now: NOW })).id, "PATCH_PROPOSE_READINESS_REVIEW");

  const missingParent = tempDir();
  ensureHarness(missingParent);
  writeJson(path.join(missingParent, ".meta-harness", "repos.json"), { repos: [{ name: "missing", path: path.join(tempDir(), "missing"), role: "child" }] });
  const missing = only(buildRepoRollup(missingParent, { now: NOW }));
  assert.equal(missing.id, "PATCH_PROPOSE_REPO_PATH_REVIEW");
  assert.equal(missing.target_path, ".meta-harness/repos.json");
  assertReadOnly(missing);
});

test("patch proposals preserve readiness state, ok behavior, category order, markdown, and files", () => {
  const { parent, child } = setupReadyChild(readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", name: "ready", status: "fail", reason: "failed" }], schema_version: "0.9.0" }));
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));
  writeFile(path.join(parent, "SECURITY.md"), "parent\n");
  writeJson(skillRegistryPath(parent), skillRegistry("2.0.0", "1.0.0"));
  writeJson(skillRegistryPath(child), skillRegistry("1.0.0", "0.9.0"));
  writeFile(path.join(child, ".meta-harness", "status.md"), "# Status\n\nCurrent truth: failing\n");
  const watched = [path.join(parent, ".meta-harness", "repos.json"), templateManifestPath(parent), readyPath(child), path.join(child, ".meta-harness", "status.md"), path.join(child, "PATCH_PROPOSAL.diff")];
  const before = readSnapshot(watched);

  const rollup = buildRepoRollup(parent, { now: NOW });
  const markdown = renderRepoRollupMarkdown(rollup);

  assert.equal(rollup.ok, false);
  assert.equal(rollup.repos[0].state, "failed");
  assert.deepEqual(ids(rollup), [
    "PATCH_PROPOSE_READINESS_REVIEW",
    "PATCH_PROPOSE_TEMPLATE_DRIFT_REVIEW",
    "PATCH_PROPOSE_TEMPLATE_DRIFT_REVIEW",
    "PATCH_PROPOSE_SECURITY_FILE_REVIEW",
    "PATCH_PROPOSE_SKILL_REGISTRY_DIFF_REVIEW",
    "PATCH_PROPOSE_SKILL_REGISTRY_DIFF_REVIEW",
    "PATCH_PROPOSE_READY_SCHEMA_REVIEW",
    "PATCH_PROPOSE_STATUS_PHASE_MARKER",
  ]);
  for (const proposal of proposals(rollup)) assertReadOnly(proposal);
  assert.match(markdown, /  - PATCH PATCH_PROPOSE_READINESS_REVIEW docs_patch — propose reviewing child readiness evidence before follow-up changes/);
  assert.match(markdown, /  - PATCH PATCH_PROPOSE_STATUS_PHASE_MARKER docs_patch — propose adding a Phase marker to child status documentation/);
  assert.deepEqual(readSnapshot(watched), before);

  const readyDrift = setupReadyChild();
  writeJson(templateManifestPath(readyDrift.parent), templateManifest());
  const driftOnly = buildRepoRollup(readyDrift.parent, { now: NOW });
  assert.equal(driftOnly.ok, true);
  assert.equal(driftOnly.repos[0].state, "ready");
});
