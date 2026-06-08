"use strict";

const fs = require("node:fs");

function createCommandContext(overrides = {}) {
  return {
    cwd: overrides.cwd || process.cwd(),
    env: overrides.env || process.env,
    fs: overrides.fs || fs,
    stdout: overrides.stdout || process.stdout,
    stderr: overrides.stderr || process.stderr,
  };
}

function writeOut(context, text) {
  context.stdout.write(String(text));
}

function writeLine(context, text = "") {
  context.stdout.write(`${text}\n`);
}

module.exports = { createCommandContext, writeLine, writeOut };
