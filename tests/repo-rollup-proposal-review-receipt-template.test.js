"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalReviewOptions } = require("../lib/repo-rollup-proposal-review-options");
const {
  buildProposalReviewReceiptTemplate,
  renderProposalReviewReceiptTemplateMarkdown,
} = require("../lib/repo-rollup-proposal-review-receipt-template");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PACKET_ID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-receipt-")); }
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
function packet(verdict, packetId = PACKET_ID) {
  return { kind: "read_only_proposal_review_packet", packet_id: packetId, verdict, mutates: false };
}
function optionsFor(verdict) {
  return buildProposalReviewOptions({ proposalReviewPacket: packet(verdict) });
}
function receiptFor(verdict) {
  return buildProposalReviewReceiptTemplate({ proposalReviewOptions: optionsFor(verdict) });
}
function failedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}
function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, META_HARNESS_INTERNAL_CLI: "1" },
  });
}

test("ready_for_review options produce approve reject and defer receipt allowed IDs", () => {
  const receipt = receiptFor("ready_for_review");
  assert.equal(receipt.kind, "read_only_proposal_review_receipt_template");
  assert.equal(receipt.source, "proposal_review_options");
  assert.equal(receipt.packet_id, PACKET_ID);
  assert.equal(receipt.verdict, "ready_for_review");
  assert.deepEqual(receipt.allowed_decision_ids, ["approve_for_manual_work", "reject_packet", "defer_packet"]);
  assert.deepEqual(receipt.required_fields, ["packet_id", "decision_id", "reviewer", "reviewed_at", "reason"]);
  assert.deepEqual(receipt.template, { packet_id: PACKET_ID, decision_id: null, reviewer: null, reviewed_at: null, reason: null });
  assert.equal(receipt.records_decision, false);
  assert.equal(receipt.mutates, false);
});

test("blocked options produce fix validation and defer receipt allowed IDs", () => {
  const receipt = receiptFor("blocked");
  assert.equal(receipt.verdict, "blocked");
  assert.deepEqual(receipt.allowed_decision_ids, ["fix_proposal_validation", "defer_packet"]);
});

test("not_needed options produce no_action receipt allowed ID", () => {
  const receipt = receiptFor("not_needed");
  assert.equal(receipt.verdict, "not_needed");
  assert.deepEqual(receipt.allowed_decision_ids, ["no_action"]);
});

test("missing options produce unknown safe no-record template", () => {
  const receipt = buildProposalReviewReceiptTemplate();
  assert.deepEqual(receipt, {
    kind: "read_only_proposal_review_receipt_template",
    source: "proposal_review_options",
    packet_id: null,
    verdict: "unknown",
    allowed_decision_ids: [],
    required_fields: ["packet_id", "decision_id", "reviewer", "reviewed_at", "reason"],
    template: { packet_id: null, decision_id: null, reviewer: null, reviewed_at: null, reason: null },
    records_decision: false,
    mutates: false,
  });
});

test("template does not record a decision or use default_decision", () => {
  const options = optionsFor("ready_for_review");
  assert.equal(options.default_decision, "defer_packet");
  const receipt = buildProposalReviewReceiptTemplate({ proposalReviewOptions: options });
  assert.equal(Object.prototype.hasOwnProperty.call(receipt, "default_decision"), false);
  assert.equal(receipt.template.decision_id, null);
  assert.equal(receipt.template.reviewer, null);
  assert.equal(receipt.template.reviewed_at, null);
  assert.equal(receipt.template.reason, null);
  assert.equal(receipt.records_decision, false);
  assert.equal(receipt.mutates, false);
});

test("receipt template references the same packet_id as proposal_review_options", () => {
  const options = optionsFor("ready_for_review");
  const receipt = buildProposalReviewReceiptTemplate({ proposalReviewOptions: options });
  assert.equal(receipt.packet_id, options.packet_id);
  assert.equal(receipt.template.packet_id, options.packet_id);
});

test("production rollup omits receipt template without changing top-level ok or child readiness state", () => {
  const rollup = failedRollup();
  assert.equal(rollup.ok, false);
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.equal(Object.hasOwn(rollup, "proposal_review_receipt_template"), false);
  assert.equal(Object.hasOwn(rollup, "proposal_review_options"), false);
  assert.equal(rollup.manual_work_packet.verdict, "ready_for_manual_work");
  assert.equal(rollup.manual_work_packet.records_decision, false);
  assert.equal(rollup.manual_work_packet.records_approval, false);
});

test("rollup top-level field order contains only the direct manual-work surface", () => {
  assert.deepEqual(Object.keys(failedRollup()), [
    "schema_version",
    "generated_from",
    "ok",
    "summary",
    "response_handoff",
    "next_action_brief",
    "manual_work_packet",
    "manual_work_packet_artifact_validation",
    "operator_execution_plan",
    "repos",
    "not_changed",
  ]);
});

test("generation and Markdown rendering do not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);
  renderRepoRollupMarkdown(buildRepoRollup(parent, { now: NOW }));
  renderProposalReviewReceiptTemplateMarkdown(receiptFor("ready_for_review"));
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("production JSON has no receipt template ceremony or forbidden output fields", () => {
  const json = JSON.stringify(failedRollup());
  for (const field of FORBIDDEN_FILE_FIELDS) assert.equal(json.includes(`"${field}"`), false, field);
  assert.equal(json.includes("proposal_review_receipt_template"), false);
  assert.equal(json.includes("manual_work_packet"), true);
});

test("lean Markdown suppresses the Proposal Review Receipt Template", () => {
  const markdown = renderRepoRollupMarkdown(failedRollup());
  assert.doesNotMatch(markdown, /## Proposal Review Receipt Template/);
  assert.doesNotMatch(markdown, /## Manual Work Safety Validation/);
  assert.match(markdown, /## Manual Work Packet/);
  assert.match(markdown, /- packet_id: sha256:[a-f0-9]{64}/);
  assert.match(markdown, /- verdict: ready_for_manual_work/);
  assert.match(markdown, /- records_decision: false/);
  assert.match(markdown, /- records_approval: false/);
  assert.match(markdown, /- mutates: false/);
});

test("poll --rollup --write remains rejected and non-mutating", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app");
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);

  const result = run(parent, ["poll", "--rollup", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /poll --rollup is read-only/);
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});
