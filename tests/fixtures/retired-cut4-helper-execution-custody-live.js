"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { computeRunSpecDigest } = require("../../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const {
  AUTHORIZATION_TTL_SECONDS,
  executeRequest,
} = require("../../lib/execution-custody/execute");
const {
  absNorm,
  digestHex,
  sha256File,
  sha256Utf8,
} = require("../../lib/execution-custody/support");
const { resolveGit, runGit } = require("./execution-custody-git");

function enabled(value) {
  return /^(?:1|true)$/i.test(String(value || ""));
}

function snapshotHostEnv(keys) {
  const result = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      result[key] = String(value);
    }
  }
  return result;
}

function loadExample(examplePath) {
  const value = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  assert.equal(value.schemaVersion, "bounded-repository-change-example/v1");
  assert.ok(value.repository && typeof value.repository === "object");
  assert.ok(typeof value.allowedPath === "string" && value.allowedPath.length > 0);
  assert.ok(typeof value.objective === "string" && value.objective.length > 0);
  assert.ok(value.validationCapsule && Array.isArray(value.validationCapsule.commands));
  return value;
}

function validationEnvironmentKeys(example) {
  return [...new Set(
    example.validationCapsule.commands.flatMap((command) => command.environmentPolicy.allow),
  )];
}

function buildValidationHostEnv(example) {
  return snapshotHostEnv(validationEnvironmentKeys(example));
}

function detectLiveTools({
  forceEnvNames = [],
  sourceEnvName,
  defaultSourcePath,
  validationExecutableEnvName,
  defaultValidationExecutablePath,
}) {
  assert.ok(typeof sourceEnvName === "string" && sourceEnvName.length > 0);
  assert.ok(typeof defaultSourcePath === "string" && defaultSourcePath.length > 0);
  assert.ok(typeof validationExecutableEnvName === "string" && validationExecutableEnvName.length > 0);
  assert.ok(typeof defaultValidationExecutablePath === "string" && defaultValidationExecutablePath.length > 0);

  const force = ["CUSTODY_LIVE", ...forceEnvNames]
    .some((name) => enabled(process.env[name]));
  const nodePath = absNorm(
    process.env.CUSTODY_NODE_PATH
      || (fs.existsSync("D:\\nodejs\\node.exe") ? "D:\\nodejs\\node.exe" : process.execPath),
  );
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const codexRoot = path.join(appData, "npm", "node_modules", "@openai", "codex");
  const launcherPath = absNorm(
    process.env.CUSTODY_CODEX_LAUNCHER || path.join(codexRoot, "bin", "codex.js"),
  );
  const nativePath = absNorm(
    process.env.CUSTODY_CODEX_NATIVE || path.join(
      codexRoot,
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    ),
  );
  const codexHome = absNorm(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const sourcePath = absNorm(process.env[sourceEnvName] || defaultSourcePath);
  const validationExecutablePath = absNorm(
    process.env[validationExecutableEnvName] || defaultValidationExecutablePath,
  );
  const version = process.env.CUSTODY_CODEX_VERSION || "0.144.1";
  const required = [
    nodePath,
    launcherPath,
    nativePath,
    codexHome,
    sourcePath,
    validationExecutablePath,
  ];
  return {
    force,
    available: required.every((candidate) => fs.existsSync(candidate)),
    nodePath,
    launcherPath,
    nativePath,
    codexHome,
    sourcePath,
    validationExecutablePath,
    version,
  };
}

function clonePinnedChild({ example, sourcePath, rootPath }) {
  const root = absNorm(rootPath);
  fs.mkdirSync(root, { recursive: false });
  const repositoryPath = absNorm(path.join(root, "repository"));
  fs.mkdirSync(repositoryPath, { recursive: false });
  const gitExecutablePath = resolveGit();
  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);
  runGit(gitExecutablePath, repositoryPath, [
    "fetch", "--no-tags", "--depth=1", sourcePath, example.repository.expectedBaseRevision,
  ]);
  runGit(gitExecutablePath, repositoryPath, ["checkout", "--detach", "FETCH_HEAD"]);
  runGit(gitExecutablePath, repositoryPath, ["reset", "--hard", "HEAD"]);
  const headRevision = String(runGit(
    gitExecutablePath,
    repositoryPath,
    ["rev-parse", "HEAD"],
  ).stdout).trim();
  const tree = String(runGit(
    gitExecutablePath,
    repositoryPath,
    ["rev-parse", "HEAD^{tree}"],
  ).stdout).trim();
  return { root, repositoryPath, gitExecutablePath, headRevision, tree };
}

function identityToken(value) {
  const token = String(value || "custody")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "CUSTODY";
}

function buildPublicRunRequest(example, operationId, approvedBy) {
  const token = identityToken(operationId);
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId: `RUN-${token}`,
    repository: {
      repositoryId: example.repository.repositoryId,
      objectFormat: example.repository.objectFormat,
      expectedBaseRevision: example.repository.expectedBaseRevision,
    },
    objective: example.objective,
    scope: { allow: [example.allowedPath], deny: [] },
    validation: { commands: example.validationCapsule.commands },
    changePolicy: "forbid-noop",
  };
  const runSpecDigest = computeRunSpecDigest(runSpec);
  return {
    runSpecApproval: sealRunSpecApproval({
      schemaVersion: "run-spec-approval/v1",
      approvalId: `APPROVAL-${token}`,
      approvedBy,
      approvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      runSpec,
      runSpecDigest,
    }),
    authorizationRequest: {
      authorizationId: `AUTH-${token}`,
      attemptId: `ATTEMPT-${token}`,
    },
  };
}

function runLiveCustodyProof({
  examplePath,
  tools,
  buildValidationBinding,
  closureFileName,
  approvedBy,
}) {
  assert.equal(process.platform, "win32", "live custody proof requires native Windows execution");
  assert.equal(tools.available, true, `live tools unavailable: ${JSON.stringify(tools)}`);
  assert.equal(typeof buildValidationBinding, "function");

  const metaRoot = path.resolve(__dirname, "../..");
  const gitExecutablePath = resolveGit();
  const candidateCommit = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const candidateTree = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  const candidateShort = candidateCommit.slice(0, 12);
  const example = loadExample(examplePath);
  const operationId = `${example.repository.repositoryId}-${candidateShort}`;
  const validationBinding = buildValidationBinding(example, tools);
  const requestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-live-request-"));
  const custodyParent = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-live-custody-parent-"));
  const custodyRoot = absNorm(path.join(
    custodyParent,
    `custody-${example.repository.repositoryId}-${candidateShort}-${sha256Utf8(operationId).slice(0, 12)}`,
  ));
  const requestPath = absNorm(path.join(requestDirectory, "execution-request.json"));
  const runRequest = buildPublicRunRequest(example, operationId, approvedBy);
  fs.writeFileSync(requestPath, `${JSON.stringify({
    schemaVersion: "meta-harness-execution-request/v1",
    executionId: operationId,
    sourceRepositoryPath: tools.sourcePath,
    custodyRoot,
    expectedBaseTree: example.repository.expectedBaseTree,
    runRequest,
    agentProgram: {
      nodeExecutablePath: tools.nodePath,
      expectedNodeSha256: sha256File(tools.nodePath),
      launcherScriptPath: tools.launcherPath,
      expectedLauncherSha256: sha256File(tools.launcherPath),
      nativeExecutablePath: tools.nativePath,
      expectedNativeSha256: sha256File(tools.nativePath),
      expectedVersion: tools.version,
      codexHome: tools.codexHome,
    },
    validationProgram: {
      commandName: example.validationCapsule.commandName,
      executablePath: validationBinding.executablePath,
      expectedExecutableSha256: sha256File(validationBinding.executablePath),
      hostEnv: validationBinding.hostEnv,
      sensitiveValues: Array.isArray(validationBinding.sensitiveValues)
        ? validationBinding.sensitiveValues
        : [],
    },
  }, null, 2)}\n`, "utf8");

  try {
    const result = executeRequest({ requestPath });
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    const closure = {
      schemaVersion: "execution-custody-live-closure/v1",
      candidate: {
        commit: candidateCommit,
        tree: candidateTree,
        trackedWorktreeClean: true,
      },
      child: {
        repositoryId: receipt.repository.repositoryId,
        baseRevision: receipt.repository.baseRevision,
        baseTree: receipt.repository.baseTree,
        allowedPath: receipt.repository.allowedPath,
        retainedCustodyRoot: receipt.retained.custodyRoot,
      },
      process1: {
        clock: receipt.process1.clock,
        processExitCode: receipt.process1.processExitCode,
        controllerClosedAndProcessExited: receipt.process1.controllerClosedAndProcessExited,
        disposition: receipt.process1.disposition,
        verdict: receipt.process1.verdict,
        aoSpawnCount: receipt.process1.agentSpawnCount,
        verifiedHeadRevision: receipt.process1.verifiedHeadRevision,
        durableRef: receipt.process1.durableRef,
        terminalManifestDigest: receipt.process1.terminalManifestDigest,
      },
      process2: {
        clock: receipt.process2.clock,
        processExitCode: receipt.process2.processExitCode,
        controllerClosedAndProcessExited: receipt.process2.controllerClosedAndProcessExited,
        authorizationExpiresAt: receipt.process2.authorizationExpiresAt,
        laterThanAuthorizationExpiry: true,
        disposition: receipt.process2.disposition,
        verdict: receipt.process2.verdict,
        aoSpawnCount: receipt.process2.agentSpawnCount,
        executionToolPathsUsable: false,
      },
      portable: {
        exportManifestDigest: receipt.portable.exportManifestDigest,
        independentVerification: receipt.portable.independent,
      },
    };
    fs.writeFileSync(
      path.join(
        receipt.retained.custodyRoot,
        "exports",
        closureFileName || `${example.repository.repositoryId}-live-closure.json`,
      ),
      `${JSON.stringify(closure, null, 2)}\n`,
      "utf8",
    );
    return closure;
  } finally {
    fs.rmSync(requestDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  AUTHORIZATION_TTL_SECONDS,
  detectLiveTools,
  snapshotHostEnv,
  validationEnvironmentKeys,
  buildValidationHostEnv,
  loadExample,
  clonePinnedChild,
  runLiveCustodyProof,
  sha256Utf8,
  digestHex,
};
