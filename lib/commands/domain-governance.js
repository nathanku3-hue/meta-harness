"use strict";

const { fail, parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { checkDomainGovernance } = require("../domain-governance");

module.exports = async function runDomainGovernance(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1 || positional[0] !== "check") {
    fail(`unknown domain-governance action: ${positional[0] || "missing"}`);
  }

  const result = checkDomainGovernance({ targetRoot: requireTargetRoot(options, context) });
  if (options.json) {
    writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    const parts = [`${result.counts.pass} pass`];
    if (result.counts.fail > 0) parts.push(`${result.counts.fail} fail`);
    if (result.counts.skip > 0) parts.push(`${result.counts.skip} skip`);
    writeLine(context, `DOMAIN GOVERNANCE: ${result.ok ? "yes" : "no"} (${parts.join(", ")})`);
    for (const item of result.checks.filter((entry) => entry.status !== "pass")) {
      writeLine(context, `${item.status.toUpperCase()}\t${item.id}\t${item.reason || item.name}`);
    }
    if (!result.ok) {
      writeLine(context, `Next action: ${result.next_action}`);
    }
  }

  return result.ok ? undefined : { exitCode: 1 };
};
