"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildRepoRollup, renderRepoRollupMarkdown } = require("../lib/repo-rollup");
const { buildProposalReviewOptions } = require("../lib/repo-rollup-proposal-review-options");
const { buildProposalReviewReceiptTemplate } = require("../lib/repo-rollup-proposal-review-receipt-template");
const { buildProposalReviewReceiptValidation } = require("../lib/repo-rollup-proposal-review-receipt-validation");
const { buildProposalReviewCopyBlock } = require("../lib/repo-rollup-proposal-review-copy-block");
const {
  buildProposalReviewCopyBlockValidation,
  renderProposalReviewCopyBlockValidationMarkdown,
} = require("../lib/repo-rollup-proposal-review-copy-block-validation");

const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PACKET_ID = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-rollup-review-copy-validation-")); }
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

function packet(verdict, packetId = PACKET_ID) {
  return { kind: "read_only_proposal_review_packet", packet_id: packetId, verdict, mutates: false };
}

function fullSetup(verdict = "ready_for_review") {
  const proposalReviewPacket = packet(verdict);
  const proposalReviewOptions = buildProposalReviewOptions({ proposalReviewPacket });
  const proposalReviewReceiptTemplate = buildProposalReviewReceiptTemplate({ proposalReviewOptions });
  const proposalReviewReceiptValidation = buildProposalReviewReceiptValidation({
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    rollup: { summary: {}, repos: [] },
  });
  const proposalReviewCopyBlock = buildProposalReviewCopyBlock({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
  });
  return {
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
  };
}

function checkById(validation, id) {
  const found = validation.checks.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

test("valid copy block validates pass in normal ready_for_review state", () => {
  const setup = fullSetup("ready_for_review");
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.kind, "read_only_proposal_review_copy_block_validation");
  assert.equal(validation.ok, true);
  assert.equal(validation.verdict, "pass");
  assert.equal(validation.checks.every(c => c.status === "pass"), true);
});

test("valid copy block validates pass in blocked state (correctly blocked copy block)", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewReceiptValidation = { ok: false, verdict: "fail" };
  setup.proposalReviewCopyBlock = buildProposalReviewCopyBlock(setup);
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, true);
  assert.equal(validation.verdict, "pass");
  assert.equal(validation.checks.every(c => c.status === "pass"), true);
});

test("copy block validation fails on contradictory status: validation verdict is fail but copy_text is present", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewReceiptValidation = { ok: false, verdict: "fail" };
  setup.proposalReviewCopyBlock = buildProposalReviewCopyBlock(setup);
  // Contradiction: verdict is fail (blocked), but we manually set copy_text to a string
  setup.proposalReviewCopyBlock.copy_text = "some text";
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_TEXT_STATE_001").status, "fail");
});

test("copy block validation fails on contradictory status: validation verdict is pass but copy_text is null", () => {
  const setup = fullSetup("ready_for_review");
  // Contradiction: verdict is pass, but we manually set copy_text to null
  setup.proposalReviewCopyBlock.copy_text = null;
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_TEXT_STATE_001").status, "fail");
});

test("copy block validation fails on forbidden decision words in copy_text", () => {
  const setup = fullSetup("ready_for_review");
  // Ingest forbidden word "approved"
  setup.proposalReviewCopyBlock.copy_text += "\napproved by Alice";
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_TEXT_SAFETY_001").status, "fail");
});

test("copy block validation fails on diff/patch blocks in copy_text", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewCopyBlock.copy_text += "\ndiff --git a/file b/file\n+ added line";
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_TEXT_SAFETY_001").status, "fail");
});

test("copy block validation fails on mismatched packet IDs", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewCopyBlock.packet_id = "sha256:differentpacketid";
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_PACKET_ID_001").status, "fail");
});

test("copy block validation fails on non-read-only property (e.g. writes_files is true)", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewCopyBlock.writes_files = true;
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(validation.verdict, "fail");
  assert.equal(checkById(validation, "COPY_BLOCK_READ_ONLY_001").status, "fail");
});

test("copy block validation fails if forbidden fields are present", () => {
  const setup = fullSetup("ready_for_review");
  const validationBefore = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validationBefore.ok, true);

  setup.rollup = { summary: {}, repos: [], export_files: ["some_file.js"] };
  const validationAfter = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validationAfter.ok, false);
  assert.equal(checkById(validationAfter, "COPY_BLOCK_NO_OUTPUT_001").status, "fail");
});

test("copy block validation fails if patch_proposals is present", () => {
  const setup = fullSetup("ready_for_review");
  setup.rollup = { summary: {}, repos: [], patch_proposals: {} };
  const validation = buildProposalReviewCopyBlockValidation(setup);
  assert.equal(validation.ok, false);
  assert.equal(checkById(validation, "COPY_BLOCK_NO_PATCH_001").status, "fail");
});

test("copy block validation renders markdown correctly", () => {
  const setup = fullSetup("ready_for_review");
  const validation = buildProposalReviewCopyBlockValidation(setup);
  const markdown = renderProposalReviewCopyBlockValidationMarkdown(validation);
  assert.match(markdown.join("\n"), /## Proposal Review Copy Block Validation/);
  assert.match(markdown.join("\n"), /- verdict: pass/);
  assert.match(markdown.join("\n"), /- ok: true/);
  assert.match(markdown.join("\n"), /- COPY_BLOCK_KIND_001 pass/);
});

test("copy block validation markdown handles missing validation object gracefully", () => {
  const markdown = renderProposalReviewCopyBlockValidationMarkdown(null);
  assert.match(markdown.join("\n"), /- verdict: fail/);
  assert.match(markdown.join("\n"), /- ok: false/);
  assert.match(markdown.join("\n"), /COPY_BLOCK_VALIDATION_001 fail/);
});
