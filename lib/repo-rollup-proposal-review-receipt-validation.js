"use strict";

const VALIDATION_KIND = "read_only_proposal_review_receipt_validation";
const RECEIPT_TEMPLATE_KIND = "read_only_proposal_review_receipt_template";
const RECEIPT_TEMPLATE_SOURCE = "proposal_review_options";
const REQUIRED_FIELDS = Object.freeze([
  "packet_id",
  "decision_id",
  "reviewer",
  "reviewed_at",
  "reason",
]);
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

function normalizePacketId(options) {
  return options && typeof options.packet_id === "string" && options.packet_id.length > 0 ? options.packet_id : null;
}

function normalizeVerdict(options) {
  return options && typeof options.verdict === "string" && options.verdict.length > 0 ? options.verdict : "unknown";
}

function allowedDecisionIds(options) {
  if (!options || !Array.isArray(options.allowed_decisions)) return [];
  return options.allowed_decisions
    .map((decision) => (decision && typeof decision.id === "string" ? decision.id : null))
    .filter(Boolean);
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function scannedContainers(rollup, proposalReviewOptions, proposalReviewReceiptTemplate) {
  const containers = [];
  if (isPlainObject(rollup)) containers.push(rollup);
  if (isPlainObject(rollup && rollup.summary)) containers.push(rollup.summary);
  for (const repo of asArray(rollup && rollup.repos)) {
    if (isPlainObject(repo)) containers.push(repo);
  }
  if (isPlainObject(proposalReviewOptions)) containers.push(proposalReviewOptions);
  if (isPlainObject(proposalReviewReceiptTemplate)) containers.push(proposalReviewReceiptTemplate);
  return containers;
}

function hasForbiddenField(containers, fields) {
  return containers.some((container) => fields.some((field) => hasOwn(container, field)));
}

function templateFieldsAreNull(receiptTemplate) {
  const template = receiptTemplate && receiptTemplate.template;
  return template && template.decision_id === null
    && template.reviewer === null
    && template.reviewed_at === null
    && template.reason === null;
}

function packetIdMatches(receiptTemplate, expectedPacketId) {
  if (!receiptTemplate || receiptTemplate.packet_id !== expectedPacketId) return false;
  const template = receiptTemplate.template;
  return template && template.packet_id === expectedPacketId;
}

function buildProposalReviewReceiptValidation({ proposalReviewOptions, proposalReviewReceiptTemplate, rollup } = {}) {
  const receiptTemplate = proposalReviewReceiptTemplate || (rollup && rollup.proposal_review_receipt_template) || null;
  const options = proposalReviewOptions || (rollup && rollup.proposal_review_options) || null;
  const expectedPacketId = normalizePacketId(options);
  const expectedVerdict = normalizeVerdict(options);
  const expectedAllowedIds = allowedDecisionIds(options);
  const containers = scannedContainers(rollup || {}, options, receiptTemplate);
  const patchProposalsField = "patch_" + "proposals";
  const checks = [
    check(
      "RECEIPT_TEMPLATE_KIND_001",
      receiptTemplate && receiptTemplate.kind === RECEIPT_TEMPLATE_KIND,
      "receipt template kind is read_only_proposal_review_receipt_template",
      "receipt template kind must be read_only_proposal_review_receipt_template",
    ),
    check(
      "RECEIPT_TEMPLATE_SOURCE_001",
      receiptTemplate && receiptTemplate.source === RECEIPT_TEMPLATE_SOURCE,
      "receipt template source is proposal_review_options",
      "receipt template source must be proposal_review_options",
    ),
    check(
      "RECEIPT_TEMPLATE_PACKET_001",
      packetIdMatches(receiptTemplate, expectedPacketId),
      "receipt template packet_id matches proposal_review_options packet_id",
      "receipt template packet_id must match proposal_review_options packet_id",
    ),
    check(
      "RECEIPT_TEMPLATE_VERDICT_001",
      receiptTemplate && receiptTemplate.verdict === expectedVerdict,
      "receipt template verdict matches proposal_review_options verdict",
      "receipt template verdict must match proposal_review_options verdict",
    ),
    check(
      "RECEIPT_TEMPLATE_ALLOWED_001",
      receiptTemplate && arraysEqual(receiptTemplate.allowed_decision_ids, expectedAllowedIds),
      "receipt template allowed_decision_ids match proposal_review_options allowed_decisions",
      "receipt template allowed_decision_ids must match proposal_review_options allowed_decisions",
    ),
    check(
      "RECEIPT_TEMPLATE_REQUIRED_FIELDS_001",
      receiptTemplate && arraysEqual(receiptTemplate.required_fields, REQUIRED_FIELDS),
      "receipt template required_fields are packet_id, decision_id, reviewer, reviewed_at, reason",
      "receipt template required_fields must exactly be packet_id, decision_id, reviewer, reviewed_at, reason",
    ),
    check(
      "RECEIPT_TEMPLATE_NULLS_001",
      templateFieldsAreNull(receiptTemplate),
      "receipt template decision fields are null",
      "receipt template decision_id, reviewer, reviewed_at, and reason must be null",
    ),
    check(
      "RECEIPT_TEMPLATE_RECORDS_001",
      receiptTemplate && receiptTemplate.records_decision === false,
      "receipt template records_decision is false",
      "receipt template records_decision must be false",
    ),
    check(
      "RECEIPT_TEMPLATE_MUTATES_001",
      receiptTemplate && receiptTemplate.mutates === false,
      "receipt template mutates is false",
      "receipt template mutates must be false",
    ),
    check(
      "RECEIPT_TEMPLATE_NO_OUTPUT_001",
      !hasForbiddenField(containers, FORBIDDEN_FILE_OUTPUT_FIELDS),
      "no export/proposal/queue/action file output fields exist",
      "export/proposal/queue/action file output fields are forbidden",
    ),
    check(
      "RECEIPT_TEMPLATE_NO_PATCH_001",
      !hasForbiddenField(containers, [patchProposalsField]),
      "legacy patch proposal field is absent",
      "legacy patch proposal field is forbidden",
    ),
  ];
  const ok = checks.every((item) => item.status === "pass");
  return {
    kind: VALIDATION_KIND,
    ok,
    verdict: ok ? "pass" : "fail",
    checks,
    mutates: false,
  };
}

function renderProposalReviewReceiptValidationMarkdown(validation) {
  const lines = ["", "## Proposal Review Receipt Validation", ""];
  if (!validation) return [...lines, "- verdict: fail", "- ok: false", "- mutates: false", "- RECEIPT_TEMPLATE_VALIDATION_001 fail — proposal_review_receipt_validation is missing"];
  lines.push(
    `- verdict: ${validation.verdict}`,
    `- ok: ${validation.ok === true ? "true" : "false"}`,
    `- mutates: ${validation.mutates === false ? "false" : String(validation.mutates)}`,
  );
  for (const item of validation.checks || []) lines.push(`- ${item.id} ${item.status} — ${item.reason}`);
  return lines;
}

module.exports = {
  buildProposalReviewReceiptValidation,
  renderProposalReviewReceiptValidationMarkdown,
};
