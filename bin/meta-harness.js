#!/usr/bin/env node
"use strict";

const { createCommandContext, writeOut } = require("../lib/cli-context");
const { normalizeHarnessError } = require("../lib/errors");
const { renderHelp, resolveCommand } = require("../lib/command-registry");

function wantsHelp(argv) {
  const [command] = argv;
  return !command || command === "help" || command === "--help" || command === "-h";
}

function wantsJson(argv) {
  return argv.includes("--json");
}

function writeHumanError(error, context) {
  const harnessError = normalizeHarnessError(error);
  context.stderr.write(`meta-harness: ${harnessError.code}: ${harnessError.message}\n`);
  if (context.env.META_HARNESS_DEBUG && harnessError.stack) {
    context.stderr.write(`${harnessError.stack}\n`);
  }
  return harnessError.exitCode || 1;
}

function writeJsonError(error, context) {
  const harnessError = normalizeHarnessError(error);
  writeOut(context, `${JSON.stringify({
    schema_version: "1.0.0",
    ok: false,
    error: {
      code: harnessError.code,
      message: harnessError.message,
    },
  }, null, 2)}\n`);
  return harnessError.exitCode || 1;
}

async function run(argv, context = createCommandContext()) {
  if (wantsHelp(argv)) {
    writeOut(context, renderHelp());
    return 0;
  }

  try {
    const resolved = resolveCommand(argv);
    const result = await resolved.handler(resolved.args, context);
    return result?.exitCode || 0;
  } catch (error) {
    return wantsJson(argv) ? writeJsonError(error, context) : writeHumanError(error, context);
  }
}

try {
  run(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.exitCode = writeHumanError(error, createCommandContext());
  });
} catch (error) {
  process.exitCode = writeHumanError(error, createCommandContext());
}

module.exports = { run };
