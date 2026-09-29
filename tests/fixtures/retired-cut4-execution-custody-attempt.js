"use strict";

const { retiredRuntime } = require("./retired-runtime");

async function executeAttempt() {
  return retiredRuntime("legacy execution attempt runtime");
}

module.exports = {
  DETACHED_BRANCH_SENTINEL: null,
  executeAttempt,
};
