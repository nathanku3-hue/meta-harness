"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { run, runRaw, tempDir } = require("./helpers/cli");

test("ready blocks a material canonical truth contradiction", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Truth readiness target"]);
  const statusPath = path.join(cwd, ".meta-harness", "status.md");
  const stale = fs.readFileSync(statusPath, "utf8").replace(
    "Translate the goal into a bounded worker task.",
    "Resume D076 release mechanics.",
  );
  fs.writeFileSync(statusPath, stale, "utf8");

  const res = runRaw(cwd, ["ready", "--target", cwd, "--quick", "--read-only", "--json"]);
  assert.equal(res.status, 1);
  const data = JSON.parse(res.stdout);
  assert.equal(data.ok, false);
  const truth = data.checks.find((check) => check.id === "MH_TRUTH_001");
  assert.equal(truth.status, "fail");
  assert.match(truth.reason, /status projection does not exactly match canonical truth/i);
  assert.equal(fs.readFileSync(statusPath, "utf8"), stale);
});
