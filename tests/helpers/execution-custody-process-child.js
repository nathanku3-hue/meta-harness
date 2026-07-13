#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
  createExecutionCustodyController,
} = require("../../internal/execution-custody/controller");

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("input JSON path required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const controller = createExecutionCustodyController({
    ...input.config,
    clock: () => input.clock,
  });
  try {
    const result = await controller.run(input.request);
    process.stdout.write(`${JSON.stringify({
      result,
      agentSpawnCount: controller.getAgentSpawnCount(),
    })}\n`);
  } finally {
    await controller.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
});
