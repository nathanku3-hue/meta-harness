"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAutonomyApprovalReceiptValidation,
  renderAutonomyApprovalReceiptValidationMarkdown,
  parseIsoTimestamp,
} = require("../lib/repo-rollup-autonomy-approval-receipt-validation");

const PACKET_ID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVIEWED_AT = "2026-07-02T00:00:00.000Z";

function readyPlan(overrides = {}) {
  return {
    kind: "controlled_autonomy_dry_run_plan",
    source: "proposal_review_export_safety_gate",
    selected_action_type: "review_approved_manual_work_packet",
    verdict: "ready_for_human_approval",
    dry_run: true,
    mutates: false,
    executes_child_commands: false,
    writes_parent_files: false,
    writes_child_files: false,
    creates_tasks: false,
    creates_queues: false,
    applies_patches: false,
    refreshes_readiness: false,
    required_human_approval: true,
    packet_id: PACKET_ID,
    selected_repo: "child-app",
    selected_candidate_id: "ACTION_REVIEW_FAILED_READINESS",
    blockers: [],
    planned_steps: [],
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    packet_id: PACKET_ID,
    decision_id: "approve_for_manual_work",
    reviewer: "Runtime Reviewer",
    reviewed_at: REVIEWED_AT,
    reason: "Manual work packet reviewed and approved for manual work.",
    ...overrides,
  };
}

function checkIds(validation) {
  return validation.checks.map((item) => item.id);
}

function assertNonMutating(validation) {
  assert.equal(validation.mutates, false);
  assert.equal(validation.records_decision, false);
  assert.equal(validation.records_approval, false);
  assert.equal(validation.executes_child_commands, false);
  assert.equal(validation.writes_parent_files, false);
  assert.equal(validation.writes_child_files, false);
  assert.equal(validation.creates_tasks, false);
  assert.equal(validation.creates_queues, false);
  assert.equal(validation.applies_patches, false);
  assert.equal(validation.refreshes_readiness, false);
}

function assertInvalid(overrides, expectedCheckId) {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan(),
    autonomyApprovalReceipt: receipt(overrides),
  });
  assert.equal(validation.verdict, "invalid");
  assert.equal(validation.ok, false);
  assert.ok(checkIds(validation).includes(expectedCheckId));
  assertNonMutating(validation);
  return validation;
}

test("parseIsoTimestamp requires strict ISO-shaped timestamp", () => {
  assert.equal(parseIsoTimestamp(REVIEWED_AT), Date.parse(REVIEWED_AT));
  assert.equal(parseIsoTimestamp(" 2026-07-02T00:00:00.000Z"), null);
  assert.equal(parseIsoTimestamp("2026-07-02"), null);
  assert.equal(parseIsoTimestamp("not a timestamp"), null);
});

test("approval receipt validation is not_needed when autonomy plan is not needed", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan({ verdict: "not_needed", selected_action_type: null }),
    autonomyApprovalReceipt: receipt(),
  });
  assert.equal(validation.kind, "controlled_autonomy_approval_receipt_validation");
  assert.equal(validation.source, "autonomy_plan");
  assert.equal(validation.verdict, "not_needed");
  assert.equal(validation.ok, true);
  assert.equal(validation.packet_id, PACKET_ID);
  assert.equal(validation.selected_action_type, null);
  assert.equal(validation.receipt, null);
  assert.equal(validation.checks[0].id, "AUTONOMY_APPROVAL_NOT_NEEDED_001");
  assertNonMutating(validation);
});

test("approval receipt validation blocks when autonomy plan is missing", () => {
  const validation = buildAutonomyApprovalReceiptValidation({});
  assert.equal(validation.verdict, "blocked");
  assert.equal(validation.ok, false);
  assert.equal(validation.packet_id, null);
  assert.equal(validation.selected_action_type, null);
  assert.equal(validation.receipt, null);
  assert.equal(validation.checks[0].id, "AUTONOMY_APPROVAL_PLAN_READY_001");
  assertNonMutating(validation);
});

test("approval receipt validation blocks when autonomy plan is not ready", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan({ verdict: "blocked", selected_action_type: null }),
    autonomyApprovalReceipt: receipt(),
  });
  assert.equal(validation.verdict, "blocked");
  assert.equal(validation.ok, false);
  assert.equal(validation.receipt.packet_id, PACKET_ID);
  assert.equal(validation.checks[0].id, "AUTONOMY_APPROVAL_PLAN_READY_001");
  assertNonMutating(validation);
});

test("approval receipt validation is missing when plan is ready but no receipt is supplied", () => {
  const validation = buildAutonomyApprovalReceiptValidation({ autonomyPlan: readyPlan() });
  assert.equal(validation.verdict, "missing");
  assert.equal(validation.ok, false);
  assert.equal(validation.packet_id, PACKET_ID);
  assert.equal(validation.selected_action_type, "review_approved_manual_work_packet");
  assert.equal(validation.receipt, null);
  assert.deepEqual(validation.checks.map((item) => item.status), ["pass", "fail"]);
  assertNonMutating(validation);
});

test("approval receipt validation rejects packet_id mismatch", () => {
  const validation = assertInvalid({ packet_id: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, "AUTONOMY_APPROVAL_RECEIPT_PACKET_001");
  assert.equal(validation.packet_id, PACKET_ID);
  assert.equal(validation.receipt.packet_id, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("approval receipt validation rejects missing receipt packet_id", () => {
  const validation = assertInvalid({ packet_id: undefined }, "AUTONOMY_APPROVAL_RECEIPT_PACKET_001");
  assert.equal(validation.packet_id, PACKET_ID);
  assert.equal(validation.receipt.packet_id, null);
});

test("approval receipt validation rejects wrong decision_id", () => {
  assertInvalid({ decision_id: "reject" }, "AUTONOMY_APPROVAL_RECEIPT_DECISION_001");
});

test("approval receipt validation rejects missing reviewer", () => {
  assertInvalid({ reviewer: "" }, "AUTONOMY_APPROVAL_RECEIPT_REVIEWER_001");
});

test("approval receipt validation rejects invalid reviewed_at", () => {
  assertInvalid({ reviewed_at: "2026-07-02" }, "AUTONOMY_APPROVAL_RECEIPT_REVIEWED_AT_001");
});

test("approval receipt validation rejects missing reason", () => {
  assertInvalid({ reason: "" }, "AUTONOMY_APPROVAL_RECEIPT_REASON_001");
});

test("approval receipt validation rejects unsafe mutation fields", () => {
  assertInvalid({ writes_parent_files: true }, "AUTONOMY_APPROVAL_RECEIPT_NO_MUTATION_001");
  assertInvalid({ records_decision: true }, "AUTONOMY_APPROVAL_RECEIPT_NO_MUTATION_001");
  assertInvalid({ refreshes_readiness: true }, "AUTONOMY_APPROVAL_RECEIPT_NO_MUTATION_001");
});

test("approval receipt validation rejects present non-false safety fields", () => {
  assertInvalid({ creates_tasks: null }, "AUTONOMY_APPROVAL_RECEIPT_NO_MUTATION_001");
});

test("approval receipt validation rejects forbidden output and patch fields", () => {
  assertInvalid({ export_path: ".meta-harness/approval.json" }, "AUTONOMY_APPROVAL_RECEIPT_NO_OUTPUT_001");
  assertInvalid({ patch_proposals: [] }, "AUTONOMY_APPROVAL_RECEIPT_NO_PATCH_001");
});

test("minimal approval receipt passes when safety fields are absent", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan(),
    autonomyApprovalReceipt: receipt(),
  });
  assert.equal(validation.verdict, "approved_for_manual_work");
  assert.equal(validation.ok, true);
  assert.equal(validation.packet_id, PACKET_ID);
  assert.equal(validation.selected_action_type, "review_approved_manual_work_packet");
  assert.deepEqual(validation.receipt, {
    packet_id: PACKET_ID,
    decision_id: "approve_for_manual_work",
    reviewer: "Runtime Reviewer",
    reviewed_at: REVIEWED_AT,
    reason: "Manual work packet reviewed and approved for manual work.",
  });
  assert.equal(validation.checks.every((item) => item.status === "pass"), true);
  assertNonMutating(validation);
});

test("approval receipt validation passes when explicit safety fields are false", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan(),
    autonomyApprovalReceipt: receipt({
      mutates: false,
      records_decision: false,
      records_approval: false,
      executes_child_commands: false,
      writes_parent_files: false,
      writes_child_files: false,
      creates_tasks: false,
      creates_queues: false,
      applies_patches: false,
      refreshes_readiness: false,
    }),
  });
  assert.equal(validation.verdict, "approved_for_manual_work");
  assert.equal(validation.ok, true);
});

test("approval receipt validation can derive plan and receipt from rollup object", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    rollup: {
      autonomy_plan: readyPlan(),
      autonomy_approval_receipt: receipt(),
    },
  });
  assert.equal(validation.verdict, "approved_for_manual_work");
  assert.equal(validation.ok, true);
});

test("approval receipt validation markdown renders deterministic section", () => {
  const validation = buildAutonomyApprovalReceiptValidation({
    autonomyPlan: readyPlan(),
    autonomyApprovalReceipt: receipt(),
  });
  const markdown = renderAutonomyApprovalReceiptValidationMarkdown(validation).join("\n");
  assert.match(markdown, /## Controlled Autonomy Approval Receipt Validation/);
  assert.match(markdown, /- verdict: approved_for_manual_work/);
  assert.match(markdown, /- ok: true/);
  assert.match(markdown, /- packet_id: sha256:aaaaaaaa/);
  assert.match(markdown, /- selected_action_type: review_approved_manual_work_packet/);
  assert.match(markdown, /- records_decision: false/);
  assert.match(markdown, /- receipt:\n  - packet_id: sha256:aaaaaaaa/);
  assert.match(markdown, /AUTONOMY_APPROVAL_RECEIPT_PACKET_001 pass/);
});

test("approval receipt validation markdown handles missing validation as blocked", () => {
  const markdown = renderAutonomyApprovalReceiptValidationMarkdown(null).join("\n");
  assert.match(markdown, /## Controlled Autonomy Approval Receipt Validation/);
  assert.match(markdown, /- verdict: blocked/);
  assert.match(markdown, /- ok: false/);
  assert.match(markdown, /AUTONOMY_APPROVAL_VALIDATION_001 fail/);
});
