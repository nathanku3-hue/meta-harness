#!/usr/bin/env node
"use strict";

/**
 * D069 fixed fixture worker (private).
 * Profile: d069-fixed-fixture-v1
 *
 * No caller-selected paths or bodies. Controller owns cwd (detached worktree).
 * Always rewrites cwd-relative src/fixture.txt with the fixed marker body.
 * No network. No git. No PR.
 */

const fs = require("node:fs");
const path = require("node:path");

const RELATIVE_TARGET = "src/fixture.txt";
const BODY = "fixture-initial\nD069_FIXTURE_WORKER_APPLIED=1\n";

function main() {
  const target = path.resolve(process.cwd(), RELATIVE_TARGET);
  let st;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    process.stderr.write(`D069_WORKER_TARGET_MISSING: target missing: ${err.message}\n`);
    return 2;
  }
  if (!st.isFile() || st.isSymbolicLink()) {
    process.stderr.write("D069_WORKER_TARGET_NOT_REGULAR: target must be a regular non-symlink file\n");
    return 2;
  }

  fs.writeFileSync(target, BODY, { encoding: "utf8", flag: "w" });
  process.stdout.write("ok\n");
  return 0;
}

process.exitCode = main();
