"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildProposalReviewOptions } = require("../lib/repo-rollup-proposal-review-options");
const { buildProposalReviewReceiptTemplate } = require("../lib/repo-rollup-proposal-review-receipt-template");
const { buildProposalReviewReceiptValidation } = require("../lib/repo-rollup-proposal-review-receipt-validation");
const { buildProposalReviewCopyBlock } = require("../lib/repo-rollup-proposal-review-copy-block");
const { buildProposalReviewCopyBlockValidation } = require("../lib/repo-rollup-proposal-review-copy-block-validation");
const { buildProposalReviewExportIntent } = require("../lib/repo-rollup-proposal-review-export-intent");
const { buildProposalReviewExportSafetyGate } = require("../lib/repo-rollup-proposal-review-export-safety-gate");
const {
  buildAutonomyPlan,
  renderAutonomyPlanMarkdown,
  hasAllowedDecision,
} = require("../lib/repo-rollup-autonomy-plan");

const PACKET_ID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function packet(verdict = "ready_for_review") {
  return {
    kind: "read_only_proposal_review_packet",
    packet_id: PACKET_ID,
    verdict,
    selected_repo: verdict === "not_needed" ? null : "child-app",
    selected_candidate_id: verdict === "not_needed" ? null : "ACTION_REVIEW_FAILED_READINESS",
    mutates: false,
  };
}

function fullSetup(verdict = "ready_for_review") {
  const proposalReviewPacket = packet(verdict);
  const proposalReviewOptions = buildProposalReviewOptions({ proposalReviewPacket });
  const proposalReviewReceiptTemplate = buildProposalReviewReceiptTemplate({ proposalReviewOptions });
  const rollup = { summary: {}, repos: [] };
  const proposalReviewReceiptValidation = buildProposalReviewReceiptValidation({
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    rollup,
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
    rollup,
  });
  const proposalReviewExportIntent = buildProposalReviewExportIntent({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation,
    rollup,
  });
  const proposalReviewExportSafetyGate = buildProposalReviewExportSafetyGate({
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation,
    proposalReviewExportIntent,
    rollup,
  });
  return {
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewReceiptValidation,
    proposalReviewCopyBlock,
    proposalReviewCopyBlockValidation,
    proposalReviewExportIntent,
    proposalReviewExportSafetyGate,
    rollup,
  };
}

function blockerIds(plan) {
  return plan.blockers.map((item) => item.id);
}

function assertNonMutating(plan) {
  assert.equal(plan.dry_run, true);
  assert.equal(plan.mutates, false);
  assert.equal(plan.executes_child_commands, false);
  assert.equal(plan.writes_parent_files, false);
  assert.equal(plan.writes_child_files, false);
  assert.equal(plan.creates_tasks, false);
  assert.equal(plan.creates_queues, false);
  assert.equal(plan.applies_patches, false);
  assert.equal(plan.refreshes_readiness, false);
  assert.equal(plan.required_human_approval, true);
}

test("hasAllowedDecision checks allowed decision objects by id", () => {
  const setup = fullSetup();
  assert.equal(hasAllowedDecision(setup.proposalReviewOptions, "approve_for_manual_work"), true);
  assert.equal(hasAllowedDecision(setup.proposalReviewOptions, "missing"), false);
});

test("autonomy plan is not_needed when proposal review packet is not needed", () => {
  const plan = buildAutonomyPlan({ proposalReviewPacket: packet("not_needed") });
  assert.equal(plan.kind, "controlled_autonomy_dry_run_plan");
  assert.equal(plan.source, "proposal_review_export_safety_gate");
  assert.equal(plan.verdict, "not_needed");
  assert.equal(plan.selected_action_type, null);
  assert.equal(plan.packet_id, PACKET_ID);
  assert.equal(plan.selected_repo, null);
  assert.equal(plan.selected_candidate_id, null);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.planned_steps, []);
  assertNonMutating(plan);
});

test("autonomy plan blocks when proposal review packet is missing", () => {
  const plan = buildAutonomyPlan({});
  assert.equal(plan.verdict, "blocked");
  assert.equal(plan.selected_action_type, null);
  assert.ok(blockerIds(plan).includes("AUTONOMY_PACKET_READY_001"));
  assertNonMutating(plan);
});

test("autonomy plan blocks when proposal review packet verdict is blocked", () => {
  const setup = fullSetup("blocked");
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_PACKET_READY_001"));
});

test("autonomy plan blocks when selected packet fields are missing", () => {
  const setup = fullSetup();
  setup.proposalReviewPacket.selected_candidate_id = null;
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_PACKET_FIELDS_001"));
});

test("autonomy plan blocks when manual-work decision is absent", () => {
  const setup = fullSetup();
  setup.proposalReviewOptions.allowed_decisions = setup.proposalReviewOptions.allowed_decisions.filter((decision) => decision.id !== "approve_for_manual_work");
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_OPTIONS_APPROVAL_001"));
});

test("autonomy plan blocks when receipt template records a decision", () => {
  const setup = fullSetup();
  setup.proposalReviewReceiptTemplate.template.decision_id = "approve_for_manual_work";
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_RECEIPT_TEMPLATE_001"));
});

test("autonomy plan blocks when receipt validation fails", () => {
  const setup = fullSetup();
  setup.proposalReviewReceiptValidation = { ok: false, verdict: "fail", mutates: false };
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_RECEIPT_VALIDATION_001"));
});

test("autonomy plan blocks when copy block validation fails", () => {
  const setup = fullSetup();
  setup.proposalReviewCopyBlockValidation = { ok: false, verdict: "fail", mutates: false };
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_COPY_BLOCK_VALIDATION_001"));
});

test("autonomy plan blocks when export safety gate passes but copy block validation fails", () => {
  const setup = fullSetup();
  setup.proposalReviewCopyBlockValidation = { ok: false, verdict: "fail", mutates: false };
  setup.proposalReviewExportIntent = buildProposalReviewExportIntent(setup);
  setup.proposalReviewExportSafetyGate = buildProposalReviewExportSafetyGate(setup);
  assert.equal(setup.proposalReviewExportSafetyGate.verdict, "pass");
  assert.equal(setup.proposalReviewCopyBlockValidation.verdict, "fail");

  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_COPY_BLOCK_VALIDATION_001"));
});

test("autonomy plan blocks when export intent can write files", () => {
  const setup = fullSetup();
  setup.proposalReviewExportIntent.writes_files = true;
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_EXPORT_INTENT_READ_ONLY_001"));
});

test("autonomy plan blocks when export safety gate fails", () => {
  const setup = fullSetup();
  setup.proposalReviewExportSafetyGate = { ok: false, verdict: "fail", mutates: false };
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "blocked");
  assert.ok(blockerIds(plan).includes("AUTONOMY_EXPORT_SAFETY_GATE_001"));
});

test("autonomy plan is ready only when the full proposal review chain passes", () => {
  const setup = fullSetup();
  const plan = buildAutonomyPlan(setup);
  assert.equal(plan.verdict, "ready_for_human_approval");
  assert.equal(plan.selected_action_type, "review_approved_manual_work_packet");
  assert.equal(plan.packet_id, PACKET_ID);
  assert.equal(plan.selected_repo, "child-app");
  assert.equal(plan.selected_candidate_id, "ACTION_REVIEW_FAILED_READINESS");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.planned_steps.length, 5);
  assertNonMutating(plan);
});

test("autonomy plan can derive inputs from rollup object", () => {
  const setup = fullSetup();
  const plan = buildAutonomyPlan({
    rollup: {
      proposal_review_packet: setup.proposalReviewPacket,
      proposal_review_options: setup.proposalReviewOptions,
      proposal_review_receipt_template: setup.proposalReviewReceiptTemplate,
      proposal_review_receipt_validation: setup.proposalReviewReceiptValidation,
      proposal_review_copy_block_validation: setup.proposalReviewCopyBlockValidation,
      proposal_review_export_intent: setup.proposalReviewExportIntent,
      proposal_review_export_safety_gate: setup.proposalReviewExportSafetyGate,
    },
  });
  assert.equal(plan.verdict, "ready_for_human_approval");
});

test("autonomy plan markdown renders deterministic section", () => {
  const plan = buildAutonomyPlan(fullSetup());
  const markdown = renderAutonomyPlanMarkdown(plan).join("\n");
  assert.match(markdown, /## Controlled Autonomy Dry-Run Plan/);
  assert.match(markdown, /- verdict: ready_for_human_approval/);
  assert.match(markdown, /- selected_action_type: review_approved_manual_work_packet/);
  assert.match(markdown, /- dry_run: true/);
  assert.match(markdown, /- mutates: false/);
  assert.match(markdown, /- required_human_approval: true/);
  assert.match(markdown, /- blockers:\n  - none/);
  assert.match(markdown, /- planned steps:\n  1\. Review the existing proposal review packet\./);
});

test("autonomy plan markdown handles missing plan as blocked", () => {
  const markdown = renderAutonomyPlanMarkdown(null).join("\n");
  assert.match(markdown, /- verdict: blocked/);
  assert.match(markdown, /AUTONOMY_PLAN_001 fail/);
});
