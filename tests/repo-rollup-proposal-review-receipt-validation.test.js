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
const {
  buildProposalReviewReceiptValidation,
  renderProposalReviewReceiptValidationMarkdown,
} = require("../lib/repo-rollup-proposal-review-receipt-validation");

const BIN = path.join(__dirname, "..", "bin", "meta-harness.js");
const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PACKET_ID = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-receipt-validation-")); }
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
function validationFor(verdict) {
  return buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor(verdict), proposalReviewReceiptTemplate: receiptFor(verdict), rollup: { summary: {}, repos: [] } });
}
function failedRollup() {
  const parent = tempDir();
  configure(parent, [addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_SYNC_001", name: "sync", status: "fail", reason: "templates missing" }] }))]);
  return buildRepoRollup(parent, { now: NOW });
}
function checkById(validation, id) {
  const found = validation.checks.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}
function assertPass(validation) {
  assert.equal(validation.kind, "read_only_proposal_review_receipt_validation");
  assert.equal(validation.ok, true);
  assert.equal(validation.verdict, "pass");
  assert.equal(validation.mutates, false);
  assert.equal(validation.checks.every((item) => item.status === "pass"), true);
}
function assertFailsCheck(validation, id) {
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, id).status, "fail");
  assert.equal(validation.mutates, false);
}
function run(cwd, args) {
  return childProcess.spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

test("valid ready_for_review receipt template validates pass", () => {
  assertPass(validationFor("ready_for_review"));
});

test("valid blocked receipt template validates pass", () => {
  assertPass(validationFor("blocked"));
});

test("valid not_needed receipt template validates pass", () => {
  assertPass(validationFor("not_needed"));
});

test("missing options safe no-record receipt template validates pass", () => {
  const receipt = buildProposalReviewReceiptTemplate();
  const validation = buildProposalReviewReceiptValidation({ proposalReviewReceiptTemplate: receipt, rollup: { summary: {}, repos: [] } });
  assert.equal(receipt.packet_id, null);
  assert.equal(receipt.verdict, "unknown");
  assert.deepEqual(receipt.allowed_decision_ids, []);
  assert.equal(receipt.records_decision, false);
  assert.equal(receipt.mutates, false);
  assertPass(validation);
});

test("invalid kind fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), kind: "wrong" };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_KIND_001");
});

test("source mismatch fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), source: "proposal_review_packet" };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_SOURCE_001");
});

test("packet_id mismatch fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), packet_id: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_PACKET_001");
});

test("verdict mismatch fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), verdict: "blocked" };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_VERDICT_001");
});

test("allowed_decision_ids mismatch fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), allowed_decision_ids: ["defer_packet"] };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_ALLOWED_001");
});

test("required_fields mismatch fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), required_fields: ["packet_id", "decision_id"] };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_REQUIRED_FIELDS_001");
});

test("non-null decision_id reviewer reviewed_at or reason fails validation", () => {
  for (const field of ["decision_id", "reviewer", "reviewed_at", "reason"]) {
    const receipt = receiptFor("ready_for_review");
    receipt.template = { ...receipt.template, [field]: "recorded" };
    assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_NULLS_001");
  }
});

test("records_decision true fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), records_decision: true };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_RECORDS_001");
});

test("mutates true fails validation", () => {
  const receipt = { ...receiptFor("ready_for_review"), mutates: true };
  assertFailsCheck(buildProposalReviewReceiptValidation({ proposalReviewOptions: optionsFor("ready_for_review"), proposalReviewReceiptTemplate: receipt }), "RECEIPT_TEMPLATE_MUTATES_001");
});

test("forbidden file output field fails validation in approved scan containers", () => {
  const options = optionsFor("ready_for_review");
  const receipt = receiptFor("ready_for_review");
  const validation = buildProposalReviewReceiptValidation({
    proposalReviewOptions: options,
    proposalReviewReceiptTemplate: receipt,
    rollup: { summary: {}, repos: [], export_file: ".meta-harness/local/export.md" },
  });
  assertFailsCheck(validation, "RECEIPT_TEMPLATE_NO_OUTPUT_001");
});

test("patch_proposals field fails validation in approved scan containers", () => {
  const options = optionsFor("ready_for_review");
  const receipt = receiptFor("ready_for_review");
  const validation = buildProposalReviewReceiptValidation({
    proposalReviewOptions: options,
    proposalReviewReceiptTemplate: receipt,
    rollup: { summary: {}, repos: [{ name: "child", patch_proposals: [] }] },
  });
  assertFailsCheck(validation, "RECEIPT_TEMPLATE_NO_PATCH_001");
});

test("validation does not change top-level rollup ok", () => {
  const rollup = failedRollup();
  assert.equal(rollup.ok, false);
  assert.equal(rollup.proposal_review_receipt_validation.ok, true);
  assert.equal(rollup.proposal_review_receipt_validation.verdict, "pass");
});

test("validation does not change child repo readiness state", () => {
  const rollup = failedRollup();
  assert.equal(rollup.summary.failed, 1);
  assert.equal(rollup.repos[0].state, "failed");
  assert.equal(rollup.proposal_review_receipt_validation.mutates, false);
});

test("generation and Markdown rendering do not mutate parent or child files", () => {
  const parent = tempDir();
  const child = addReadyChild("child-app", readyJson({ ok: false, failed: 1, checks: [{ id: "MH_READY_001", status: "fail" }] }));
  configure(parent, [child]);
  writeFile(path.join(parent, ".meta-harness", "status.md"), "# Parent\n");
  writeFile(path.join(child.path, ".meta-harness", "status.md"), "# Child\n");
  const parentBefore = readSnapshot(parent);
  const childBefore = readSnapshot(child.path);
  const rollup = buildRepoRollup(parent, { now: NOW });
  renderRepoRollupMarkdown(rollup);
  renderProposalReviewReceiptValidationMarkdown(rollup.proposal_review_receipt_validation);
  assert.deepEqual(readSnapshot(parent), parentBefore);
  assert.deepEqual(readSnapshot(child.path), childBefore);
});

test("Markdown renders Proposal Review Receipt Validation", () => {
  const markdown = renderRepoRollupMarkdown(failedRollup());
  assert.match(markdown, /## Proposal Review Receipt Validation/);
  assert.match(markdown, /- verdict: pass/);
  assert.match(markdown, /- ok: true/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- RECEIPT_TEMPLATE_KIND_001 pass/);
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
