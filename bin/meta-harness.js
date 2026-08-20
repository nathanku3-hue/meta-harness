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

function isRepoAdoptionCommand(argv) {
  return (argv[0] === "sync" && argv[1] === "check")
    || (argv[0] === "templates" && argv[1] === "install");
}

function usesControlledDrain(argv) {
  if (wantsHelp(argv) || (argv.length === 1 && argv[0] === "--version") || argv[0] === "inspect") return false;
  if (!argv[0] || !commandNames().includes(argv[0])) return true;
  return argv[0] === "work";
}

function createControlledSignalScope() {
  const controller = new AbortController();
  let installed = true;
  const cleanup = () => {
    if (!installed) return;
    installed = false;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
  const onSignal = () => {
    cleanup();
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return Object.freeze({ controller, signal: controller.signal, cleanup, requestDrain: onSignal });
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

async function run(argv, context = createCommandContext(), { signal } = {}) {
  if (signal) context = { ...context, signal };
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
      || (context.env.npm_lifecycle_event === "prepublishOnly" && command === "release")
      || isRepoAdoptionCommand(argv);
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

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    const signalScope = usesControlledDrain(argv) ? createControlledSignalScope() : null;
    run(argv, createCommandContext(), { signal: signalScope?.signal }).then((exitCode) => {
      process.exitCode = exitCode;
    }).catch((error) => {
      process.exitCode = writeHumanError(error, createCommandContext());
    }).finally(() => {
      signalScope?.cleanup();
    });
  } catch (error) {
    process.exitCode = writeHumanError(error, createCommandContext());
  }
}

module.exports = { createControlledSignalScope, run, usesControlledDrain };
