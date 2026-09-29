"use strict";

const { retiredRuntime } = require("./retired-runtime");

async function implementAfterClaim() {
  return retiredRuntime("legacy implementation runtime");
}

module.exports = { implementAfterClaim };
