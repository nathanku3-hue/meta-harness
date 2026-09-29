"use strict";

const { cloneStrict, freezeDeep, rejectedValidation, unsupportedContract } = require("./retired-contract");

function validateRunSpecApproval() {
  return rejectedValidation("legacy RunSpec approval");
}

function retired() {
  return unsupportedContract("legacy RunSpec approval");
}

module.exports = {
  SCHEMA_VERSION: null,
  DOMAIN: null,
  validateRunSpecApproval,
  computeApprovalDigest: retired,
  sealRunSpecApproval: retired,
  freezeDeep,
  cloneStrict,
};
