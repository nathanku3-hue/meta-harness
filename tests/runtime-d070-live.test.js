"use strict";

/**
 * D070-A1 live authenticated Codex path.
 * Skips on hosts without bound Codex identity.
 * Closure requires a live pass on the implementation commit (do not skip for A1 close).
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
  createRuntimeFixtureLayout,
  buildRunRequest,
  programPaths,
  snapshotHostEnv,
} = require("./helpers/runtime-fixture-repo");

function detectLiveCodex() {
  const force = process.env.D070_LIVE_CODEX === "1" || process.env.D070_LIVE_CODEX === "true";
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

test("D070-A1 live: authenticated Codex :read-only full chain + replay", async (t) => {
  const live = detectLiveCodex();
  if (!live.available) {
    if (live.force) {
      assert.fail("D070_LIVE_CODEX set but Codex identity paths are incomplete");
    }
    t.skip("live Codex identity not available on this host");
    return;
  }

  const major = Number.parseInt(String(process.versions.node).split(".")[0], 10);
  assert.ok(major >= 20, `Node >= 20 required; got ${process.version}`);

  const layout = createRuntimeFixtureLayout({ label: "d070live" });
  let controller;
  try {
    const programs = programPaths();
    // Frozen clock: re-auth on replay must reseal an identical receipt body.
    const nowMs = Date.now();
    const frozenNow = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const approvedAt = new Date(nowMs - 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    controller = createLocalWalkingSliceController({
      trustedRepository: layout.trustedRepository,
      stateRoot: layout.stateRoot,
      workspaceRoot: layout.workspaceRoot,
      authorizationPolicy: {
        authorizationTtlSeconds: 3600,
        maxReadinessAgeSeconds: 7200,
        maxCommandTimeoutSeconds: FIXED_TIMEOUT_SECONDS,
        provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
        workspacePolicy: {
          schemaVersion: "workspace-policy/v1",
          approvedRoot: layout.workspaceRoot,
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

    const request = buildRunRequest(layout, {
      runId: "RUN-D071-LIVE",
      approvalId: "APR-D071-LIVE",
      authorizationId: "AUTH-D071-LIVE",
      attemptId: "ATTEMPT-D071-LIVE",
      approvedAt,
    });

    const first = await controller.run(request);
    assert.equal(first.ok, true);
    assert.equal(first.disposition, "VERIFIED");
    assert.equal(first.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(first.aoSpawnCount, 1);
    assert.match(first.aoProcessMetaSha256, /^[a-f0-9]{64}$/);
    assert.match(first.changeArtifactSha256, /^[a-f0-9]{64}$/);
    assert.match(first.changeArtifactSchemaSha256, /^[a-f0-9]{64}$/);

    const second = await controller.run(request);
    assert.equal(second.disposition, "REPLAY");
    assert.equal(second.verdict, "IMPLEMENTATION_VERIFIED");
    assert.equal(second.aoProcessMetaSha256, first.aoProcessMetaSha256);
    assert.equal(second.changeArtifactSha256, first.changeArtifactSha256);
    assert.equal(second.changeArtifactSchemaSha256, first.changeArtifactSchemaSha256);
    assert.equal(controller.getAoSpawnCount(), 1);

    // Evidence marker for closure (local ignored if under stateRoot which is temp)
    let headCommit = null;
    let trackedWorktreeClean = false;
    let trackedDiffSha256 = null;
    try {
      const { spawnSync } = require("node:child_process");
      const repoRoot = path.resolve(__dirname, "..");
      const head = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
        windowsHide: true,
      });
      const status = spawnSync(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=no"],
        { cwd: repoRoot, encoding: "utf8", windowsHide: true },
      );
      const diff = spawnSync("git", ["diff", "--binary", "HEAD"], {
        cwd: repoRoot,
        encoding: "buffer",
        windowsHide: true,
      });
      if (head.status === 0) headCommit = String(head.stdout || "").trim();
      if (status.status === 0) trackedWorktreeClean = String(status.stdout || "").trim() === "";
      if (diff.status === 0) {
        trackedDiffSha256 = crypto
          .createHash("sha256")
          .update(Buffer.from(diff.stdout || Buffer.alloc(0)))
          .digest("hex");
      }
    } catch {
      headCommit = null;
      trackedWorktreeClean = false;
      trackedDiffSha256 = null;
    }
    const implementationCommit = trackedWorktreeClean ? headCommit : null;
    const evidence = {
      kind: "d071-fixture-live-pass",
      note: "Hermetic fixture path with live Codex; S5 ToolLauncher dogfood uses tracked evidence envelope",
      provider: PROVIDER_ID,
      workerProfile: WORKER_PROFILE,
      codexVersion: live.version,
      launcherSha256: sha256File(live.launcher),
      nativeSha256: sha256File(live.native),
      verifiedHeadRevision: first.verifiedHeadRevision,
      durableRef: first.durableRef,
      aoSpawnCount: controller.getAoSpawnCount(),
      aoProcessMetaSha256: first.aoProcessMetaSha256,
      changeArtifactSha256: first.changeArtifactSha256,
      changeArtifactSchemaSha256: first.changeArtifactSchemaSha256,
      implementationCommit,
      headCommit,
      trackedWorktreeClean,
      trackedDiffSha256,
      at: new Date().toISOString(),
    };
    const evidenceDir = path.resolve(__dirname, "../.meta-harness/local");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, "d070-a1-live-pass.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  } finally {
    if (controller) {
      try { await controller.close(); } catch { /* ignore */ }
    }
    layout.cleanup();
  }
});
