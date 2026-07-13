"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { exportPortableCustody } = require("../internal/execution-custody/custody-export");
const { resolveGit, runGit } = require("./helpers/execution-custody-git");
const {
  detectLiveTools,
  loadExample,
  clonePinnedChild,
  buildRequest,
  buildConfig,
  buildCanaryConfig,
  runControllerProcess,
  runIndependentVerifier,
  sha256Utf8,
  digestHex,
} = require("./helpers/execution-custody-live");

const tools = detectLiveTools();

test("live Fluxara custody reaches VERIFIED, fresh-process REPLAY, and portable verification", {
  skip: !tools.force,
}, () => {
  assert.equal(process.platform, "win32", "D073 live gate requires native Windows execution");
  assert.equal(tools.available, true, `live tools unavailable: ${JSON.stringify(tools)}`);

  const metaRoot = path.resolve(__dirname, "..");
  const gitExecutablePath = resolveGit();
  const candidateCommit = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const candidateTree = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  const metaStatus = String(
    runGit(gitExecutablePath, metaRoot, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  assert.equal(metaStatus, "", "live proof must bind a clean immutable Meta-Harness candidate");

  const example = loadExample();
  const candidateShort = candidateCommit.slice(0, 12);
  const clockValue = new Date().toISOString();
  const request = buildRequest(example, candidateShort, clockValue);
  const authorizationId = request.authorizationRequest.authorizationId;
  const custodyParent = path.resolve(metaRoot, ".meta-harness", "local", "custody");
  fs.mkdirSync(custodyParent, { recursive: true });
  const custodyRoot = path.join(
    custodyParent,
    `d073-fluxara-${candidateShort}-${sha256Utf8(authorizationId).slice(0, 12)}`,
  );
  assert.equal(fs.existsSync(custodyRoot), false, `create-only custody root must be absent: ${custodyRoot}`);

  const clone = clonePinnedChild({
    example,
    sourcePath: tools.sourcePath,
    rootPath: custodyRoot,
  });
  const config = buildConfig({ example, clone, tools });

  const process1 = runControllerProcess({
    clone,
    label: "process-1",
    config,
    request,
    clockValue,
  });
  const verified = process1.result;
  assert.equal(verified.ok, true);
  assert.equal(verified.disposition, "VERIFIED");
  assert.equal(verified.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(verified.agentSpawnCount, 1);
  assert.equal(process1.agentSpawnCount, 1);

  const process2 = runControllerProcess({
    clone,
    label: "process-2",
    config: buildCanaryConfig(config, clone.root),
    request,
    clockValue,
  });
  const replay = process2.result;
  assert.equal(replay.ok, true);
  assert.equal(replay.disposition, "REPLAY");
  assert.equal(replay.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(replay.agentSpawnCount, 0);
  assert.equal(process2.agentSpawnCount, 0);
  assert.equal(replay.verifiedHeadRevision, verified.verifiedHeadRevision);
  assert.equal(replay.terminalManifestDigest, verified.terminalManifestDigest);

  const authReqHex = digestHex(verified.authorizationRequestDigest);
  const processMeta = JSON.parse(fs.readFileSync(
    path.join(clone.stateRoot, "attempts", authReqHex, "evidence", "ao-process-meta.json"),
    "utf8",
  ));
  assert.equal(processMeta.spawnOrdinal, 1);
  assert.equal(processMeta.exitCode, 0);
  assert.equal(processMeta.timedOut, false);
  assert.equal(processMeta.capBreached, null);

  const portable = exportPortableCustody({
    repositoryPath: clone.repositoryPath,
    stateRoot: clone.stateRoot,
    exportsRoot: clone.exportsRoot,
    authReqHex,
    baseRevision: example.repository.expectedBaseRevision,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    terminalManifestDigest: verified.terminalManifestDigest,
    gitExecutablePath: clone.gitExecutablePath,
    sensitiveValues: [
      clone.root,
      tools.sourcePath,
      tools.nodePath,
      tools.launcherPath,
      tools.nativePath,
      tools.codexHome,
      tools.pythonPath,
    ],
  });
  assert.equal(portable.manifest.privacyReview.leakageScan.ok, true);

  const independent = runIndependentVerifier({
    clone,
    portable,
    result: verified,
    example,
    tools,
  });
  assert.equal(independent.ok, true);
  assert.equal(independent.resultCommit, verified.verifiedHeadRevision);
  assert.equal(independent.parent, example.repository.expectedBaseRevision);
  assert.deepEqual(independent.changed, [example.allowedPath]);
  assert.equal(independent.validation.length, example.validationCapsule.commands.length);
  assert.equal(independent.leakage, "PASS");

  const childStatus = String(
    runGit(clone.gitExecutablePath, clone.repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  const childHead = String(
    runGit(clone.gitExecutablePath, clone.repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  assert.equal(childStatus, "");
  assert.equal(childHead, example.repository.expectedBaseRevision);

  const closure = {
    schemaVersion: "d073-live-custody-closure/v1",
    candidate: {
      commit: candidateCommit,
      tree: candidateTree,
      trackedWorktreeClean: true,
    },
    child: {
      repositoryId: example.repository.repositoryId,
      baseRevision: example.repository.expectedBaseRevision,
      baseTree: example.repository.expectedBaseTree,
      allowedPath: example.allowedPath,
      retainedCustodyRoot: clone.root,
    },
    process1: {
      disposition: verified.disposition,
      verdict: verified.verdict,
      aoSpawnCount: verified.agentSpawnCount,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      terminalManifestDigest: verified.terminalManifestDigest,
    },
    process2: {
      disposition: replay.disposition,
      verdict: replay.verdict,
      aoSpawnCount: replay.agentSpawnCount,
      executionToolPathsUsable: false,
    },
    portable: {
      exportDir: portable.exportDir,
      exportManifestDigest: portable.exportManifestDigest,
      leakageScan: portable.manifest.privacyReview.leakageScan,
      independentVerification: independent,
    },
  };
  fs.writeFileSync(
    path.join(clone.exportsRoot, "d073-live-closure.json"),
    `${JSON.stringify(closure, null, 2)}\n`,
    "utf8",
  );
});
