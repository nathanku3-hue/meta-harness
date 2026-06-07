"use strict";

const { parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const { harnessPath, refreshStatus, requireHarness } = require("../harness-state");
const { fileExists, readText } = require("../paths");

module.exports = async function runStatus(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);
  const statusPath = harnessPath(context, "status.md");
  const status = options.refresh || !fileExists(statusPath)
    ? refreshStatus(context)
    : readText(statusPath);
  writeOut(context, status.endsWith("\n") ? status : `${status}\n`);
};
