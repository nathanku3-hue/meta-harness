#!/usr/bin/env node
"use strict";

const { runCli } = require("../../internal/execution-custody/operator-process");

runCli().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
});
