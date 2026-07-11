#!/usr/bin/env node
"use strict";

/**
 * D069 fixed validation program (private).
 * Integrity-bound via construction expectedScriptSha256 + expectedCommand.
 *
 * Always inspects cwd-relative src/fixture.txt (script owns the path).
 * Success: exit 0 when the marker line is present.
 * Failure: non-zero otherwise.
 * No no-arg success path.
 */

const fs = require("node:fs");
const path = require("node:path");

const RELATIVE_TARGET = "src/fixture.txt";
const MARKER = "D069_FIXTURE_WORKER_APPLIED=1";

function main() {
  const target = path.resolve(process.cwd(), RELATIVE_TARGET);
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    process.stderr.write(`D069_VALIDATION_TARGET_MISSING: ${err.message}\n`);
    return 1;
  }
  if (!st.isFile() || st.isSymbolicLink()) {
    process.stderr.write("D069_VALIDATION_TARGET_NOT_REGULAR\n");
    return 1;
  }

  const text = fs.readFileSync(target, "utf8");
  if (!text.includes(MARKER)) {
    process.stderr.write("D069_VALIDATION_MARKER_MISSING\n");
    return 1;
  }

  process.stdout.write("validation-ok\n");
  return 0;
}

process.exitCode = main();
