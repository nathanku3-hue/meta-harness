"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalDraft } = require("../lib/repo-rollup-proposal-draft");
const { buildProposalValidation } = require("../lib/repo-rollup-proposal-validation");
const { buildProposalReviewGate } = require("../lib/repo-rollup-proposal-review-gate");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const FORBIDDEN_FILE_FIELDS = Object.freeze([
  ["proposal", "files"].join("_"),
  ["proposal", "file"].join("_"),
  ["proposal", "path"].join("_"),
  ["proposal", "output"].join("_"),
  ["export", "file"].join("_"),
  ["export", "path"].join("_"),
  ["export", "output"].join("_"),
  ["queue", "files"].join("_"),
  ["queue", "file"].join("_"),
  ["queue", "path"].join("_"),
  ["queue", "output"].join("_"),
  ["action", "files"].join("_"),
  ["action", "file"].join("_"),
  ["action", "path"].join("_"),
  ["action", "output"].join("_"),
]);

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-gate-")); }
function ensureHarness(root) { fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true }); }
function writeFile(filePath, content) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content, "utf8"); }
function writeJson(filePath, value) { writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }
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
  return { schema_version: "1.0.0", generated_at: NOW, target: "/tmp/child", ok: true, redacted: true, expires_after: FUTURE, checks: [], passed: 1, failed: 0, warned: 0, skipped: 0, ...overrides };
}
function configure(parent, repos) { ensureHarness(parent); writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos }); }
function addReadyChild(name, ready = readyJson()) {
  const child = tempDir();
  ensureHarness(child);
  writeJson(path.join(child, ".meta-harness", "ready.json"), ready);
  return { name, path: child, role: "child" };
}
function run(cwd, args) { return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" }); }
function noOpBrief() {
  return { kind: "read_only_worker_brief", selected_candidate_id: null, selected_repo: null, priority: null, reason: null, source_state: null, source_warning_ids: [], source_check_ids: [], target_paths: [], selection_reason: "no next-action candidates", body: "No follow-up action is needed.", mutates: false };
}
function selectedBrief(overrides = {}) {
  return { kind: "read_only_worker_brief", selected_candidate_id: "ACTION_REVIEW_FAILED_READINESS", selected_repo: "child-app", priority: "high", reason: "review failed child readiness evidence", source_state: "failed", source_warning_ids: [], source_check_ids: ["MH_SYNC_001"], target_paths: [".meta-harness/ready.json"], selection_reason: "selected highest-priority candidate using repo order and candidate order tie-breakers", body: "Review child repo evidence.", mutates: false, ...overrides };
}
function validationFor(draft, brief) {
  return buildProposalValidation({ proposalDraft: draft, nextActionBrief: brief, rollup: { summary: {}, repos: [] } });
}
function selectedFailedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}

test("valid selected proposal draft returns ready_for_review", () => {
  const brief = selectedBrief();
  const draft = buildProposalDraft(brief);
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: validationFor(draft, brief) });
  assert.equal(gate.kind, "read_only_proposal_review_gate");
  assert.equal(gate.verdict, "ready_for_review");
  assert.equal(gate.reason, "proposal draft is valid and has a selected next-action candidate");
  assert.equal(gate.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(gate.selected_repo, "child-app");
  assert.deepEqual(gate.blocking_check_ids, []);
  assert.equal(gate.next_action, "review_proposal_draft");
  assert.equal(gate.mutates, false);
});

test("valid no-op proposal draft returns not_needed", () => {
  const brief = noOpBrief();
  const draft = buildProposalDraft(brief);
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: validationFor(draft, brief) });
  assert.equal(gate.verdict, "not_needed");
  assert.equal(gate.reason, "no next-action candidate is selected");
  assert.equal(gate.selected_candidate_id, null);
  assert.equal(gate.selected_repo, null);
  assert.deepEqual(gate.blocking_check_ids, []);
  assert.equal(gate.next_action, "none");
  assert.equal(gate.mutates, false);
});

test("failed validation returns blocked", () => {
  const draft = buildProposalDraft(selectedBrief());
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: { ok: false, checks: [{ id: "PROPOSAL_DIFF_001", status: "fail" }] } });
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.reason, "proposal validation failed");
  assert.equal(gate.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(gate.selected_repo, "child-app");
  assert.equal(gate.next_action, "fix_proposal_validation");
  assert.equal(gate.mutates, false);
});

test("blocked gate includes failing validation check IDs", () => {
  const draft = buildProposalDraft(selectedBrief());
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: { ok: false, checks: [
    { id: "PROPOSAL_KIND_001", status: "pass" },
    { id: "PROPOSAL_DIFF_001", status: "fail" },
    { id: "PROPOSAL_NO_FILE_OUTPUT_001", status: "fail" },
  ] } });
  assert.deepEqual(gate.blocking_check_ids, ["PROPOSAL_DIFF_001", "PROPOSAL_NO_FILE_OUTPUT_001"]);
});

test("review gate does not change top-level rollup ok", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.ok, false);
  assert.equal(rollup.proposal_validation.ok, true);
  assert.equal(rollup.proposal_review_gate.verdict, "ready_for_review");
});

test("review gate does not change child repo readiness state", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.deepEqual(rollup.repos[0].failing_checks.map((item) => item.id), ["MH_SYNC_001"]);
  assert.equal(rollup.proposal_review_gate.next_action, "review_proposal_draft");
});

test("review gate generation and Markdown rendering do not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);
  renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("JSON has no forbidden file output fields", () => {
  const json = JSON.stringify(selectedFailedRollup());
  for (const field of FORBIDDEN_FILE_FIELDS) assert.equal(json.includes(`"${field}"`), false, field);
  assert.equal(json.includes("proposal_draft"), true);
  assert.equal(json.includes("proposal_validation"), true);
  assert.equal(json.includes("proposal_review_gate"), true);
});

test("JSON has no patch_proposals", () => {
  assert.equal(JSON.stringify(selectedFailedRollup()).includes(["patch", "proposals"].join("_")), false);
});

test("Markdown renders Proposal Review Gate", () => {
  const markdown = renderRepoRollupMarkdown(selectedFailedRollup());
  assert.match(markdown, /## Proposal Review Gate/);
  assert.match(markdown, /- verdict: ready_for_review/);
  assert.match(markdown, /- next_action: review_proposal_draft/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- selected: child-app ACTION_REVIEW_FAILED_READINESS/);
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
