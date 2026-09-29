"use strict";

function retired() {
  const error = new Error("pre-0.4 truth authority receipts and proposals are inert archive formats");
  error.code = "UNSUPPORTED_SCHEMA";
  throw error;
}

function invalid() {
  return {
    ok: false,
    errors: [{
      code: "UNSUPPORTED_SCHEMA",
      message: "pre-0.4 truth authority receipts and proposals are not interpreted by 0.4",
    }],
  };
}

module.exports = {
  AUTHORITY_SCHEMA: null,
  CAPABILITY: null,
  DEFAULT_TTL_SECONDS: 0,
  LEGACY_RECEIPT_SCHEMA: null,
  MAX_RECEIPT_TTL_SECONDS: 0,
  PROPOSAL_SCHEMA: null,
  PUBLIC_KEY_RELATIVE_PATH: null,
  RECEIPT_SCHEMA: null,
  canonicalSnapshotDigest: retired,
  createTruthProposal: retired,
  eventFromTruthReceipt: retired,
  hasTruthAuthority: () => false,
  installPublicAuthority: retired,
  ledgerEventDigest: retired,
  loadPublicAuthority: retired,
  loadPublicKey: retired,
  normalizePublicAuthority: retired,
  proposalFromTruthEvent: retired,
  signerKeyId: retired,
  validatePublicAuthorityInstallation: retired,
  validateTruthAuthorityReceipt: invalid,
  validateTruthProposal: () => invalid().errors,
};
