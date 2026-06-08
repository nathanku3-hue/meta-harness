"use strict";

const path = require("node:path");
const { UsageError } = require("../errors");
const { parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runReleaseCheck } = require("../release-check");

function targetRootFromOptions(options, context) {
  if (options.target !== undefined) {
    return requireTargetRoot(options, context);
  }
  return path.resolve(context.cwd);
}

function printHuman(context, result) {
  writeLine(context, `RELEASE CHECK: ${result.local_ok ? "LOCAL PASS" : "LOCAL FAIL"} release_ready=${result.release_ready ? "yes" : "no"}`);
  for (const item of result.checks) {
    const status = item.status.toUpperCase().padEnd(8);
    const id = item.id.padEnd(34);
    const reason = item.reason ? ` ${item.reason}` : "";
    writeLine(context, `${status}${id}${item.name}${reason}`);
  }
  if (result.next_action && result.next_action !== "none") {
    writeLine(context);
    writeLine(context, `Next action: ${result.next_action}`);
  }
}

module.exports = async function commandRelease(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1 || positional[0] !== "check") {
    throw new UsageError(`unknown release action: ${positional[0] || "missing"}`);
  }
  if (options.publish !== undefined) {
    throw new UsageError("release check --publish is not implemented in Phase 10A");
  }

  const result = await runReleaseCheck({
    targetRoot: targetRootFromOptions(options, context),
  });

  if (options.json) {
    writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(context, result);
  }

  return { exitCode: result.local_ok ? 0 : 1 };
};
