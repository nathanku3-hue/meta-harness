"use strict";

const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  isExactUtcTimestamp,
  freezeDeep,
  cloneStrict,
} = require("./canonical-json");
const { validateRunSpec, computeRunSpecDigest } = require("./run-spec");

const SCHEMA_VERSION = "run-spec-approval/v1";
const DOMAIN = "run-spec-approval/v1";

const BODY_KEYS = [
  "schemaVersion",
  "approvalId",
  "approvedBy",
  "approvedAt",
  "runSpec",
  "runSpecDigest",
];

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function approvalBody(approval) {
  const body = {};
  for (const k of BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(approval, k)) body[k] = approval[k];
  }
  return body;
}

function computeApprovalDigest(approval) {
  return domainDigest(DOMAIN, approvalBody(approval));
}

function sealRunSpecApproval(body) {
  const without = { ...body };
  delete without.approvalDigest;
  const approvalDigest = domainDigest(DOMAIN, without);
  return freezeDeep({ ...without, approvalDigest });
}

/**
 * Validate sealed RunSpecApproval: nested RunSpec revalidated, digests recomputed.
 * @param {object} approval
 * @param {{ maxCommandTimeoutSeconds?: number }} [options]
 */
function validateRunSpecApproval(approval, options = {}) {
  const reasons = [];
  if (!isOrdinaryPlainObject(approval)) {
    return {
      ok: false,
      reasons: [reason("APPROVAL_NOT_OBJECT", "runSpecApproval must be a plain object")],
    };
  }
  try {
    assertStrictJsonData(approval);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  if (!exactKeys(approval, [...BODY_KEYS, "approvalDigest"])) {
    return {
      ok: false,
      reasons: [reason(
        "APPROVAL_SHAPE",
        "runSpecApproval must be exactly { schemaVersion, approvalId, approvedBy, approvedAt, runSpec, runSpecDigest, approvalDigest }",
      )],
    };
  }

  if (approval.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${SCHEMA_VERSION}`));
  }
  if (!isNonEmptyString(approval.approvalId)) {
    reasons.push(reason("FIELD_REQUIRED", "approvalId is required"));
  }
  if (!isNonEmptyString(approval.approvedBy)) {
    reasons.push(reason("FIELD_REQUIRED", "approvedBy is required (audit metadata only)"));
  }
  if (!isExactUtcTimestamp(approval.approvedAt)) {
    reasons.push(reason("APPROVED_AT_INVALID", "approvedAt must be exact UTC timestamp"));
  }

  const specCheck = validateRunSpec(approval.runSpec, options);
  if (!specCheck.ok) {
    reasons.push(reason("RUN_SPEC_INVALID", "nested runSpec is invalid"));
    reasons.push(...specCheck.reasons);
  } else {
    const expectedSpecDigest = computeRunSpecDigest(approval.runSpec);
    if (approval.runSpecDigest !== expectedSpecDigest) {
      reasons.push(reason("RUN_SPEC_DIGEST_MISMATCH", "runSpecDigest does not match nested runSpec"));
    }
    if (!isDigest(approval.runSpecDigest)) {
      reasons.push(reason("RUN_SPEC_DIGEST_REQUIRED", "runSpecDigest must be sha256 digest"));
    }
  }

  if (!isDigest(approval.approvalDigest)) {
    reasons.push(reason("APPROVAL_DIGEST_REQUIRED", "approvalDigest is required"));
  } else if (approval.approvalDigest !== computeApprovalDigest(approval)) {
    reasons.push(reason("APPROVAL_DIGEST_MISMATCH", "approvalDigest does not match body"));
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  SCHEMA_VERSION,
  DOMAIN,
  validateRunSpecApproval,
  computeApprovalDigest,
  sealRunSpecApproval,
  freezeDeep,
  cloneStrict,
};
