#!/usr/bin/env node
"use strict";

const { createCommandContext } = require("../lib/cli-context");
const { connectStdio } = require("../lib/acp-entry");

connectStdio(createCommandContext()).catch((error) => {
  process.stderr.write(`meta-harness-acp: ${error.message}\n`);
  process.exitCode = 1;
});
