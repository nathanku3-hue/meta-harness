"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalDraft } = require("../lib/repo-rollup-proposal-draft");
const { validateProposalDraft } = require("../lib/repo-rollup-proposal-validation");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-validation-")); }
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
function validationFor({ draft, brief, summary = {}, repos = [], extra = {} } = {}) {
  return validateProposalDraft({ summary, next_action_brief: brief, proposal_draft: draft, repos, ...extra });
}
function checkById(validation, id) { return validation.checks.find((item) => item.id === id); }
function assertCheckFails(validation, id) { assert.equal(validation.ok, false); assert.equal(validation.verdict, "fail"); assert.equal(checkById(validation, id).status, "fail"); }
function assertTargetFails(targetPath) {
  const brief = selectedBrief({ target_paths: [targetPath] });
  const draft = { ...buildProposalDraft(selectedBrief()), target_paths: [targetPath] };
  assertCheckFails(validationFor({ draft, brief }), "PROPOSAL_TARGETS_001");
}

test("valid no-op proposal draft validates pass", () => {
  const brief = noOpBrief();
  const validation = validationFor({ draft: buildProposalDraft(brief), brief });
  assert.equal(validation.kind, "read_only_proposal_validation");
  assert.equal(validation.ok, true);
  assert.equal(validation.verdict, "pass");
  assert.equal(validation.mutates, false);
  assert.deepEqual(validation.checks.map((item) => item.status), Array(validation.checks.length).fill("pass"));
});

test("valid selected proposal draft validates pass", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  const rollup = buildRepoRollup(parent, { now: NOW });
  assert.deepEqual(Object.keys(rollup), ["schema_version", "generated_from", "ok", "summary", "response_handoff", "next_action_brief", "proposal_draft", "proposal_validation", "proposal_review_gate", "proposal_review_packet", "proposal_review_options", "proposal_review_receipt_template", "proposal_review_receipt_validation", "proposal_review_copy_block", "proposal_review_copy_block_validation", "proposal_review_export_intent", "proposal_review_export_safety_gate", "autonomy_plan", "repos", "not_changed"]);
  assert.equal(rollup.proposal_validation.ok, true);
  assert.equal(rollup.proposal_validation.verdict, "pass");
  assert.equal(checkById(rollup.proposal_validation, "PROPOSAL_KIND_001").reason, "proposal_draft kind is read_only_proposal_draft");
});

test("invalid kind fails validation", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: { ...buildProposalDraft(brief), kind: "write_enabled_proposal_draft" }, brief }), "PROPOSAL_KIND_001");
});

test("non-null diff fails validation", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: { ...buildProposalDraft(brief), diff: "diff --git a/file b/file" }, brief }), "PROPOSAL_DIFF_001");
});

test("mutates=true fails validation", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: { ...buildProposalDraft(brief), mutates: true }, brief }), "PROPOSAL_MUTATES_001");
});

test("absolute target path fails validation", () => {
  assertTargetFails("/tmp/ready.json");
  for (const badPath of ["", null, {}, [], 42, "\\\\server\\share"]) assertTargetFails(badPath);
});

test("drive-letter target path fails validation", () => {
  assertTargetFails("C:/tmp/ready.json");
  assertTargetFails("C:tmp\\ready.json");
});

test("selected candidate mismatch fails validation", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: { ...buildProposalDraft(brief), selected_candidate_id: "ACTION_OTHER" }, brief }), "PROPOSAL_SELECTED_001");
});

test("missing read-only boundary fails validation", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: { ...buildProposalDraft(brief), body: "Review the child repo evidence." }, brief }), "PROPOSAL_BODY_001");
});

test("validation detects forbidden patch_proposals", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: buildProposalDraft(brief), brief, summary: { ["patch_" + "proposals"]: [] } }), "PROPOSAL_NO_PATCH_001");
});

test("validation detects forbidden proposal/action/queue file output fields", () => {
  const brief = selectedBrief();
  assertCheckFails(validationFor({ draft: buildProposalDraft(brief), brief, extra: { queue_file: ".meta-harness/local/queue.json" } }), "PROPOSAL_NO_FILE_OUTPUT_001");
});

test("validation does not change top-level rollup ok", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }))]);
  const rollup = buildRepoRollup(parent, { now: NOW });
  assert.equal(rollup.ok, false);
  assert.equal(rollup.proposal_validation.ok, true);
});

test("validation does not change child repo readiness state", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }))]);
  const rollup = buildRepoRollup(parent, { now: NOW });
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.deepEqual(rollup.repos[0].failing_checks.map((item) => item.id), ["MH_READY_001"]);
});

test("validation generation and Markdown rendering do not mutate parent or child files", () => {
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

test("Markdown renders Proposal Validation", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "FAIL_A", status: "fail" }] }))]);
  const markdown = renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));
  assert.match(markdown, /## Proposal Validation/);
  assert.match(markdown, /- verdict: pass/);
  assert.match(markdown, /- ok: true/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- PROPOSAL_KIND_001 pass — proposal_draft kind is read_only_proposal_draft/);
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
