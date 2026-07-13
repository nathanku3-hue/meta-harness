"use strict";

/**
 * D071 hermetic fixture repository helper.
 * Vendored ToolLauncher baseline — no E:\\code\\ToolLauncher dependency.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  FIXED_TIMEOUT_SECONDS,
  PROVIDER_ID,
  WORKER_PROFILE,
} = require("../../internal/d069/local-controller");
const { D071_SUBJECT_RELATIVE_PATH } = require("../../internal/d069/ao-constants");
const { absNorm: supportAbsNorm } = require("../../internal/d069/support");
const { computeRunSpecDigest } = require("../../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const { programPaths, snapshotHostEnv } = require("./runtime-programs");
const { resolveGit, runGit } = require("./runtime-git");

const FIXTURE_REPOSITORY_ID = "d071-fixture";
const FIXTURE_RELATIVE_FILE = D071_SUBJECT_RELATIVE_PATH;
const TOOLLAUNCHER_BASE_REVISION = "7fab419f20ba5c7a4008d6a6071d5aad10ba534c";
const TOOLLAUNCHER_BASELINE_BLOB = "aa1d3b7c71761b9a50139f828e7c154bc9693b66";
const FROZEN_NOW = "2026-07-12T12:00:00.000Z";
const APPROVED_AT = "2026-07-12T11:00:00.000Z";
const TEST_CODEX_VERSION = "0.144.1-test";
const D071_OBJECTIVE = [
  "Replace scripts/utils/CheckShortcut.ps1 with a deterministic command-line probe.",
  "Accept optional -StartupPath. When omitted, derive the default at runtime from the child",
  "process $env:APPDATA plus 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\AI Tool Launcher.lnk';",
  "do not use Shell, KnownFolder, or SpecialFolder APIs. Emit one compact JSON object with fields found,",
  "startup_path, target_path, arguments, and working_directory.",
  "Missing shortcut => found=false, startup_path equals the resolved requested path,",
  "and target_path, arguments, and working_directory are empty/null.",
  "Unreadable or corrupt shortcut must fail nonzero without success JSON.",
  "No network, API key, provider, or launcher execution.",
].join(" ");

function absNorm(p) {
  return supportAbsNorm(p);
}

function loadVendoredBaseline(programs) {
  const body = fs.readFileSync(programs.baselineFixture);
  const hash = String(
    spawnSync("git", ["hash-object", programs.baselineFixture], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout || "",
  ).trim();
  if (hash !== TOOLLAUNCHER_BASELINE_BLOB) {
    throw new Error(`vendored baseline blob ${hash} != pinned ${TOOLLAUNCHER_BASELINE_BLOB}`);
  }
  return body;
}

function createRuntimeFixtureLayout(options = {}) {
  const gitExecutablePath = options.gitExecutablePath || resolveGit();
  const label = options.label || "d071";
  const root = absNorm(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)));
  const repositoryPath = absNorm(path.join(root, "repo"));
  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "ws"));
  const codexHome = absNorm(path.join(root, "codex-home"));
  const programs = programPaths();

  for (const p of [repositoryPath, stateRoot, workspaceRoot, codexHome]) {
    fs.mkdirSync(p, { recursive: true });
  }
  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);

  const fixtureAbsoluteFile = absNorm(
    path.join(repositoryPath, ...FIXTURE_RELATIVE_FILE.split("/")),
  );
  fs.mkdirSync(path.dirname(fixtureAbsoluteFile), { recursive: true });
  const baselineBody = loadVendoredBaseline(programs);
  fs.writeFileSync(fixtureAbsoluteFile, baselineBody);
  runGit(gitExecutablePath, repositoryPath, ["add", FIXTURE_RELATIVE_FILE]);
  runGit(gitExecutablePath, repositoryPath, ["commit", "-m", "d071 fixture baseline"]);

  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  let objectFormat = "sha1";
  try {
    const fmt = String(
      runGit(gitExecutablePath, repositoryPath, ["rev-parse", "--show-object-format"]).stdout,
    ).trim();
    if (fmt === "sha1" || fmt === "sha256") objectFormat = fmt;
  } catch {
    objectFormat = headRevision.length === 64 ? "sha256" : "sha1";
  }
  if (String(runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain"]).stdout).trim()) {
    throw new Error("fixture repository is not clean after initial commit");
  }
  const knownGoodBody = fs.readFileSync(programs.knownGoodFixture, "utf8");

  return {
    root,
    trustedRepository: { repositoryId: FIXTURE_REPOSITORY_ID, repositoryPath },
    repositoryPath,
    stateRoot,
    workspaceRoot,
    codexHome,
    headRevision,
    objectFormat,
    fixtureRelativeFile: FIXTURE_RELATIVE_FILE,
    fixtureAbsoluteFile,
    initialBody: baselineBody.toString("utf8"),
    knownGoodBody,
    baselineBlobSha1: TOOLLAUNCHER_BASELINE_BLOB,
    toolLauncherBaseRevision: TOOLLAUNCHER_BASE_REVISION,
    gitExecutablePath,
    cleanup() {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch { /* best-effort */ }
    },
  };
}

function buildControllerConfig(layout, options = {}) {
  const programs = programPaths();
  return {
    trustedRepository: {
      repositoryId: layout.trustedRepository.repositoryId,
      repositoryPath: layout.trustedRepository.repositoryPath,
    },
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
    clock: options.clock || (() => FROZEN_NOW),
    codexProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: absNorm(process.execPath),
      launcherScriptPath: programs.testLauncher,
      expectedLauncherSha256: programs.testLauncherSha256,
      nativeExecutablePath: programs.testNative,
      expectedNativeSha256: programs.testNativeSha256,
      expectedVersion: options.codexVersion || TEST_CODEX_VERSION,
      codexHome: layout.codexHome,
      hostEnv: snapshotHostEnv(),
    },
    validationProgram: {
      executablePath: programs.powershellPath,
      expectedExecutableSha256: programs.powershellSha256,
      scriptPath: programs.validationScript,
      expectedScriptSha256: programs.validationSha256,
      hostEnv: programs.snapshotValidationHostEnv(),
      expectedCommand: {
        ...programs.validationExpectedCommand,
        argv: programs.validationArgv.slice(),
      },
    },
  };
}

function buildRunRequest(layout, options = {}) {
  const programs = programPaths();
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId: options.runId || "RUN-D071-V1",
    repository: {
      repositoryId: layout.trustedRepository.repositoryId,
      objectFormat: layout.objectFormat,
      expectedBaseRevision: layout.headRevision,
    },
    objective: options.objective || D071_OBJECTIVE,
    scope: { allow: [FIXTURE_RELATIVE_FILE], deny: [] },
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
  return {
    runSpecApproval: sealRunSpecApproval({
      schemaVersion: "run-spec-approval/v1",
      approvalId: options.approvalId || "APR-D071-V1",
      approvedBy: options.approvedBy || "test@meta-harness.local",
      approvedAt: options.approvedAt || APPROVED_AT,
      runSpec,
      runSpecDigest,
    }),
    authorizationRequest: {
      authorizationId: options.authorizationId || "AUTH-D071-V1",
      attemptId: options.attemptId || "ATTEMPT-D071-V1",
    },
  };
}

module.exports = {
  createRuntimeFixtureLayout,
  buildControllerConfig,
  buildRunRequest,
  programPaths,
  snapshotHostEnv,
  FIXTURE_REPOSITORY_ID,
  FIXTURE_RELATIVE_FILE,
  D071_OBJECTIVE,
  TOOLLAUNCHER_BASE_REVISION,
  TOOLLAUNCHER_BASELINE_BLOB,
  FROZEN_NOW,
  APPROVED_AT,
  TEST_CODEX_VERSION,
  absNorm,
};
