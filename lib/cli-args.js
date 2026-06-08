"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UsageError } = require("./errors");

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

function optionValue(value, fallback = undefined) {
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

function optionValues(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function fail(message, code = 2) {
  throw new UsageError(message, { exitCode: code });
}

function requireTargetRoot(options, context = {}) {
  const value = options.target;
  if (Array.isArray(value)) {
    fail("--target must be provided once");
  }
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    fail("--target requires an existing directory");
  }

  const root = context.cwd || process.cwd();
  const fsApi = context.fs || fs;
  const targetRoot = path.resolve(root, String(value));
  let stat;
  try {
    stat = fsApi.lstatSync(targetRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      fail(`--target must be an existing directory: ${value}`);
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`--target must be an existing directory: ${value}`);
  }
  return targetRoot;
}

module.exports = {
  addOption,
  fail,
  optionValue,
  optionValues,
  parseArgs,
  requireTargetRoot,
};
