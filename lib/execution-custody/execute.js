"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { assertStrictJsonData } = require("../contracts/canonical-json");
const { validateRunSpecApproval } = require("../contracts/run-spec-approval");
const {
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
} = require("./controller");
const { exportPortableCustody } = require("./custody-export");
const { AGENT_ENV_ALLOWLIST } = require("./constants");
const {
  absNorm,
  canonicalExistingRoot,
  codedError,
  digestHex,
  hostRealPath,
  isAbsoluteNormalizedFsPath,
  isNonEmptyString,
  isPlainObject,
  sha256File,
  writeJsonNoReplace,
} = require("./support");
const {
  ensureIsolatedGitHome,
  resolveGitExecutable,
  runGit,
} = require("./git-ops");

const EXECUTION_REQUEST_SCHEMA = "meta-harness-execution-request/v1";
const EXECUTION_RECEIPT_SCHEMA = "meta-harness-execution-receipt/v1";
const EXECUTION_RESULT_SCHEMA = "meta-harness-execute-result/v1";
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

function validateDigestHex(value, label, length = 64) {
  ensure(
    typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value),
    "CUSTODY_EXECUTION_REQUEST",
    `${label} must be ${length} lowercase hex chars`,
  );
}

function validateAbsolutePath(value, label) {
  ensure(
    isAbsoluteNormalizedFsPath(value),
    "CUSTODY_EXECUTION_REQUEST",
    `${label} must be an absolute normalized path`,
  );
}

function validateStringMap(value, label) {
  ensure(isPlainObject(value), "CUSTODY_EXECUTION_REQUEST", `${label} must be an object`);
  for (const [key, entry] of Object.entries(value)) {
    ensure(isNonEmptyString(key), "CUSTODY_EXECUTION_REQUEST", `${label} key invalid`);
    ensure(typeof entry === "string", "CUSTODY_EXECUTION_REQUEST", `${label}.${key} must be a string`);
  }
}

function validateExecutionRequest(request) {
  try {
    assertStrictJsonData(request);
  } catch (error) {
    throw codedError(
      "CUSTODY_EXECUTION_REQUEST",
      `request must contain strict JSON data: ${error.message}`,
    );
  }
  ensure(exactKeys(request, [
    "schemaVersion",
    "executionId",
    "sourceRepositoryPath",
    "custodyRoot",
    "expectedBaseTree",
    "runRequest",
    "agentProgram",
    "validationProgram",
  ]), "CUSTODY_EXECUTION_REQUEST", "execution request top-level shape invalid");
  ensure(
    request.schemaVersion === EXECUTION_REQUEST_SCHEMA,
    "CUSTODY_EXECUTION_REQUEST",
    `schemaVersion must be ${EXECUTION_REQUEST_SCHEMA}`,
  );
  ensure(
    isNonEmptyString(request.executionId)
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(request.executionId),
    "CUSTODY_EXECUTION_REQUEST",
    "executionId must use 3-128 letters, digits, dot, underscore, or hyphen",
  );
  validateAbsolutePath(request.sourceRepositoryPath, "sourceRepositoryPath");
  validateAbsolutePath(request.custodyRoot, "custodyRoot");

  ensure(exactKeys(request.runRequest, ["runSpecApproval", "authorizationRequest"]),
    "CUSTODY_EXECUTION_REQUEST", "runRequest shape invalid");
  const approvalCheck = validateRunSpecApproval(request.runRequest.runSpecApproval, {
    maxCommandTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
  });
  ensure(
    approvalCheck.ok,
    "CUSTODY_EXECUTION_REQUEST",
    `runSpecApproval invalid: ${JSON.stringify(approvalCheck.reasons)}`,
    { reasons: approvalCheck.reasons },
  );
  const authorizationRequest = request.runRequest.authorizationRequest;
  ensure(
    exactKeys(authorizationRequest, ["authorizationId", "attemptId"])
      && isNonEmptyString(authorizationRequest.authorizationId)
      && isNonEmptyString(authorizationRequest.attemptId),
    "CUSTODY_EXECUTION_REQUEST",
    "authorizationRequest must be exactly { authorizationId, attemptId }",
  );

  const runSpec = request.runRequest.runSpecApproval.runSpec;
  ensure(
    Array.isArray(runSpec.scope.allow)
      && runSpec.scope.allow.length === 1
      && Array.isArray(runSpec.scope.deny)
      && runSpec.scope.deny.length === 0,
    "CUSTODY_EXECUTION_REQUEST",
    "v1 requires exactly one allowed path and an empty deny list",
  );
  ensure(
    runSpec.changePolicy === "forbid-noop",
    "CUSTODY_EXECUTION_REQUEST",
    "v1 requires changePolicy forbid-noop",
  );
  ensure(
    Array.isArray(runSpec.validation.commands) && runSpec.validation.commands.length > 0,
    "CUSTODY_EXECUTION_REQUEST",
    "v1 requires one or more validation commands",
  );
  const objectLength = runSpec.repository.objectFormat === "sha256" ? 64 : 40;
  validateDigestHex(request.expectedBaseTree, "expectedBaseTree", objectLength);

  ensure(exactKeys(request.agentProgram, [
    "nodeExecutablePath",
    "expectedNodeSha256",
    "launcherScriptPath",
    "expectedLauncherSha256",
    "nativeExecutablePath",
    "expectedNativeSha256",
    "expectedVersion",
    "codexHome",
  ]), "CUSTODY_EXECUTION_REQUEST", "agentProgram shape invalid");
  for (const key of [
    "nodeExecutablePath", "launcherScriptPath", "nativeExecutablePath", "codexHome",
  ]) {
    validateAbsolutePath(request.agentProgram[key], `agentProgram.${key}`);
  }
  validateDigestHex(request.agentProgram.expectedNodeSha256, "agentProgram.expectedNodeSha256");
  validateDigestHex(request.agentProgram.expectedLauncherSha256, "agentProgram.expectedLauncherSha256");
  validateDigestHex(request.agentProgram.expectedNativeSha256, "agentProgram.expectedNativeSha256");
  ensure(
    isNonEmptyString(request.agentProgram.expectedVersion),
    "CUSTODY_EXECUTION_REQUEST",
    "agentProgram.expectedVersion required",
  );

  ensure(exactKeys(request.validationProgram, [
    "commandName",
    "executablePath",
    "expectedExecutableSha256",
    "hostEnv",
    "sensitiveValues",
  ]), "CUSTODY_EXECUTION_REQUEST", "validationProgram shape invalid");
  ensure(
    isNonEmptyString(request.validationProgram.commandName),
    "CUSTODY_EXECUTION_REQUEST",
    "validationProgram.commandName required",
  );
  validateAbsolutePath(request.validationProgram.executablePath, "validationProgram.executablePath");
  validateDigestHex(
    request.validationProgram.expectedExecutableSha256,
    "validationProgram.expectedExecutableSha256",
  );
  validateStringMap(request.validationProgram.hostEnv, "validationProgram.hostEnv");
  ensure(
    Array.isArray(request.validationProgram.sensitiveValues)
      && request.validationProgram.sensitiveValues.every((value) => typeof value === "string"),
    "CUSTODY_EXECUTION_REQUEST",
    "validationProgram.sensitiveValues must be a string array",
  );
  for (const command of runSpec.validation.commands) {
    ensure(
      command.argv[0] === request.validationProgram.commandName,
      "CUSTODY_EXECUTION_REQUEST",
      "every validation command must use validationProgram.commandName",
    );
    ensure(
      command.networkPolicy === "denied",
      "CUSTODY_EXECUTION_REQUEST",
      "every validation command must deny network access",
    );
  }

  return Object.freeze(JSON.parse(JSON.stringify(request)));
}

function rejectExistingSymlinkComponents(inputPath, label) {
  const absolute = absNorm(inputPath);
  const root = path.parse(absolute).root;
  const relative = absolute.slice(root.length);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const lstat = fs.lstatSync(current);
    ensure(!lstat.isSymbolicLink(), "CUSTODY_EXECUTION_PATH", `${label} contains symlink: ${current}`);
  }
}

function requireRegularNonSymlinkFile(filePath, label) {
  rejectExistingSymlinkComponents(filePath, label);
  const lstat = fs.lstatSync(filePath);
  ensure(
    lstat.isFile() && !lstat.isSymbolicLink(),
    "CUSTODY_EXECUTION_BINDING",
    `${label} must be a regular non-symlink file`,
  );
  return hostRealPath(filePath);
}

function loadExecutionRequestEnvelope(requestPathInput) {
  validateAbsolutePath(requestPathInput, "request path");
  const requestPath = absNorm(requestPathInput);
  let bytes;
  let parsed;
  try {
    requireRegularNonSymlinkFile(requestPath, "request path");
    bytes = fs.readFileSync(requestPath);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error && String(error.code || "").startsWith("CUSTODY_")) throw error;
    throw codedError("CUSTODY_EXECUTION_REQUEST_READ", `request read failed: ${error.message}`);
  }
  return Object.freeze({
    requestPath,
    request: validateExecutionRequest(parsed),
    requestDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  });
}

function comparePath(value) {
  const normalized = absNorm(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathContains(parent, child) {
  const parentValue = comparePath(parent);
  const childValue = comparePath(child);
  return childValue === parentValue || childValue.startsWith(`${parentValue}${path.sep}`);
}

function requireSeparatedPaths(left, right, leftLabel, rightLabel) {
  ensure(
    !pathContains(left, right) && !pathContains(right, left),
    "CUSTODY_EXECUTION_ROOT",
    `${leftLabel} and ${rightLabel} must be separated`,
  );
}

function verifyExpectedFile(filePath, expectedSha256, label) {
  const realPath = requireRegularNonSymlinkFile(filePath, label);
  const observedSha256 = sha256File(realPath);
  ensure(
    observedSha256 === expectedSha256,
    "CUSTODY_EXECUTION_IDENTITY",
    `${label} sha256 mismatch`,
    { expected: expectedSha256, actual: observedSha256 },
  );
  return Object.freeze({ realPath, expectedSha256, observedSha256 });
}

function snapshotHostEnv(keys, source = process.env) {
  const result = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      result[key] = String(value);
    }
  }
  return result;
}

function sourceObjectPreflight(sourceRepositoryPath, runSpec, expectedBaseTree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-execute-preflight-"));
  try {
    const gitHome = ensureIsolatedGitHome(root);
    const { gitExecutablePath, gitVersion } = resolveGitExecutable(gitHome);
    const resolvedRevision = String(runGit(
      gitExecutablePath,
      sourceRepositoryPath,
      ["rev-parse", `${runSpec.repository.expectedBaseRevision}^{commit}`],
      gitHome,
    ).stdout).trim();
    const resolvedTree = String(runGit(
      gitExecutablePath,
      sourceRepositoryPath,
      ["rev-parse", `${resolvedRevision}^{tree}`],
      gitHome,
    ).stdout).trim();
    let objectFormat = resolvedRevision.length === 64 ? "sha256" : "sha1";
    try {
      const observed = String(runGit(
        gitExecutablePath,
        sourceRepositoryPath,
        ["rev-parse", "--show-object-format"],
        gitHome,
      ).stdout).trim();
      if (observed === "sha1" || observed === "sha256") objectFormat = observed;
    } catch {
      // Hash length fallback above is sufficient for older Git.
    }
    ensure(
      resolvedRevision === runSpec.repository.expectedBaseRevision,
      "CUSTODY_EXECUTION_BASE",
      "source base revision does not resolve to the requested immutable commit",
    );
    ensure(
      resolvedTree === expectedBaseTree,
      "CUSTODY_EXECUTION_BASE",
      "source base tree does not match expectedBaseTree",
    );
    ensure(
      objectFormat === runSpec.repository.objectFormat,
      "CUSTODY_EXECUTION_BASE",
      "source object format does not match the sealed run specification",
    );
    return { gitVersion, resolvedRevision, resolvedTree, objectFormat };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function validateLocalBindings(envelope) {
  const { request } = envelope;
  const runSpec = request.runRequest.runSpecApproval.runSpec;

  const sourceRepositoryPath = canonicalExistingRoot(
    request.sourceRepositoryPath,
    "sourceRepositoryPath",
  );
  ensure(
    fs.statSync(sourceRepositoryPath).isDirectory(),
    "CUSTODY_EXECUTION_BINDING",
    "sourceRepositoryPath must be a directory",
  );

  const custodyRoot = absNorm(request.custodyRoot);
  ensure(
    !fs.existsSync(custodyRoot),
    "CUSTODY_EXECUTION_ROOT_EXISTS",
    `create-only custody root already exists: ${custodyRoot}`,
  );
  const custodyParentInput = path.dirname(custodyRoot);
  const custodyParent = canonicalExistingRoot(custodyParentInput, "custodyRoot parent");
  ensure(
    fs.statSync(custodyParent).isDirectory(),
    "CUSTODY_EXECUTION_ROOT",
    "custodyRoot immediate parent must be an existing directory",
  );
  const proposedCustodyRoot = absNorm(path.join(custodyParent, path.basename(custodyRoot)));
  requireSeparatedPaths(sourceRepositoryPath, proposedCustodyRoot, "sourceRepositoryPath", "custodyRoot");

  const packageRoot = canonicalExistingRoot(path.resolve(__dirname, "../.."), "installed package root");
  requireSeparatedPaths(packageRoot, proposedCustodyRoot, "installed package root", "custodyRoot");
  const packageJsonPath = requireRegularNonSymlinkFile(
    path.join(packageRoot, "package.json"),
    "installed package.json",
  );
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  ensure(
    isNonEmptyString(packageJson.name) && isNonEmptyString(packageJson.version),
    "CUSTODY_EXECUTION_PACKAGE",
    "installed package name and version required",
  );

  const controllerEntrypointPath = requireRegularNonSymlinkFile(
    path.join(__dirname, "controller-process.js"),
    "controller entrypoint",
  );
  const verifierEntrypointPath = requireRegularNonSymlinkFile(
    path.join(__dirname, "portable-verifier.js"),
    "portable verifier entrypoint",
  );

  const node = verifyExpectedFile(
    request.agentProgram.nodeExecutablePath,
    request.agentProgram.expectedNodeSha256,
    "agentProgram.nodeExecutablePath",
  );
  const launcher = verifyExpectedFile(
    request.agentProgram.launcherScriptPath,
    request.agentProgram.expectedLauncherSha256,
    "agentProgram.launcherScriptPath",
  );
  const native = verifyExpectedFile(
    request.agentProgram.nativeExecutablePath,
    request.agentProgram.expectedNativeSha256,
    "agentProgram.nativeExecutablePath",
  );
  const validation = verifyExpectedFile(
    request.validationProgram.executablePath,
    request.validationProgram.expectedExecutableSha256,
    "validationProgram.executablePath",
  );
  const codexHome = canonicalExistingRoot(request.agentProgram.codexHome, "agentProgram.codexHome");
  ensure(
    fs.statSync(codexHome).isDirectory(),
    "CUSTODY_EXECUTION_BINDING",
    "agentProgram.codexHome must be a non-symlink directory",
  );

  const sourcePreflight = sourceObjectPreflight(
    sourceRepositoryPath,
    runSpec,
    request.expectedBaseTree,
  );

  return Object.freeze({
    requestPath: envelope.requestPath,
    sourceRepositoryPath,
    custodyRoot: proposedCustodyRoot,
    packageRoot,
    packageIdentity: Object.freeze({ name: packageJson.name, version: packageJson.version }),
    controllerEntrypointPath,
    verifierEntrypointPath,
    codexHome,
    tools: Object.freeze({ node, launcher, native, validation }),
    sourcePreflight: Object.freeze(sourcePreflight),
  });
}

function createCustodyAuthority({ request, bindings }) {
  const runSpec = request.runRequest.runSpecApproval.runSpec;
  const root = bindings.custodyRoot;
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
    bindings.sourceRepositoryPath,
    runSpec.repository.expectedBaseRevision,
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

  ensure(headRevision === runSpec.repository.expectedBaseRevision,
    "CUSTODY_EXECUTION_BASE", "shallow authority HEAD mismatch");
  ensure(tree === request.expectedBaseTree,
    "CUSTODY_EXECUTION_BASE", "shallow authority tree mismatch");
  ensure(status === "", "CUSTODY_EXECUTION_BASE", "shallow authority must be clean");
  ensure(revisionCount === 1,
    "CUSTODY_EXECUTION_BASE", "shallow authority must expose exactly one revision");
  ensure(shallowBoundary === runSpec.repository.expectedBaseRevision,
    "CUSTODY_EXECUTION_BASE", "shallow boundary must equal the base revision");
  ensure(remotes.length === 0,
    "CUSTODY_EXECUTION_BASE", "shallow authority must retain zero remotes");
  ensure(
    fs.existsSync(path.join(repositoryPath, ...runSpec.scope.allow[0].split("/"))),
    "CUSTODY_EXECUTION_BASE",
    "allowed path is absent from the pinned authority",
  );

  return Object.freeze({
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
  });
}

function buildConfig({ request, clone }) {
  const runSpec = request.runRequest.runSpecApproval.runSpec;
  return {
    trustedRepository: {
      repositoryId: runSpec.repository.repositoryId,
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
      nodeExecutablePath: request.agentProgram.nodeExecutablePath,
      expectedNodeSha256: request.agentProgram.expectedNodeSha256,
      launcherScriptPath: request.agentProgram.launcherScriptPath,
      expectedLauncherSha256: request.agentProgram.expectedLauncherSha256,
      nativeExecutablePath: request.agentProgram.nativeExecutablePath,
      expectedNativeSha256: request.agentProgram.expectedNativeSha256,
      expectedVersion: request.agentProgram.expectedVersion,
      codexHome: request.agentProgram.codexHome,
      hostEnv: snapshotHostEnv(AGENT_ENV_ALLOWLIST),
    },
    validationProgram: {
      commandName: request.validationProgram.commandName,
      executablePath: request.validationProgram.executablePath,
      expectedExecutableSha256: request.validationProgram.expectedExecutableSha256,
      hostEnv: { ...request.validationProgram.hostEnv },
      expectedCommands: runSpec.validation.commands,
    },
  };
}

function buildCanaryConfig(config, root) {
  const missing = absNorm(path.join(root, "execution-tools-must-not-be-read"));
  return {
    ...config,
    agentProgram: {
      ...config.agentProgram,
      nodeExecutablePath: absNorm(path.join(missing, "node")),
      expectedNodeSha256: "0".repeat(64),
      launcherScriptPath: absNorm(path.join(missing, "launcher.js")),
      expectedLauncherSha256: "1".repeat(64),
      nativeExecutablePath: absNorm(path.join(missing, "native")),
      expectedNativeSha256: "2".repeat(64),
      expectedVersion: "unusable",
      codexHome: absNorm(path.join(missing, "codex-home")),
      hostEnv: {},
    },
    validationProgram: {
      ...config.validationProgram,
      executablePath: absNorm(path.join(missing, "validation")),
      expectedExecutableSha256: "3".repeat(64),
      hostEnv: {},
    },
  };
}

function boundedChildEnvironment() {
  const keys = [
    "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "windir",
    "COMSPEC", "ComSpec", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
  ];
  return snapshotHostEnv(keys);
}

function runJsonChild(scriptPath, inputPath, cwd, timeout = PROCESS_TIMEOUT_MS) {
  const child = spawnSync(process.execPath, [scriptPath, inputPath], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: boundedChildEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw codedError(
      "CUSTODY_EXECUTION_CHILD",
      `${path.basename(scriptPath)} failed ${child.status}: ${String(child.stderr || child.stdout || "").trim()}`,
      { status: child.status },
    );
  }
  const lines = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  ensure(lines.length > 0, "CUSTODY_EXECUTION_CHILD", `${path.basename(scriptPath)} produced no result`);
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (error) {
    throw codedError(
      "CUSTODY_EXECUTION_CHILD",
      `${path.basename(scriptPath)} returned invalid JSON: ${error.message}`,
    );
  }
}

function runControllerProcess({ bindings, clone, label, config, request, clockValue }) {
  const inputPath = path.join(clone.exportsRoot, `${label}-input.json`);
  writeJsonNoReplace(inputPath, { config, request, clock: clockValue });
  return runJsonChild(bindings.controllerEntrypointPath, inputPath, clone.root);
}

function runIndependentVerifier({
  bindings,
  clone,
  portable,
  verified,
  request,
  sensitiveValues,
}) {
  const runSpec = request.runRequest.runSpecApproval.runSpec;
  const inputPath = path.join(clone.exportsRoot, "independent-verifier-input.json");
  writeJsonNoReplace(inputPath, {
    gitExecutablePath: clone.gitExecutablePath,
    sourceRepositoryPath: clone.repositoryPath,
    verifierRepositoryPath: absNorm(path.join(clone.exportsRoot, "independent-verifier")),
    exportDir: portable.exportDir,
    baseRevision: runSpec.repository.expectedBaseRevision,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    allowedPath: runSpec.scope.allow[0],
    validationExecutablePath: request.validationProgram.executablePath,
    expectedValidationExecutableSha256: request.validationProgram.expectedExecutableSha256,
    validationCommands: runSpec.validation.commands,
    validationHostEnv: request.validationProgram.hostEnv,
    sensitiveValues,
  });
  return runJsonChild(bindings.verifierEntrypointPath, inputPath, clone.root);
}

function uniqueSensitiveValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null)
    .map(String)
    .filter((value) => value.length > 0))];
}

function executeRequest({ requestPath }) {
  const startedAt = new Date();
  const envelope = loadExecutionRequestEnvelope(requestPath);
  const request = envelope.request;
  const runSpec = request.runRequest.runSpecApproval.runSpec;
  const bindings = validateLocalBindings(envelope);
  const clone = createCustodyAuthority({ request, bindings });
  const config = buildConfig({ request, clone });
  const clockValue = startedAt.toISOString();

  const process1 = runControllerProcess({
    bindings,
    clone,
    label: "process-1",
    config,
    request: request.runRequest,
    clockValue,
  });
  const verified = process1.result;
  ensure(verified.ok === true, "CUSTODY_EXECUTION_RESULT", "process 1 did not return ok");
  ensure(verified.disposition === "VERIFIED", "CUSTODY_EXECUTION_RESULT", "process 1 not VERIFIED");
  ensure(
    verified.verdict === "IMPLEMENTATION_VERIFIED",
    "CUSTODY_EXECUTION_RESULT",
    "process 1 verdict mismatch",
  );
  ensure(verified.agentSpawnCount === 1, "CUSTODY_EXECUTION_RESULT", "process 1 spawn count mismatch");
  ensure(process1.agentSpawnCount === 1, "CUSTODY_EXECUTION_RESULT", "controller spawn count mismatch");

  const authReqHex = digestHex(verified.authorizationRequestDigest);
  const evidenceRoot = path.join(clone.stateRoot, "attempts", authReqHex, "evidence");
  const authorizationReceipt = JSON.parse(fs.readFileSync(
    path.join(evidenceRoot, "authorization-receipt.json"),
    "utf8",
  ));
  const replayClockValue = new Date(
    new Date(authorizationReceipt.expiresAt).getTime() + REPLAY_EXPIRY_MARGIN_MS,
  ).toISOString();
  ensure(
    new Date(replayClockValue).getTime() > new Date(authorizationReceipt.expiresAt).getTime(),
    "CUSTODY_EXECUTION_REPLAY",
    "process 2 clock must be later than authorization expiry",
  );

  const process2 = runControllerProcess({
    bindings,
    clone,
    label: "process-2",
    config: buildCanaryConfig(config, clone.root),
    request: request.runRequest,
    clockValue: replayClockValue,
  });
  const replay = process2.result;
  ensure(replay.ok === true, "CUSTODY_EXECUTION_REPLAY", "process 2 did not return ok");
  ensure(replay.disposition === "REPLAY", "CUSTODY_EXECUTION_REPLAY", "process 2 not REPLAY");
  ensure(replay.agentSpawnCount === 0, "CUSTODY_EXECUTION_REPLAY", "process 2 spawned agent");
  ensure(process2.agentSpawnCount === 0, "CUSTODY_EXECUTION_REPLAY", "process 2 controller spawn mismatch");
  ensure(replay.verifiedHeadRevision === verified.verifiedHeadRevision,
    "CUSTODY_EXECUTION_REPLAY", "replay verified head changed");
  ensure(replay.terminalManifestDigest === verified.terminalManifestDigest,
    "CUSTODY_EXECUTION_REPLAY", "replay terminal manifest changed");

  const processMeta = JSON.parse(fs.readFileSync(path.join(evidenceRoot, "ao-process-meta.json"), "utf8"));
  ensure(processMeta.spawnOrdinal === 1, "CUSTODY_EXECUTION_RESULT", "agent spawn ordinal mismatch");
  ensure(processMeta.exitCode === 0, "CUSTODY_EXECUTION_RESULT", "agent exit code mismatch");
  ensure(processMeta.timedOut === false, "CUSTODY_EXECUTION_RESULT", "agent timed out");

  const sensitiveValues = uniqueSensitiveValues([
    bindings.requestPath,
    bindings.sourceRepositoryPath,
    clone.root,
    bindings.packageRoot,
    bindings.controllerEntrypointPath,
    bindings.verifierEntrypointPath,
    request.agentProgram.nodeExecutablePath,
    request.agentProgram.launcherScriptPath,
    request.agentProgram.nativeExecutablePath,
    request.agentProgram.codexHome,
    request.validationProgram.executablePath,
    ...Object.values(config.agentProgram.hostEnv),
    ...Object.values(request.validationProgram.hostEnv),
    ...request.validationProgram.sensitiveValues,
  ]);
  const portable = exportPortableCustody({
    repositoryPath: clone.repositoryPath,
    stateRoot: clone.stateRoot,
    exportsRoot: clone.exportsRoot,
    authReqHex,
    baseRevision: runSpec.repository.expectedBaseRevision,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    terminalManifestDigest: verified.terminalManifestDigest,
    gitExecutablePath: clone.gitExecutablePath,
    sensitiveValues,
  });
  ensure(
    portable.manifest.privacyReview.leakageScan.ok === true,
    "CUSTODY_EXECUTION_EXPORT",
    "portable leakage scan failed",
  );

  const independent = runIndependentVerifier({
    bindings,
    clone,
    portable,
    verified,
    request,
    sensitiveValues,
  });
  ensure(independent.ok === true, "CUSTODY_EXECUTION_EXPORT", "independent verification failed");
  ensure(independent.resultCommit === verified.verifiedHeadRevision,
    "CUSTODY_EXECUTION_EXPORT", "independent result commit mismatch");
  ensure(independent.parent === runSpec.repository.expectedBaseRevision,
    "CUSTODY_EXECUTION_EXPORT", "independent parent mismatch");
  ensure(JSON.stringify(independent.changed) === JSON.stringify(runSpec.scope.allow),
    "CUSTODY_EXECUTION_EXPORT", "independent changed-path mismatch");
  ensure(independent.leakage === "PASS",
    "CUSTODY_EXECUTION_EXPORT", "independent leakage failed");

  const childStatus = String(runGit(
    clone.gitExecutablePath,
    clone.repositoryPath,
    ["status", "--porcelain", "-uall"],
    clone.gitHome,
  ).stdout).trim();
  const childHead = String(runGit(
    clone.gitExecutablePath,
    clone.repositoryPath,
    ["rev-parse", "HEAD"],
    clone.gitHome,
  ).stdout).trim();
  ensure(childStatus === "", "CUSTODY_EXECUTION_BASE", "primary authority clone became dirty");
  ensure(childHead === runSpec.repository.expectedBaseRevision,
    "CUSTODY_EXECUTION_BASE", "primary authority clone moved from pinned base");

  const endedAt = new Date();
  const receiptPath = path.join(clone.root, "execution-receipt.json");
  const identity = processMeta.identity || {};
  const receipt = {
    schemaVersion: EXECUTION_RECEIPT_SCHEMA,
    execution: {
      executionId: request.executionId,
      requestSha256: envelope.requestDigest,
      package: { ...bindings.packageIdentity },
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMilliseconds: endedAt.getTime() - startedAt.getTime(),
    },
    repository: {
      repositoryId: runSpec.repository.repositoryId,
      objectFormat: runSpec.repository.objectFormat,
      baseRevision: runSpec.repository.expectedBaseRevision,
      baseTree: request.expectedBaseTree,
      allowedPath: runSpec.scope.allow[0],
    },
    authority: {
      headRevision: clone.headRevision,
      tree: clone.tree,
      trackedWorktreeClean: childStatus === "",
      visibleRevisionCount: clone.revisionCount,
      shallowBoundary: clone.shallowBoundary,
      remoteCount: clone.remoteCount,
    },
    executableIdentities: {
      node: {
        expectedSha256: request.agentProgram.expectedNodeSha256,
        observedSha256: identity.nodeSha256 || bindings.tools.node.observedSha256,
      },
      launcher: {
        expectedSha256: request.agentProgram.expectedLauncherSha256,
        observedSha256: identity.launcherSha256 || bindings.tools.launcher.observedSha256,
      },
      nativeAgent: {
        expectedSha256: request.agentProgram.expectedNativeSha256,
        observedSha256: identity.nativeSha256 || bindings.tools.native.observedSha256,
      },
      validation: {
        expectedSha256: request.validationProgram.expectedExecutableSha256,
        observedSha256: bindings.tools.validation.observedSha256,
      },
      observedAgentVersion: identity.version || null,
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
      agentExitCode: processMeta.exitCode,
      agentTimedOut: processMeta.timedOut,
      authorizationExpiresAt: authorizationReceipt.expiresAt,
    },
    process2: {
      clock: replayClockValue,
      authorizationExpiresAt: authorizationReceipt.expiresAt,
      secondsAfterAuthorizationExpiry: REPLAY_EXPIRY_MARGIN_MS / 1000,
      processExitCode: 0,
      controllerClosedAndProcessExited: true,
      disposition: replay.disposition,
      verdict: replay.verdict,
      agentSpawnCount: replay.agentSpawnCount,
      unusableToolCanaryPassed: true,
    },
    portable: {
      exportManifestDigest: portable.exportManifestDigest,
      independent: {
        resultCommit: independent.resultCommit,
        parent: independent.parent,
        changed: independent.changed,
        validation: independent.validation,
        leakage: independent.leakage,
      },
    },
    retained: {
      custodyRoot: clone.root,
      receiptPath,
    },
  };
  writeJsonNoReplace(receiptPath, receipt);

  return Object.freeze({
    schemaVersion: EXECUTION_RESULT_SCHEMA,
    ok: true,
    executionId: request.executionId,
    disposition: verified.disposition,
    verifiedHeadRevision: verified.verifiedHeadRevision,
    durableRef: verified.durableRef,
    receiptPath,
    portableExportPath: portable.exportDir,
    replay: Object.freeze({
      disposition: replay.disposition,
      agentSpawnCount: replay.agentSpawnCount,
    }),
  });
}

module.exports = {
  EXECUTION_REQUEST_SCHEMA,
  EXECUTION_RECEIPT_SCHEMA,
  EXECUTION_RESULT_SCHEMA,
  AUTHORIZATION_TTL_SECONDS,
  REPLAY_EXPIRY_MARGIN_MS,
  validateExecutionRequest,
  loadExecutionRequestEnvelope,
  validateLocalBindings,
  createCustodyAuthority,
  buildConfig,
  buildCanaryConfig,
  runControllerProcess,
  runIndependentVerifier,
  executeRequest,
};
