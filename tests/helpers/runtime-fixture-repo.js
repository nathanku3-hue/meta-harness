"use strict";

/**
 * D070-A1 test helper: ordinary non-bare temporary fixture repository.
 * Offline tests bind the test-only Codex launcher (not a second production path).
 * Not a production export.
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
const { absNorm: supportAbsNorm } = require("../../internal/d069/support");
const { computeRunSpecDigest } = require("../../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const { programPaths, snapshotHostEnv } = require("./runtime-programs");

const FIXTURE_REPOSITORY_ID = "d070-fixture";
const FIXTURE_RELATIVE_FILE = "src/fixture.txt";
const FIXTURE_INITIAL_BODY = "fixture-initial\n";
const A1_EXACT_BODY = "d070-ao-verified-marker\n";
const FROZEN_NOW = "2026-07-12T12:00:00.000Z";
const APPROVED_AT = "2026-07-12T11:00:00.000Z";
const TEST_CODEX_VERSION = "0.144.1-test";

function resolveGit() {
  const preferred = process.platform === "win32" ? "D:\\Git\\cmd\\git.exe" : "git";
  const candidates = [preferred, "git"];
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { encoding: "utf8", windowsHide: true });
    if (probe.error || probe.status !== 0) continue;
    if (path.isAbsolute(c) && fs.existsSync(c)) {
      return fs.realpathSync(c);
    }
    const whereCmd = process.platform === "win32" ? "where" : "which";
    const located = spawnSync(whereCmd, [c], { encoding: "utf8", windowsHide: true });
    if (located.status === 0) {
      const first = String(located.stdout || "").trim().split(/\r?\n/)[0];
      if (first) return fs.realpathSync(first);
    }
  }
  throw new Error("runtime-fixture-repo: unable to resolve git");
}

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "meta-harness-d070-fixture",
    GIT_AUTHOR_EMAIL: "fixture@meta-harness.local",
    GIT_COMMITTER_NAME: "meta-harness-d070-fixture",
    GIT_COMMITTER_EMAIL: "fixture@meta-harness.local",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

function hooksPathDisabled() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function runGit(gitPath, cwd, args) {
  const result = spawnSync(
    gitPath,
    ["-c", `core.hooksPath=${hooksPathDisabled()}`, "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", windowsHide: true, env: gitEnv() },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function absNorm(p) {
  return supportAbsNorm(p);
}

/**
 * Create a short-lived fixture layout under os.tmpdir().
 */
function createRuntimeFixtureLayout(options = {}) {
  const gitExecutablePath = options.gitExecutablePath || resolveGit();
  const label = options.label || "d070";
  const root = absNorm(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)));
  const repositoryPath = absNorm(path.join(root, "repo"));
  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "ws"));
  const codexHome = absNorm(path.join(root, "codex-home"));

  fs.mkdirSync(repositoryPath, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });

  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);

  const fixtureAbsoluteFile = absNorm(
    path.join(repositoryPath, ...FIXTURE_RELATIVE_FILE.split("/")),
  );
  fs.mkdirSync(path.dirname(fixtureAbsoluteFile), { recursive: true });
  fs.writeFileSync(fixtureAbsoluteFile, FIXTURE_INITIAL_BODY, "utf8");

  runGit(gitExecutablePath, repositoryPath, ["add", FIXTURE_RELATIVE_FILE]);
  runGit(gitExecutablePath, repositoryPath, ["commit", "-m", "d070 fixture initial"]);

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

  const status = String(
    runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain"]).stdout,
  );
  if (status.trim() !== "") {
    throw new Error("fixture repository is not clean after initial commit");
  }

  function cleanup() {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // best-effort
    }
  }

  return {
    root,
    trustedRepository: {
      repositoryId: FIXTURE_REPOSITORY_ID,
      repositoryPath,
    },
    repositoryPath,
    stateRoot,
    workspaceRoot,
    codexHome,
    headRevision,
    objectFormat,
    fixtureRelativeFile: FIXTURE_RELATIVE_FILE,
    fixtureAbsoluteFile,
    initialBody: FIXTURE_INITIAL_BODY,
    a1ExactBody: A1_EXACT_BODY,
    gitExecutablePath,
    cleanup,
  };
}

/**
 * Trusted test assembly config for createLocalWalkingSliceController.
 * Default clock is frozen so concurrent same-request digests match.
 */
function buildControllerConfig(layout, options = {}) {
  const programs = programPaths();
  const clock = options.clock || (() => FROZEN_NOW);
  const nodePath = absNorm(process.execPath);

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
      provider: {
        id: PROVIDER_ID,
        workerProfile: WORKER_PROFILE,
      },
      workspacePolicy: {
        schemaVersion: "workspace-policy/v1",
        approvedRoot: layout.workspaceRoot,
      },
    },
    clock,
    codexProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: nodePath,
      launcherScriptPath: programs.testLauncher,
      expectedLauncherSha256: programs.testLauncherSha256,
      nativeExecutablePath: programs.testNative,
      expectedNativeSha256: programs.testNativeSha256,
      expectedVersion: options.codexVersion || TEST_CODEX_VERSION,
      codexHome: layout.codexHome,
      hostEnv: snapshotHostEnv(),
    },
    validationProgram: {
      executablePath: process.execPath,
      scriptPath: programs.validationScript,
      expectedScriptSha256: programs.validationSha256,
      expectedCommand: {
        argv: [process.execPath, programs.validationScript],
        cwdRelative: ".",
        timeoutSeconds: FIXED_TIMEOUT_SECONDS,
        networkPolicy: "denied",
        environmentPolicy: { allow: [] },
      },
    },
  };
}

/**
 * Real sealed RunSpecApproval + authorization request for controller.run.
 */
function buildRunRequest(layout, options = {}) {
  const programs = programPaths();
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId: options.runId || "RUN-D070-V1",
    repository: {
      repositoryId: layout.trustedRepository.repositoryId,
      objectFormat: layout.objectFormat,
      expectedBaseRevision: layout.headRevision,
    },
    objective: options.objective
      || "D070-A1 controller-materialized AO artifact sequential verified commit",
    scope: {
      allow: ["src/fixture.txt"],
      deny: [],
    },
    validation: {
      commands: [
        {
          argv: [process.execPath, programs.validationScript],
          cwdRelative: ".",
          timeoutSeconds: FIXED_TIMEOUT_SECONDS,
          networkPolicy: "denied",
          environmentPolicy: { allow: [] },
        },
      ],
    },
    changePolicy: "forbid-noop",
  };
  const runSpecDigest = computeRunSpecDigest(runSpec);
  const runSpecApproval = sealRunSpecApproval({
    schemaVersion: "run-spec-approval/v1",
    approvalId: options.approvalId || "APR-D070-V1",
    approvedBy: options.approvedBy || "test@meta-harness.local",
    approvedAt: options.approvedAt || APPROVED_AT,
    runSpec,
    runSpecDigest,
  });

  return {
    runSpecApproval,
    authorizationRequest: {
      authorizationId: options.authorizationId || "AUTH-D070-V1",
      attemptId: options.attemptId || "ATTEMPT-D070-V1",
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
  FIXTURE_INITIAL_BODY,
  A1_EXACT_BODY,
  FROZEN_NOW,
  APPROVED_AT,
  TEST_CODEX_VERSION,
  absNorm,
};
