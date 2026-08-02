"use strict";

const { parseArgs } = require("../cli-args");
const { writeOut } = require("../cli-context");
const { harnessPath, refreshStatus, requireHarness } = require("../harness-state");
const { readText } = require("../paths");
const { assertTruthReconciled } = require("../truth-reconciler");

module.exports = async function runStatus(args, context) {
  const { options } = parseArgs(args);
  requireHarness(context);
  const statusPath = harnessPath(context, "status.md");
  const status = options.refresh
    ? refreshStatus(context)
    : assertTruthReconciled({ targetRoot: context.cwd }).actual_status || readText(statusPath);
  writeOut(context, status.endsWith("\n") ? status : `${status}\n`);
};
