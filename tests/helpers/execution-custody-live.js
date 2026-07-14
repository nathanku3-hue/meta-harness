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
  MAX_VALIDATION_TIMEOUT_SECONDS,
  sha256File,
} = require("../../internal/execution-custody/controller");
const { exportPortableCustody } = require("../../internal/execution-custody/custody-export");
const { absNorm, digestHex } = require("../../internal/execution-custody/support");
const { AGENT_ENV_ALLOWLIST } = require("../../internal/execution-custody/constants");
const { validateExample, buildRunRequest } = require("../../internal/execution-custody/example");
const { resolveGit, runGit } = require("./execution-custody-git");

const AUTHORIZATION_TTL_SECONDS = 3600;
const REPLAY_EXPIRY_MARGIN_MS = 60_000;

function sha256Utf8(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

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

function loadExample(examplePath) {
  return validateExample(JSON.parse(fs.readFileSync(examplePath, "utf8")));
}

function clonePinnedChild({ example, sourcePath, rootPath }) {
  const gitExecutablePath = resolveGit();
  const root = absNorm(rootPath);
  if (fs.existsSync(root)) {
    throw new Error(`create-only custody root already exists: ${root}`);
  }
  fs.mkdirSync(root, { recursive: false });
  const repositoryPath = absNorm(path.join(root, "repository"));
  fs.mkdirSync(repositoryPath, { recursive: false });
  runGit(gitExecutablePath, repositoryPath, ["init"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.eol", "lf"]);
  runGit(gitExecutablePath, repositoryPath, [
    "fetch",
    "--no-tags",
    "--depth=1",
    sourcePath,
    example.repository.expectedBaseRevision,
  ]);
  runGit(gitExecutablePath, repositoryPath, ["checkout", "--detach", "FETCH_HEAD"]);
  runGit(gitExecutablePath, repositoryPath, ["reset", "--hard", "HEAD"]);

  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  const tree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  const status = String(
    runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  assert.equal(headRevision, example.repository.expectedBaseRevision);
  assert.equal(tree, example.repository.expectedBaseTree);
  assert.equal(status, "");
  assert.ok(fs.existsSync(path.join(repositoryPath, ...example.allowedPath.split("/"))));

  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "workspaces"));
  const exportsRoot = absNorm(path.join(root, "exports"));
  for (const directory of [stateRoot, workspaceRoot, exportsRoot]) {
    fs.mkdirSync(directory, { recursive: false });
  }
  return {
    root,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    exportsRoot,
    gitExecutablePath,
    headRevision,
    tree,
  };
}

function identityToken(value) {
  const token = String(value || "custody")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "CUSTODY";
}

function buildRequest(example, candidateShort, clockValue, options = {}) {
  const approvedAt = new Date(new Date(clockValue).getTime() - 5 * 60 * 1000).toISOString();
  const token = identityToken(options.identity || example.repository.repositoryId);
  return buildRunRequest(example, {
    runId: `RUN-${token}-${candidateShort}`,
    approvalId: `APPROVAL-${token}-${candidateShort}`,
    authorizationId: `AUTH-${token}-${candidateShort}`,
    attemptId: `ATTEMPT-${token}-${candidateShort}`,
    approvedAt,
    approvedBy: options.approvedBy || "live-custody@meta-harness.local",
  }).request;
}

function buildConfig({ example, clone, tools, validationBinding }) {
  assert.ok(validationBinding && typeof validationBinding === "object");
  assert.equal(validationBinding.executablePath, tools.validationExecutablePath);
  assert.ok(validationBinding.hostEnv && typeof validationBinding.hostEnv === "object");
  return {
    trustedRepository: {
      repositoryId: example.repository.repositoryId,
      repositoryPath: clone.repositoryPath,
    },
    stateRoot: clone.stateRoot,
    workspaceRoot: clone.workspaceRoot,
    authorizationPolicy: {
      authorizationTtlSeconds: AUTHORIZATION_TTL_SECONDS,
      maxReadinessAgeSeconds: 7200,
      maxCommandTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
      provider: { id: PROVIDER_ID, workerProfile: WORKER_PROFILE },
      workspacePolicy: {
        schemaVersion: "workspace-policy/v1",
        approvedRoot: clone.workspaceRoot,
      },
    },
    agentProgram: {
      workerProfile: WORKER_PROFILE,
      nodeExecutablePath: tools.nodePath,
      launcherScriptPath: tools.launcherPath,
      expectedLauncherSha256: sha256File(tools.launcherPath),
      nativeExecutablePath: tools.nativePath,
      expectedNativeSha256: sha256File(tools.nativePath),
      expectedVersion: tools.version,
      codexHome: tools.codexHome,
      hostEnv: snapshotHostEnv(AGENT_ENV_ALLOWLIST),
    },
    validationProgram: {
      commandName: example.validationCapsule.commandName,
      executablePath: validationBinding.executablePath,
      expectedExecutableSha256: sha256File(validationBinding.executablePath),
      hostEnv: validationBinding.hostEnv,
      expectedCommands: example.validationCapsule.commands,
    },
  };
}

function buildCanaryConfig(config, root) {
  const missing = absNorm(path.join(root, "execution-tools-must-not-be-read"));
  return {
    ...config,
    agentProgram: {
      ...config.agentProgram,
      nodeExecutablePath: absNorm(path.join(missing, "node.exe")),
      launcherScriptPath: absNorm(path.join(missing, "codex.js")),
      nativeExecutablePath: absNorm(path.join(missing, "codex.exe")),
      codexHome: absNorm(path.join(missing, "codex-home")),
      expectedLauncherSha256: "0".repeat(64),
      expectedNativeSha256: "1".repeat(64),
      expectedVersion: "unusable",
      hostEnv: {},
    },
    validationProgram: {
      ...config.validationProgram,
      executablePath: absNorm(path.join(missing, "validation-tool")),
      expectedExecutableSha256: "2".repeat(64),
      hostEnv: {},
    },
  };
}

function runJsonChild(scriptPath, inputPath, timeout = 420_000) {
  const child = spawnSync(process.execPath, [scriptPath, inputPath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: process.env,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed ${child.status}: ${String(child.stderr || child.stdout || "").trim()}`);
  }
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${path.basename(scriptPath)} produced no result`);
  return JSON.parse(lines[lines.length - 1]);
}

function runControllerProcess({ clone, label, config, request, clockValue }) {
  const inputPath = path.join(clone.exportsRoot, `${label}-input.json`);
  fs.writeFileSync(inputPath, `${JSON.stringify({ config, request, clock: clockValue }, null, 2)}\n`, "utf8");
  return runJsonChild(
    path.resolve(__dirname, "execution-custody-process-child.js"),
    inputPath,
  );
}

function runIndependentVerifier({
  clone,
  portable,
  result,
  example,
  validationBinding,
  sensitiveValues = [],
}) {
  const inputPath = path.join(clone.exportsRoot, "independent-verifier-input.json");
  fs.writeFileSync(inputPath, `${JSON.stringify({
    gitExecutablePath: clone.gitExecutablePath,
    sourceRepositoryPath: clone.repositoryPath,
    verifierRepositoryPath: absNorm(path.join(clone.exportsRoot, "independent-verifier")),
    exportDir: portable.exportDir,
    baseRevision: example.repository.expectedBaseRevision,
    verifiedHeadRevision: result.verifiedHeadRevision,
    durableRef: result.durableRef,
    allowedPath: example.allowedPath,
    validationExecutablePath: validationBinding.executablePath,
    validationCommands: example.validationCapsule.commands,
    validationHostEnv: validationBinding.hostEnv,
    sensitiveValues,
  }, null, 2)}\n`, "utf8");
  return runJsonChild(
    path.resolve(__dirname, "execution-custody-export-verifier.js"),
    inputPath,
  );
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
  const metaStatus = String(
    runGit(gitExecutablePath, metaRoot, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  assert.equal(metaStatus, "", "live proof must bind a clean immutable Meta-Harness candidate");

  const example = loadExample(examplePath);
  const candidateShort = candidateCommit.slice(0, 12);
  const clockValue = new Date().toISOString();
  const request = buildRequest(example, candidateShort, clockValue, {
    identity: example.repository.repositoryId,
    approvedBy,
  });
  const authorizationId = request.authorizationRequest.authorizationId;
  const custodyParent = path.resolve(metaRoot, ".meta-harness", "local", "custody");
  fs.mkdirSync(custodyParent, { recursive: true });
  const custodyRoot = path.join(
    custodyParent,
    `custody-${example.repository.repositoryId}-${candidateShort}-${sha256Utf8(authorizationId).slice(0, 12)}`,
  );
  assert.equal(fs.existsSync(custodyRoot), false, `create-only custody root must be absent: ${custodyRoot}`);

  const clone = clonePinnedChild({
    example,
    sourcePath: tools.sourcePath,
    rootPath: custodyRoot,
  });
  const validationBinding = buildValidationBinding(example, tools);
  const config = buildConfig({ example, clone, tools, validationBinding });

  const process1 = runControllerProcess({
    clone,
    label: "process-1",
    config,
    request,
    clockValue,
  });
  const verified = process1.result;
  assert.equal(verified.ok, true);
  assert.equal(verified.disposition, "VERIFIED");
  assert.equal(verified.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(verified.agentSpawnCount, 1);
  assert.equal(process1.agentSpawnCount, 1);

  const authReqHex = digestHex(verified.authorizationRequestDigest);
  const receipt = JSON.parse(fs.readFileSync(
    path.join(clone.stateRoot, "attempts", authReqHex, "evidence", "authorization-receipt.json"),
    "utf8",
  ));
  const replayClockValue = new Date(
    new Date(receipt.expiresAt).getTime() + REPLAY_EXPIRY_MARGIN_MS,
  ).toISOString();
  assert.ok(
    new Date(replayClockValue).getTime() > new Date(receipt.expiresAt).getTime(),
    "process 2 clock must be later than authorization expiry",
  );

  const process2 = runControllerProcess({
    clone,
    label: "process-2",
    config: buildCanaryConfig(config, clone.root),
    request,
    clockValue: replayClockValue,
  });
  const replay = process2.result;
  assert.equal(replay.ok, true);
  assert.equal(replay.disposition, "REPLAY");
  assert.equal(replay.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(replay.agentSpawnCount, 0);
  assert.equal(process2.agentSpawnCount, 0);
  assert.equal(replay.verifiedHeadRevision, verified.verifiedHeadRevision);
  assert.equal(replay.terminalManifestDigest, verified.terminalManifestDigest);

  const processMeta = JSON.parse(fs.readFileSync(
    path.join(clone.stateRoot, "attempts", authReqHex, "evidence", "ao-process-meta.json"),
    "utf8",
  ));
  assert.equal(processMeta.spawnOrdinal, 1);
  assert.equal(processMeta.exitCode, 0);
  assert.equal(processMeta.timedOut, false);
  assert.equal(processMeta.capBreached, null);

  const validationSensitiveValues = Array.isArray(validationBinding.sensitiveValues)
    ? validationBinding.sensitiveValues
    : [];
  const portable = exportPortableCustody({
    repositoryPath: clone.repositoryPath,
    stateRoot: clone.stateRoot,
    exportsRoot: clone.exportsRoot,
    authReqHex,
    baseRevision: example.repository.expectedBaseRevision,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    terminalManifestDigest: verified.terminalManifestDigest,
    gitExecutablePath: clone.gitExecutablePath,
    sensitiveValues: [
      clone.root,
      tools.sourcePath,
      tools.nodePath,
      tools.launcherPath,
      tools.nativePath,
      tools.codexHome,
      tools.validationExecutablePath,
      ...validationSensitiveValues,
    ],
  });
  assert.equal(portable.manifest.privacyReview.leakageScan.ok, true);

  const independent = runIndependentVerifier({
    clone,
    portable,
    result: verified,
    example,
    validationBinding,
    sensitiveValues: [
      clone.root,
      tools.sourcePath,
      tools.nodePath,
      tools.launcherPath,
      tools.nativePath,
      tools.codexHome,
      tools.validationExecutablePath,
      ...validationSensitiveValues,
    ],
  });
  assert.equal(independent.ok, true);
  assert.equal(independent.resultCommit, verified.verifiedHeadRevision);
  assert.equal(independent.parent, example.repository.expectedBaseRevision);
  assert.deepEqual(independent.changed, [example.allowedPath]);
  assert.equal(independent.validation.length, example.validationCapsule.commands.length);
  assert.equal(independent.leakage, "PASS");

  const childStatus = String(
    runGit(clone.gitExecutablePath, clone.repositoryPath, ["status", "--porcelain", "-uall"]).stdout,
  ).trim();
  const childHead = String(
    runGit(clone.gitExecutablePath, clone.repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  assert.equal(childStatus, "");
  assert.equal(childHead, example.repository.expectedBaseRevision);

  const closure = {
    schemaVersion: "execution-custody-live-closure/v1",
    candidate: {
      commit: candidateCommit,
      tree: candidateTree,
      trackedWorktreeClean: true,
    },
    child: {
      repositoryId: example.repository.repositoryId,
      baseRevision: example.repository.expectedBaseRevision,
      baseTree: example.repository.expectedBaseTree,
      allowedPath: example.allowedPath,
      retainedCustodyRoot: clone.root,
    },
    process1: {
      clock: clockValue,
      processExitCode: 0,
      controllerClosedAndProcessExited: true,
      disposition: verified.disposition,
      verdict: verified.verdict,
      aoSpawnCount: verified.agentSpawnCount,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      terminalManifestDigest: verified.terminalManifestDigest,
    },
    process2: {
      clock: replayClockValue,
      processExitCode: 0,
      controllerClosedAndProcessExited: true,
      authorizationExpiresAt: receipt.expiresAt,
      laterThanAuthorizationExpiry: true,
      disposition: replay.disposition,
      verdict: replay.verdict,
      aoSpawnCount: replay.agentSpawnCount,
      executionToolPathsUsable: false,
    },
    portable: {
      exportDir: portable.exportDir,
      exportManifestDigest: portable.exportManifestDigest,
      leakageScan: portable.manifest.privacyReview.leakageScan,
      independentVerification: independent,
    },
  };
  fs.writeFileSync(
    path.join(clone.exportsRoot, closureFileName || `${example.repository.repositoryId}-live-closure.json`),
    `${JSON.stringify(closure, null, 2)}\n`,
    "utf8",
  );
  return closure;
}

module.exports = {
  AUTHORIZATION_TTL_SECONDS,
  detectLiveTools,
  snapshotHostEnv,
  validationEnvironmentKeys,
  buildValidationHostEnv,
  loadExample,
  clonePinnedChild,
  buildRequest,
  buildConfig,
  buildCanaryConfig,
  runControllerProcess,
  runIndependentVerifier,
  runLiveCustodyProof,
  sha256Utf8,
  digestHex,
};
