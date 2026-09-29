"use strict";

const path = require("node:path");

const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const {
  executeRequest,
  loadExecutionRequestEnvelope,
} = require("../execution-custody/execute");

function renderHuman(context, result) {
  if (result.disposition === "MECHANICS_VERIFIED") {
    writeLine(context, "MECHANICS VERIFIED");
    writeLine(context, "PRODUCT ACCEPTANCE: NOT EVALUATED");
  } else if (result.disposition === "TERMINAL_SLICE_VERIFIED") {
    writeLine(context, "TERMINAL SLICE VERIFIED");
  } else if (result.disposition === "SLICE_CLOSED") {
    writeLine(context, "SLICE CLOSED");
    writeLine(context, "PRODUCT ACCEPTANCE: TERMINAL SLICE VERIFIED");
  } else {
    writeLine(context, result.disposition.replaceAll("_", " "));
    writeLine(context, "PRODUCT ACCEPTANCE: NOT EVALUATED");
  }
  for (const [key, value] of Object.entries(result)) {
    if (["schemaVersion", "action", "disposition", "productAcceptance"].includes(key)) continue;
    writeLine(context, `${key}: ${value}`);
  }
}

module.exports = async function commandExecute(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 0) fail("execute does not accept positional arguments");
  for (const key of Object.keys(options)) {
    if (!new Set(["request", "json"]).has(key)) fail(`unknown execute option: --${key}`);
  }
  const requestValue = optionValue(options.request);
  if (!requestValue || requestValue === true) fail("--request <absolute-json-path> is required");
  const requestPath = path.resolve(context.cwd, String(requestValue));
  const request = loadExecutionRequestEnvelope(requestPath);
  const result = await executeRequest(request, { repositoryPath: path.resolve(context.cwd) });
  if (options.json !== undefined) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else renderHuman(context, result);
  return { exitCode: 0 };
};
