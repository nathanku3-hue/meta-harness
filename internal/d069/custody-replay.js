"use strict";

/**
 * D072 canonical receipt lookup and replay binding validation.
 * This module performs custody-only reads and must not touch execution tools.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  validateAttemptAuthorization,
  validateAuthorizationPolicy,
  PREPARE_WORKSPACE_CAPABILITY,
} = require("../../lib/contracts/attempt-authorization");
const {
  codedError,
  isPlainObject,
  sha256Utf8,
} = require("./support");

function canonicalReceiptPath(stateRoot, authorizationId) {
  return path.join(
    stateRoot,
    "authorizations",
    `auth-${sha256Utf8(authorizationId)}.json`,
  );
}

function lookupStoredReceipt(stateRoot, authorizationId) {
  const receiptPath = canonicalReceiptPath(stateRoot, authorizationId);
  let bytes;
  try {
    bytes = fs.readFileSync(receiptPath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { exists: false, receiptPath, receipt: null, bytes: null };
    }
    throw codedError(
      "D072_RECEIPT_READ_FAILED",
      `canonical authorization receipt unreadable: ${err.message}`,
      { causeCode: err && err.code },
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    throw codedError(
      "D069_RECEIPT_CONFLICT",
      `canonical authorization receipt is not valid JSON: ${err.message}`,
    );
  }
  const sealed = validateAttemptAuthorization(receipt);
  if (!sealed.ok) {
    throw codedError(
      "D069_RECEIPT_CONFLICT",
      `stored authorization receipt failed validation: ${JSON.stringify(sealed.reasons)}`,
      { reasons: sealed.reasons },
    );
  }
  return { exists: true, receiptPath, receipt, bytes };
}

function rejectReplacementAuthorizationIdentity(stateRoot, authorizationRequest, runSpecApproval) {
  const authorizationDir = path.join(stateRoot, "authorizations");
  if (!fs.existsSync(authorizationDir)) return;
  for (const name of fs.readdirSync(authorizationDir).sort()) {
    if (!/^auth-[a-f0-9]{64}\.json$/.test(name)) continue;
    const filePath = path.join(authorizationDir, name);
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      throw codedError(
        "D069_RECEIPT_CONFLICT",
        `canonical receipt index contains unreadable state: ${err.message}`,
      );
    }
    const sealed = validateAttemptAuthorization(receipt);
    if (!sealed.ok) {
      throw codedError(
        "D069_RECEIPT_CONFLICT",
        "canonical receipt index contains an invalid sealed receipt",
        { reasons: sealed.reasons },
      );
    }
    if (receipt.authorizationId === authorizationRequest.authorizationId) continue;
    const sameLogicalAttempt = receipt.attemptId === authorizationRequest.attemptId
      || receipt.approvalDigest === runSpecApproval.approvalDigest
      || receipt.runSpecDigest === runSpecApproval.runSpecDigest;
    if (sameLogicalAttempt) {
      throw codedError(
        "D072_REPLACEMENT_AUTHORIZATION_DENIED",
        "stored custody already binds this attempt or approval to a different authorization identity",
        { storedAuthorizationId: receipt.authorizationId },
      );
    }
  }
}

function validateStoredReceiptBindings({ receipt, runSpecApproval, authorizationRequest, boundPolicy }) {
  if (!isPlainObject(receipt)) {
    throw codedError("D069_RECEIPT_CONFLICT", "stored authorization receipt required");
  }
  const policyCheck = validateAuthorizationPolicy(boundPolicy);
  if (!policyCheck.ok) {
    throw codedError(
      "D069_POLICY_SHAPE",
      `bound authorization policy invalid: ${JSON.stringify(policyCheck.reasons)}`,
      { reasons: policyCheck.reasons },
    );
  }

  const conflicts = [];
  if (receipt.authorizationId !== authorizationRequest.authorizationId) conflicts.push("authorizationId");
  if (receipt.attemptId !== authorizationRequest.attemptId) conflicts.push("attemptId");
  if (receipt.approvalDigest !== runSpecApproval.approvalDigest) conflicts.push("approvalDigest");
  if (receipt.runSpecDigest !== runSpecApproval.runSpecDigest) conflicts.push("runSpecDigest");
  if (receipt.authorizationPolicyDigest !== policyCheck.authorizationPolicyDigest) {
    conflicts.push("authorizationPolicyDigest");
  }
  if (receipt.workspacePolicyDigest !== policyCheck.workspacePolicyDigest) {
    conflicts.push("workspacePolicyDigest");
  }
  if (!isPlainObject(receipt.provider)
    || receipt.provider.id !== boundPolicy.provider.id
    || receipt.provider.workerProfile !== boundPolicy.provider.workerProfile) {
    conflicts.push("provider");
  }
  if (receipt.capability !== PREPARE_WORKSPACE_CAPABILITY) conflicts.push("capability");

  if (conflicts.length > 0) {
    throw codedError(
      "D072_STORED_RECEIPT_CONFLICT",
      `stored authorization receipt conflicts with approved request: ${conflicts.join(", ")}`,
      { conflicts },
    );
  }
  return receipt;
}

module.exports = {
  canonicalReceiptPath,
  lookupStoredReceipt,
  rejectReplacementAuthorizationIdentity,
  validateStoredReceiptBindings,
};
