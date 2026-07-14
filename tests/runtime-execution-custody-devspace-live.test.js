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
const { prepareVerifierBase } = require("./helpers/execution-custody-export-verifier");
const { resolveGit, runGit } = require("./helpers/execution-custody-git");

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

test("portable verifier anchors a shallow prerequisite before thin-bundle verification", () => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-shallow-bundle-"));
  try {
    const gitExecutablePath = resolveGit();
    const originPath = path.join(temporaryParent, "origin");
    const shallowSourcePath = path.join(temporaryParent, "shallow-source");
    const verifierRepositoryPath = path.join(temporaryParent, "verifier");
    const bundlePath = path.join(temporaryParent, "result.bundle");
    fs.mkdirSync(originPath);
    runGit(gitExecutablePath, originPath, ["init"]);
    runGit(gitExecutablePath, originPath, ["config", "core.autocrlf", "false"]);
    fs.writeFileSync(path.join(originPath, "result.txt"), "base\n", "utf8");
    runGit(gitExecutablePath, originPath, ["add", "result.txt"]);
    runGit(gitExecutablePath, originPath, ["commit", "-m", "base"]);
    const baseRevision = String(
      runGit(gitExecutablePath, originPath, ["rev-parse", "HEAD"]).stdout,
    ).trim();

    runGit(gitExecutablePath, temporaryParent, [
      "clone", "--no-local", "--depth=1", originPath, shallowSourcePath,
    ]);
    assert.ok(fs.existsSync(path.join(shallowSourcePath, ".git", "shallow")));
    runGit(gitExecutablePath, shallowSourcePath, ["config", "core.autocrlf", "false"]);
    fs.writeFileSync(path.join(shallowSourcePath, "result.txt"), "verified\n", "utf8");
    runGit(gitExecutablePath, shallowSourcePath, ["add", "result.txt"]);
    runGit(gitExecutablePath, shallowSourcePath, ["commit", "-m", "verified result"]);
    const resultRevision = String(
      runGit(gitExecutablePath, shallowSourcePath, ["rev-parse", "HEAD"]).stdout,
    ).trim();
    const durableRef = "refs/meta-harness/attempts/test-shallow-bundle";
    runGit(gitExecutablePath, shallowSourcePath, ["update-ref", durableRef, resultRevision]);
    runGit(gitExecutablePath, shallowSourcePath, [
      "bundle", "create", bundlePath, durableRef, `^${baseRevision}`,
    ]);

    prepareVerifierBase({
      gitExecutablePath,
      sourceRepositoryPath: shallowSourcePath,
      verifierRepositoryPath,
      baseRevision,
    });
    const verify = runGit(gitExecutablePath, verifierRepositoryPath, [
      "bundle", "verify", bundlePath,
    ]);
    const verifyText = `${String(verify.stdout || "")}\n${String(verify.stderr || "")}`;
    assert.match(verifyText, new RegExp(baseRevision));
    assert.equal(
      String(runGit(gitExecutablePath, verifierRepositoryPath, [
        "rev-parse", "refs/verify/base",
      ]).stdout).trim(),
      baseRevision,
    );
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
