"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalDraft } = require("../lib/repo-rollup-proposal-draft");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-draft-"));
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

function configure(parent, repos) {
  ensureHarness(parent);
  writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos });
}

function addReadyChild(name, ready = readyJson()) {
  const child = tempDir();
  ensureHarness(child);
  writeJson(path.join(child, ".meta-harness", "ready.json"), ready);
  return { name, path: child, role: "child" };
}

function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, META_HARNESS_INTERNAL_CLI: "1" },
  });
}

test("empty and clean production rollups omit derivative proposal drafts", () => {
  const emptyParent = tempDir();
  configure(emptyParent, []);
  const empty = buildRepoRollup(emptyParent, { now: NOW });
  assert.equal(Object.hasOwn(empty, "proposal_draft"), false);
  assert.equal(empty.manual_work_packet.verdict, "not_needed");

  const cleanParent = tempDir();
  configure(cleanParent, [addReadyChild("clean-child")]);
  const clean = buildRepoRollup(cleanParent, { now: NOW });
  assert.equal(clean.next_action_brief.selected_candidate_id, null);
  assert.equal(Object.hasOwn(clean, "proposal_draft"), false);
  assert.equal(clean.manual_work_packet.verdict, "not_needed");
});

test("next-action brief exposes structured candidate fields", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({
    ok: false,
    failed: 1,
    checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }],
  }));
  configure(parent, [child]);

  const brief = buildRepoRollup(parent, { now: NOW }).next_action_brief;

  assert.equal(brief.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(brief.selected_repo, "child-app");
  assert.equal(brief.priority, "high");
  assert.equal(brief.reason, "review failed child readiness evidence");
  assert.equal(brief.source_state, "failed");
  assert.deepEqual(brief.source_warning_ids, []);
  assert.deepEqual(brief.source_check_ids, ["MH_SYNC_001"]);
  assert.deepEqual(brief.target_paths, [".meta-harness/ready.json"]);
});

test("selected next-action brief flows directly to the manual work packet", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({
    ok: false,
    failed: 1,
    checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }],
  }));
  configure(parent, [child]);

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(Object.hasOwn(rollup, "proposal_draft"), false);
  assert.equal(rollup.manual_work_packet.kind, "manual_work_packet");
  assert.equal(rollup.manual_work_packet.source, "next_action_brief");
  assert.equal(rollup.manual_work_packet.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(rollup.manual_work_packet.selected_repo, "child-app");
  assert.deepEqual(rollup.manual_work_packet.target_paths, [".meta-harness/ready.json"]);
  assert.equal(rollup.manual_work_packet.mutates, false);
  assert.equal(rollup.manual_work_packet.records_decision, false);
  assert.equal(rollup.manual_work_packet.records_approval, false);
});

test("proposal draft uses structured brief fields instead of parsing body text", () => {
  const draft = buildProposalDraft({
    kind: "read_only_worker_brief",
    selected_candidate_id: "ACTION_REVIEW_SECURITY_DRIFT",
    selected_repo: "child-app",
    priority: "low",
    reason: "structured security drift reason",
    source_state: null,
    source_warning_ids: ["DRIFT_SECURITY_POLICY_MISSING"],
    source_check_ids: [],
    target_paths: [".meta-harness/security-policy.json"],
    selection_reason: "selected highest-priority candidate using repo order and candidate order tie-breakers",
    body: "Reason: body text must not be used",
    mutates: false,
  });

  assert.match(draft.body, /Reason: structured security drift reason/);
  assert.doesNotMatch(draft.body, /body text must not be used/);
  assert.deepEqual(draft.target_paths, [".meta-harness/security-policy.json"]);
});

test("omitting proposal draft does not change readiness state or top-level ok", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({
    ok: false,
    failed: 1,
    checks: [{ id: "MH_READY_001", status: "fail" }],
  }));
  configure(parent, [child]);

  const rollup = buildRepoRollup(parent, { now: NOW });

  assert.equal(rollup.ok, false);
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.equal(Object.hasOwn(rollup, "proposal_draft"), false);
  assert.equal(rollup.manual_work_packet.mutates, false);
});

test("proposal draft generation and Markdown rendering do not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({
    ok: false,
    failed: 1,
    checks: [{ id: "MH_READY_001", status: "fail" }],
  }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);

  renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("JSON excludes legacy proposal, file, and queue fields", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }))]);

  const json = JSON.stringify(buildRepoRollup(parent, { now: NOW }));

  assert.equal(json.includes("patch_" + "proposals"), false);
  assert.equal(json.includes("proposal_" + "files"), false);
  assert.equal(json.includes("queue_file"), false);
  assert.equal(json.includes("action_files"), false);
});

test("Markdown suppresses derivative Proposal Draft once non-mutating manual work is ready", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }))]);

  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.doesNotMatch(markdown, new RegExp("## " + "Proposal Draft"));
  assert.doesNotMatch(markdown, /## Proposal Validation/);
  assert.match(markdown, /## Manual Work Packet/);
  assert.match(markdown, /- selected: child-app ACTION_REVIEW_FAILED_READINESS/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- target_paths: \.meta-harness\/ready\.json/);
});

test("Markdown omits Proposal Draft when no candidates exist", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app")]);

  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));

  assert.doesNotMatch(markdown, new RegExp("## " + "Proposal Draft"));
  assert.match(markdown, /## Manual Work Packet/);
  assert.match(markdown, /- verdict: not_needed/);
  assert.match(markdown, /- selected: none/);
  assert.match(markdown, /- mutates: false/);
});

test("poll --rollup --write remains rejected and non-mutating", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app");
  configure(parent, [child]);
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);

  const result = run(parent, ["poll", "--rollup", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /poll --rollup is read-only/);
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});
