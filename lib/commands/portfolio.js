"use strict";

const { UsageError } = require("../errors");
const { optionValue, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { resolveInputPath, writePortfolioReport } = require("../portfolio-audit");

function requiredOption(options, name) {
  const value = optionValue(options[name]);
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    throw new UsageError(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} requires a value`);
  }
  return value;
}

module.exports = async function runPortfolio(args, context) {
  const { positional, options } = parseArgs(args);
  const action = positional[0];
  if (positional.length !== 1 || action !== "audit") {
    throw new UsageError(`unknown portfolio action: ${action || "missing"}`);
  }

  const policy = resolveInputPath(requiredOption(options, "policy"), context.cwd);
  const output = resolveInputPath(requiredOption(options, "output"), context.cwd);
  const copy = options.copy === undefined
    ? undefined
    : resolveInputPath(requiredOption(options, "copy"), context.cwd);
  const result = writePortfolioReport({ policyPath: policy, outputPath: output, copyPath: copy });
  const summary = {
    ok: result.ok,
    mode: result.mode,
    verdict: result.verdict,
    output_path: result.output_path,
    output_sha256: result.output_sha256,
    output_bytes: result.output_bytes,
    second_copy: result.second_copy,
    summary: result.summary,
  };
  if (options.json) writeOut(context, `${JSON.stringify(summary, null, 2)}\n`);
  else writeLine(context, `PORTFOLIO AUDIT: ${summary.verdict} ${summary.output_path}`);
  return { exitCode: 0 };
};
