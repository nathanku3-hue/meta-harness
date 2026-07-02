"use strict";

const GATE_KIND = "read_only_proposal_review_export_safety_gate";
const INTENT_KIND = "read_only_proposal_review_export_intent";
const FORBIDDEN_FILE_OUTPUT_FIELDS = Object.freeze([
  "proposal_files",
  "proposal_file",
  "proposal_path",
  "proposal_output",
  "export_files",
  "export_file",
  "export_path",
  "export_output",
  "queue_files",
  "queue_file",
  "queue_path",
  "queue_output",
  "action_files",
  "action_file",
  "action_path",
  "action_output",
]);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function check(id, passed, passReason, failReason) {
  return {
    id,
    status: passed ? "pass" : "fail",
    reason: passed ? passReason : failReason,
  };
}

function normalizePacketId(...sources) {
  for (const source of sources) {
    if (source && typeof source.packet_id === "string" && source.packet_id.length > 0) return source.packet_id;
  }
  return null;
}

function scannedContainers(
  rollup,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewCopyBlock,
  proposalReviewCopyBlockValidation,
  proposalReviewExportIntent
) {
  const containers = [];
  if (isPlainObject(rollup)) containers.push(rollup);
  if (isPlainObject(rollup && rollup.summary)) containers.push(rollup.summary);
  for (const repo of asArray(rollup && rollup.repos)) {
    if (isPlainObject(repo)) containers.push(repo);
  }
  if (isPlainObject(proposalReviewOptions)) containers.push(proposalReviewOptions);
  if (isPlainObject(proposalReviewReceiptTemplate)) containers.push(proposalReviewReceiptTemplate);
  if (isPlainObject(proposalReviewCopyBlock)) containers.push(proposalReviewCopyBlock);
  if (isPlainObject(proposalReviewCopyBlockValidation)) containers.push(proposalReviewCopyBlockValidation);
  if (isPlainObject(proposalReviewExportIntent)) containers.push(proposalReviewExportIntent);
  return containers;
}

function hasForbiddenField(containers, fields) {
  return containers.some((container) => fields.some((field) => hasOwn(container, field)));
}

function buildProposalReviewExportSafetyGate({
  proposalReviewPacket,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewReceiptValidation,
  proposalReviewCopyBlock,
  proposalReviewCopyBlockValidation,
  proposalReviewExportIntent,
  rollup,
} = {}) {
  const intent = proposalReviewExportIntent || (rollup && rollup.proposal_review_export_intent) || null;
  const copyBlockValidation = proposalReviewCopyBlockValidation || (rollup && rollup.proposal_review_copy_block_validation) || null;

  const expectedPacketId = normalizePacketId(
    proposalReviewPacket,
    proposalReviewOptions,
    proposalReviewReceiptTemplate,
    proposalReviewCopyBlock,
    intent
  );

  const containers = scannedContainers(
    rollup || {},
    proposalReviewOptions || {},
    proposalReviewReceiptTemplate || {},
    proposalReviewCopyBlock || {},
    copyBlockValidation || {},
    intent || {}
  );
  const patchProposalsField = "patch_" + "proposals";

  const checks = [];

  // Check 1: Export Intent Kind
  checks.push(
    check(
      "EXPORT_INTENT_KIND_001",
      intent && intent.kind === INTENT_KIND,
      "export intent kind is read_only_proposal_review_export_intent",
      "export intent kind must be read_only_proposal_review_export_intent"
    )
  );

  // Check 2: Packet ID consistency
  const packetIdsMatch = intent &&
    intent.packet_id === expectedPacketId &&
    (!proposalReviewPacket || proposalReviewPacket.packet_id === expectedPacketId) &&
    (!proposalReviewCopyBlock || proposalReviewCopyBlock.packet_id === expectedPacketId);

  checks.push(
    check(
      "EXPORT_SAFETY_PACKET_ID_001",
      !!packetIdsMatch,
      "export safety packet_id matches expected packet_id across components",
      "export safety packet_id must match expected packet_id across components"
    )
  );

  // Check 3: Copy block validation passed
  const validationPassed = copyBlockValidation && copyBlockValidation.ok === true && copyBlockValidation.verdict === "pass";
  const expectedVerdict = validationPassed ? "pass" : "fail";

  checks.push(
    check(
      "EXPORT_SAFETY_COPY_BLOCK_VALIDATION_001",
      intent && intent.validation_verdict === expectedVerdict,
      "export safety copy block validation verdict is correct",
      "export safety copy block validation verdict must be correct"
    )
  );

  // Check 4: Safety constraints on the intent
  const intentIsSafe = intent &&
    intent.export_target === null &&
    intent.declared_intent === (validationPassed ? "none" : null) &&
    intent.writes_files === false &&
    intent.records_decision === false &&
    intent.mutates === false;

  checks.push(
    check(
      "EXPORT_SAFETY_INTENT_CONSTRAINTS_001",
      !!intentIsSafe,
      "export intent adheres to read-only constraints (export_target: null, declared_intent: none/null, writes_files: false, records_decision: false, mutates: false)",
      "export intent must adhere to read-only constraints"
    )
  );

  // Check 5: no forbidden output fields
  checks.push(
    check(
      "EXPORT_SAFETY_NO_OUTPUT_001",
      !hasForbiddenField(containers, FORBIDDEN_FILE_OUTPUT_FIELDS),
      "no export/proposal/queue/action file output fields exist",
      "export/proposal/queue/action file output fields are forbidden"
    )
  );

  // Check 6: no legacy patch proposals
  checks.push(
    check(
      "EXPORT_SAFETY_NO_PATCH_001",
      !hasForbiddenField(containers, [patchProposalsField]),
      "legacy patch proposal field is absent",
      "legacy patch proposal field is forbidden"
    )
  );

  const ok = checks.every((item) => item.status === "pass");
  return {
    kind: GATE_KIND,
    ok,
    verdict: ok ? "pass" : "fail",
    checks,
    mutates: false,
  };
}

function renderProposalReviewExportSafetyGateMarkdown(gate) {
  const lines = ["", "## Proposal Review Export Safety Gate", ""];
  if (!gate) {
    return [
      ...lines,
      "- verdict: fail",
      "- ok: false",
      "- mutates: false",
      "- EXPORT_SAFETY_GATE_001 fail — proposal_review_export_safety_gate is missing",
    ];
  }
  lines.push(
    `- verdict: ${gate.verdict}`,
    `- ok: ${gate.ok === true ? "true" : "false"}`,
    `- mutates: ${gate.mutates === false ? "false" : String(gate.mutates)}`
  );
  for (const item of gate.checks || []) {
    lines.push(`- ${item.id} ${item.status} — ${item.reason}`);
  }
  return lines;
}

module.exports = {
  buildProposalReviewExportSafetyGate,
  renderProposalReviewExportSafetyGateMarkdown,
};
