"use strict";

const { fail, parseArgs, requireTargetRoot } = require("../cli-args");
const { commandDecisions } = require("../decisions");
const { scanDecisionInbox } = require("../decision-inbox-check");
const { printCheckResult } = require("./read-only-check");

async function runDecisionInboxScan(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional.length > 0) {
    fail(`unknown decisions scan argument: ${positional[0]}`);
  }
  const targetRoot = requireTargetRoot(options, context);
  return { exitCode: printCheckResult(context, "DECISION INBOX SCAN", scanDecisionInbox({ targetRoot })) };
}

module.exports = async function runDecisions(args, context) {
  if (args[0] === "scan") {
    return runDecisionInboxScan(args.slice(1), context);
  }
  return commandDecisions(args, context);
};
