#!/usr/bin/env node
"use strict";

const { createCommandContext, writeOut } = require("../lib/cli-context");
const { normalizeHarnessError, UsageError } = require("../lib/errors");
const { commandNames, renderHelp, resolveCommand } = require("../lib/command-registry");
const { runAutomatic } = require("../lib/commands/work");
const { latestWorkSessionState, repositoryRoot } = require("../lib/work-git");
const packageJson = require("../package.json");

function wantsHelp(argv) {
  const [command] = argv;
  return command === "help" || command === "--help" || command === "-h";
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

function writeProductError(error, context) {
  const harnessError = normalizeHarnessError(error);
  const message = String(harnessError.message || "The requested result could not continue.").trim();
  const punctuation = /[.!?]$/u.test(message) ? "" : ".";
  writeOut(context, `Blocked: ${message}${punctuation}\n`);
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

function renderInspection(context) {
  const latest = latestWorkSessionState(repositoryRoot(context.cwd));
  if (latest.state === "ACTIVE") {
    writeOut(context, `State: active\nResult: ${latest.session.productResult}\nNext: continuation is automatic.\n`);
    return;
  }
  writeOut(context, "State: idle\nNext: state a product result when something is worth changing.\n");
}

async function run(argv, context = createCommandContext()) {
  if (wantsHelp(argv)) {
    writeOut(context, renderHelp({ advanced: argv.includes("--advanced") }));
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--version") {
    writeOut(context, `${packageJson.version}\n`);
    return 0;
  }

  try {
    const command = argv[0];
    if (!command) {
      const result = await runAutomatic([], context);
      return result?.exitCode || 0;
    }
    if (command === "inspect") {
      if (argv.length !== 1) throw new UsageError("usage: meta-harness inspect");
      renderInspection(context);
      return 0;
    }
    if (!commandNames().includes(command)) {
      const result = await runAutomatic(argv, context);
      return result?.exitCode || 0;
    }
    const maintenanceContext = context.env.META_HARNESS_INTERNAL_CLI === "1"
      || (context.env.npm_lifecycle_event === "prepublishOnly" && command === "release");
    if (!maintenanceContext) {
      throw new UsageError(`'${command}' is internal; normal usage is meta-harness \"<result>\" or meta-harness`);
    }
    const resolved = resolveCommand(argv);
    const result = await resolved.handler(resolved.args, context);
    return result?.exitCode || 0;
  } catch (error) {
    if (!commandNames().includes(argv[0]) && !wantsJson(argv)) return writeProductError(error, context);
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
