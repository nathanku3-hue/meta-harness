"use strict";

/**
 * D070-A1 process-tree timeout custody (offline fixture process with child).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  spawnTrackedNodeProcess,
  processExists,
} = require("../internal/d069/ao-process");

const TREE_CHILD_LAUNCHER = path.resolve(
  __dirname,
  "../internal/d069/programs/test-tree-child-launcher.js",
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("process-tree timeout kills parent and descendant", async () => {
  const outDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "d070-tree-")));
  try {
    const result = await spawnTrackedNodeProcess({
      nodeExecutablePath: process.execPath,
      scriptPath: TREE_CHILD_LAUNCHER,
      scriptArgs: [outDir],
      cwd: outDir,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
      timeoutSeconds: 1,
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.reapOk, true);
    assert.equal(result.launcherAlive, false);

    // Wait briefly for OS to reap
    await sleep(200);

    const parentPidPath = path.join(outDir, "parent-pid.txt");
    const childPidPath = path.join(outDir, "spawned-child-pid.txt");
    const childSelfPath = path.join(outDir, "child-pid.txt");
    assert.ok(fs.existsSync(parentPidPath));
    assert.ok(fs.existsSync(childPidPath));

    const parentPid = Number(String(fs.readFileSync(parentPidPath, "utf8")).trim());
    const childPid = Number(String(fs.readFileSync(childPidPath, "utf8")).trim());
    assert.ok(Number.isInteger(parentPid) && parentPid > 0);
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    assert.equal(processExists(parentPid), false, "parent must be dead");
    assert.equal(processExists(childPid), false, "spawned child must be dead");

    if (fs.existsSync(childSelfPath)) {
      const selfPid = Number(String(fs.readFileSync(childSelfPath, "utf8")).trim());
      if (Number.isInteger(selfPid) && selfPid > 0) {
        assert.equal(processExists(selfPid), false, "child self pid must be dead");
      }
    }
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // ignore
    }
  }
});
