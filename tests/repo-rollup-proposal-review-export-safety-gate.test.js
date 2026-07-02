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
const { buildProposalReviewCopyBlockValidation } = require("../lib/repo-rollup-proposal-review-copy-block-validation");
const {
  buildProposalReviewExportIntent,
  renderProposalReviewExportIntentMarkdown,
} = require("../lib/repo-rollup-proposal-review-export-intent");
const {
  buildProposalReviewExportSafetyGate,
  renderProposalReviewExportSafetyGateMarkdown,
} = require("../lib/repo-rollup-proposal-review-export-safety-gate");

const NOW = "2026-06-30T04:00:00.000Z";
const FUTURE = "2026-07-01T04:00:00.000Z";
const PACKET_ID = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

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
  const proposalReviewCopyBlockValidation = buildProposalReviewCopyBlockValidation({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    rollup: { summary: {}, repos: [] },
  });
  const proposalReviewExportIntent = buildProposalReviewExportIntent({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation,
    rollup: { summary: {}, repos: [] },
  });
  return {
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation,
    proposalReviewExportIntent,
    rollup: { summary: {}, repos: [] },
  };
}

function checkById(gate, id) {
  const found = gate.checks.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

test("valid export safety gate passes in normal ready_for_review state", () => {
  const setup = fullSetup("ready_for_review");
  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.kind, "read_only_proposal_review_export_safety_gate");
  assert.equal(gate.ok, true);
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.checks.every(c => c.status === "pass"), true);
});

test("valid export safety gate passes in blocked copy block validation state", () => {
  const setup = fullSetup("ready_for_review");
  // Force copy block validation failure
  setup.proposalReviewReceiptValidation = { ok: false, verdict: "fail" };
  setup.proposalReviewCopyBlock = buildProposalReviewCopyBlock(setup);
  setup.proposalReviewCopyBlockValidation = buildProposalReviewCopyBlockValidation(setup);
  setup.proposalReviewExportIntent = buildProposalReviewExportIntent(setup);

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, true);
  assert.equal(gate.verdict, "pass");
  assert.equal(gate.checks.every(c => c.status === "pass"), true);
});

test("export safety gate fails on contradictory validation verdict mismatch", () => {
  const setup = fullSetup("ready_for_review");
  // Contradiction: copy block validation passed, but intent claims validation_verdict is fail
  setup.proposalReviewExportIntent.validation_verdict = "fail";

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(gate.verdict, "fail");
  assert.equal(checkById(gate, "EXPORT_SAFETY_COPY_BLOCK_VALIDATION_001").status, "fail");
});

test("export safety gate fails on non-null export target", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewExportIntent.export_target = "proposal_files";

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(gate.verdict, "fail");
  assert.equal(checkById(gate, "EXPORT_SAFETY_INTENT_CONSTRAINTS_001").status, "fail");
});

test("export safety gate fails if writes_files is true", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewExportIntent.writes_files = true;

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(gate.verdict, "fail");
  assert.equal(checkById(gate, "EXPORT_SAFETY_INTENT_CONSTRAINTS_001").status, "fail");
});

test("export safety gate fails if mismatched packet ID in intent", () => {
  const setup = fullSetup("ready_for_review");
  setup.proposalReviewExportIntent.packet_id = "sha256:mismatchedpacket";

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(gate.verdict, "fail");
  assert.equal(checkById(gate, "EXPORT_SAFETY_PACKET_ID_001").status, "fail");
});

test("export safety gate fails if forbidden fields are present in rollup", () => {
  const setup = fullSetup("ready_for_review");
  setup.rollup = { summary: {}, repos: [], export_files: ["some_file.js"] };

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(checkById(gate, "EXPORT_SAFETY_NO_OUTPUT_001").status, "fail");
});

test("export safety gate fails if patch_proposals is present in rollup", () => {
  const setup = fullSetup("ready_for_review");
  setup.rollup = { summary: {}, repos: [], patch_proposals: {} };

  const gate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(gate.ok, false);
  assert.equal(checkById(gate, "EXPORT_SAFETY_NO_PATCH_001").status, "fail");
});

test("export intent and gate markdown render correctly", () => {
  const setup = fullSetup("ready_for_review");
  const intent = setup.proposalReviewExportIntent;
  const gate = buildProposalReviewExportSafetyGate(setup);

  const intentMarkdown = renderProposalReviewExportIntentMarkdown(intent);
  assert.match(intentMarkdown.join("\n"), /## Proposal Review Export Intent/);
  assert.match(intentMarkdown.join("\n"), /- declared_intent: none/);

  const gateMarkdown = renderProposalReviewExportSafetyGateMarkdown(gate);
  assert.match(gateMarkdown.join("\n"), /## Proposal Review Export Safety Gate/);
  assert.match(gateMarkdown.join("\n"), /- verdict: pass/);
  assert.match(gateMarkdown.join("\n"), /EXPORT_SAFETY_PACKET_ID_001 pass/);
});

test("gate markdown handles missing gate object gracefully", () => {
  const markdown = renderProposalReviewExportSafetyGateMarkdown(null);
  assert.match(markdown.join("\n"), /- verdict: fail/);
  assert.match(markdown.join("\n"), /EXPORT_SAFETY_GATE_001 fail/);
});
