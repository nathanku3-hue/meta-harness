"use strict";

/** D072 thin-bundle portable export and independent verifier process. */

const {
  windowsRuntimeTest: test,
} = require("./helpers/windows-runtime-test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  createLocalWalkingSliceController,
} = require("../internal/d069/local-controller");
const { exportPortableCustody } = require("../internal/d069/custody-export");
const {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  programPaths,
  absNorm,
} = require("./helpers/runtime-fixture-repo");

function digestHex(digest) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return digest.slice("sha256:".length);
}

test("D072 portable export is thin, privacy-safe, and independently verified", async () => {
  const layout = createRuntimeFixtureLayout({ label: "d072export" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-EXPORT",
    attemptId: "ATTEMPT-D072-EXPORT",
  });
  let controller;
  try {
    controller = createLocalWalkingSliceController(buildControllerConfig(layout));
    const verified = await controller.run(request);
    assert.equal(verified.disposition, "VERIFIED");
    const authHex = digestHex(verified.authorizationRequestDigest);
    const exportsRoot = absNorm(path.join(layout.root, "exports"));
    const exportOptions = {
      repositoryPath: layout.repositoryPath,
      stateRoot: layout.stateRoot,
      exportsRoot,
      authReqHex: authHex,
      baseRevision: layout.headRevision,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      terminalManifestDigest: verified.terminalManifestDigest,
      gitExecutablePath: layout.gitExecutablePath,
      sensitiveValues: [os.homedir(), process.env.USERPROFILE, process.env.APPDATA],
    };
    const portable = exportPortableCustody(exportOptions);

    assert.equal(portable.manifest.thinBundle.containsBaseObject, false);
    assert.equal(portable.manifest.thinBundle.prerequisiteBaseRevision, layout.headRevision);
    assert.equal(portable.manifest.localCustody.exactLocalEvidenceRetainedSeparately, true);
    assert.equal(portable.manifest.privacyReview.leakageScan.findings.length, 0);
    assert.ok(fs.existsSync(portable.bundlePath));
    const portableManifestPath = path.join(portable.exportDir, "custody-export-manifest.json");
    assert.ok(fs.existsSync(portableManifestPath));
    const portableManifestBytes = fs.readFileSync(portableManifestPath);
    assert.throws(
      () => exportPortableCustody(exportOptions),
      (err) => err && err.code === "D072_EXPORT_EXISTS",
    );
    assert.deepEqual(fs.readFileSync(portableManifestPath), portableManifestBytes);
    assert.equal(
      portable.manifest.sourceObjectHashes.some(
        (entry) => entry.exactBytesIncluded === false && entry.independentlyRecomputable === false,
      ),
      true,
    );

    const verifierRepositoryPath = absNorm(path.join(layout.root, "independent-verifier"));
    const inputPath = path.join(layout.root, "export-verifier-input.json");
    const programs = programPaths();
    const input = {
      gitExecutablePath: layout.gitExecutablePath,
      sourceRepositoryPath: layout.repositoryPath,
      verifierRepositoryPath,
      exportDir: portable.exportDir,
      baseRevision: layout.headRevision,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      allowedPath: layout.fixtureRelativeFile,
      validationArgv: programs.validationArgv,
    };
    fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    const helper = path.join(__dirname, "helpers", "runtime-d072-export-verifier.js");
    const child = spawnSync(process.execPath, [helper, inputPath], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
      env: { ...process.env },
    });
    assert.equal(child.error, undefined, child.error && child.error.message);
    assert.equal(child.status, 0, String(child.stderr || child.stdout || "").trim());
    const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    const result = JSON.parse(lines[lines.length - 1]);
    assert.equal(result.ok, true);
    assert.equal(result.parent, layout.headRevision);
    assert.equal(result.resultCommit, verified.verifiedHeadRevision);
    assert.deepEqual(result.changed, [layout.fixtureRelativeFile]);
    assert.equal(result.validation, "PASS");
    assert.equal(result.exportManifestDigest, portable.exportManifestDigest);
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
});
