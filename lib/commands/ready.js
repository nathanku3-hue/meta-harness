"use strict";

const { UsageError } = require("../errors");
const { parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runReadyCheck } = require("../ready-check");

module.exports = async function commandReady(argv, context) {
  const { options } = parseArgs(argv);
  const targetRoot = requireTargetRoot(options, context);
  const quick = Boolean(options.quick);
  const readOnly = Boolean(options.readOnly);
  const noExec = Boolean(options.noExec || options.readOnly);
  const isJson = Boolean(options.json);

  let mode = "local";
  if (options.mode) {
    const allowed = ["local", "strict", "release"];
    if (allowed.includes(options.mode)) {
      mode = options.mode;
    } else {
      throw new UsageError(`Invalid mode: ${options.mode}. Expected local, strict, or release.`, { exitCode: 2 });
    }
  } else if (options.release) {
    mode = "release";
  } else if (options.strict) {
    mode = "strict";
  }

  if (mode === "release" && quick) {
    throw new UsageError("--quick is not allowed in release mode", { exitCode: 2 });
  }

  const result = await runReadyCheck({
    targetRoot,
    quick,
    readOnly,
    noExec,
    mode,
    strictGithubSettings: Boolean(options.strictGithubSettings)
  });

  if (isJson) {
    writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    const parts = [];
    parts.push(`${result.passed} pass`);
    if (result.failed > 0) parts.push(`${result.failed} fail`);
    if (result.timed_out > 0) parts.push(`${result.timed_out} timeout`);
    if (result.warned > 0) parts.push(`${result.warned} warn`);
    if (result.skipped > 0) parts.push(`${result.skipped} skip`);
    if (result.unknown > 0) parts.push(`${result.unknown} unknown`);

    if (result.ok) {
      writeLine(context, `READY: yes (${parts.join(", ")})`);
    } else {
      writeLine(context, `READY: no (${parts.join(", ")})`);
    }
    writeLine(context);
    for (const c of result.checks) {
      const statusPart = c.status.toUpperCase().padEnd(6);
      const idPart = c.id.padEnd(14);
      const namePart = c.name.padEnd(14);
      const reasonPart = c.status === "pass" ? "" : (c.reason || "");
      writeLine(context, `${statusPart}${idPart}${namePart}${reasonPart}`);
    }
    if (!result.ok && result.next_action && result.next_action !== "none") {
      writeLine(context);
      writeLine(context, `Next action: ${result.next_action}`);
    }
  }

  if (!result.ok) {
    return { exitCode: 1 };
  }
};
