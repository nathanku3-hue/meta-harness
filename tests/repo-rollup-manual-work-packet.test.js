"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildManualWorkPacket } = require("../lib/repo-rollup-manual-work-packet");

const PACKET_ID = "sha256:manual-work-packet";
const SELECTED_CANDIDATE_ID = "ACTION_REVIEW_FAILED_READINESS";

function nextActionBrief(overrides = {}) {
  return {
    kind: "read_only_worker_brief",
    selected_candidate_id: SELECTED_CANDIDATE_ID,
    selected_repo: "child-app",
    priority: "high",
    reason: "review failed child readiness evidence",
    source_state: "failed",
    source_warning_ids: [],
    source_check_ids: ["MH_SYNC_001"],
    target_paths: [".meta-harness/ready.json"],
    body: "Untrusted body text must not be parsed for packet fields.",
    mutates: false,
    ...overrides,
  };
}

function proposalReviewPacket(overrides = {}) {
  return {
    kind: "read_only_proposal_review_packet",
    packet_id: PACKET_ID,
    verdict: "ready_for_review",
    selected_candidate_id: SELECTED_CANDIDATE_ID,
    selected_repo: "child-app",
    sections: [],
    mutates: false,
    ...overrides,
  };
}

function autonomyPlan(overrides = {}) {
  return {
    kind: "controlled_autonomy_dry_run_plan",
    source: "proposal_review_export_safety_gate",
    selected_action_type: "review_approved_manual_work_packet",
    verdict: "ready_for_human_approval",
    mutates: false,
    dry_run: true,
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
    selected_candidate_id: SELECTED_CANDIDATE_ID,
    blockers: [],
    planned_steps: [],
    ...overrides,
  };
}

function approvalValidation(overrides = {}) {
  return {
    kind: "controlled_autonomy_approval_receipt_validation",
    source: "autonomy_plan",
    verdict: "approved_for_manual_work",
    ok: true,
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
    packet_id: PACKET_ID,
    selected_action_type: "review_approved_manual_work_packet",
    receipt: {
      packet_id: PACKET_ID,
      decision_id: "approve_for_manual_work",
      reviewer: "Runtime Reviewer",
      reviewed_at: "2026-07-02T00:00:00.000Z",
      reason: "Manual work packet reviewed and approved.",
    },
    checks: [],
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildManualWorkPacket({
    nextActionBrief: nextActionBrief(overrides.nextActionBrief),
    proposalReviewPacket: proposalReviewPacket(overrides.proposalReviewPacket),
    autonomyPlan: overrides.autonomyPlan === null ? null : autonomyPlan(overrides.autonomyPlan),
    autonomyApprovalReceiptValidation: overrides.autonomyApprovalReceiptValidation === null
      ? null
      : approvalValidation(overrides.autonomyApprovalReceiptValidation),
  });
}

function assertNonMutating(packet) {
  for (const field of [
    "mutates",
    "writes_files",
    "writes_parent_files",
    "writes_child_files",
    "executes_child_commands",
    "creates_tasks",
    "creates_queues",
    "applies_patches",
    "refreshes_readiness",
    "records_decision",
    "records_approval",
  ]) {
    assert.equal(packet[field], false, field);
  }
}

test("manual work packet is explicit not_needed when autonomy plan is not needed", () => {
  const packet = build({
    autonomyPlan: { verdict: "not_needed", selected_action_type: null, packet_id: null, selected_repo: null, selected_candidate_id: null },
    autonomyApprovalReceiptValidation: { verdict: "not_needed", ok: true, packet_id: null, selected_action_type: null, receipt: null },
    nextActionBrief: { selected_candidate_id: null, selected_repo: null, target_paths: [], source_check_ids: [] },
    proposalReviewPacket: { verdict: "not_needed", packet_id: PACKET_ID, selected_candidate_id: null, selected_repo: null },
  });

  assert.equal(packet.verdict, "not_needed");
  assert.deepEqual(packet.instructions, []);
  assertNonMutating(packet);
});

test("manual work packet is missing_approval when plan is ready but receipt is absent", () => {
  const packet = build({
    autonomyApprovalReceiptValidation: { verdict: "missing", ok: false, receipt: null },
  });

  assert.equal(packet.verdict, "missing_approval");
  assert.equal(packet.selected_candidate_id, SELECTED_CANDIDATE_ID);
  assert.deepEqual(packet.instructions, []);
  assertNonMutating(packet);
});

test("manual work packet is blocked when autonomy plan is blocked", () => {
  const packet = build({
    autonomyPlan: { verdict: "blocked", selected_action_type: null, blockers: [{ id: "AUTONOMY_PACKET_READY_001" }] },
    autonomyApprovalReceiptValidation: { verdict: "blocked", ok: false, receipt: null },
  });

  assert.equal(packet.verdict, "blocked");
  assert.deepEqual(packet.instructions, []);
  assertNonMutating(packet);
});

test("manual work packet is invalid when supplied approval receipt fails validation", () => {
  const packet = build({
    autonomyApprovalReceiptValidation: { verdict: "invalid", ok: false },
  });

  assert.equal(packet.verdict, "invalid");
  assert.equal(packet.reviewer, "Runtime Reviewer");
  assert.deepEqual(packet.instructions, []);
  assertNonMutating(packet);
});

test("valid approval receipt unlocks deterministic stdout-only manual work packet", () => {
  const packet = build({
    nextActionBrief: {
      target_paths: [".meta-harness/ready.json", ".meta-harness/status.md"],
      source_check_ids: ["MH_SYNC_001"],
      source_warning_ids: ["DRIFT_TEMPLATE_MANIFEST_MISSING"],
      body: "target_paths: should-not-be-parsed.md",
    },
  });

  assert.equal(packet.kind, "approved_manual_work_packet");
  assert.equal(packet.source, "autonomy_approval_receipt_validation");
  assert.equal(packet.verdict, "ready_for_manual_work");
  assert.equal(packet.packet_id, PACKET_ID);
  assert.equal(packet.selected_action_type, "review_approved_manual_work_packet");
  assert.equal(packet.selected_repo, "child-app");
  assert.equal(packet.selected_candidate_id, SELECTED_CANDIDATE_ID);
  assert.equal(packet.reviewer, "Runtime Reviewer");
  assert.equal(packet.reviewed_at, "2026-07-02T00:00:00.000Z");
  assert.equal(packet.approval_reason, "Manual work packet reviewed and approved.");
  assert.deepEqual(packet.target_paths, [".meta-harness/ready.json", ".meta-harness/status.md"]);
  assert.deepEqual(packet.source_check_ids, ["MH_SYNC_001"]);
  assert.deepEqual(packet.source_warning_ids, ["DRIFT_TEMPLATE_MANIFEST_MISSING"]);
  assert.equal(packet.instructions.length > 0, true);
  assert.equal(packet.target_paths.includes("should-not-be-parsed.md"), false);
  assertNonMutating(packet);
});

test("manual work packet exposes no proposal, export, queue, action, or patch output fields", () => {
  const packet = build();
  for (const field of [
    "proposal_files",
    "proposal_file",
    "proposal_path",
    "export_files",
    "export_file",
    "export_path",
    "queue_files",
    "queue_file",
    "queue_path",
    "action_files",
    "action_file",
    "action_path",
    "patch_proposals",
  ]) {
    assert.equal(Object.hasOwn(packet, field), false, field);
  }
});
