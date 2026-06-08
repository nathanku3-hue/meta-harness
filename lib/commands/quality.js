"use strict";

const { QualityGateError } = require("../errors");
const { commandQuality } = require("../quality");
const { HARNESS_DIR, relativePath } = require("../harness-state");

module.exports = async function runQuality(args, context) {
  return commandQuality(args, {
    ...context,
    harnessDir: HARNESS_DIR,
    fail: (message) => { throw new QualityGateError(message); },
    relativePath: (targetPath) => relativePath(targetPath, context.cwd),
  });
};
