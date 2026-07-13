"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  createFixtureLayout,
  buildExample,
  buildRunRequest,
  buildControllerConfig,
  buildUnusableReplayConfig,
  createExecutionCustodyController,
  FIXTURE_ALLOWED_PATH,
  FROZEN_NOW,
} = require("./helpers/execution-custody-fixture");
const { exportPortableCustody } = require("../internal/execution-custody/custody-export");
const { digestHex } = require("../internal/execution-custody/support");
const { runGit } = require("./helpers/execution-custody-git");

function runChild(scriptPath, inputPath, timeout = 180_000) {
  const result = spawnSync(process.execPath, [scriptPath, inputPath], {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(scriptPath)} failed ${result.status}: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return JSON.parse(String(result.stdout || "").trim());
}

test("host-neutral custody reaches VERIFIED, fresh-process REPLAY, and portable verification", async () => {
  const layout = createFixtureLayout({ label: "custody-e2e" });
  let controller;
  try {
    const request = buildRunRequest(layout);
    controller = createExecutionCustodyController(buildControllerConfig(layout));
    const verified = await controller.run(request);

    assert.equal(verified.ok, true);
    assert.equal(verified.disposition, "VERIFIED");
    assert.equal(verified.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(verified.agentSpawnCount, 1);
    assert.equal(controller.getAgentSpawnCount(), 1);
    assert.match(verified.durableRef, /^refs\/meta-harness\/attempts\/[a-f0-9]{64}$/);

    const primaryHead = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    const primaryStatus = String(
      runGit(layout.gitExecutablePath, layout.repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
    ).trim();
    assert.equal(primaryHead, layout.headRevision);
    assert.equal(primaryStatus, "");

    await controller.close();
    controller = null;

    const replayInputPath = path.join(layout.root, "replay-input.json");
    fs.writeFileSync(replayInputPath, `${JSON.stringify({
      config: buildUnusableReplayConfig(layout),
      request,
      clock: FROZEN_NOW,
    }, null, 2)}\n`, "utf8");
    const replay = runChild(
      path.resolve(__dirname, "helpers/execution-custody-process-child.js"),
      replayInputPath,
    );
    assert.equal(replay.result.ok, true);
    assert.equal(replay.result.disposition, "REPLAY");
    assert.equal(replay.result.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(replay.result.agentSpawnCount, 0);
    assert.equal(replay.agentSpawnCount, 0);
    assert.equal(replay.result.verifiedHeadRevision, verified.verifiedHeadRevision);
    assert.equal(replay.result.terminalManifestDigest, verified.terminalManifestDigest);

    const authReqHex = digestHex(verified.authorizationRequestDigest);
    const portable = exportPortableCustody({
      repositoryPath: layout.repositoryPath,
      stateRoot: layout.stateRoot,
      exportsRoot: layout.exportsRoot,
      authReqHex,
      baseRevision: layout.headRevision,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      terminalManifestDigest: verified.terminalManifestDigest,
      gitExecutablePath: layout.gitExecutablePath,
      sensitiveValues: [layout.root],
    });
    assert.ok(fs.existsSync(portable.exportDir));
    assert.equal(portable.manifest.privacyReview.leakageScan.ok, true);

    const verifierRepositoryPath = path.join(layout.root, "portable-verifier");
    const verifierInputPath = path.join(layout.root, "verifier-input.json");
    const example = buildExample(layout);
    fs.writeFileSync(verifierInputPath, `${JSON.stringify({
      exportDir: portable.exportDir,
      baseRevision: layout.headRevision,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      allowedPath: FIXTURE_ALLOWED_PATH,
      gitExecutablePath: layout.gitExecutablePath,
      sourceRepositoryPath: layout.repositoryPath,
      verifierRepositoryPath,
      validationExecutablePath: process.execPath,
      validationCommands: example.validationCapsule.commands,
      sensitiveValues: [layout.root],
    }, null, 2)}\n`, "utf8");
    const independent = runChild(
      path.resolve(__dirname, "helpers/execution-custody-export-verifier.js"),
      verifierInputPath,
    );
    assert.equal(independent.ok, true);
    assert.equal(independent.resultCommit, verified.verifiedHeadRevision);
    assert.equal(independent.parent, layout.headRevision);
    assert.deepEqual(independent.changed, [FIXTURE_ALLOWED_PATH]);
    assert.equal(independent.validation.length, 2);
    assert.equal(independent.leakage, "PASS");
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* best effort */ }
    }
    layout.cleanup();
  }
});
