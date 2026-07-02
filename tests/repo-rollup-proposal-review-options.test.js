"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalReviewOptions, renderProposalReviewOptionsMarkdown } = require("../lib/repo-rollup-proposal-review-options");

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

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-options-")); }
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
function packet(verdict, packetId = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  return { kind: "read_only_proposal_review_packet", packet_id: packetId, verdict, mutates: false };
}
function decisionIds(options) { return options.allowed_decisions.map((decision) => decision.id); }
function selectedFailedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}

test("ready_for_review packet exposes approve reject and defer options", () => {
  const options = buildProposalReviewOptions({ proposalReviewPacket: packet("ready_for_review") });
  assert.equal(options.kind, "read_only_proposal_review_options");
  assert.equal(options.packet_id, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(options.verdict, "ready_for_review");
  assert.deepEqual(decisionIds(options), ["approve_for_manual_work", "reject_packet", "defer_packet"]);
  assert.deepEqual(options.allowed_decisions.map((decision) => decision.label), ["Approve for manual work", "Reject packet", "Defer packet"]);
  assert.equal(options.default_decision, "defer_packet");
  assert.equal(options.mutates, false);
});

test("blocked packet exposes fix_proposal_validation and defer options", () => {
  const options = buildProposalReviewOptions({ proposalReviewPacket: packet("blocked") });
  assert.equal(options.verdict, "blocked");
  assert.deepEqual(decisionIds(options), ["fix_proposal_validation", "defer_packet"]);
  assert.deepEqual(options.allowed_decisions.map((decision) => decision.label), ["Fix proposal validation", "Defer packet"]);
  assert.equal(options.default_decision, "defer_packet");
});

test("not_needed packet exposes no_action option", () => {
  const options = buildProposalReviewOptions({ proposalReviewPacket: packet("not_needed") });
  assert.equal(options.verdict, "not_needed");
  assert.deepEqual(decisionIds(options), ["no_action"]);
  assert.equal(options.allowed_decisions[0].label, "No action");
  assert.equal(options.allowed_decisions[0].requires_explicit_human_action, false);
  assert.equal(options.default_decision, "no_action");
});

test("missing packet falls back to unknown verdict and defer option", () => {
  const options = buildProposalReviewOptions();
  assert.deepEqual(options, {
    kind: "read_only_proposal_review_options",
    packet_id: null,
    verdict: "unknown",
    allowed_decisions: [{ id: "defer_packet", label: "Defer packet", requires_explicit_human_action: true, mutates: false }],
    default_decision: "defer_packet",
    mutates: false,
  });
});

test("unknown packet verdict preserves packet_id and normalizes verdict", () => {
  const options = buildProposalReviewOptions({ proposalReviewPacket: packet("surprising_future_verdict", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") });
  assert.equal(options.packet_id, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(options.verdict, "unknown");
  assert.deepEqual(decisionIds(options), ["defer_packet"]);
  assert.equal(options.default_decision, "defer_packet");
});

test("default decision and option bodies are deterministic", () => {
  const first = buildProposalReviewOptions({ proposalReviewPacket: packet("ready_for_review") });
  const second = buildProposalReviewOptions({ proposalReviewPacket: packet("ready_for_review") });
  assert.deepEqual(first, second);
});

test("all decisions are non-mutating and only no_action skips explicit human action", () => {
  for (const verdict of ["ready_for_review", "blocked", "not_needed", "unknown"]) {
    const options = buildProposalReviewOptions({ proposalReviewPacket: packet(verdict) });
    for (const decision of options.allowed_decisions) {
      assert.equal(decision.mutates, false, decision.id);
      assert.equal(decision.requires_explicit_human_action, decision.id !== "no_action", decision.id);
    }
  }
});

test("rollup options reference the same packet_id as proposal_review_packet", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.proposal_review_packet.verdict, "ready_for_review");
  assert.equal(rollup.proposal_review_options.packet_id, rollup.proposal_review_packet.packet_id);
  assert.equal(rollup.proposal_review_options.verdict, "ready_for_review");
});

test("rollup top-level field order includes proposal_review_options after proposal_review_packet", () => {
  const rollup = selectedFailedRollup();
  assert.deepEqual(Object.keys(rollup), [
    "schema_version",
    "generated_from",
    "ok",
    "summary",
    "response_handoff",
    "next_action_brief",
    "proposal_draft",
    "proposal_validation",
    "proposal_review_gate",
    "proposal_review_packet",
    "proposal_review_options",
    "proposal_review_receipt_template",
    "proposal_review_receipt_validation",
    "proposal_review_copy_block",
    "proposal_review_copy_block_validation",
    "proposal_review_export_intent",
    "proposal_review_export_safety_gate",
    "autonomy_plan",
    "autonomy_approval_receipt_validation",
    "manual_work_packet",
    "repos",
    "not_changed",
  ]);
});

test("options do not change top-level ok or child readiness state", () => {
  const rollup = selectedFailedRollup();
  assert.equal(rollup.ok, false);
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.deepEqual(rollup.repos[0].failing_checks.map((item) => item.id), ["MH_SYNC_001"]);
});

test("options generation and Markdown rendering do not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);
  renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));
  renderProposalReviewOptionsMarkdown(buildProposalReviewOptions({ proposalReviewPacket: packet("ready_for_review") }));
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("JSON has no forbidden write export queue action file fields", () => {
  const json = JSON.stringify(selectedFailedRollup());
  for (const field of FORBIDDEN_FILE_FIELDS) assert.equal(json.includes(`"${field}"`), false, field);
  assert.equal(json.includes("proposal_review_options"), true);
});

test("Markdown renders Proposal Review Options", () => {
  const markdown = renderRepoRollupMarkdown(selectedFailedRollup());
  assert.match(markdown, /## Proposal Review Options/);
  assert.match(markdown, /- packet_id: sha256:[a-f0-9]{64}/);
  assert.match(markdown, /- verdict: ready_for_review/);
  assert.match(markdown, /- default_decision: defer_packet/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- approve_for_manual_work — Approve for manual work/);
  assert.match(markdown, /- reject_packet — Reject packet/);
  assert.match(markdown, /- defer_packet — Defer packet/);
});
