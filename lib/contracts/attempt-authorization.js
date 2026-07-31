"use strict";

const { cloneStrict, freezeDeep, rejectedValidation, unsupportedContract } = require("./retired-contract");

function validateAttemptAuthorization() {
  return rejectedValidation("legacy attempt authorization");
}

function retired() {
  return unsupportedContract("legacy attempt authorization");
}

module.exports = {
  SCHEMA_VERSION: null,
  DOMAIN: null,
  REQUEST_DOMAIN: null,
  POLICY_DOMAIN: null,
  WORKSPACE_POLICY_DOMAIN: null,
  WORKSPACE_POLICY_SCHEMA: null,
  PREPARE_WORKSPACE_CAPABILITY: null,
  PROTOCOL_MAX_AUTHORIZATION_TTL_SECONDS: 0,
  PROTOCOL_MAX_READINESS_AGE_SECONDS: 0,
  PROTOCOL_MAX_COMMAND_TIMEOUT_SECONDS: 0,
  validateAttemptAuthorization,
  validateAuthorizationPolicy: validateAttemptAuthorization,
  computeReceiptDigest: retired,
  computeAuthorizationRequestDigest: retired,
  computeAuthorizationRequestDigestFromReceipt: retired,
  authorizationRequestIdentity: retired,
  computeWorkspacePolicyDigest: retired,
  computeAuthorizationPolicyDigest: retired,
  sealAuthorizationReceipt: retired,
  isWithinAuthorizationWindow: () => false,
  addSecondsExactUtc: retired,
  freezeDeep,
  cloneStrict,
};
