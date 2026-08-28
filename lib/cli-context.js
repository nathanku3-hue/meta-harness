"use strict";

const fs = require("node:fs");

function createCommandContext(overrides = {}) {
  return {
    cwd: overrides.cwd || process.cwd(),
    env: overrides.env || process.env,
    platform: overrides.platform || process.platform,
    fs: overrides.fs || fs,
    stdout: overrides.stdout || process.stdout,
    stderr: overrides.stderr || process.stderr,
    delegationRound3: overrides.delegationRound3 || null,
  };
}

function writeOut(context, text) {
  context.stdout.write(String(text));
}

function writeLine(context, text = "") {
  context.stdout.write(`${text}\n`);
}

module.exports = { createCommandContext, writeLine, writeOut };
