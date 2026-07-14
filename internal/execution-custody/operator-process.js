#!/usr/bin/env node
"use strict";

/** Fresh-process private controller entrypoint. Not packaged. */

const fs = require("node:fs");
const {
  createExecutionCustodyController,
} = require("./controller");

async function runControllerInput(input) {
  const controller = createExecutionCustodyController({
    ...input.config,
    clock: () => input.clock,
  });
  try {
    const result = await controller.run(input.request);
    return {
      result,
      agentSpawnCount: controller.getAgentSpawnCount(),
    };
  } finally {
    await controller.close();
  }
}

async function runCli(argv = process.argv) {
  const inputPath = argv[2];
  if (!inputPath) throw new Error("input JSON path required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const output = await runControllerInput(input);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runControllerInput,
  runCli,
};
