"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { absNorm, digestHex } = require("../../internal/execution-custody/support");
const { loadExample } = require("../../internal/execution-custody/example");
const {
  AUTHORIZATION_TTL_SECONDS,
  snapshotHostEnv,
  clonePinnedChild: cloneOperatorChild,
  identityToken,
  operateBoundedRepositoryChange,
  sha256Utf8,
} = require("../../internal/execution-custody/operator");
const { resolveGit, runGit } = require("./execution-custody-git");

function enabled(value) {
  return /^(?:1|true)$/i.test(String(value || ""));
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
  return cloneOperatorChild({
    example,
    sourceRepositoryPath: sourcePath,
    custodyRoot: rootPath,
  });
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
  const candidateShort = candidateCommit.slice(0, 12);
  const example = loadExample(examplePath);
  const operationId = `${example.repository.repositoryId}-${candidateShort}`;
  const authorizationId = `AUTH-${identityToken(operationId)}`;
  const custodyRoot = path.resolve(
    metaRoot,
    ".meta-harness",
    "local",
    "custody",
    `custody-${example.repository.repositoryId}-${candidateShort}-${sha256Utf8(authorizationId).slice(0, 12)}`,
  );
  const validationBinding = buildValidationBinding(example, tools);
  const requestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-live-request-"));
  const operatorRequestPath = absNorm(path.join(requestDirectory, "operator-request.json"));
  fs.writeFileSync(operatorRequestPath, `${JSON.stringify({
    schemaVersion: "execution-custody-operator-request/v1",
    operationId,
    examplePath: absNorm(examplePath),
    sourceRepositoryPath: tools.sourcePath,
    custodyRoot: absNorm(custodyRoot),
    approvedBy,
    agentProgram: {
      nodeExecutablePath: tools.nodePath,
      launcherScriptPath: tools.launcherPath,
      nativeExecutablePath: tools.nativePath,
      expectedVersion: tools.version,
      codexHome: tools.codexHome,
    },
    validationProgram: {
      executablePath: validationBinding.executablePath,
      hostEnv: validationBinding.hostEnv,
      sensitiveValues: Array.isArray(validationBinding.sensitiveValues)
        ? validationBinding.sensitiveValues
        : [],
    },
  }, null, 2)}\n`, "utf8");

  try {
    const operated = operateBoundedRepositoryChange({ operatorRequestPath, metaRoot });
    const receipt = operated.receipt;
    const closure = {
      schemaVersion: "execution-custody-live-closure/v1",
      candidate: receipt.candidate,
      child: {
        repositoryId: receipt.child.repositoryId,
        baseRevision: receipt.child.baseRevision,
        baseTree: receipt.child.baseTree,
        allowedPath: receipt.child.allowedPath,
        retainedCustodyRoot: receipt.child.retainedCustodyRoot,
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
        executionToolPathsUsable: receipt.process2.executionToolPathsUsable,
      },
      portable: receipt.portable,
    };
    fs.writeFileSync(
      path.join(
        receipt.child.retainedCustodyRoot,
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
