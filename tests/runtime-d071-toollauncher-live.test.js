"use strict";

/**
 * D071 S5 live dogfood: authenticated Codex against isolated ToolLauncher clone.
 * Requires D071_LIVE_TOOLLAUNCHER=1 and live Codex identity.
 * Does not use a worktree from the dirty live ToolLauncher checkout.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createLocalWalkingSliceController,
  PROVIDER_ID,
  WORKER_PROFILE,
  FIXED_TIMEOUT_SECONDS,
  sha256File,
} = require("../internal/d069/local-controller");
const { absNorm } = require("../internal/d069/support");
const {
  programPaths,
  snapshotHostEnv,
  D071_OBJECTIVE,
  FIXTURE_REPOSITORY_ID,
} = require("./helpers/runtime-fixture-repo");
const {
  createDetachedToolLauncherClone,
  TOOLLAUNCHER_BASE_REVISION,
  TOOLLAUNCHER_BASE_TREE,
} = require("./helpers/toollauncher-clone");
const { computeRunSpecDigest } = require("../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../lib/contracts/run-spec-approval");

function detectLiveCodex() {
  const force = process.env.D071_LIVE_TOOLLAUNCHER === "1"
    || process.env.D071_LIVE_TOOLLAUNCHER === "true";
  const nodePath = process.env.D070_NODE_PATH
    || (fs.existsSync("D:\\nodejs\\node.exe") ? "D:\\nodejs\\node.exe" : process.execPath);
  const launcher = process.env.D070_CODEX_LAUNCHER
    || path.join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
  const native = process.env.D070_CODEX_NATIVE
    || path.join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
  const codexHome = process.env.CODEX_HOME
    || path.join(os.homedir(), ".codex");
  const version = process.env.D070_CODEX_VERSION || "0.144.1";

  const available = fs.existsSync(nodePath)
    && fs.existsSync(launcher)
    && fs.existsSync(native)
    && fs.existsSync(codexHome);

  return {
    force,
    available,
    nodePath: absNorm(nodePath),
    launcher: absNorm(launcher),
    native: absNorm(native),
    codexHome: absNorm(codexHome),
    version,
  };
}

function sha256Utf8(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

test("D071 live: ToolLauncher CheckShortcut.ps1 dogfood + replay", async (t) => {
  const live = detectLiveCodex();
  if (!live.force) {
    t.skip("set D071_LIVE_TOOLLAUNCHER=1 to run ToolLauncher dogfood");
    return;
  }
  if (!live.available) {
    assert.fail("D071_LIVE_TOOLLAUNCHER set but Codex identity paths are incomplete");
  }

  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  assert.ok(major >= 20, `Node >= 20 required; got ${process.version}`);

  const programs = programPaths();
  let clone;
  let controller;
  const tmp = absNorm(fs.mkdtempSync(path.join(os.tmpdir(), "d071-tl-run-")));
  const stateRoot = absNorm(path.join(tmp, "state"));
  const workspaceRoot = absNorm(path.join(tmp, "ws"));
  const codexHome = absNorm(path.join(tmp, "codex-home"));
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });

  try {
    clone = createDetachedToolLauncherClone();
    assert.equal(clone.headRevision, TOOLLAUNCHER_BASE_REVISION);
    assert.equal(clone.tree, TOOLLAUNCHER_BASE_TREE);

    const nowMs = Date.now();
    const frozenNow = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const approvedAt = new Date(nowMs - 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");

    controller = createLocalWalkingSliceController({
      trustedRepository: {
        repositoryId: "toollauncher",
        repositoryPath: clone.repositoryPath,
      },
      stateRoot,
      workspaceRoot,
      authorizationPolicy: {
        authorizationTtlSeconds: 3600,
        maxReadinessAgeSeconds: 7200,
        maxCommandTimeoutSeconds: FIXED_TIMEOUT_SECONDS,
        provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
        workspacePolicy: {
          schemaVersion: "workspace-policy/v1",
          approvedRoot: workspaceRoot,
        },
      },
      clock: () => frozenNow,
      codexProgram: {
        workerProfile: WORKER_PROFILE,
        nodeExecutablePath: live.nodePath,
        launcherScriptPath: live.launcher,
        expectedLauncherSha256: sha256File(live.launcher),
        nativeExecutablePath: live.native,
        expectedNativeSha256: sha256File(live.native),
        expectedVersion: live.version,
        codexHome: live.codexHome,
        hostEnv: snapshotHostEnv(),
      },
      validationProgram: {
        executablePath: programs.powershellPath,
        expectedExecutableSha256: programs.powershellSha256,
        scriptPath: programs.validationScript,
        expectedScriptSha256: programs.validationSha256,
        hostEnv: programs.snapshotValidationHostEnv(),
        expectedCommand: {
          argv: programs.validationArgv.slice(),
          cwdRelative: ".",
          timeoutSeconds: FIXED_TIMEOUT_SECONDS,
          networkPolicy: "denied",
          environmentPolicy: { allow: programs.validationAllow.slice() },
        },
      },
    });

    const runSpec = {
      schemaVersion: "run-spec/v1",
      runId: "RUN-D071-TOOLLAUNCHER",
      repository: {
        repositoryId: "toollauncher",
        objectFormat: "sha1",
        expectedBaseRevision: TOOLLAUNCHER_BASE_REVISION,
      },
      objective: D071_OBJECTIVE,
      scope: {
        allow: [programs.subjectRelativePath],
        deny: [],
      },
      validation: {
        commands: [{
          argv: programs.validationArgv.slice(),
          cwdRelative: ".",
          timeoutSeconds: FIXED_TIMEOUT_SECONDS,
          networkPolicy: "denied",
          environmentPolicy: { allow: programs.validationAllow.slice() },
        }],
      },
      changePolicy: "forbid-noop",
    };
    const runSpecDigest = computeRunSpecDigest(runSpec);
    const runSpecApproval = sealRunSpecApproval({
      schemaVersion: "run-spec-approval/v1",
      approvalId: "APR-D071-TOOLLAUNCHER",
      approvedBy: "d071@meta-harness.local",
      approvedAt,
      runSpec,
      runSpecDigest,
    });
    const request = {
      runSpecApproval,
      authorizationRequest: {
        authorizationId: "AUTH-D071-TOOLLAUNCHER",
        attemptId: "ATTEMPT-D071-TOOLLAUNCHER",
      },
    };

    const first = await controller.run(request);
    assert.equal(first.ok, true);
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(first.aoSpawnCount, 1);

    const second = await controller.run(request);
    assert.equal(second.disposition, "REPLAY");
    assert.equal(second.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(controller.getAoSpawnCount(), 1);

    // Parent MH tree cleanliness for implementationCommit binding.
    const repoRoot = path.resolve(__dirname, "..");
    const { spawnSync } = require("node:child_process");
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true,
    });
    const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true,
    });
    const headCommit = head.status === 0 ? String(head.stdout || "").trim() : null;
    const trackedWorktreeClean = status.status === 0
      && String(status.stdout || "").trim() === "";
    const implementationCommit = trackedWorktreeClean ? headCommit : null;

    const evidence = {
      kind: "d071-toollauncher-dogfood-evidence",
      schemaVersion: "d071-evidence/v1",
      metaHarnessImplementationCommit: implementationCommit,
      childRepositoryId: "toollauncher",
      childBaseRevision: TOOLLAUNCHER_BASE_REVISION,
      childBaseTree: TOOLLAUNCHER_BASE_TREE,
      allowedPath: programs.subjectRelativePath,
      runSpecDigest,
      authorizationReceiptDigest: first.authorizationReceiptDigest || null,
      objectiveDigest: `sha256:${sha256Utf8(D071_OBJECTIVE)}`,
      validationCommandDigest: `sha256:${sha256Utf8(JSON.stringify(programs.validationExpectedCommand))}`,
      verifiedChildHeadRevision: first.verifiedHeadRevision,
      durableRef: first.durableRef,
      aoSpawnCount: controller.getAoSpawnCount(),
      aoProcessMetaSha256: first.aoProcessMetaSha256,
      changeArtifactSha256: first.changeArtifactSha256,
      changeArtifactSchemaSha256: first.changeArtifactSchemaSha256,
      replayDisposition: second.disposition,
      trackedWorktreeClean,
      codexVersion: live.version,
      fixtureRepositoryIdNote: FIXTURE_REPOSITORY_ID,
      at: new Date().toISOString(),
    };

    const localDir = path.resolve(__dirname, "../.meta-harness/local");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, "d071-toollauncher-live-pass.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    // Also stage path for tracked envelope (C2 copies if clean).
    fs.writeFileSync(
      path.join(localDir, "d071-evidence-envelope.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );

    assert.equal(trackedWorktreeClean, true, "live dogfood must run from clean MH implementation commit");
    assert.ok(implementationCommit, "implementationCommit required when tree is clean");
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* ignore */ }
    }
    if (clone) clone.cleanup();
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch { /* ignore */ }
  }
});
