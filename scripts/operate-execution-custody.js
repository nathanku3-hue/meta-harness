#!/usr/bin/env node
"use strict";

/**
 * Private operator entrypoint for one approved bounded repository change.
 * Intentionally unregistered: no package script, bin mapping, or public CLI contract.
 */

const path = require("node:path");
const {
  operateBoundedRepositoryChange,
} = require("../internal/execution-custody/operator");

function main(argv = process.argv) {
  if (argv.length !== 3) {
    throw new Error("usage: node scripts/operate-execution-custody.js <absolute-local-request.json>");
  }
  const operatorRequestPath = argv[2];
  if (!path.isAbsolute(operatorRequestPath)) {
    throw new Error("operator request path must be absolute");
  }
  const result = operateBoundedRepositoryChange({
    operatorRequestPath,
    metaRoot: path.resolve(__dirname, ".."),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
