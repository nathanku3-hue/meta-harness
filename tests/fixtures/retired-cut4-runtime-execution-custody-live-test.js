"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { absNorm } = require("../lib/execution-custody/support");
const {
  detectLiveTools,
  snapshotHostEnv,
  validationEnvironmentKeys,
  runLiveCustodyProof,
} = require("./helpers/execution-custody-live");

const EXAMPLE_PATH = path.resolve(
  __dirname,
  "../.agents/skills/bounded-repository-change/examples/fluxara-demo-output.json",
);
const DEFAULT_PYTHON_PATH = fs.existsSync("E:\\Python\\bin\\python.exe")
  ? "E:\\Python\\bin\\python.exe"
  : "python";
const tools = detectLiveTools({
  forceEnvNames: ["CUSTODY_LIVE_FLUXARA"],
  sourceEnvName: "CUSTODY_FLUXARA_SOURCE",
  defaultSourcePath: "E:\\code\\Fluxara",
  validationExecutableEnvName: "CUSTODY_PYTHON_PATH",
  defaultValidationExecutablePath: DEFAULT_PYTHON_PATH,
});

function buildPythonValidationBinding(example, liveTools) {
  const hostEnv = snapshotHostEnv(validationEnvironmentKeys(example));
  const userBaseProbe = spawnSync(
    liveTools.validationExecutablePath,
    ["-c", "import site; print(site.getuserbase())"],
    { encoding: "utf8", windowsHide: true, timeout: 15_000, env: process.env },
  );
  if (userBaseProbe.error || userBaseProbe.status !== 0) {
    throw new Error(
      `python user-base probe failed: ${String(userBaseProbe.stderr || userBaseProbe.stdout || "").trim()}`,
    );
  }
  const userBase = absNorm(String(userBaseProbe.stdout || "").trim());
  if (!fs.existsSync(userBase) || !fs.statSync(userBase).isDirectory()) {
    throw new Error(`python user-base probe returned invalid directory: ${userBase}`);
  }
  hostEnv.PYTHONUSERBASE = userBase;
  delete hostEnv.PYTHONPATH;

  const importProbe = spawnSync(
    liveTools.validationExecutablePath,
    ["-c", "import numpy, pandas, pygments, pytest, scipy, uuid; assert hasattr(uuid, 'uuid4')"],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, env: hostEnv },
  );
  if (importProbe.error || importProbe.status !== 0) {
    throw new Error(
      `python validation environment probe failed: ${String(importProbe.stderr || importProbe.stdout || "").trim()}`,
    );
  }
  return {
    executablePath: liveTools.validationExecutablePath,
    hostEnv,
    sensitiveValues: [userBase],
  };
}

test("live Fluxara custody reaches VERIFIED, expired fresh-process REPLAY, and portable verification", {
  skip: !tools.force,
}, () => {
  assert.equal(tools.available, true, `live tools unavailable: ${JSON.stringify(tools)}`);
  const closure = runLiveCustodyProof({
    examplePath: EXAMPLE_PATH,
    tools,
    buildValidationBinding: buildPythonValidationBinding,
    closureFileName: "fluxara-live-closure.json",
    approvedBy: "fluxara-live@meta-harness.local",
  });
  assert.equal(closure.child.repositoryId, "fluxara");
  assert.equal(closure.process2.laterThanAuthorizationExpiry, true);
});
