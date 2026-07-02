"use strict";

const VALIDATION_KIND = "read_only_proposal_review_copy_block_validation";
const COPY_BLOCK_KIND = "read_only_proposal_review_copy_block";
const COPY_BLOCK_SOURCE = "proposal_review_receipt_validation";
const EXPECTED_INCLUDES = Object.freeze([
  "proposal_review_packet",
  "proposal_review_options",
  "proposal_review_receipt_template",
  "proposal_review_receipt_validation",
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

const FORBIDDEN_LANGUAGE = Object.freeze([
  /approved/i,
  /approval recorded/i,
  /decision recorded/i,
  /reviewed by/i,
  /accepted by/i,
  /rejected by/i,
]);

const FORBIDDEN_DIFF_PATTERNS = Object.freeze([
  /diff --git/i,
  /^--- /m,
  /^\+\+\+ /m,
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

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function scannedContainers(rollup, proposalReviewOptions, proposalReviewReceiptTemplate, proposalReviewCopyBlock) {
  const containers = [];
  if (isPlainObject(rollup)) containers.push(rollup);
  if (isPlainObject(rollup && rollup.summary)) containers.push(rollup.summary);
  for (const repo of asArray(rollup && rollup.repos)) {
    if (isPlainObject(repo)) containers.push(repo);
  }
  if (isPlainObject(proposalReviewOptions)) containers.push(proposalReviewOptions);
  if (isPlainObject(proposalReviewReceiptTemplate)) containers.push(proposalReviewReceiptTemplate);
  if (isPlainObject(proposalReviewCopyBlock)) containers.push(proposalReviewCopyBlock);
  return containers;
}

function hasForbiddenField(containers, fields) {
  return containers.some((container) => fields.some((field) => hasOwn(container, field)));
}

function buildProposalReviewCopyBlockValidation({
  proposalReviewPacket,
  proposalReviewOptions,
  proposalReviewReceiptTemplate,
  proposalReviewReceiptValidation,
  proposalReviewCopyBlock,
  rollup,
} = {}) {
  const packet = proposalReviewPacket || (rollup && rollup.proposal_review_packet) || null;
  const options = proposalReviewOptions || (rollup && rollup.proposal_review_options) || null;
  const receiptTemplate = proposalReviewReceiptTemplate || (rollup && rollup.proposal_review_receipt_template) || null;
  const receiptValidation = proposalReviewReceiptValidation || (rollup && rollup.proposal_review_receipt_validation) || (rollup && rollup["proposal_review_" + "receipt_validation"]) || null;
  const copyBlock = proposalReviewCopyBlock || (rollup && rollup.proposal_review_copy_block) || null;

  const expectedPacketId = normalizePacketId(options, packet, receiptTemplate);
  const isReceiptValidationPass = receiptValidation && receiptValidation.ok === true && receiptValidation.verdict === "pass";
  const expectedVerdict = isReceiptValidationPass ? "pass" : "fail";

  const containers = scannedContainers(rollup || {}, options, receiptTemplate, copyBlock);
  const patchProposalsField = "patch_" + "proposals";

  const checks = [];

  // Check 1: Copy Block Kind
  checks.push(
    check(
      "COPY_BLOCK_KIND_001",
      copyBlock && copyBlock.kind === COPY_BLOCK_KIND,
      "copy block kind is read_only_proposal_review_copy_block",
      "copy block kind must be read_only_proposal_review_copy_block"
    )
  );

  // Check 2: Copy Block Source
  checks.push(
    check(
      "COPY_BLOCK_SOURCE_001",
      copyBlock && copyBlock.source === COPY_BLOCK_SOURCE,
      "copy block source is proposal_review_receipt_validation",
      "copy block source must be proposal_review_receipt_validation"
    )
  );

  // Check 3: Packet ID matches across all
  const packetIdsMatch = copyBlock &&
    copyBlock.packet_id === expectedPacketId &&
    (!packet || packet.packet_id === expectedPacketId) &&
    (!options || options.packet_id === expectedPacketId) &&
    (!receiptTemplate || receiptTemplate.packet_id === expectedPacketId);

  checks.push(
    check(
      "COPY_BLOCK_PACKET_ID_001",
      !!packetIdsMatch,
      "copy block packet_id matches packet/options/receipt template packet_id",
      "copy block packet_id must match packet/options/receipt template packet_id"
    )
  );

  // Check 4: Validation Verdict matches receipt validation
  checks.push(
    check(
      "COPY_BLOCK_VERDICT_001",
      copyBlock && copyBlock.validation_verdict === expectedVerdict,
      "copy block validation_verdict matches expected receipt validation state",
      "copy block validation_verdict must match expected receipt validation state"
    )
  );

  // Check 5: Includes list is exact
  checks.push(
    check(
      "COPY_BLOCK_INCLUDES_001",
      copyBlock && arraysEqual(copyBlock.includes, EXPECTED_INCLUDES),
      "copy block includes matches expected includes",
      "copy block includes must exactly match expected includes"
    )
  );

  // Check 6: Read-only safety fields
  const isReadOnly = copyBlock &&
    copyBlock.export_target === null &&
    copyBlock.writes_files === false &&
    copyBlock.records_decision === false &&
    copyBlock.records_approval === false &&
    copyBlock.mutates === false;

  checks.push(
    check(
      "COPY_BLOCK_READ_ONLY_001",
      !!isReadOnly,
      "copy block is read-only and does not mutate or write files",
      "copy block must be read-only (export_target: null, writes_files: false, records_decision: false, records_approval: false, mutates: false)"
    )
  );

  // Check 7: copy_text existence vs verdict
  let textStatePassed = false;
  if (copyBlock) {
    if (expectedVerdict === "pass") {
      textStatePassed = typeof copyBlock.copy_text === "string" && copyBlock.copy_text.length > 0;
    } else {
      textStatePassed = copyBlock.copy_text === null;
    }
  }

  checks.push(
    check(
      "COPY_BLOCK_TEXT_STATE_001",
      textStatePassed,
      "copy block copy_text state is consistent with validation verdict",
      "copy block copy_text must be non-empty string when pass, and null when fail"
    )
  );

  // Check 8: Forbidden language and diff check
  let languageSafetyPassed = true;
  let safetyReason = "copy block copy_text contains no forbidden language or diffs";
  let safetyFailReason = "copy block copy_text is not a string or has not been checked";

  if (copyBlock && typeof copyBlock.copy_text === "string") {
    // Check forbidden words
    const failedWord = FORBIDDEN_LANGUAGE.find((regex) => regex.test(copyBlock.copy_text));
    if (failedWord) {
      languageSafetyPassed = false;
      safetyFailReason = `copy block copy_text contains forbidden language matching: ${failedWord}`;
    } else {
      // Check forbidden diff patterns
      const failedDiff = FORBIDDEN_DIFF_PATTERNS.find((regex) => regex.test(copyBlock.copy_text));
      if (failedDiff) {
        languageSafetyPassed = false;
        safetyFailReason = `copy block copy_text contains forbidden diff/patch patterns matching: ${failedDiff}`;
      }
    }
  } else if (copyBlock && copyBlock.copy_text === null) {
    // If it's null (blocked state), it's safe
    languageSafetyPassed = true;
    safetyReason = "copy block copy_text is null (blocked state)";
  } else {
    languageSafetyPassed = false;
  }

  checks.push(
    check(
      "COPY_BLOCK_TEXT_SAFETY_001",
      languageSafetyPassed,
      safetyReason,
      safetyFailReason
    )
  );

  // Check 9: no forbidden output fields
  checks.push(
    check(
      "COPY_BLOCK_NO_OUTPUT_001",
      !hasForbiddenField(containers, FORBIDDEN_FILE_OUTPUT_FIELDS),
      "no export/proposal/queue/action file output fields exist",
      "export/proposal/queue/action file output fields are forbidden"
    )
  );

  // Check 10: no legacy patch proposals
  checks.push(
    check(
      "COPY_BLOCK_NO_PATCH_001",
      !hasForbiddenField(containers, [patchProposalsField]),
      "legacy patch proposal field is absent",
      "legacy patch proposal field is forbidden"
    )
  );

  const ok = checks.every((item) => item.status === "pass");
  return {
    kind: VALIDATION_KIND,
    ok,
    verdict: ok ? "pass" : "fail",
    checks,
    mutates: false,
  };
}

function renderProposalReviewCopyBlockValidationMarkdown(validation) {
  const lines = ["", "## Proposal Review Copy Block Validation", ""];
  if (!validation) {
    return [
      ...lines,
      "- verdict: fail",
      "- ok: false",
      "- mutates: false",
      "- COPY_BLOCK_VALIDATION_001 fail — proposal_review_copy_block_validation is missing",
    ];
  }
  lines.push(
    `- verdict: ${validation.verdict}`,
    `- ok: ${validation.ok === true ? "true" : "false"}`,
    `- mutates: ${validation.mutates === false ? "false" : String(validation.mutates)}`
  );
  for (const item of validation.checks || []) {
    lines.push(`- ${item.id} ${item.status} — ${item.reason}`);
  }
  return lines;
}

module.exports = {
  buildProposalReviewCopyBlockValidation,
  renderProposalReviewCopyBlockValidationMarkdown,
};
