"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalReviewOptions } = require("../lib/repo-rollup-proposal-review-options");
const { buildProposalReviewReceiptTemplate } = require("../lib/repo-rollup-proposal-review-receipt-template");
const { buildProposalReviewReceiptValidation } = require("../lib/repo-rollup-proposal-review-receipt-validation");
const {
  buildProposalReviewCopyBlock,
  renderProposalReviewCopyBlockMarkdown,
} = require("../lib/repo-rollup-proposal-review-copy-block");

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

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-copy-")); }
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
function packet(verdict = "ready_for_review", packetId = PACKET_ID) {
  return { kind: "read_only_proposal_review_packet", packet_id: packetId, verdict, mutates: false };
}
function copyBlockFor(verdict = "ready_for_review") {
  const proposalReviewPacket = packet(verdict);
  const proposalReviewOptions = buildProposalReviewOptions({ proposalReviewPacket });
  const proposalReviewReceiptTemplate = buildProposalReviewReceiptTemplate({ proposalReviewOptions });
  const proposalReviewReceiptValidation = buildProposalReviewReceiptValidation({
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    rollup: { summary: {}, repos: [] },
  });
  return buildProposalReviewCopyBlock({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
  });
}
function failedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}
function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

test("valid receipt validation produces a pass copy block", () => {
  const block = copyBlockFor("ready_for_review");
  assert.equal(block.kind, "read_only_proposal_review_copy_block");
  assert.equal(block.source, "proposal_review_receipt_validation");
  assert.equal(block.packet_id, PACKET_ID);
  assert.equal(block.validation_verdict, "pass");
  assert.equal(typeof block.copy_text, "string");
  assert.deepEqual(block.includes, [
    "proposal_review_packet",
    "proposal_review_options",
    "proposal_review_receipt_template",
    "proposal_review_receipt_validation",
  ]);
  assert.equal(block.export_target, null);
  assert.equal(block.writes_files, false);
  assert.equal(block.records_decision, false);
  assert.equal(block.records_approval, false);
  assert.equal(block.mutates, false);
});

test("failing receipt validation produces blocked no-copy behavior", () => {
  const proposalReviewPacket = packet("ready_for_review");
  const proposalReviewOptions = buildProposalReviewOptions({ proposalReviewPacket });
  const proposalReviewReceiptTemplate = buildProposalReviewReceiptTemplate({ proposalReviewOptions });
  const block = buildProposalReviewCopyBlock({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation: { ok: false, verdict: "fail" },
  });
  assert.equal(block.validation_verdict, "fail");
  assert.equal(block.copy_text, null);
  assert.equal(block.reason, "proposal review receipt validation did not pass");
  assert.equal(block.export_target, null);
  assert.equal(block.writes_files, false);
  assert.equal(block.records_decision, false);
  assert.equal(block.records_approval, false);
  assert.equal(block.mutates, false);
});

test("missing receipt validation produces blocked no-copy behavior", () => {
  const block = buildProposalReviewCopyBlock({ proposalReviewPacket: packet("ready_for_review") });
  assert.equal(block.validation_verdict, "fail");
  assert.equal(block.copy_text, null);
  assert.equal(block.reason, "proposal review receipt validation did not pass");
});

test("copy block references the same packet_id across packet options and receipt template", () => {
  const rollup = failedRollup();
  assert.equal(rollup.proposal_review_copy_block.packet_id, rollup.proposal_review_packet.packet_id);
  assert.equal(rollup.proposal_review_copy_block.packet_id, rollup.proposal_review_options.packet_id);
  assert.equal(rollup.proposal_review_copy_block.packet_id, rollup.proposal_review_receipt_template.packet_id);
});

test("copy text is deterministic across repeated rollup builds", () => {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  const left = buildRepoRollup(parent, { now: NOW }).proposal_review_copy_block.copy_text;
  const right = buildRepoRollup(parent, { now: NOW }).proposal_review_copy_block.copy_text;
  assert.equal(left, right);
});

test("copy text avoids language that implies a human decision happened", () => {
  const copyText = copyBlockFor("ready_for_review").copy_text;
  for (const forbidden of [/approved/i, /approval recorded/i, /decision recorded/i, /reviewed by/i, /accepted by/i, /rejected by/i]) {
    assert.doesNotMatch(copyText, forbidden);
  }
  assert.match(copyText, /Allowed decisions:/);
  assert.match(copyText, /approve_for_manual_work/);
  assert.match(copyText, /reject_packet/);
  assert.match(copyText, /defer_packet/);
});

test("copy text contains no generated diff", () => {
  const copyText = copyBlockFor("ready_for_review").copy_text;
  assert.doesNotMatch(copyText, /diff --git/);
  assert.doesNotMatch(copyText, /^--- /m);
  assert.doesNotMatch(copyText, /^\+\+\+ /m);
});

test("rollup includes copy block after receipt validation without changing ok or child readiness", () => {
  const rollup = failedRollup();
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
    "repos",
    "not_changed",
  ]);
  assert.equal(rollup.ok, false);
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.equal(rollup.proposal_review_copy_block.validation_verdict, "pass");
  assert.equal(rollup.proposal_review_copy_block.mutates, false);
});

test("JSON has no forbidden proposal export queue action fields and no patch proposals", () => {
  const json = JSON.stringify(failedRollup());
  for (const field of FORBIDDEN_FILE_FIELDS) assert.equal(json.includes(`"${field}"`), false, field);
  assert.equal(json.includes("proposal_review_copy_block"), true);
  assert.equal(json.includes("\"export_target\":null"), true);
});

test("Markdown renders Proposal Review Copy Block pass and blocked states", () => {
  const markdown = renderRepoRollupMarkdown(failedRollup());
  assert.match(markdown, /## Proposal Review Copy Block/);
  assert.match(markdown, /- validation_verdict: pass/);
  assert.match(markdown, /- writes_files: false/);
  assert.match(markdown, /- records_decision: false/);
  assert.match(markdown, /- records_approval: false/);
  assert.match(markdown, /```text\nProposal Review Copy Block/);

  const blocked = renderProposalReviewCopyBlockMarkdown(buildProposalReviewCopyBlock());
  assert.match(blocked.join("\n"), /- validation_verdict: fail/);
  assert.match(blocked.join("\n"), /- copy_text: null/);
  assert.doesNotMatch(blocked.join("\n"), /```text/);
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
  renderProposalReviewCopyBlockMarkdown(copyBlockFor("ready_for_review"));
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
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
