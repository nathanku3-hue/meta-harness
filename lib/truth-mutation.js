"use strict";

function retired() {
  const error = new Error("pre-0.4 canonical mutation is retired; only deterministic terminal projection may mutate canonical state");
  error.code = "UNSUPPORTED_AUTHORITY";
  throw error;
}

module.exports = {
  appendCanonicalReceipt: retired,
  preflightInitialCanonicalReceipt: retired,
};
