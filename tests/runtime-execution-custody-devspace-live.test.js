"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  detectLiveTools,
  buildValidationHostEnv,
  loadExample,
  clonePinnedChild,
  runLiveCustodyProof,
} = require("./helpers/execution-custody-live");
const { runGit } = require("./helpers/execution-custody-git");

const EXAMPLE_PATH = path.resolve(
  __dirname,
  "../.agents/skills/bounded-repository-change/examples/devspace-dev-server.json",
);
const tools = detectLiveTools({
  forceEnvNames: ["CUSTODY_LIVE_DEVSPACE"],
  sourceEnvName: "CUSTODY_DEVSPACE_SOURCE",
  defaultSourcePath: "E:\\Code\\devspace\\devspace-src",
  validationExecutableEnvName: "CUSTODY_NODE_VALIDATION_PATH",
  defaultValidationExecutablePath: process.execPath,
});

function buildNodeValidationBinding(example, liveTools) {
  return {
    executablePath: liveTools.validationExecutablePath,
    hostEnv: buildValidationHostEnv(example),
    sensitiveValues: [],
  };
}

test("DevSpace pinned clone contains only the exact shallow authority commit", {
  skip: !fs.existsSync(tools.sourcePath),
}, () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-devspace-clone-"));
  try {
    const example = loadExample(EXAMPLE_PATH);
    const clone = clonePinnedChild({
      example,
      sourcePath: tools.sourcePath,
      rootPath: path.join(temporaryParent, "custody"),
    });
    const remotes = String(runGit(clone.gitExecutablePath, clone.repositoryPath, ["remote"]).stdout).trim();
    const revisionCount = String(
      runGit(clone.gitExecutablePath, clone.repositoryPath, ["rev-list", "--count", "HEAD"]).stdout,
    ).trim();
    const shallowBoundary = fs.readFileSync(
      path.join(clone.repositoryPath, ".git", "shallow"),
      "utf8",
    ).trim();

    assert.equal(remotes, "");
    assert.equal(revisionCount, "1");
    assert.equal(shallowBoundary, example.repository.expectedBaseRevision);
    assert.equal(clone.headRevision, example.repository.expectedBaseRevision);
    assert.equal(clone.tree, example.repository.expectedBaseTree);
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test("live DevSpace custody reaches VERIFIED, expired fresh-process REPLAY, and portable Node verification", {
  skip: !tools.force,
}, () => {
  assert.equal(tools.available, true, `live tools unavailable: ${JSON.stringify(tools)}`);
  const closure = runLiveCustodyProof({
    examplePath: EXAMPLE_PATH,
    tools,
    buildValidationBinding: buildNodeValidationBinding,
    closureFileName: "devspace-live-closure.json",
    approvedBy: "devspace-live@meta-harness.local",
  });
  assert.equal(closure.child.repositoryId, "devspace");
  assert.equal(closure.child.allowedPath, "scripts/dev-server.mjs");
  assert.equal(closure.process1.aoSpawnCount, 1);
  assert.equal(closure.process2.laterThanAuthorizationExpiry, true);
  assert.equal(closure.process2.aoSpawnCount, 0);
  assert.equal(closure.portable.independentVerification.leakage, "PASS");
});
