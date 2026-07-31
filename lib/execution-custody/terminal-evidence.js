"use strict";

const { retiredRuntime } = require("./retired-runtime");

function retired() {
  return retiredRuntime("legacy terminal evidence runtime");
}

module.exports = {
  MANIFEST_SCHEMA: null,
  REQUIRED_FILES: Object.freeze([]),
  prepareTerminalEvidence: retired,
  publishPreparedTerminalEvidence: retired,
  discardPreparedTerminalEvidence: retired,
  verifyTerminalEvidence: retired,
};
