#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const testsRoot = path.join(root, "tests");

function collectTests(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTests(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      out.push(fullPath);
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

const result = spawnSync(process.execPath, ["--test", ...collectTests(testsRoot)], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

process.exitCode = result.status === null ? 1 : result.status;
