"use strict";

const fs = require("node:fs");
const {
  createLocalWalkingSliceController,
} = require("../../internal/d069/local-controller");

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("input JSON path required");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!input || !input.config || !input.request) throw new Error("input requires config and request");
  if (typeof input.clockValue !== "string") throw new Error("input.clockValue required");
  input.config.clock = () => input.clockValue;

  const controller = createLocalWalkingSliceController(input.config);
  try {
    const result = await controller.run(input.request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await controller.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ code: err && err.code, message: err && err.message })}\n`);
  process.exitCode = 1;
});
