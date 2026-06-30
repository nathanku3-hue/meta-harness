"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PAST = "2026-06-29T04:00:00.000Z";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-brief-"));
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

function templateManifest(version = "1.0.0", hash = "hash-a") {
  return { version, templates: [{ source_path: "templates/a.md", content_hash: hash }] };
}

function templateManifestPath(root) {
  return path.join(root, ".meta-harness", "templates", "manifest.json");
}

function configure(parent, repos) {
  ensureHarness(parent);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos });
}

function addReadyChild(name, ready = readyJson()) {
  const child = tempDir();
  ensureHarness(child);
  writeJson(readyPath(child), ready);
  return { name, path: child, role: "child" };
}

function readSnapshot(root) {
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

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("empty and clean rollups emit a no-op read-only next-action brief", () => {
  const emptyParent = tempDir();
  configure(emptyParent, []);
  const empty = buildRepoRollup(emptyParent, { now: NOW });

  assert.deepEqual(empty.next_action_brief, {
    kind: "read_only_worker_brief",
    selected_candidate_id: null,
    selected_repo: null,
    priority: null,
    reason: null,
    source_state: null,
    source_warning_ids: [],
    source_check_ids: [],
    selection_reason: "no next-action candidates",
    target_paths: [],
    body: "No follow-up action is needed from the current rollup evidence.\n\nBoundary: read-only review only. Do not execute child commands, write files, apply patches, or mutate parent/child repo truth.",
    mutates: false,
  });

  const cleanParent = tempDir();
  const cleanChild = addReadyChild("clean-child");
  configure(cleanParent, [cleanChild]);
  const clean = buildRepoRollup(cleanParent, { now: NOW });
  assert.equal(clean.summary.next_action_candidates, 0);
  assert.equal(clean.next_action_brief.selected_candidate_id, null);
  assert.equal(clean.next_action_brief.mutates, false);
});

test("highest priority candidate is selected", () => {
  const parent = tempDir();
  const stale = addReadyChild("stale-child", readyJson({ expires_after: PAST }));
  const failed = addReadyChild("failed-child", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", name: "sync", status: "fail", reason: "failed" }] }));
  configure(parent, [stale, failed]);

  const brief = buildRepoRollup(parent, { now: NOW }).next_action_brief;

  assert.equal(brief.selected_repo, "failed-child");
  assert.equal(brief.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(brief.priority, "high");
  assert.equal(brief.reason, "review failed child readiness evidence");
  assert.equal(brief.source_state, "failed");
  assert.deepEqual(brief.source_warning_ids, []);
  assert.deepEqual(brief.source_check_ids, ["FAIL_A"]);
});

test("configured repo order breaks priority ties", () => {
  const parent = tempDir();
  const first = addReadyChild("first-child", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_FIRST", status: "fail" }] }));
  const second = addReadyChild("second-child", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_SECOND", status: "fail" }] }));
  configure(parent, [first, second]);

  const brief = buildRepoRollup(parent, { now: NOW }).next_action_brief;

  assert.equal(brief.selected_repo, "first-child");
  assert.match(brief.body, /Source check IDs: FAIL_FIRST/);
});

test("candidate order breaks same-repo ties", () => {
  const parent = tempDir();
  const child = addReadyChild("child", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  configure(parent, [child]);
  writeJson(templateManifestPath(parent), templateManifest());

  const rollup = buildRepoRollup(parent, { now: NOW });
  const brief = rollup.next_action_brief;

  assert.deepEqual(rollup.repos[0].next_action_candidates.map((candidate) => candidate.id), [
    "ACTION_REVIEW_FAILED_READINESS",
    "ACTION_REVIEW_TEMPLATE_DRIFT",
  ]);
  assert.equal(brief.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
});

test("brief body includes selected candidate evidence and read-only boundary", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({
    ok: false,
    failed: 2,
    checks: [
      { id: "MH_SYNC_001", name: "sync", status: "fail", reason: "5 templates missing" },
      { id: "MH_SECURITY_001", name: "security", status: "fail", reason: "missing SECURITY.md" },
    ],
  }));
  configure(parent, [child]);

  const brief = buildRepoRollup(parent, { now: NOW }).next_action_brief;

  assert.match(brief.body, /Review child repo evidence for child-app\./);
  assert.match(brief.body, /Candidate: ACTION_REVIEW_FAILED_READINESS/);
  assert.match(brief.body, /Priority: high/);
  assert.match(brief.body, /Reason: review failed child readiness evidence/);
  assert.match(brief.body, /Source state: failed/);
  assert.match(brief.body, /Source warning IDs: none/);
  assert.match(brief.body, /Source check IDs: MH_SYNC_001, MH_SECURITY_001/);
  assert.match(brief.body, /Target paths: \.meta-harness\/ready\.json/);
  assert.match(brief.body, /Boundary: read-only review only/);
  assert.match(brief.body, /Do not execute child commands, write files, apply patches, or mutate parent\/child repo truth/);
});

test("drift-only low candidate produces read-only brief without making ok false", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app");
  configure(parent, [child]);
  writeJson(templateManifestPath(parent), templateManifest());

  const rollup = buildRepoRollup(parent, { now: NOW });
  const brief = rollup.next_action_brief;

  assert.equal(rollup.ok, true);
  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(brief.selected_candidate_id, "ACTION_REVIEW_TEMPLATE_DRIFT");
  assert.equal(brief.priority, "low");
  assert.equal(brief.mutates, false);
  assert.match(brief.body, /Source warning IDs: DRIFT_TEMPLATE_MANIFEST_MISSING/);
});

test("brief generation does not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");

  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);
  const rollup = buildRepoRollup(parent, { now: NOW });
  renderRepoRollupMarkdown(rollup);

  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("JSON does not include proposal or legacy action fields", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  configure(parent, [child]);

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(Object.hasOwn(rollup, "patch_proposals"), false);
  assert.equal(Object.hasOwn(rollup.summary, "patch_proposals"), false);
  assert.equal(Object.hasOwn(rollup.repos[0], "patch_proposals"), false);
  assert.equal(Object.hasOwn(rollup, "action_candidates"), false);
  assert.equal(Object.hasOwn(rollup.summary, "action_candidates"), false);
  assert.equal(Object.hasOwn(rollup.repos[0], "action_candidates"), false);
});

test("Markdown renders Next Action Brief section", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }));
  configure(parent, [child]);

  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.match(markdown, /## Next Action Brief/);
  assert.match(markdown, /- selected: child-app ACTION_REVIEW_FAILED_READINESS high/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- target_paths: \.meta-harness\/ready\.json/);
  assert.match(markdown, /Review child repo evidence for child-app\./);
});

test("Markdown renders no-op Next Action Brief when no candidates exist", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app");
  configure(parent, [child]);

  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.match(markdown, /## Next Action Brief/);
  assert.match(markdown, /- selected: none/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- reason: no next-action candidates/);
});

test("poll --rollup --write remains rejected and non-mutating", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app");
  configure(parent, [child]);
  writeJson(templateManifestPath(parent), templateManifest());
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);

  const result = run(parent, ["poll", "--rollup", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /poll --rollup is read-only/);
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});
