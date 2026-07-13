"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  PROVIDER_ID,
  WORKER_PROFILE,
  FIXED_TIMEOUT_SECONDS,
  sha256File,
} = require("../../internal/d069/local-controller");
const { absNorm } = require("../../internal/d069/support");
const { snapshotHostEnv } = require("./runtime-fixture-repo");

function detectLiveCodex() {
  const force = process.env.D072_LIVE_TOOLLAUNCHER === "1"
    || process.env.D072_LIVE_TOOLLAUNCHER === "true";
  const nodePath = process.env.D070_NODE_PATH
    || (fs.existsSync("D:\\nodejs\\node.exe") ? "D:\\nodejs\\node.exe" : process.execPath);
  const launcher = process.env.D070_CODEX_LAUNCHER
    || path.join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  const native = process.env.D070_CODEX_NATIVE
    || path.join(
      process.env.APPDATA || "",
      "npm", "node_modules", "@openai", "codex", "node_modules", "@openai",
      "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe",
    );
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
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

function digestHex(digest) {
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  return digest.slice("sha256:".length);
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return String(result.stdout || "").trim();
}

function runControllerProcess(root, label, config, request, clockValue, timeout = 300_000) {
  const inputPath = path.join(root, "exports", `${label}-input.json`);
  fs.writeFileSync(inputPath, `${JSON.stringify({ config, request, clockValue }, null, 2)}\n`, "utf8");
  const helper = path.join(__dirname, "runtime-d072-process-child.js");
  const child = spawnSync(process.execPath, [helper, inputPath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: { ...process.env },
  });
  assert.equal(child.error, undefined, `${label}: ${child.error && child.error.message}`);
  assert.equal(child.status, 0, `${label}: ${String(child.stderr || child.stdout || "").trim()}`);
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${label}: result missing`);
  return JSON.parse(lines[lines.length - 1]);
}

function runExportVerifier(root, clone, portable, verified, programs) {
  const inputPath = path.join(root, "exports", "independent-verifier-input.json");
  fs.writeFileSync(inputPath, `${JSON.stringify({
    gitExecutablePath: clone.gitExecutablePath,
    sourceRepositoryPath: clone.repositoryPath,
    verifierRepositoryPath: absNorm(path.join(root, "exports", "independent-verifier")),
    exportDir: portable.exportDir,
    baseRevision: verified.baseRevision,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    allowedPath: programs.subjectRelativePath,
    validationArgv: programs.validationArgv,
  }, null, 2)}\n`, "utf8");
  const helper = path.join(__dirname, "runtime-d072-export-verifier.js");
  const child = spawnSync(process.execPath, [helper, inputPath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
    timeout: 240_000,
    env: { ...process.env },
  });
  assert.equal(child.error, undefined, child.error && child.error.message);
  assert.equal(child.status, 0, String(child.stderr || child.stdout || "").trim());
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function buildConfig({ clone, stateRoot, workspaceRoot, live, programs }) {
  return {
    trustedRepository: { repositoryId: "toollauncher", repositoryPath: clone.repositoryPath },
    stateRoot,
    workspaceRoot,
    authorizationPolicy: {
      authorizationTtlSeconds: 3600,
      maxReadinessAgeSeconds: 7200,
      maxCommandTimeoutSeconds: FIXED_TIMEOUT_SECONDS,
      provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
      workspacePolicy: { schemaVersion: "workspace-policy/v1", approvedRoot: workspaceRoot },
    },
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
  };
}

function buildCanaryConfig(config, root) {
  const missing = absNorm(path.join(root, "execution-tools-must-not-be-read"));
  return {
    ...config,
    codexProgram: {
      ...config.codexProgram,
      nodeExecutablePath: absNorm(path.join(missing, "node.exe")),
      launcherScriptPath: absNorm(path.join(missing, "codex.js")),
      nativeExecutablePath: absNorm(path.join(missing, "codex.exe")),
      codexHome: absNorm(path.join(missing, "codex-home")),
      expectedLauncherSha256: "0".repeat(64),
      expectedNativeSha256: "1".repeat(64),
    },
    validationProgram: {
      ...config.validationProgram,
      executablePath: absNorm(path.join(missing, "powershell.exe")),
      scriptPath: absNorm(path.join(missing, "validator.ps1")),
      expectedExecutableSha256: "2".repeat(64),
      expectedScriptSha256: "3".repeat(64),
    },
  };
}

module.exports = {
  detectLiveCodex,
  sha256Utf8,
  digestHex,
  git,
  runControllerProcess,
  runExportVerifier,
  buildConfig,
  buildCanaryConfig,
};
