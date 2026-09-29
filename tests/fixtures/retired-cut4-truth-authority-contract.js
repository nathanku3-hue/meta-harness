"use strict";

function retired() {
  const error = new Error("pre-0.4 truth authority contracts are inert archive formats");
  error.code = "UNSUPPORTED_SCHEMA";
  throw error;
}

module.exports = {
  AUTHORITY_SCHEMA: null,
  PUBLIC_KEY_RELATIVE_PATH: null,
  hasTruthAuthority: () => false,
  installPublicAuthority: retired,
  loadPublicAuthority: retired,
  loadPublicKey: retired,
  normalizePublicAuthority: retired,
  signerKeyId: retired,
  validatePublicAuthorityInstallation: retired,
};
