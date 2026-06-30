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
const { buildProposalReviewPacket } = require("../lib/repo-rollup-proposal-review-packet");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const FORBIDDEN_FILE_FIELDS = Object.freeze([
  ["patch", "proposals"].join("_"),
  ["proposal", "files"].join("_"),
  ["proposal", "file"].join("_"),
  ["proposal", "path"].join("_"),
  ["proposal", "output"].join("_"),
  ["export", "files"].join("_"),
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

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-packet-")); }
function ensureHarness(root) { fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true }); }
function writeFile(filePath, content) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content, "utf8"); }
function writeJson(filePath, value) { writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function configure(parent, repos) { ensureHarness(parent); writeJson(path.join(parent, ".meta-harness", "repos.json"), { repos }); }
function readyJson(overrides = {}) {
  return { schema_version: "1.0.0", generated_at: NOW, target: "/tmp/child", ok: true, redacted: true, expires_after: FUTURE, checks: [], passed: 1, failed: 0, warned: 0, skipped: 0, ...overrides };
}
function addReadyChild(name, ready = readyJson()) {
  const child = tempDir();
  ensureHarness(child);
  writeJson(path.join(child, ".meta-harness", "ready.json"), ready);
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
function run(cwd, args) { return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" }); }
function selectedBrief(overrides = {}) {
  return { kind: "read_only_worker_brief", selected_candidate_id: "ACTION_REVIEW_FAILED_READINESS", selected_repo: "child-app", priority: "high", reason: "review failed child readiness evidence", source_state: "failed", source_warning_ids: [], source_check_ids: ["MH_SYNC_001"], target_paths: [".meta-harness/ready.json"], selection_reason: "selected highest-priority candidate using repo order and candidate order tie-breakers", body: "Review child repo evidence.", mutates: false, ...overrides };
}
function noOpBrief() {
  return { kind: "read_only_worker_brief", selected_candidate_id: null, selected_repo: null, priority: null, reason: null, source_state: null, source_warning_ids: [], source_check_ids: [], target_paths: [], selection_reason: "no next-action candidates", body: "No follow-up action is needed.", mutates: false };
}
function validationFor(draft, brief) {
  return buildProposalValidation({ proposalDraft: draft, nextActionBrief: brief, rollup: { summary: {}, repos: [] } });
}
function packetForBrief(brief) {
  const draft = buildProposalDraft(brief);
  const validation = validationFor(draft, brief);
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: validation });
  return buildProposalReviewPacket({ proposalDraft: draft, proposalValidation: validation, proposalReviewGate: gate });
}
function selectedFailedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}

test("ready-for-review gate produces ready_for_review packet", () => {
  const packet = packetForBrief(selectedBrief());
  assert.equal(packet.kind, "read_only_proposal_review_packet");
  assert.match(packet.packet_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(packet.verdict, "ready_for_review");
  assert.equal(packet.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(packet.selected_repo, "child-app");
  assert.equal(packet.mutates, false);
});

test("no-op gate produces not_needed packet", () => {
  const packet = packetForBrief(noOpBrief());
  assert.equal(packet.verdict, "not_needed");
  assert.equal(packet.selected_candidate_id, null);
  assert.equal(packet.selected_repo, null);
  assert.equal(packet.mutates, false);
});

test("blocked gate produces blocked packet", () => {
  const brief = selectedBrief();
  const draft = buildProposalDraft(brief);
  const validation = { kind: "read_only_proposal_validation", ok: false, verdict: "fail", checks: [{ id: "PROPOSAL_DIFF_001", status: "fail", reason: "diff must be null" }], mutates: false };
  const gate = buildProposalReviewGate({ proposalDraft: draft, proposalValidation: validation });
  const packet = buildProposalReviewPacket({ proposalDraft: draft, proposalValidation: validation, proposalReviewGate: gate });
  assert.equal(packet.verdict, "blocked");
  assert.equal(packet.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.equal(packet.selected_repo, "child-app");
  assert.equal(packet.mutates, false);
});

test("packet ID is deterministic across repeated rollup builds", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", status: "fail", reason: "templates missing" }] }))]);
  const first = buildRepoRollup(parent, { now: NOW }).proposal_review_packet.packet_id;
  const second = buildRepoRollup(parent, { now: NOW }).proposal_review_packet.packet_id;
  assert.equal(first, second);
});

test("packet ID changes when source draft validation or gate content changes", () => {
  const base = {
    proposalDraft: { kind: "read_only_proposal_draft", selected_candidate_id: "A", selected_repo: "child", body: "base", target_paths: ["a"], diff: null, mutates: false },
    proposalValidation: { kind: "read_only_proposal_validation", ok: true, verdict: "pass", checks: [{ id: "P", status: "pass", reason: "base" }], mutates: false },
    proposalReviewGate: { kind: "read_only_proposal_review_gate", verdict: "ready_for_review", selected_candidate_id: "A", selected_repo: "child", next_action: "review_proposal_draft", blocking_check_ids: [], reason: "base", mutates: false },
  };
  const packetId = buildProposalReviewPacket(base).packet_id;
  assert.notEqual(buildProposalReviewPacket({ ...base, proposalDraft: { ...base.proposalDraft, body: "changed" } }).packet_id, packetId);
  assert.notEqual(buildProposalReviewPacket({ ...base, proposalValidation: { ...base.proposalValidation, checks: [{ id: "P", status: "pass", reason: "changed" }] } }).packet_id, packetId);
  assert.notEqual(buildProposalReviewPacket({ ...base, proposalReviewGate: { ...base.proposalReviewGate, reason: "changed" } }).packet_id, packetId);
});

test("packet includes draft validation and gate sections", () => {
  const packet = packetForBrief(selectedBrief());
  assert.deepEqual(packet.sections.map((section) => section.id), ["proposal_draft", "proposal_validation", "proposal_review_gate"]);
  assert.deepEqual(packet.sections.map((section) => section.title), ["Proposal Draft", "Proposal Validation", "Proposal Review Gate"]);
  assert.match(packet.sections[0].body, /Source candidate: ACTION_REVIEW_FAILED_READINESS/);
  assert.match(packet.sections[1].body, /PROPOSAL_KIND_001 pass/);
  assert.match(packet.sections[2].body, /verdict: ready_for_review/);
});

test("packet generation does not change top-level rollup ok", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.ok, false);
  assert.equal(rollup.proposal_review_gate.verdict, "ready_for_review");
  assert.equal(rollup.proposal_review_packet.verdict, "ready_for_review");
});

test("packet generation does not change child repo readiness state", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.deepEqual(rollup.repos[0].failing_checks.map((item) => item.id), ["MH_SYNC_001"]);
});

test("packet generation and Markdown rendering do not mutate parent or child files", () => {
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

test("JSON has no forbidden write export queue action or patch proposal fields", () => {
  const json = JSON.stringify(selectedFailedRollup());
  for (const field of FORBIDDEN_FILE_FIELDS) assert.equal(json.includes(`"${field}"`), false, field);
  assert.equal(json.includes("proposal_draft"), true);
  assert.equal(json.includes("proposal_validation"), true);
  assert.equal(json.includes("proposal_review_gate"), true);
  assert.equal(json.includes("proposal_review_packet"), true);
});

test("Markdown renders Proposal Review Packet", () => {
  const markdown = renderRepoRollupMarkdown(selectedFailedRollup());
  assert.match(markdown, /## Proposal Review Packet/);
  assert.match(markdown, /- verdict: ready_for_review/);
  assert.match(markdown, /- packet_id: sha256:[a-f0-9]{64}/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- selected: child-app ACTION_REVIEW_FAILED_READINESS/);
  assert.match(markdown, /### Proposal Draft/);
  assert.match(markdown, /### Proposal Validation/);
  assert.match(markdown, /### Proposal Review Gate/);
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
