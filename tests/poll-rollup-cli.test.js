"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const GENERATED_AT = "2026-06-30T04:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-poll-rollup-"));
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
    generated_at: GENERATED_AT,
    target: "/tmp/child",
    ok: true,
    redacted: true,
    expires_after: FUTURE,
    checks: [],
    passed: 3,
    failed: 0,
    warned: 0,
    skipped: 0,
    ...overrides,
  };
}

function templateManifest(version = "1.0.0", hash = "hash-a") {
  return {
    version,
    templates: [{ source_path: "templates/a.md", content_hash: hash }],
  };
}

function templateManifestPath(root) {
  return path.join(root, ".meta-harness", "templates", "manifest.json");
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readSnapshot(paths) {
  return Object.fromEntries(paths.map((filePath) => [
    filePath,
    fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null,
  ]));
}

function setupParentChild(readyOverrides = {}) {
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
    templateManifestPath(parent),
    templateManifestPath(child),
  ];

  writeFile(watched[0], "# Status\n\nParent status must not change\n");
  writeFile(watched[1], "{\"event\":\"parent\"}\n");
  writeFile(watched[2], "parent poll must not change\n");
  writeFile(watched[3], "# Status\n\nPhase: closed\n\nUpdated: 2026-06-30\n");
  writeFile(watched[4], "{\"event\":\"child\"}\n");
  writeJson(watched[5], readyJson(readyOverrides));
  writeJson(watched[6], { name: "child-app" });
  writeJson(path.join(parent, ".meta-harness", "repos.json"), {
    repos: [{ name: "child-app", path: child, role: "child" }],
  });

  return { parent, child, watched };
}

test("poll --rollup --json emits read-only local file rollup without mutating files", () => {
  const { parent, watched } = setupParentChild();
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup", "--json"]);
  const after = readSnapshot(watched);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.schema_version, "1.0.0");
  assert.equal(rollup.generated_from, "local_files");
  assert.equal(rollup.ok, true);
  assert.deepEqual(rollup.summary, {
    total: 1,
    ready: 1,
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
  assert.deepEqual(rollup.not_changed, [
    "child_repos",
    "child_status",
    "child_events",
    "parent_status",
    "parent_events",
  ]);
  assert.equal(rollup.autonomy_plan.kind, "controlled_autonomy_dry_run_plan");
  assert.equal(rollup.autonomy_plan.source, "proposal_review_export_safety_gate");
  assert.equal(rollup.autonomy_plan.verdict, "not_needed");
  assert.equal(rollup.autonomy_plan.selected_action_type, null);
  assert.equal(rollup.autonomy_plan.dry_run, true);
  assert.equal(rollup.autonomy_plan.mutates, false);
  assert.equal(rollup.autonomy_plan.executes_child_commands, false);
  assert.equal(rollup.autonomy_plan.writes_parent_files, false);
  assert.equal(rollup.autonomy_plan.writes_child_files, false);
  assert.equal(rollup.autonomy_plan.creates_tasks, false);
  assert.equal(rollup.autonomy_plan.creates_queues, false);
  assert.equal(rollup.autonomy_plan.applies_patches, false);
  assert.equal(rollup.autonomy_plan.refreshes_readiness, false);
  assert.equal(rollup.autonomy_plan.required_human_approval, true);
  assert.deepEqual(rollup.autonomy_plan.blockers, []);
  assert.deepEqual(rollup.autonomy_plan.planned_steps, []);
  assert.equal(rollup.repos[0].name, "child-app");
  assert.equal(rollup.repos[0].state, "ready");
  assert.equal(rollup.repos[0].source, ".meta-harness/ready.json");
  assert.deepEqual(rollup.repos[0].drift_warnings, []);
  assert.deepEqual(after, before);
});

test("poll --rollup --json includes stale count", () => {
  const { parent } = setupParentChild({ expires_after: PAST });

  const result = run(parent, ["poll", "--rollup", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.ok, false);
  assert.equal(rollup.summary.stale, 1);
  assert.equal(rollup.summary.drift_warnings, 0);
  assert.equal(rollup.repos[0].state, "stale");
  assert.equal(rollup.response_handoff.severity, "warn");
  assert.equal(rollup.response_handoff.next_action, "review_child_repo_evidence");
  assert.equal(rollup.response_handoff.items[0].reason, "child readiness evidence is stale");
  assert.equal(rollup.response_handoff.items[0].mutates, false);
});

test("poll --rollup --json includes top-level and repo drift warnings", () => {
  const { parent } = setupParentChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));

  const result = run(parent, ["poll", "--rollup", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const rollup = JSON.parse(result.stdout);
  assert.equal(rollup.ok, true);
  assert.equal(rollup.summary.drift_warnings, 1);
  assert.equal(rollup.repos[0].drift_warnings[0].id, "DRIFT_TEMPLATE_MANIFEST_MISSING");
  assert.equal(rollup.repos[0].drift_warnings[0].severity, "warn");
  assert.equal(rollup.response_handoff.severity, "warn");
  assert.equal(rollup.response_handoff.items[0].reason, "child has template manifest drift");
  assert.deepEqual(rollup.response_handoff.items[0].drift_warning_ids, ["DRIFT_TEMPLATE_MANIFEST_MISSING"]);
  assert.equal(rollup.response_handoff.items[0].mutates, false);
});

test("poll --rollup Markdown prints failed check IDs and reasons without mutating files", () => {
  const { parent, watched } = setupParentChild({
    ok: false,
    failed: 2,
    checks: [
      {
        id: "MH_SYNC_001",
        name: "sync",
        status: "fail",
        reason: "5 templates missing",
        next_action: "Run sync apply",
      },
      {
        id: "MH_SECURITY_001",
        name: "security",
        status: "fail",
        reason: "missing SECURITY.md",
        next_action: "Restore SECURITY.md",
      },
    ],
  });
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup"]);
  const after = readSnapshot(watched);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Repo Rollup\n/);
  assert.match(result.stdout, /Generated from: local_files/);
  assert.match(result.stdout, /Read-only: child_repos, child_status, child_events, parent_status, parent_events/);
  assert.match(result.stdout, /ROLLUP: 0\/1 repos ready/);
  assert.match(result.stdout, /ready=0 warned=0 failed=1 stale=0 unknown=0 missing=0 invalid=0 drift_warnings=0 next_action_candidates=1/);
  assert.match(result.stdout, /  - ACTION high ACTION_REVIEW_FAILED_READINESS review — review failed child readiness evidence/);
  assert.doesNotMatch(result.stdout, /patch_proposals/);
  assert.doesNotMatch(result.stdout, /  - PATCH /);
  assert.match(result.stdout, /child-app\tfailed\tchild/);
  assert.match(result.stdout, /  - FAIL MH_SYNC_001 sync — 5 templates missing/);
  assert.match(result.stdout, /  - FAIL MH_SECURITY_001 security — missing SECURITY\.md/);
  assert.match(result.stdout, /## Response Handoff/);
  assert.match(result.stdout, /- child-app warn — child readiness failed/);
  assert.match(result.stdout, /  - readiness: MH_SYNC_001, MH_SECURITY_001/);
  assert.match(result.stdout, /  - mutates: false/);
  assert.match(result.stdout, /## Controlled Autonomy Dry-Run Plan/);
  assert.match(result.stdout, /- verdict: ready_for_human_approval/);
  assert.match(result.stdout, /- selected_action_type: review_approved_manual_work_packet/);
  assert.match(result.stdout, /- dry_run: true/);
  assert.match(result.stdout, /- mutates: false/);
  assert.match(result.stdout, /- blockers:\n  - none/);
  assert.deepEqual(after, before);
});

test("poll --rollup Markdown prints deterministic drift warning lines", () => {
  const { parent, child } = setupParentChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  writeJson(templateManifestPath(child), templateManifest("0.9.0", "hash-b"));

  const result = run(parent, ["poll", "--rollup"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready=1 warned=0 failed=0 stale=0 unknown=0 missing=0 invalid=0 drift_warnings=2 next_action_candidates=2/);
  assert.match(result.stdout, /  - ACTION low ACTION_REVIEW_TEMPLATE_DRIFT review — review template manifest drift/);
  assert.doesNotMatch(result.stdout, /patch_proposals/);
  assert.match(result.stdout, /  - DRIFT DRIFT_TEMPLATE_VERSION template_manifest — child template manifest version differs from parent/);
  assert.match(result.stdout, /  - DRIFT DRIFT_TEMPLATE_HASH template_manifest — child template content hash differs from parent/);
  assert.match(result.stdout, /## Response Handoff/);
  assert.match(result.stdout, /- child-app warn — child has template manifest drift/);
  assert.match(result.stdout, /  - drift: DRIFT_TEMPLATE_VERSION, DRIFT_TEMPLATE_HASH/);
});

test("poll --rollup --write is rejected and still does not mutate parent or child files", () => {
  const { parent, watched } = setupParentChild();
  writeJson(templateManifestPath(parent), templateManifest("1.0.0", "hash-a"));
  const before = readSnapshot(watched);

  const result = run(parent, ["poll", "--rollup", "--write"]);
  const after = readSnapshot(watched);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /poll --rollup is read-only/);
  assert.deepEqual(after, before);
});
