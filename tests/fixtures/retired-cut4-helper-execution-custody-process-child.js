#!/usr/bin/env node
"use strict";

const { runCli } = require("../../lib/execution-custody/controller-process");

runCli().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
});
