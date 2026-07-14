"use strict";

/**
 * Private example-driven operator orchestration.
 * Not packaged. No public CLI, provider registry, or compatibility surface.
 */

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
} = require("./controller");
const { exportPortableCustody } = require("./custody-export");
const {
  absNorm,
  codedError,
  digestHex,
  isAbsoluteNormalizedFsPath,
  isNonEmptyString,
  isPlainObject,
  writeJsonNoReplace,
} = require("./support");
const { AGENT_ENV_ALLOWLIST } = require("./constants");
const { loadExample, buildRunRequest } = require("./example");
const {
  ensureIsolatedGitHome,
  resolveGitExecutable,
  runGit,
} = require("./git-ops");

const OPERATOR_REQUEST_SCHEMA = "execution-custody-operator-request/v1";
const OPERATOR_RECEIPT_SCHEMA = "execution-custody-operator-receipt/v1";
const AUTHORIZATION_TTL_SECONDS = 3600;
const REPLAY_EXPIRY_MARGIN_MS = 60_000;
const PROCESS_TIMEOUT_MS = 420_000;

function exactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function ensure(condition, code, message, details = {}) {
  if (!condition) throw codedError(code, message, details);
}

function sha256Utf8(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
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

function validateStringMap(value, label) {
  ensure(isPlainObject(value), "CUSTODY_OPERATOR_REQUEST", `${label} must be an object`);
  for (const [key, entry] of Object.entries(value)) {
    ensure(isNonEmptyString(key), "CUSTODY_OPERATOR_REQUEST", `${label} key invalid`);
    ensure(typeof entry === "string", "CUSTODY_OPERATOR_REQUEST", `${label}.${key} must be a string`);
  }
}

function validateAbsolutePath(value, label) {
  ensure(
    isAbsoluteNormalizedFsPath(value),
    "CUSTODY_OPERATOR_REQUEST",
    `${label} must be an absolute normalized path`,
  );
}

function validateOperatorRequest(request) {
  ensure(exactKeys(request, [
    "schemaVersion",
    "operationId",
    "examplePath",
    "sourceRepositoryPath",
    "custodyRoot",
    "approvedBy",
    "agentProgram",
    "validationProgram",
  ]), "CUSTODY_OPERATOR_REQUEST", "operator request top-level shape invalid");
  ensure(
    request.schemaVersion === OPERATOR_REQUEST_SCHEMA,
    "CUSTODY_OPERATOR_REQUEST",
    `schemaVersion must be ${OPERATOR_REQUEST_SCHEMA}`,
  );
  ensure(
    isNonEmptyString(request.operationId)
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(request.operationId),
    "CUSTODY_OPERATOR_REQUEST",
    "operationId must use 3-128 letters, digits, dot, underscore, or hyphen",
  );
  ensure(isNonEmptyString(request.approvedBy), "CUSTODY_OPERATOR_REQUEST", "approvedBy required");
  for (const [key, value] of Object.entries({
    examplePath: request.examplePath,
    sourceRepositoryPath: request.sourceRepositoryPath,
    custodyRoot: request.custodyRoot,
  })) {
    validateAbsolutePath(value, key);
  }

  ensure(exactKeys(request.agentProgram, [
    "nodeExecutablePath",
    "launcherScriptPath",
    "nativeExecutablePath",
    "expectedVersion",
    "codexHome",
  ]), "CUSTODY_OPERATOR_REQUEST", "agentProgram shape invalid");
  for (const key of [
    "nodeExecutablePath", "launcherScriptPath", "nativeExecutablePath", "codexHome",
  ]) {
    validateAbsolutePath(request.agentProgram[key], `agentProgram.${key}`);
  }
  ensure(
    isNonEmptyString(request.agentProgram.expectedVersion),
    "CUSTODY_OPERATOR_REQUEST",
    "agentProgram.expectedVersion required",
  );

  ensure(exactKeys(request.validationProgram, [
    "executablePath", "hostEnv", "sensitiveValues",
  ]), "CUSTODY_OPERATOR_REQUEST", "validationProgram shape invalid");
  validateAbsolutePath(request.validationProgram.executablePath, "validationProgram.executablePath");
  validateStringMap(request.validationProgram.hostEnv, "validationProgram.hostEnv");
  ensure(
    Array.isArray(request.validationProgram.sensitiveValues)
      && request.validationProgram.sensitiveValues.every((value) => typeof value === "string"),
    "CUSTODY_OPERATOR_REQUEST",
    "validationProgram.sensitiveValues must be a string array",
  );

  return Object.freeze(JSON.parse(JSON.stringify(request)));
}

function loadOperatorRequestEnvelope(inputPath) {
  validateAbsolutePath(inputPath, "operator request path");
  let bytes;
  let parsed;
  try {
    bytes = fs.readFileSync(inputPath);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    throw codedError("CUSTODY_OPERATOR_REQUEST_READ", `operator request read failed: ${err.message}`);
  }
  return {
    request: validateOperatorRequest(parsed),
    requestDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function loadOperatorRequest(inputPath) {
  return loadOperatorRequestEnvelope(inputPath).request;
}

function requireExistingFile(filePath, label) {
  ensure(fs.existsSync(filePath), "CUSTODY_OPERATOR_BINDING", `${label} does not exist`);
  ensure(fs.statSync(filePath).isFile(), "CUSTODY_OPERATOR_BINDING", `${label} must be a file`);
}

function requireExistingDirectory(directoryPath, label) {
  ensure(fs.existsSync(directoryPath), "CUSTODY_OPERATOR_BINDING", `${label} does not exist`);
  ensure(
    fs.statSync(directoryPath).isDirectory(),
    "CUSTODY_OPERATOR_BINDING",
    `${label} must be a directory`,
  );
}

function requirePrivateCustodyRoot(metaRoot, custodyRoot) {
  const approvedParent = absNorm(path.join(metaRoot, ".meta-harness", "local", "custody"));
  const requestedParent = path.dirname(custodyRoot);
  const parentMatches = requestedParent === approvedParent
    || (process.platform === "win32"
      && requestedParent.toLowerCase() === approvedParent.toLowerCase());
  ensure(
    parentMatches,
    "CUSTODY_OPERATOR_ROOT",
    "custodyRoot must be one create-only directory under .meta-harness/local/custody",
  );
  fs.mkdirSync(approvedParent, { recursive: true });
  const approvedReal = fs.realpathSync(approvedParent);
  ensure(
    approvedReal === approvedParent
      || (process.platform === "win32" && approvedReal.toLowerCase() === approvedParent.toLowerCase()),
    "CUSTODY_OPERATOR_ROOT",
    "private custody parent must not resolve elsewhere",
  );
}

function requireApprovedExamplePath(metaRoot, examplePath) {
  requireExistingFile(examplePath, "examplePath");
  const examplesRoot = fs.realpathSync(path.join(
    metaRoot,
    ".agents",
    "skills",
    "bounded-repository-change",
    "examples",
  ));
  const exampleReal = fs.realpathSync(examplePath);
  const relative = path.relative(examplesRoot, exampleReal);
  ensure(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative) && relative.endsWith(".json"),
    "CUSTODY_OPERATOR_EXAMPLE",
    "examplePath must name one tracked bounded-repository-change example",
  );
}

function identityToken(value) {
  const token = String(value || "custody")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "CUSTODY";
}

function buildOperatorRunRequest(example, operationId, clockValue, approvedBy) {
  const approvedAt = new Date(new Date(clockValue).getTime() - 5 * 60 * 1000).toISOString();
  const token = identityToken(operationId);
  return buildRunRequest(example, {
    runId: `RUN-${token}`,
    approvalId: `APPROVAL-${token}`,
    authorizationId: `AUTH-${token}`,
    attemptId: `ATTEMPT-${token}`,
    approvedAt,
    approvedBy,
  }).request;
}

function clonePinnedChild({ example, sourceRepositoryPath, custodyRoot }) {
  const root = absNorm(custodyRoot);
  ensure(
    !fs.existsSync(root),
    "CUSTODY_OPERATOR_ROOT_EXISTS",
    `create-only custody root already exists: ${root}`,
  );
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(root, { recursive: false });

  const repositoryPath = absNorm(path.join(root, "repository"));
  const stateRoot = absNorm(path.join(root, "state"));
  const workspaceRoot = absNorm(path.join(root, "workspaces"));
  const exportsRoot = absNorm(path.join(root, "exports"));
  for (const directory of [repositoryPath, stateRoot, workspaceRoot, exportsRoot]) {
    fs.mkdirSync(directory, { recursive: false });
  }

  const gitHome = ensureIsolatedGitHome(stateRoot);
  const { gitExecutablePath, gitVersion } = resolveGitExecutable(gitHome);
  runGit(gitExecutablePath, repositoryPath, ["init"], gitHome);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"], gitHome);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.eol", "lf"], gitHome);
  runGit(gitExecutablePath, repositoryPath, [
    "fetch",
    "--no-tags",
    "--depth=1",
    sourceRepositoryPath,
    example.repository.expectedBaseRevision,
  ], gitHome);
  runGit(gitExecutablePath, repositoryPath, ["checkout", "--detach", "FETCH_HEAD"], gitHome);
  runGit(gitExecutablePath, repositoryPath, ["reset", "--hard", "HEAD"], gitHome);

  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"], gitHome).stdout,
  ).trim();
  const tree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"], gitHome).stdout,
  ).trim();
  const status = String(
    runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain", "-uall"], gitHome).stdout,
  ).trim();
  const revisionCount = Number(String(
    runGit(gitExecutablePath, repositoryPath, ["rev-list", "--count", "HEAD"], gitHome).stdout,
  ).trim());
  const remotes = String(
    runGit(gitExecutablePath, repositoryPath, ["remote"], gitHome).stdout,
  ).trim().split(/\r?\n/).filter(Boolean);
  const shallowPath = path.join(repositoryPath, ".git", "shallow");
  const shallowBoundary = fs.existsSync(shallowPath)
    ? fs.readFileSync(shallowPath, "utf8").trim()
    : "";

  ensure(
    headRevision === example.repository.expectedBaseRevision,
    "CUSTODY_OPERATOR_BASE",
    "shallow authority HEAD does not match example base revision",
  );
  ensure(
    tree === example.repository.expectedBaseTree,
    "CUSTODY_OPERATOR_BASE",
    "shallow authority tree does not match example base tree",
  );
  ensure(status === "", "CUSTODY_OPERATOR_BASE", "shallow authority must be clean");
  ensure(revisionCount === 1, "CUSTODY_OPERATOR_BASE", "shallow authority must expose one revision");
  ensure(
    shallowBoundary === example.repository.expectedBaseRevision,
    "CUSTODY_OPERATOR_BASE",
    "shallow boundary must equal example base revision",
  );
  ensure(remotes.length === 0, "CUSTODY_OPERATOR_BASE", "shallow authority must retain no remote");
  ensure(
    fs.existsSync(path.join(repositoryPath, ...example.allowedPath.split("/"))),
    "CUSTODY_OPERATOR_BASE",
    "allowed path missing from pinned authority",
  );

  return {
    root,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    exportsRoot,
    gitHome,
    gitExecutablePath,
    gitVersion,
    headRevision,
    tree,
    revisionCount,
    shallowBoundary,
    remoteCount: remotes.length,
  };
}

function buildConfig({ example, clone, request }) {
  const agent = request.agentProgram;
  const validation = request.validationProgram;
  for (const [label, filePath] of Object.entries({
    nodeExecutablePath: agent.nodeExecutablePath,
    launcherScriptPath: agent.launcherScriptPath,
    nativeExecutablePath: agent.nativeExecutablePath,
    validationExecutablePath: validation.executablePath,
  })) {
    requireExistingFile(filePath, label);
  }
  requireExistingDirectory(agent.codexHome, "agentProgram.codexHome");

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
      nodeExecutablePath: agent.nodeExecutablePath,
      launcherScriptPath: agent.launcherScriptPath,
      expectedLauncherSha256: sha256File(agent.launcherScriptPath),
      nativeExecutablePath: agent.nativeExecutablePath,
      expectedNativeSha256: sha256File(agent.nativeExecutablePath),
      expectedVersion: agent.expectedVersion,
      codexHome: agent.codexHome,
      hostEnv: snapshotHostEnv(AGENT_ENV_ALLOWLIST),
    },
    validationProgram: {
      commandName: example.validationCapsule.commandName,
      executablePath: validation.executablePath,
      expectedExecutableSha256: sha256File(validation.executablePath),
      hostEnv: validation.hostEnv,
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

function runJsonChild(scriptPath, inputPath, cwd, timeout = PROCESS_TIMEOUT_MS) {
  const child = spawnSync(process.execPath, [scriptPath, inputPath], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: process.env,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw codedError(
      "CUSTODY_OPERATOR_CHILD",
      `${path.basename(scriptPath)} failed ${child.status}: ${String(child.stderr || child.stdout || "").trim()}`,
      { status: child.status },
    );
  }
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  ensure(lines.length > 0, "CUSTODY_OPERATOR_CHILD", `${path.basename(scriptPath)} produced no result`);
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    throw codedError(
      "CUSTODY_OPERATOR_CHILD",
      `${path.basename(scriptPath)} returned invalid JSON: ${err.message}`,
    );
  }
}

function runControllerProcess({ metaRoot, clone, label, config, request, clockValue }) {
  const inputPath = path.join(clone.exportsRoot, `${label}-input.json`);
  writeJsonNoReplace(inputPath, { config, request, clock: clockValue });
  return runJsonChild(
    path.join(metaRoot, "internal", "execution-custody", "operator-process.js"),
    inputPath,
    metaRoot,
  );
}

function runIndependentVerifier({
  metaRoot,
  clone,
  portable,
  result,
  example,
  request,
  sensitiveValues,
}) {
  const inputPath = path.join(clone.exportsRoot, "independent-verifier-input.json");
  writeJsonNoReplace(inputPath, {
    gitExecutablePath: clone.gitExecutablePath,
    sourceRepositoryPath: clone.repositoryPath,
    verifierRepositoryPath: absNorm(path.join(clone.exportsRoot, "independent-verifier")),
    exportDir: portable.exportDir,
    baseRevision: example.repository.expectedBaseRevision,
    verifiedHeadRevision: result.verifiedHeadRevision,
    durableRef: result.durableRef,
    allowedPath: example.allowedPath,
    validationExecutablePath: request.validationProgram.executablePath,
    validationCommands: example.validationCapsule.commands,
    validationHostEnv: request.validationProgram.hostEnv,
    sensitiveValues,
  });
  return runJsonChild(
    path.join(metaRoot, "internal", "execution-custody", "portable-verifier.js"),
    inputPath,
    metaRoot,
  );
}

function metaHarnessIdentity(metaRoot, gitExecutablePath, gitHome) {
  const commit = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD"], gitHome).stdout,
  ).trim();
  const tree = String(
    runGit(gitExecutablePath, metaRoot, ["rev-parse", "HEAD^{tree}"], gitHome).stdout,
  ).trim();
  const status = String(
    runGit(gitExecutablePath, metaRoot, ["status", "--porcelain", "-uall"], gitHome).stdout,
  ).trim();
  ensure(status === "", "CUSTODY_OPERATOR_CANDIDATE", "operator requires a clean immutable Meta-Harness candidate");
  return { commit, tree, trackedWorktreeClean: true };
}

function operateBoundedRepositoryChange({ operatorRequestPath, metaRoot: metaRootInput }) {
  const startedAt = new Date();
  const metaRoot = absNorm(metaRootInput || path.resolve(__dirname, "../.."));
  requireExistingDirectory(metaRoot, "metaRoot");
  const requestPath = absNorm(operatorRequestPath);
  const requestEnvelope = loadOperatorRequestEnvelope(requestPath);
  const localRequest = requestEnvelope.request;
  requireApprovedExamplePath(metaRoot, localRequest.examplePath);
  requireExistingDirectory(localRequest.sourceRepositoryPath, "sourceRepositoryPath");
  requirePrivateCustodyRoot(metaRoot, localRequest.custodyRoot);

  const candidateCheckRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-operator-candidate-"));
  let candidate;
  try {
    const candidateGitHome = ensureIsolatedGitHome(candidateCheckRoot);
    const candidateGit = resolveGitExecutable(candidateGitHome);
    candidate = metaHarnessIdentity(metaRoot, candidateGit.gitExecutablePath, candidateGitHome);
  } finally {
    fs.rmSync(candidateCheckRoot, { recursive: true, force: true });
  }

  const example = loadExample(localRequest.examplePath);
  const clone = clonePinnedChild({
    example,
    sourceRepositoryPath: localRequest.sourceRepositoryPath,
    custodyRoot: localRequest.custodyRoot,
  });
  const clockValue = startedAt.toISOString();
  const runRequest = buildOperatorRunRequest(
    example,
    localRequest.operationId,
    clockValue,
    localRequest.approvedBy,
  );
  const config = buildConfig({ example, clone, request: localRequest });

  const process1 = runControllerProcess({
    metaRoot,
    clone,
    label: "process-1",
    config,
    request: runRequest,
    clockValue,
  });
  const verified = process1.result;
  ensure(verified.ok === true, "CUSTODY_OPERATOR_RESULT", "process 1 did not return ok");
  ensure(verified.disposition === "VERIFIED", "CUSTODY_OPERATOR_RESULT", "process 1 not VERIFIED");
  ensure(
    verified.verdict === "IMPLEMENTATION_VERIFIED",
    "CUSTODY_OPERATOR_RESULT",
    "process 1 verdict mismatch",
  );
  ensure(verified.agentSpawnCount === 1, "CUSTODY_OPERATOR_RESULT", "process 1 spawn count mismatch");
  ensure(process1.agentSpawnCount === 1, "CUSTODY_OPERATOR_RESULT", "controller spawn count mismatch");

  const authReqHex = digestHex(verified.authorizationRequestDigest);
  const evidenceRoot = path.join(clone.stateRoot, "attempts", authReqHex, "evidence");
  const receipt = JSON.parse(fs.readFileSync(
    path.join(evidenceRoot, "authorization-receipt.json"),
    "utf8",
  ));
  const replayClockValue = new Date(
    new Date(receipt.expiresAt).getTime() + REPLAY_EXPIRY_MARGIN_MS,
  ).toISOString();
  ensure(
    new Date(replayClockValue).getTime() > new Date(receipt.expiresAt).getTime(),
    "CUSTODY_OPERATOR_REPLAY",
    "process 2 clock must be later than authorization expiry",
  );

  const process2 = runControllerProcess({
    metaRoot,
    clone,
    label: "process-2",
    config: buildCanaryConfig(config, clone.root),
    request: runRequest,
    clockValue: replayClockValue,
  });
  const replay = process2.result;
  ensure(replay.ok === true, "CUSTODY_OPERATOR_REPLAY", "process 2 did not return ok");
  ensure(replay.disposition === "REPLAY", "CUSTODY_OPERATOR_REPLAY", "process 2 not REPLAY");
  ensure(replay.agentSpawnCount === 0, "CUSTODY_OPERATOR_REPLAY", "process 2 spawned agent");
  ensure(process2.agentSpawnCount === 0, "CUSTODY_OPERATOR_REPLAY", "process 2 controller spawn mismatch");
  ensure(
    replay.verifiedHeadRevision === verified.verifiedHeadRevision,
    "CUSTODY_OPERATOR_REPLAY",
    "replay verified head changed",
  );
  ensure(
    replay.terminalManifestDigest === verified.terminalManifestDigest,
    "CUSTODY_OPERATOR_REPLAY",
    "replay terminal manifest changed",
  );

  const processMeta = JSON.parse(fs.readFileSync(path.join(evidenceRoot, "ao-process-meta.json"), "utf8"));
  ensure(processMeta.spawnOrdinal === 1, "CUSTODY_OPERATOR_RESULT", "AO spawn ordinal mismatch");
  ensure(processMeta.exitCode === 0, "CUSTODY_OPERATOR_RESULT", "AO exit code mismatch");
  ensure(processMeta.timedOut === false, "CUSTODY_OPERATOR_RESULT", "AO timed out");

  const sensitiveValues = [
    clone.root,
    requestPath,
    localRequest.sourceRepositoryPath,
    localRequest.agentProgram.nodeExecutablePath,
    localRequest.agentProgram.launcherScriptPath,
    localRequest.agentProgram.nativeExecutablePath,
    localRequest.agentProgram.codexHome,
    localRequest.validationProgram.executablePath,
    ...localRequest.validationProgram.sensitiveValues,
  ];
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
    sensitiveValues,
  });
  ensure(
    portable.manifest.privacyReview.leakageScan.ok === true,
    "CUSTODY_OPERATOR_EXPORT",
    "portable leakage scan failed",
  );

  const independent = runIndependentVerifier({
    metaRoot,
    clone,
    portable,
    result: verified,
    example,
    request: localRequest,
    sensitiveValues,
  });
  ensure(independent.ok === true, "CUSTODY_OPERATOR_EXPORT", "independent verification failed");
  ensure(
    independent.resultCommit === verified.verifiedHeadRevision,
    "CUSTODY_OPERATOR_EXPORT",
    "independent result commit mismatch",
  );
  ensure(
    independent.parent === example.repository.expectedBaseRevision,
    "CUSTODY_OPERATOR_EXPORT",
    "independent parent mismatch",
  );
  ensure(
    JSON.stringify(independent.changed) === JSON.stringify([example.allowedPath]),
    "CUSTODY_OPERATOR_EXPORT",
    "independent changed-path mismatch",
  );
  ensure(independent.leakage === "PASS", "CUSTODY_OPERATOR_EXPORT", "independent leakage failed");

  const childStatus = String(
    runGit(
      clone.gitExecutablePath,
      clone.repositoryPath,
      ["status", "--porcelain", "-uall"],
      clone.gitHome,
    ).stdout,
  ).trim();
  const childHead = String(
    runGit(clone.gitExecutablePath, clone.repositoryPath, ["rev-parse", "HEAD"], clone.gitHome).stdout,
  ).trim();
  ensure(childStatus === "", "CUSTODY_OPERATOR_BASE", "primary authority clone became dirty");
  ensure(
    childHead === example.repository.expectedBaseRevision,
    "CUSTODY_OPERATOR_BASE",
    "primary authority clone moved from pinned base",
  );
  const candidateAfter = metaHarnessIdentity(metaRoot, clone.gitExecutablePath, clone.gitHome);
  ensure(
    candidateAfter.commit === candidate.commit && candidateAfter.tree === candidate.tree,
    "CUSTODY_OPERATOR_CANDIDATE",
    "Meta-Harness candidate identity changed during operation",
  );

  const endedAt = new Date();
  const operatorReceipt = {
    schemaVersion: OPERATOR_RECEIPT_SCHEMA,
    operation: {
      operationId: localRequest.operationId,
      requestDigest: requestEnvelope.requestDigest,
      approvedBy: localRequest.approvedBy,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMilliseconds: endedAt.getTime() - startedAt.getTime(),
    },
    candidate: {
      ...candidate,
      trackedWorktreeCleanAfter: candidateAfter.trackedWorktreeClean,
    },
    child: {
      repositoryId: example.repository.repositoryId,
      baseRevision: example.repository.expectedBaseRevision,
      baseTree: example.repository.expectedBaseTree,
      allowedPath: example.allowedPath,
      retainedCustodyRoot: clone.root,
      authority: {
        headRevision: clone.headRevision,
        tree: clone.tree,
        trackedWorktreeClean: childStatus === "",
        visibleRevisionCount: clone.revisionCount,
        shallowBoundary: clone.shallowBoundary,
        remoteCount: clone.remoteCount,
      },
    },
    process1: {
      clock: clockValue,
      processExitCode: 0,
      controllerClosedAndProcessExited: true,
      disposition: verified.disposition,
      verdict: verified.verdict,
      agentSpawnCount: verified.agentSpawnCount,
      verifiedHeadRevision: verified.verifiedHeadRevision,
      durableRef: verified.durableRef,
      terminalManifestDigest: verified.terminalManifestDigest,
      agentVersion: processMeta.version,
      agentExitCode: processMeta.exitCode,
      agentTimedOut: processMeta.timedOut,
    },
    process2: {
      clock: replayClockValue,
      authorizationExpiresAt: receipt.expiresAt,
      secondsAfterAuthorizationExpiry: REPLAY_EXPIRY_MARGIN_MS / 1000,
      processExitCode: 0,
      controllerClosedAndProcessExited: true,
      disposition: replay.disposition,
      verdict: replay.verdict,
      agentSpawnCount: replay.agentSpawnCount,
      executionToolPathsUsable: false,
      validationToolPathUsable: false,
    },
    portable: {
      exportDir: portable.exportDir,
      exportManifestDigest: portable.exportManifestDigest,
      leakageScan: portable.manifest.privacyReview.leakageScan,
      independentVerification: independent,
    },
  };
  const receiptPath = path.join(clone.exportsRoot, "operator-receipt.json");
  writeJsonNoReplace(receiptPath, operatorReceipt);
  return {
    ok: true,
    receiptPath,
    receipt: operatorReceipt,
  };
}

module.exports = {
  OPERATOR_REQUEST_SCHEMA,
  OPERATOR_RECEIPT_SCHEMA,
  AUTHORIZATION_TTL_SECONDS,
  REPLAY_EXPIRY_MARGIN_MS,
  validateOperatorRequest,
  loadOperatorRequestEnvelope,
  loadOperatorRequest,
  snapshotHostEnv,
  identityToken,
  buildOperatorRunRequest,
  clonePinnedChild,
  buildConfig,
  buildCanaryConfig,
  runControllerProcess,
  runIndependentVerifier,
  operateBoundedRepositoryChange,
  sha256Utf8,
};
