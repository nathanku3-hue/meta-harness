"use strict";

const { fail, parseArgs, requireTargetRoot } = require("../cli-args");
const { commandBrief } = require("../decisions");
const { scanPmBrief } = require("../pm-brief-check");
const { printCheckResult } = require("./read-only-check");

async function runBriefScan(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional.length > 0) {
    fail(`unknown brief scan argument: ${positional[0]}`);
  }
  const targetRoot = requireTargetRoot(options, context);
  return { exitCode: printCheckResult(context, "BRIEF SCAN", scanPmBrief({ targetRoot })) };
}

module.exports = async function runBrief(args, context) {
  if (args[0] === "scan") {
    return runBriefScan(args.slice(1), context);
  }
  return commandBrief(args, context);
};
