"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { errorCode, run, runRaw, tempDir } = require("./helpers/cli");

test("quality gate initializes managed repo contract and blocks a new monolith", () => {
  const cwd = tempDir();

  run(cwd, ["quality", "init"]);

  const harness = path.join(cwd, ".meta-harness");
  assert.equal(fs.existsSync(path.join(harness, "clean-code-contract.json")), true);
  assert.equal(fs.existsSync(path.join(harness, "baseline", "quality-baseline.json")), true);
  assert.match(run(cwd, ["quality", "init"]), /Kept \.meta-harness\/baseline\/quality-baseline\.json/);

  const clean = runRaw(cwd, ["quality", "check"]);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /Quality gate: PASS/);

  assert.match(run(cwd, ["quality", "explain"]), /ratchet/);
  const refusedBaseline = runRaw(cwd, ["quality", "baseline"]);
  assert.notEqual(refusedBaseline.status, 0);
  assert.match(refusedBaseline.stderr, /requires --force after audit/);
  run(cwd, ["quality", "baseline", "--force"]);

  fs.writeFileSync(
    path.join(cwd, "new-monolith.js"),
    Array.from({ length: 501 }, (_, index) => `const line${index} = ${index};`).join("\n"),
    "utf8",
  );

  const blocked = runRaw(cwd, ["quality", "check"]);
  assert.notEqual(blocked.status, 0);
  assert.equal(errorCode(blocked), "MH_QUALITY_GATE");
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /new overbudget file/);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /new-monolith\.js/);
});
