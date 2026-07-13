#!/usr/bin/env node
"use strict";

/**
 * Offline fixture: parent launches a long-lived child then hangs.
 * Used to prove process-tree termination reaps descendants.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const outDir = process.argv[2];
if (!outDir) {
  process.stderr.write("usage: test-tree-child-launcher.js <outDir>\n");
  process.exitCode = 2;
  return;
}
fs.mkdirSync(outDir, { recursive: true });

const child = spawn(
  process.execPath,
  ["-e", "const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,String(process.pid));setInterval(()=>{},500);", path.join(outDir, "child-pid.txt")],
  {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    detached: false,
  },
);

fs.writeFileSync(path.join(outDir, "parent-pid.txt"), `${process.pid}\n`, "utf8");
fs.writeFileSync(path.join(outDir, "spawned-child-pid.txt"), `${child.pid}\n`, "utf8");

// Hang until killed
setInterval(() => {}, 500);
