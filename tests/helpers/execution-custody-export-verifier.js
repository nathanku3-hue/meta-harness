#!/usr/bin/env node
"use strict";

const {
  prepareVerifierBase,
  verifyPortableCustody,
  runCli,
} = require("../../internal/execution-custody/portable-verifier");

if (require.main === module) {
  try {
    runCli();
  } catch (err) {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  prepareVerifierBase,
  verifyPortableCustody,
};
