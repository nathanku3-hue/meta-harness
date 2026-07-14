"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  spawnTrackedNodeProcess,
  processExists,
} = require("../lib/execution-custody/agent-process");

const TREE_CHILD_LAUNCHER = path.resolve(
  __dirname,
  "fixtures/execution-custody/test-tree-child-launcher.js",
);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("process-tree timeout kills the launcher and its descendant", async () => {
  const outDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "custody-tree-")));
  try {
    const result = await spawnTrackedNodeProcess({
      nodeExecutablePath: process.execPath,
      scriptPath: TREE_CHILD_LAUNCHER,
      scriptArgs: [outDir],
      cwd: outDir,
      env: {
        PATH: process.env.PATH,
        PATHEXT: process.env.PATHEXT,
        SystemRoot: process.env.SystemRoot,
        SYSTEMROOT: process.env.SYSTEMROOT,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        TMPDIR: process.env.TMPDIR,
      },
      timeoutSeconds: 1,
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.reapOk, true);
    assert.equal(result.launcherAlive, false);
    await sleep(200);

    for (const fileName of ["parent-pid.txt", "spawned-child-pid.txt", "child-pid.txt"]) {
      const filePath = path.join(outDir, fileName);
      if (!fs.existsSync(filePath)) continue;
      const pid = Number(String(fs.readFileSync(filePath, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0) {
        assert.equal(processExists(pid), false, `${fileName} process must be dead`);
      }
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
