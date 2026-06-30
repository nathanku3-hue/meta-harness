"use strict";

const VALIDATION_KIND = "read_only_proposal_validation";
const DRAFT_KIND = "read_only_proposal_draft";
const DRAFT_SOURCE = "next_action_brief";
const PROPOSAL_TYPE = "review_brief";
const FORBIDDEN_FILE_OUTPUT_FIELDS = Object.freeze([
  "proposal_files",
  "proposal_file",
  "proposal_path",
  "proposal_output",
  "action_files",
  "action_file",
  "action_path",
  "action_output",
  "queue_files",
  "queue_file",
  "queue_path",
  "queue_output",
]);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function check(id, passed, passReason, failReason) {
  return {
    id,
    status: passed ? "pass" : "fail",
    reason: passed ? passReason : failReason,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return true;
}

function targetPathsAreRelative(draft) {
  if (!draft || !Array.isArray(draft.target_paths)) return false;
  return draft.target_paths.every(isNonEmptyRelativePath);
}

function selectedCandidateMatches(draft, brief) {
  if (!draft || !brief) return false;
  const noOp = brief.selected_candidate_id === null
    && draft.selected_candidate_id === null
    && draft.selected_repo === null;
  if (noOp) return true;
  return draft.selected_candidate_id === brief.selected_candidate_id
    && draft.selected_repo === brief.selected_repo
    && typeof draft.selected_candidate_id === "string"
    && draft.selected_candidate_id.length > 0
    && typeof draft.selected_repo === "string"
    && draft.selected_repo.length > 0;
}

function bodyHasReadOnlyBoundary(draft) {
  if (!draft || typeof draft.body !== "string") return false;
  const body = draft.body.toLowerCase();
  return body.includes("read-only")
    && body.includes("do not write files")
    && body.includes("execute child commands")
    && body.includes("refresh readiness")
    && body.includes("mutate parent/child repo truth");
}

function containersForForbiddenFieldScan(rollup, draft) {
  return [
    rollup,
    rollup && rollup.summary,
    draft,
    ...asArray(rollup && rollup.repos),
  ].filter(isPlainObject);
}

function hasForbiddenField(containers, fields) {
  return containers.some((container) => fields.some((field) => hasOwn(container, field)));
}

function buildProposalValidation({ proposalDraft, nextActionBrief, rollup } = {}) {
  const draft = proposalDraft || (rollup && rollup.proposal_draft) || null;
  const brief = nextActionBrief || (rollup && rollup.next_action_brief) || null;
  const containers = containersForForbiddenFieldScan(rollup || {}, draft);
  const patchProposalsField = "patch_" + "proposals";
  const checks = [
    check(
      "PROPOSAL_KIND_001",
      draft && draft.kind === DRAFT_KIND,
      "proposal_draft kind is read_only_proposal_draft",
      "proposal_draft kind must be read_only_proposal_draft",
    ),
    check(
      "PROPOSAL_SOURCE_001",
      draft && draft.source === DRAFT_SOURCE,
      "proposal_draft source is next_action_brief",
      "proposal_draft source must be next_action_brief",
    ),
    check(
      "PROPOSAL_TYPE_001",
      draft && draft.proposal_type === PROPOSAL_TYPE,
      "proposal_draft proposal_type is review_brief",
      "proposal_draft proposal_type must be review_brief",
    ),
    check(
      "PROPOSAL_DIFF_001",
      draft && draft.diff === null,
      "proposal_draft diff is null",
      "proposal_draft diff must be null",
    ),
    check(
      "PROPOSAL_MUTATES_001",
      draft && draft.mutates === false,
      "proposal_draft mutates is false",
      "proposal_draft mutates must be false",
    ),
    check(
      "PROPOSAL_TARGETS_001",
      targetPathsAreRelative(draft),
      "all target_paths are relative strings",
      "target_paths must be an array of non-empty relative strings",
    ),
    check(
      "PROPOSAL_SELECTED_001",
      selectedCandidateMatches(draft, brief),
      "selected candidate matches next_action_brief",
      "selected candidate must match next_action_brief",
    ),
    check(
      "PROPOSAL_BODY_001",
      bodyHasReadOnlyBoundary(draft),
      "proposal_draft body contains read-only boundary language",
      "proposal_draft body must contain read-only boundary language",
    ),
    check(
      "PROPOSAL_NO_PATCH_001",
      !hasForbiddenField(containers, [patchProposalsField]),
      "legacy patch proposal field is absent at top level, summary, or repo level",
      "legacy patch proposal field is forbidden at top level, summary, or repo level",
    ),
    check(
      "PROPOSAL_NO_FILE_OUTPUT_001",
      !hasForbiddenField(containers, FORBIDDEN_FILE_OUTPUT_FIELDS),
      "no proposal/action/queue file output fields exist",
      "proposal/action/queue file output fields are forbidden",
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

function validateProposalDraft(rollupLike) {
  return buildProposalValidation({
    rollup: rollupLike,
    proposalDraft: rollupLike && rollupLike.proposal_draft,
    nextActionBrief: rollupLike && rollupLike.next_action_brief,
  });
}

function renderProposalValidationMarkdown(validation) {
  const lines = ["", "## Proposal Validation", ""];
  if (!validation) return [...lines, "- verdict: fail", "- ok: false", "- mutates: false", "- PROPOSAL_VALIDATION_001 fail — proposal_validation is missing"];
  lines.push(
    `- verdict: ${validation.verdict}`,
    `- ok: ${validation.ok === true ? "true" : "false"}`,
    `- mutates: ${validation.mutates === false ? "false" : String(validation.mutates)}`,
  );
  for (const item of validation.checks || []) lines.push(`- ${item.id} ${item.status} — ${item.reason}`);
  return lines;
}

module.exports = { buildProposalValidation, renderProposalValidationMarkdown, validateProposalDraft };
