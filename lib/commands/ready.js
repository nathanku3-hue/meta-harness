"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UsageError } = require("../errors");
const { runReadyCheck } = require("../ready-check");

function addOption(options, key, value) {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
  } else {
    options[key] = value;
  }
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      addOption(options, key, true);
    } else {
      addOption(options, key, next);
      index += 1;
    }
  }

  return { positional, options };
}

function requireTargetRoot(options) {
  const value = options.target;
  if (Array.isArray(value)) {
    throw new UsageError("--target must be provided once", { exitCode: 2 });
  }
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    throw new UsageError("--target requires an existing directory", { exitCode: 2 });
  }
  const targetRoot = path.resolve(process.cwd(), String(value));
  let stat;
  try {
    stat = fs.lstatSync(targetRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new UsageError(`--target must be an existing directory: ${value}`, { exitCode: 2 });
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UsageError(`--target must be an existing directory: ${value}`, { exitCode: 2 });
  }
  return targetRoot;
}

module.exports = async function commandReady(argv) {
  const { options } = parseArgs(argv);
  const targetRoot = requireTargetRoot(options);
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
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const totalCount = result.checks.length;
    const parts = [];
    parts.push(`${result.passed} pass`);
    if (result.failed > 0) parts.push(`${result.failed} fail`);
    if (result.timed_out > 0) parts.push(`${result.timed_out} timeout`);
    if (result.warned > 0) parts.push(`${result.warned} warn`);
    if (result.skipped > 0) parts.push(`${result.skipped} skip`);
    if (result.unknown > 0) parts.push(`${result.unknown} unknown`);

    if (result.ok) {
      console.log(`READY: yes (${parts.join(", ")})`);
    } else {
      console.log(`READY: no (${parts.join(", ")})`);
    }
    console.log("");
    for (const c of result.checks) {
      const statusPart = c.status.toUpperCase().padEnd(6);
      const idPart = c.id.padEnd(14);
      const namePart = c.name.padEnd(14);
      const reasonPart = c.status === "pass" ? "" : (c.reason || "");
      console.log(`${statusPart}${idPart}${namePart}${reasonPart}`);
    }
    if (!result.ok && result.next_action && result.next_action !== "none") {
      console.log("");
      console.log(`Next action: ${result.next_action}`);
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
};
