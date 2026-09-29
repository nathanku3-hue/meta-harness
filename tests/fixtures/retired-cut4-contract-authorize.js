"use strict";

const { unsupportedContract } = require("./retired-contract");

function authorizeAttempt() {
  return unsupportedContract("legacy attempt authorization");
}

module.exports = { authorizeAttempt };
