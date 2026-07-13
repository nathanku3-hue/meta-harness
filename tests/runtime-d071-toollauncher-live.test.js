"use strict";

/** D072 persistent live ToolLauncher proof. */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { exportPortableCustody } = require("../internal/d069/custody-export");
const { absNorm } = require("../internal/d069/support");
const {
  programPaths,
  D071_OBJECTIVE,
} = require("./helpers/runtime-fixture-repo");
const {
  createDetachedToolLauncherClone,
  TOOLLAUNCHER_BASE_REVISION,
  TOOLLAUNCHER_BASE_TREE,
} = require("./helpers/toollauncher-clone");
const { computeRunSpecDigest } = require("../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../lib/contracts/run-spec-approval");
const {
  detectLiveCodex,
  sha256Utf8,
  digestHex,
  git,
  runControllerProcess,
  runExportVerifier,
  buildConfig,
  buildCanaryConfig,
} = require("./helpers/runtime-d072-live-support");

function buildRequest(programs, implementationShort, approvedAt, authorizationId, attemptId) {
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId: `RUN-D072-TOOLLAUNCHER-${implementationShort}`,
    repository: {
      repositoryId: "toollauncher",
      objectFormat: "sha1",
      expectedBaseRevision: TOOLLAUNCHER_BASE_REVISION,
    },
    objective: D071_OBJECTIVE,
    scope: { allow: [programs.subjectRelativePath], deny: [] },
    validation: {
      commands: [{
        argv: programs.validationArgv.slice(),
        cwdRelative: ".",
        timeoutSeconds: 60,
        networkPolicy: "denied",
        environmentPolicy: { allow: programs.validationAllow.slice() },
      }],
    },
    changePolicy: "forbid-noop",
  };
  const runSpecDigest = computeRunSpecDigest(runSpec);
  return {
    runSpecDigest,
    request: {
      runSpecApproval: sealRunSpecApproval({
        schemaVersion: "run-spec-approval/v1",
        approvalId: `APR-D072-TOOLLAUNCHER-${implementationShort}`,
        approvedBy: "d072@meta-harness.local",
        approvedAt,
        runSpec,
        runSpecDigest,
      }),
      authorizationRequest: { authorizationId, attemptId },
    },
  };
}

function writeClosure(exportsRoot, closure) {
  fs.writeFileSync(
    path.join(exportsRoot, "d072-live-closure.json"),
    `${JSON.stringify(closure, null, 2)}\n`,
    "utf8",
  );
}

test("D072 live: persistent ToolLauncher custody, process restart, and portable verification", (t) => {
  const live = detectLiveCodex();
  if (!live.force) {
    t.skip("set D072_LIVE_TOOLLAUNCHER=1 to run persistent ToolLauncher custody proof");
    return;
  }
  if (!live.available) {
    assert.fail("D072_LIVE_TOOLLAUNCHER set but Codex identity paths are incomplete");
  }
  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  assert.ok(major >= 20, `Node >= 20 required; got ${process.version}`);

  const metaHarnessRoot = path.resolve(__dirname, "..");
  const implementationCommit = git(metaHarnessRoot, ["rev-parse", "HEAD"]);
  assert.equal(
    git(metaHarnessRoot, ["status", "--porcelain=v1", "--untracked-files=no"]),
    "",
    "D072 live proof requires a clean tracked tree at the exact implementation commit",
  );

  const implementationShort = implementationCommit.slice(0, 12);
  const authorizationId = `AUTH-D072-TOOLLAUNCHER-${implementationShort}`;
  const attemptId = `ATTEMPT-D072-TOOLLAUNCHER-${implementationShort}`;
  const authIdHash = sha256Utf8(authorizationId).slice(0, 12);
  const custodyRoot = absNorm(path.join(
    metaHarnessRoot,
    ".meta-harness",
    "local",
    "custody",
    `d072-toollauncher-${implementationShort}-${authIdHash}`,
  ));
  assert.equal(fs.existsSync(custodyRoot), false, "D072 live custody root is create-only");

  let clone;
  try {
    clone = createDetachedToolLauncherClone({ rootPath: custodyRoot, retain: true });
    assert.equal(clone.headRevision, TOOLLAUNCHER_BASE_REVISION);
    assert.equal(clone.tree, TOOLLAUNCHER_BASE_TREE);

    const stateRoot = absNorm(path.join(custodyRoot, "state"));
    const workspaceRoot = absNorm(path.join(custodyRoot, "workspaces"));
    const exportsRoot = absNorm(path.join(custodyRoot, "exports"));
    for (const directory of [stateRoot, workspaceRoot, exportsRoot]) {
      fs.mkdirSync(directory, { recursive: false });
    }

    const programs = programPaths();
    const nowMs = Date.now();
    const firstClock = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const laterClock = new Date(nowMs + 48 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const approvedAt = new Date(nowMs - 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const config = buildConfig({ clone, stateRoot, workspaceRoot, live, programs });
    const built = buildRequest(
      programs,
      implementationShort,
      approvedAt,
      authorizationId,
      attemptId,
    );

    const first = runControllerProcess(custodyRoot, "process-1", config, built.request, firstClock);
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.aoSpawnCount, 1);
    assert.match(first.authorizationReceiptDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.terminalManifestDigest, /^sha256:[a-f0-9]{64}$/);

    const second = runControllerProcess(
      custodyRoot,
      "process-2",
      buildCanaryConfig(config, custodyRoot),
      built.request,
      laterClock,
      120_000,
    );
    assert.equal(second.disposition, "REPLAY");
    assert.equal(second.aoSpawnCount, 0);
    for (const field of [
      "authorizationRequestDigest",
      "authorizationReceiptDigest",
      "runSpecDigest",
      "verifiedHeadRevision",
      "durableRef",
      "terminalManifestDigest",
    ]) {
      assert.equal(second[field], first[field], field);
    }

    const portable = exportPortableCustody({
      repositoryPath: clone.repositoryPath,
      stateRoot,
      exportsRoot,
      authReqHex: digestHex(first.authorizationRequestDigest),
      baseRevision: TOOLLAUNCHER_BASE_REVISION,
      verifiedHeadRevision: first.verifiedHeadRevision,
      durableRef: first.durableRef,
      terminalManifestDigest: first.terminalManifestDigest,
      gitExecutablePath: clone.gitExecutablePath,
      sensitiveValues: [os.homedir(), process.env.USERPROFILE, process.env.APPDATA, custodyRoot],
    });
    const independent = runExportVerifier(
      custodyRoot,
      clone,
      portable,
      { ...first, baseRevision: TOOLLAUNCHER_BASE_REVISION },
      programs,
    );
    assert.equal(independent.ok, true);
    assert.equal(independent.parent, TOOLLAUNCHER_BASE_REVISION);
    assert.equal(independent.validation, "PASS");

    writeClosure(exportsRoot, {
      schemaVersion: "d072-live-closure/v1",
      metaHarnessImplementationCommit: implementationCommit,
      retainedLocalCustodyRoot: custodyRoot,
      retainedLocalCustodyIsIgnoredAndNotPortable: true,
      childRepositoryId: "toollauncher",
      childBaseRevision: TOOLLAUNCHER_BASE_REVISION,
      childBaseTree: TOOLLAUNCHER_BASE_TREE,
      allowedPath: programs.subjectRelativePath,
      objectiveDigest: `sha256:${sha256Utf8(D071_OBJECTIVE)}`,
      runSpecDigest: built.runSpecDigest,
      authorizationRequestDigest: first.authorizationRequestDigest,
      authorizationReceiptDigest: first.authorizationReceiptDigest,
      terminalManifestDigest: first.terminalManifestDigest,
      verifiedChildHeadRevision: first.verifiedHeadRevision,
      durableRef: first.durableRef,
      verifiedAoSpawnCount: first.aoSpawnCount,
      replayAoSpawnCount: second.aoSpawnCount,
      replayDisposition: second.disposition,
      portableExportManifestDigest: portable.exportManifestDigest,
      independentVerification: independent,
      codexVersion: live.version,
      at: new Date().toISOString(),
    });

    assert.ok(fs.existsSync(clone.repositoryPath));
    assert.ok(fs.existsSync(stateRoot));
    assert.ok(fs.existsSync(exportsRoot));
  } finally {
    if (clone) {
      try {
        spawnSync(clone.gitExecutablePath, ["worktree", "prune"], {
          cwd: clone.repositoryPath,
          encoding: "utf8",
          windowsHide: true,
        });
      } catch { /* retain custody; prune only */ }
      clone.cleanup();
    }
  }
});
