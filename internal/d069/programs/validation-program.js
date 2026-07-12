#!/usr/bin/env node
"use strict";

/**
 * D070-A1 fixed validation program (private).
 * Integrity-bound via construction expectedScriptSha256 + expectedCommand.
 *
 * Always inspects cwd-relative src/fixture.txt (script owns the path).
 * Success: exit 0 only when file bytes are exactly the A1 marker.
 * Failure: non-zero otherwise.
 * No no-arg success path.
 *
 * Content is NOT sealed by RunSpec; exact-byte check lives here.
 */

const fs = require("node:fs");
const path = require("node:path");

const RELATIVE_TARGET = "src/fixture.txt";
const EXACT_CONTENT = "d070-ao-verified-marker\n";

function main() {
  const target = path.resolve(process.cwd(), RELATIVE_TARGET);
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    process.stderr.write(`D070_VALIDATION_TARGET_MISSING: ${err.message}\n`);
    return 1;
  }
  if (!st.isFile() || st.isSymbolicLink()) {
    process.stderr.write("D070_VALIDATION_TARGET_NOT_REGULAR\n");
    return 1;
  }

  const text = fs.readFileSync(target, "utf8");
  if (text !== EXACT_CONTENT) {
    process.stderr.write("D070_VALIDATION_EXACT_MISMATCH\n");
    return 1;
  }

  process.stdout.write("validation-ok\n");
  return 0;
}

process.exitCode = main();
