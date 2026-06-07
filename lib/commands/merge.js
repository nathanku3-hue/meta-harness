"use strict";

const path = require("node:path");
const { UsageError } = require("../errors");
const { optionValue, parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runMergeCheck } = require("../merge-check");

function targetRootFromOptions(options, context) {
  if (options.target !== undefined) {
    return requireTargetRoot(options, context);
  }
  return path.resolve(context.cwd);
}

function printHuman(context, result) {
  writeLine(context, `MERGE CHECK: ${result.ok ? "PASS" : "FAIL"} scope=${result.scope} files=${result.changed_files} lines=${result.changed_lines}`);
  for (const check of result.checks) {
    const status = check.status.toUpperCase().padEnd(6);
    const id = check.id.padEnd(22);
    const reason = check.reason ? ` ${check.reason}` : "";
    writeLine(context, `${status}${id}${check.name}${reason}`);
  }
  if (!result.ok && result.next_action) {
    writeLine(context);
    writeLine(context, `Next action: ${result.next_action}`);
  }
}

module.exports = async function commandMerge(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1 || positional[0] !== "check") {
    throw new UsageError(`unknown merge action: ${positional[0] || "missing"}`);
  }

  const result = runMergeCheck({
    targetRoot: targetRootFromOptions(options, context),
    pr: optionValue(options.pr),
    base: optionValue(options.base),
    head: optionValue(options.head),
    scope: optionValue(options.scope),
    expectedBase: optionValue(options.expectedBase),
    expectedHead: optionValue(options.expectedHead),
    checksStatus: optionValue(options.checksStatus),
    decisionId: optionValue(options.decisionId),
    maxFiles: optionValue(options.maxFiles),
    maxLines: optionValue(options.maxLines),
  });

  if (options.json) {
    writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(context, result);
  }

  return { exitCode: result.ok ? 0 : 1 };
};
