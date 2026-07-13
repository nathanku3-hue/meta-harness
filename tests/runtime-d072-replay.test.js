"use strict";

/** D072 graceful fresh-process custody replay: stored receipt before execution-tool binding. */

const {
  windowsRuntimeTest: test,
} = require("./helpers/windows-runtime-test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  createLocalWalkingSliceController,
} = require("../internal/d069/local-controller");
const { canonicalReceiptPath } = require("../internal/d069/custody-replay");
const {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  absNorm,
} = require("./helpers/runtime-fixture-repo");

function digestHex(digest) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return digest.slice("sha256:".length);
}

function unusableReplayConfig(layout) {
  const config = buildControllerConfig(layout, {
    clock: () => "2026-07-14T12:00:00.000Z",
  });
  const missing = absNorm(path.join(layout.root, "execution-tools-must-not-be-read"));
  config.codexProgram = {
    ...config.codexProgram,
    nodeExecutablePath: absNorm(path.join(missing, "node.exe")),
    launcherScriptPath: absNorm(path.join(missing, "codex.js")),
    nativeExecutablePath: absNorm(path.join(missing, "codex.exe")),
    codexHome: absNorm(path.join(missing, "codex-home")),
    expectedLauncherSha256: "0".repeat(64),
    expectedNativeSha256: "1".repeat(64),
  };
  config.validationProgram = {
    ...config.validationProgram,
    executablePath: absNorm(path.join(missing, "powershell.exe")),
    scriptPath: absNorm(path.join(missing, "validator.ps1")),
    expectedExecutableSha256: "2".repeat(64),
    expectedScriptSha256: "3".repeat(64),
  };
  return config;
}

function directoryEntriesOrEmpty(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

function snapshotTree(root) {
  const rows = [];
  function visit(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        rows.push({ path: childRelative.replace(/\\/g, "/"), type: "directory" });
        visit(child, childRelative);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(child);
        rows.push({
          path: childRelative.replace(/\\/g, "/"),
          type: "file",
          bytes: bytes.length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  visit(root);
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function runRestartProcess(layout, label, config, request, clockValue) {
  const inputPath = path.join(layout.root, `${label}.json`);
  fs.writeFileSync(inputPath, `${JSON.stringify({ config, request, clockValue }, null, 2)}\n`, "utf8");
  const helper = path.join(__dirname, "helpers", "runtime-d072-process-child.js");
  const child = spawnSync(process.execPath, [helper, inputPath], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
    env: { ...process.env },
  });
  assert.equal(child.error, undefined, `${label}: ${child.error && child.error.message}`);
  assert.equal(child.status, 0, `${label}: ${String(child.stderr || child.stdout || "").trim()}`);
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${label}: result JSON missing`);
  return JSON.parse(lines[lines.length - 1]);
}

test("D072 fresh controller replays expired terminal custody without execution tools", async () => {
  const layout = createRuntimeFixtureLayout({ label: "d072replay" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-RESTART",
    attemptId: "ATTEMPT-D072-RESTART",
  });
  let firstController;
  let replayController;
  try {
    firstController = createLocalWalkingSliceController(buildControllerConfig(layout));
    const first = await firstController.run(request);
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.aoSpawnCount, 1);
    assert.match(first.authorizationRequestDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.authorizationReceiptDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.terminalManifestDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.runSpecDigest, request.runSpecApproval.runSpecDigest);
    await firstController.close();
    firstController = null;

    const authHex = digestHex(first.authorizationRequestDigest);
    const receiptPath = canonicalReceiptPath(
      layout.stateRoot,
      request.authorizationRequest.authorizationId,
    );
    const receiptBytes = fs.readFileSync(receiptPath);
    const authorizationEntries = directoryEntriesOrEmpty(path.dirname(receiptPath));
    const attemptEntries = directoryEntriesOrEmpty(path.join(layout.stateRoot, "attempts"));

    const workspacesRoot = path.join(layout.workspaceRoot, "workspaces");
    fs.rmSync(workspacesRoot, { recursive: true, force: true });

    replayController = createLocalWalkingSliceController(unusableReplayConfig(layout));
    const retainedStateBeforeReplay = snapshotTree(layout.stateRoot);
    const replay = await replayController.run(request);

    assert.equal(replay.disposition, "REPLAY");
    assert.equal(replay.terminal, true);
    assert.equal(replay.aoSpawnCount, 0);
    assert.equal(replay.authorizationRequestDigest, first.authorizationRequestDigest);
    assert.equal(replay.authorizationReceiptDigest, first.authorizationReceiptDigest);
    assert.equal(replay.runSpecDigest, first.runSpecDigest);
    assert.equal(replay.verifiedHeadRevision, first.verifiedHeadRevision);
    assert.equal(replay.durableRef, first.durableRef);
    assert.equal(replay.terminalManifestDigest, first.terminalManifestDigest);
    assert.deepEqual(fs.readFileSync(receiptPath), receiptBytes);
    assert.deepEqual(directoryEntriesOrEmpty(path.dirname(receiptPath)), authorizationEntries);
    assert.deepEqual(directoryEntriesOrEmpty(path.join(layout.stateRoot, "attempts")), attemptEntries);
    assert.deepEqual(snapshotTree(layout.stateRoot), retainedStateBeforeReplay);
    assert.equal(fs.existsSync(path.join(workspacesRoot, authHex)), false);
  } finally {
    if (replayController) {
      try { await replayController.close(); } catch { /* ignore */ }
    }
    if (firstController) {
      try { await firstController.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
});

test("D072 process restart replays retained custody with zero AO spawn", () => {
  const layout = createRuntimeFixtureLayout({ label: "d072process" });
  const request = buildRunRequest(layout, {
    authorizationId: "AUTH-D072-PROCESS",
    attemptId: "ATTEMPT-D072-PROCESS",
  });
  try {
    const first = runRestartProcess(
      layout,
      "process-1",
      buildControllerConfig(layout),
      request,
      "2026-07-12T12:00:00.000Z",
    );
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.aoSpawnCount, 1);
    assert.match(first.terminalManifestDigest, /^sha256:[a-f0-9]{64}$/);

    const workspacesRoot = path.join(layout.workspaceRoot, "workspaces");
    fs.rmSync(workspacesRoot, { recursive: true, force: true });

    const receiptPath = canonicalReceiptPath(
      layout.stateRoot,
      request.authorizationRequest.authorizationId,
    );
    const receiptBytes = fs.readFileSync(receiptPath);
    const retainedStateBeforeReplay = snapshotTree(layout.stateRoot);
    const second = runRestartProcess(
      layout,
      "process-2",
      unusableReplayConfig(layout),
      request,
      "2026-07-14T12:00:00.000Z",
    );
    assert.equal(second.disposition, "REPLAY");
    assert.equal(second.aoSpawnCount, 0);
    assert.equal(second.authorizationRequestDigest, first.authorizationRequestDigest);
    assert.equal(second.authorizationReceiptDigest, first.authorizationReceiptDigest);
    assert.equal(second.runSpecDigest, first.runSpecDigest);
    assert.equal(second.verifiedHeadRevision, first.verifiedHeadRevision);
    assert.equal(second.durableRef, first.durableRef);
    assert.equal(second.terminalManifestDigest, first.terminalManifestDigest);
    assert.deepEqual(fs.readFileSync(receiptPath), receiptBytes);
    assert.deepEqual(snapshotTree(layout.stateRoot), retainedStateBeforeReplay);
    assert.equal(fs.existsSync(workspacesRoot), false);
  } finally {
    layout.cleanup();
  }
});
