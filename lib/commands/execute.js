"use strict";

const path = require("node:path");

const {
  FileSystemError,
  QualityGateError,
  UsageError,
} = require("../errors");
const { writeLine, writeOut } = require("../cli-context");
const { isAbsoluteNormalizedFsPath } = require("../execution-custody/support");
const { executeRequest } = require("../execution-custody/execute");

function parseExecuteArgs(argv) {
  let requestPath = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--request") {
      if (requestPath !== null) throw new UsageError("--request may be supplied exactly once");
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError("--request requires an absolute path value");
      }
      requestPath = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      if (json) throw new UsageError("--json may be supplied at most once");
      json = true;
      continue;
    }
    if (arg.startsWith("--")) throw new UsageError(`unknown execute option: ${arg}`);
    throw new UsageError(`unexpected execute positional argument: ${arg}`);
  }

  if (requestPath === null) throw new UsageError("execute requires --request <absolute-path>");
  if (!path.isAbsolute(requestPath) || !isAbsoluteNormalizedFsPath(requestPath)) {
    throw new UsageError("--request must be an absolute normalized path");
  }
  return Object.freeze({ requestPath, json });
}

function mapExecutionError(error) {
  if (error instanceof UsageError
    || error instanceof FileSystemError
    || error instanceof QualityGateError) {
    return error;
  }
  const code = String(error && error.code || "CUSTODY_EXECUTION_FAILED");
  const options = { code, cause: error, details: error && error.details };

  if (/^E[A-Z]+$/.test(code)
    || code === "CUSTODY_EXECUTION_REQUEST_READ"
    || code === "CUSTODY_EXECUTION_PATH"
    || code.startsWith("CUSTODY_EXECUTION_ROOT")) {
    return new FileSystemError(error.message, options);
  }
  if (code === "CUSTODY_EXECUTION_REQUEST"
    || code === "CUSTODY_EXECUTION_BINDING"
    || code === "CUSTODY_EXECUTION_IDENTITY"
    || code === "CUSTODY_EXECUTION_PACKAGE") {
    return new UsageError(error.message, options);
  }
  return new QualityGateError(error && error.message ? error.message : "execution custody failed", options);
}

function printHuman(context, result) {
  writeLine(context, "VERIFIED");
  writeLine(context, `Child commit: ${result.verifiedHeadRevision}`);
  writeLine(context, `Durable ref: ${result.durableRef}`);
  writeLine(context, `Receipt: ${result.receiptPath}`);
  writeLine(context, `Portable export: ${result.portableExportPath}`);
  writeLine(context, "REPLAY: confirmed, zero spawns");
}

module.exports = async function commandExecute(argv, context) {
  const options = parseExecuteArgs(argv);
  let result;
  try {
    result = executeRequest({ requestPath: options.requestPath });
  } catch (error) {
    throw mapExecutionError(error);
  }

  if (options.json) {
    writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(context, result);
  }
  return { exitCode: 0 };
};

module.exports.parseExecuteArgs = parseExecuteArgs;
module.exports.mapExecutionError = mapExecutionError;
module.exports.printHuman = printHuman;
