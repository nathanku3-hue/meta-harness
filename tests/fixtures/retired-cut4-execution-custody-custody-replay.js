"use strict";

const { retiredRuntime } = require("./retired-runtime");

function retired() {
  return retiredRuntime("legacy custody replay");
}

module.exports = {
  canonicalReceiptPath: retired,
  lookupStoredReceipt: retired,
  rejectReplacementAuthorizationIdentity: retired,
  validateStoredReceiptBindings: retired,
};
