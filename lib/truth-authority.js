"use strict";

const crypto = require("node:crypto");

const {
  canonicalize, exactKeys, isExactUtcTimestamp, isOrdinaryPlainObject,
} = require("./contracts/canonical-json");
const { domainDigest, isDigest } = require("./contracts/digest");
const {
  AUTHORITY_SCHEMA,
  PUBLIC_KEY_RELATIVE_PATH,
  hasTruthAuthority,
  installPublicAuthority,
  loadPublicAuthority,
  loadPublicKey,
  normalizePublicAuthority,
  signerKeyId,
  validatePublicAuthorityInstallation,
} = require("./truth-authority-contract");

const RECEIPT_SCHEMA = "meta-harness-truth-authority-receipt/v2";
const LEGACY_RECEIPT_SCHEMA = "meta-harness-truth-authority-receipt/v1";
const PROPOSAL_SCHEMA = "meta-harness-truth-proposal/v1";
const CAPABILITY = "canonical_truth_mutation";
const OPERATIONS = new Set(["snapshot", "reconcile"]);
const DEFAULT_TTL_SECONDS = 300;
const MAX_RECEIPT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
const PROPOSAL_KEYS = Object.freeze([
  "schema_version", "operation", "stream", "phase", "action", "result", "goal",
  "next_action", "stop_criteria", "evidence", "decision", "occurred_at", "rejected_event_digests",
]);
const LEGACY_RECEIPT_BODY_KEYS = Object.freeze([
  "schema_version", "receipt_id", "capability", "prior_snapshot_digest", "proposal",
  "proposal_digest", "signer_key_id", "issued_at", "expires_at",
]);
const RECEIPT_BODY_KEYS = Object.freeze([
  "schema_version", "receipt_id", "capability", "repository_id", "prior_snapshot_digest",
  "proposal", "proposal_digest", "signer_key_id", "issued_at", "expires_at",
]);
const LEGACY_RECEIPT_KEYS = Object.freeze([...LEGACY_RECEIPT_BODY_KEYS, "signature"]);
const RECEIPT_KEYS = Object.freeze([...RECEIPT_BODY_KEYS, "signature"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRejectedDigests(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item));
}

function validateTruthProposal(proposal) {
  const errors = [];
  if (!isOrdinaryPlainObject(proposal) || !exactKeys(proposal, PROPOSAL_KEYS)) {
    return [{ code: "TRUTH_PROPOSAL_SHAPE_INVALID", message: "truth proposal has unexpected or missing fields" }];
  }
  if (proposal.schema_version !== PROPOSAL_SCHEMA) {
    errors.push({ code: "TRUTH_PROPOSAL_SCHEMA_INVALID", message: `proposal schema_version must be ${PROPOSAL_SCHEMA}` });
  }
  if (!OPERATIONS.has(proposal.operation)) {
    errors.push({ code: "TRUTH_PROPOSAL_OPERATION_INVALID", message: "proposal operation must be snapshot or reconcile" });
  }
  for (const field of ["stream", "phase", "action", "result", "goal", "next_action", "stop_criteria"]) {
    if (!nonEmptyString(proposal[field])) {
      errors.push({ code: "TRUTH_PROPOSAL_FIELD_MISSING", field, message: `${field} must be a non-empty string` });
    }
  }
  for (const field of ["evidence", "decision"]) {
    if (proposal[field] !== null && !nonEmptyString(proposal[field])) {
      errors.push({ code: "TRUTH_PROPOSAL_OPTIONAL_FIELD_INVALID", field, message: `${field} must be null or a non-empty string` });
    }
  }
  if (!isExactUtcTimestamp(proposal.occurred_at)) {
    errors.push({ code: "TRUTH_PROPOSAL_TIMESTAMP_INVALID", message: "occurred_at must be an exact UTC timestamp" });
  }
  if (!Array.isArray(proposal.rejected_event_digests)
    || proposal.rejected_event_digests.some((digest) => !isDigest(digest))
    || new Set(proposal.rejected_event_digests).size !== proposal.rejected_event_digests.length) {
    errors.push({ code: "TRUTH_REJECTED_DIGESTS_INVALID", message: "rejected_event_digests must be a unique digest array" });
  }
  if (proposal.operation === "snapshot" && proposal.rejected_event_digests.length !== 0) {
    errors.push({ code: "TRUTH_SNAPSHOT_REJECTS_HISTORY", message: "snapshot proposals cannot reject historical events" });
  }
  if (proposal.operation === "reconcile" && proposal.rejected_event_digests.length === 0) {
    errors.push({ code: "TRUTH_RECONCILIATION_EMPTY", message: "reconcile proposals must name rejected event digests" });
  }
  return errors;
}

function createTruthProposal(input = {}) {
  const occurredAt = input.occurred_at || input.occurredAt || new Date().toISOString();
  const proposal = {
    schema_version: PROPOSAL_SCHEMA,
    operation: input.operation || "snapshot",
    stream: input.stream,
    phase: input.phase,
    action: input.action,
    result: input.result,
    goal: input.goal,
    next_action: input.next_action || input.nextAction,
    stop_criteria: input.stop_criteria || input.stopCriteria,
    evidence: input.evidence == null || input.evidence === "" ? null : input.evidence,
    decision: input.decision == null || input.decision === "" ? null : input.decision,
    occurred_at: occurredAt,
    rejected_event_digests: normalizeRejectedDigests(input.rejected_event_digests || input.rejectedEventDigests),
  };
  const errors = validateTruthProposal(proposal);
  if (errors.length > 0) {
    const error = new Error(errors.map((item) => item.message).join("; "));
    error.code = errors[0].code;
    error.details = errors;
    throw error;
  }
  return proposal;
}

function proposalDigest(proposal) {
  return domainDigest("truth-proposal/v1", proposal);
}

function receiptDefinition(schemaVersion) {
  if (schemaVersion === RECEIPT_SCHEMA) {
    return { keys: RECEIPT_KEYS, bodyKeys: RECEIPT_BODY_KEYS, legacy: false };
  }
  if (schemaVersion === LEGACY_RECEIPT_SCHEMA) {
    return { keys: LEGACY_RECEIPT_KEYS, bodyKeys: LEGACY_RECEIPT_BODY_KEYS, legacy: true };
  }
  return null;
}

function receiptBody(receipt, bodyKeys) {
  return Object.fromEntries(bodyKeys.map((key) => [key, receipt[key]]));
}

function signingBytes(schemaVersion, body) {
  return Buffer.from(`${schemaVersion.replace("meta-harness-", "")}\u001e${canonicalize(body)}`, "utf8");
}

function validateTruthAuthorityReceipt({
  targetRoot,
  authorityDocument,
  receipt,
  expectedPriorSnapshotDigest,
  seenReceiptIds = new Set(),
  at,
  allowLegacy = true,
  allowLegacyAuthority = true,
} = {}) {
  const errors = [];
  if (!isOrdinaryPlainObject(receipt)) {
    return { ok: false, errors: [{ code: "TRUTH_RECEIPT_SHAPE_INVALID", message: "authority receipt must be a JSON object" }] };
  }
  const definition = receiptDefinition(receipt.schema_version);
  if (!definition || !exactKeys(receipt, definition.keys)) {
    return { ok: false, errors: [{ code: "TRUTH_RECEIPT_SHAPE_INVALID", message: "authority receipt has an unsupported schema or unexpected fields" }] };
  }
  if (definition.legacy && !allowLegacy) {
    errors.push({ code: "TRUTH_RECEIPT_LEGACY_REJECTED", message: "new canonical mutation requires a repository-bound v2 authority receipt" });
  }
  if (receipt.capability !== CAPABILITY) {
    errors.push({ code: "TRUTH_RECEIPT_CAPABILITY_INVALID", message: `receipt capability must be ${CAPABILITY}` });
  }
  if (!nonEmptyString(receipt.receipt_id)) {
    errors.push({ code: "TRUTH_RECEIPT_ID_INVALID", message: "receipt_id must be a non-empty string" });
  } else if (seenReceiptIds.has(receipt.receipt_id)) {
    errors.push({ code: "TRUTH_RECEIPT_REPLAY", message: "authority receipt_id has already been used" });
  }
  if (receipt.prior_snapshot_digest !== null && !isDigest(receipt.prior_snapshot_digest)) {
    errors.push({ code: "TRUTH_PRIOR_DIGEST_INVALID", message: "prior_snapshot_digest must be null or sha256 digest" });
  }
  if (receipt.prior_snapshot_digest !== expectedPriorSnapshotDigest) {
    errors.push({ code: "TRUTH_PRIOR_DIGEST_MISMATCH", message: "authority receipt is not bound to the current canonical snapshot" });
  }
  const proposalErrors = validateTruthProposal(receipt.proposal);
  errors.push(...proposalErrors);
  if (!isDigest(receipt.proposal_digest) || (proposalErrors.length === 0 && receipt.proposal_digest !== proposalDigest(receipt.proposal))) {
    errors.push({ code: "TRUTH_PROPOSAL_DIGEST_MISMATCH", message: "proposal_digest does not match the exact proposal" });
  }
  if (!isExactUtcTimestamp(receipt.issued_at) || !isExactUtcTimestamp(receipt.expires_at)) {
    errors.push({ code: "TRUTH_RECEIPT_WINDOW_INVALID", message: "issued_at and expires_at must be exact UTC timestamps" });
  } else {
    const lifetimeMs = Date.parse(receipt.expires_at) - Date.parse(receipt.issued_at);
    if (lifetimeMs <= 0) {
      errors.push({ code: "TRUTH_RECEIPT_WINDOW_INVALID", message: "issued_at must precede expires_at" });
    } else if (lifetimeMs > MAX_RECEIPT_TTL_SECONDS * 1000) {
      errors.push({
        code: "TRUTH_RECEIPT_TTL_EXCEEDED",
        message: `authority receipt lifetime must not exceed ${MAX_RECEIPT_TTL_SECONDS} seconds`,
      });
    }
  }
  const checkedAt = at || receipt.proposal?.occurred_at;
  if (!isExactUtcTimestamp(checkedAt)
    || (isExactUtcTimestamp(receipt.issued_at) && Date.parse(checkedAt) < Date.parse(receipt.issued_at))
    || (isExactUtcTimestamp(receipt.expires_at) && Date.parse(checkedAt) >= Date.parse(receipt.expires_at))) {
    errors.push({ code: "TRUTH_RECEIPT_EXPIRED", message: "authority receipt is outside its validity window" });
  }

  let authority;
  try {
    authority = authorityDocument === undefined
      ? loadPublicAuthority(targetRoot)
      : normalizePublicAuthority(authorityDocument, { allowLegacy: allowLegacyAuthority });
  } catch (error) {
    errors.push({ code: error.code || "TRUTH_AUTHORITY_KEY_INVALID", message: error.message });
  }
  if (authority) {
    if (!definition.legacy) {
      if (authority.legacy) {
        errors.push({ code: "TRUTH_AUTHORITY_CONTRACT_REQUIRED", message: "repository-bound receipts require a structured public authority contract" });
      } else if (receipt.repository_id !== authority.repository_id) {
        errors.push({ code: "TRUTH_REPOSITORY_ID_MISMATCH", message: "authority receipt is bound to a different repository identity" });
      }
    }
    const expectedKeyId = signerKeyId(authority.public_key);
    if (receipt.signer_key_id !== expectedKeyId) {
      errors.push({ code: "TRUTH_SIGNER_KEY_MISMATCH", message: "receipt signer_key_id does not match the repository authority key" });
    }
    if (!nonEmptyString(receipt.signature)) {
      errors.push({ code: "TRUTH_RECEIPT_SIGNATURE_MISSING", message: "authority receipt signature is required" });
    } else {
      let verified = false;
      try {
        verified = crypto.verify(
          null,
          signingBytes(receipt.schema_version, receiptBody(receipt, definition.bodyKeys)),
          crypto.createPublicKey({ key: authority.public_key, format: "jwk" }),
          Buffer.from(receipt.signature, "base64url"),
        );
      } catch (_) {
        verified = false;
      }
      if (!verified) {
        errors.push({ code: "TRUTH_RECEIPT_SIGNATURE_INVALID", message: "authority receipt signature is invalid" });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function eventFromTruthReceipt(receipt) {
  const proposal = receipt.proposal;
  const event = {
    ts: proposal.occurred_at,
    time: proposal.occurred_at,
    actor: "controller",
    stream: proposal.stream,
    phase: proposal.phase,
    action: proposal.action,
    result: proposal.result,
    goal: proposal.goal,
    next_action: proposal.next_action,
    stop_criteria: proposal.stop_criteria,
    truth_snapshot: true,
    authority: receipt.signer_key_id,
    authority_receipt: receipt,
  };
  if (proposal.evidence !== null) event.evidence = proposal.evidence;
  if (proposal.decision !== null) event.decision = proposal.decision;
  if (proposal.operation === "reconcile") {
    event.truth_reconciliation = true;
    event.rejected_event_digests = [...proposal.rejected_event_digests];
  }
  return event;
}

function proposalFromTruthEvent(event) {
  return {
    schema_version: PROPOSAL_SCHEMA,
    operation: event.truth_reconciliation === true ? "reconcile" : "snapshot",
    stream: event.stream,
    phase: event.phase,
    action: event.action,
    result: event.result,
    goal: event.goal,
    next_action: event.next_action,
    stop_criteria: event.stop_criteria,
    evidence: event.evidence == null || event.evidence === "" ? null : event.evidence,
    decision: event.decision == null || event.decision === "" ? null : event.decision,
    occurred_at: event.ts || event.time,
    rejected_event_digests: Array.isArray(event.rejected_event_digests) ? [...event.rejected_event_digests] : [],
  };
}

function canonicalSnapshotDigest(event) {
  return proposalDigest(proposalFromTruthEvent(event));
}

function ledgerEventDigest(event) {
  return domainDigest("truth-ledger-event/v1", event);
}

module.exports = {
  AUTHORITY_SCHEMA,
  CAPABILITY,
  DEFAULT_TTL_SECONDS,
  LEGACY_RECEIPT_SCHEMA,
  MAX_RECEIPT_TTL_SECONDS,
  PROPOSAL_SCHEMA,
  PUBLIC_KEY_RELATIVE_PATH,
  RECEIPT_SCHEMA,
  canonicalSnapshotDigest,
  createTruthProposal,
  eventFromTruthReceipt,
  hasTruthAuthority,
  installPublicAuthority,
  ledgerEventDigest,
  loadPublicAuthority,
  loadPublicKey,
  normalizePublicAuthority,
  proposalFromTruthEvent,
  signerKeyId,
  validatePublicAuthorityInstallation,
  validateTruthAuthorityReceipt,
  validateTruthProposal,
};
