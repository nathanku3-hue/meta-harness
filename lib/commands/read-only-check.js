"use strict";

const path = require("node:path");
const { fail, parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine } = require("../cli-context");

function statusCount(items, status) {
  return items.filter((item) => item.status === status).length;
}

function renderCheckSummary(label, result) {
  const fields = [`checked=${result.checked ?? result.items.length}`];
  for (const status of ["MISSING", "DRIFT", "REJECTED", "MALFORMED", "UNREADABLE", "MIGRATION_NEEDED"]) {
    const count = statusCount(result.items, status);
    if (count > 0) {
      fields.push(`${status.toLowerCase()}=${count}`);
    }
  }
  return `${label}: ${result.status} ${fields.join(" ")}`;
}

function printCheckResult(context, label, result) {
  writeLine(context, renderCheckSummary(label, result));
  for (const item of result.items.filter((entry) => entry.status !== "PASS")) {
    const columns = [item.status, item.path];
    if (item.detail) {
      columns.push(item.detail);
    }
    writeLine(context, columns.join("\t"));
  }
  return result.status === "PASS" ? 0 : 1;
}

async function runReadOnlyCheck(args, context, config) {
  const { positional, options } = parseArgs(args);
  if (positional.length !== 1 || positional[0] !== config.action) {
    fail(`unknown ${config.command} action: ${positional[0] || "missing"}`);
  }
  const sourceRoot = path.resolve(__dirname, "..", "..");
  const targetRoot = requireTargetRoot(options, context);
  return { exitCode: printCheckResult(context, config.label, config.check({ sourceRoot, targetRoot })) };
}

module.exports = { printCheckResult, runReadOnlyCheck };
