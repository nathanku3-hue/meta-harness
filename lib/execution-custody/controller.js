"use strict";

/** Host-neutral controller for the packaged execution-custody runtime. */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  sha256File,
  requireNodeMajorAtLeast,
  publishNoReplace,
  writeJsonNoReplace,
  canonicalExistingRoot,
  rootsPairwiseSeparated,
  ownerDigestFor,
} = require("./support");
const {
  CONTROLLER_AUTHOR_NAME,
  CONTROLLER_AUTHOR_EMAIL,
  ensureIsolatedGitHome,
  resolveGitExecutable,
  runGit,
} = require("./git-ops");
const { executeAttempt } = require("./attempt");
const {
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
  AGENT_TIMEOUT_SECONDS,
} = require("./constants");
const { createLazyExecutionBindings } = require("./execution-bindings");

const OWNER_FILE_NAME = "controller-owner.json";
const OWNER_SCHEMA = "execution-custody-controller-owner/v1";

function validateAuthorizationPolicyShape(policy) {
  if (!isPlainObject(policy)) {
    throw codedError("CUSTODY_POLICY_REQUIRED", "authorizationPolicy is required");
  }
  const required = [
    "authorizationTtlSeconds",
    "maxReadinessAgeSeconds",
    "maxCommandTimeoutSeconds",
    "provider",
    "workspacePolicy",
  ];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(policy, key)) {
      throw codedError("CUSTODY_POLICY_SHAPE", `authorizationPolicy.${key} required`);
    }
  }
  if (!isPlainObject(policy.provider)
    || policy.provider.id !== PROVIDER_ID
    || policy.provider.workerProfile !== WORKER_PROFILE) {
    throw codedError(
      "CUSTODY_PROVIDER_IDENTITY",
      `authorizationPolicy.provider must be { id: "${PROVIDER_ID}", workerProfile: "${WORKER_PROFILE}" }`,
    );
  }
  if (!isPlainObject(policy.workspacePolicy)
    || policy.workspacePolicy.schemaVersion !== "workspace-policy/v1"
    || !isAbsoluteNormalizedFsPath(policy.workspacePolicy.approvedRoot)) {
    throw codedError(
      "CUSTODY_WORKSPACE_POLICY",
      "authorizationPolicy.workspacePolicy must be { schemaVersion: workspace-policy/v1, approvedRoot: absolute normalized path }",
    );
  }
  if (policy.maxCommandTimeoutSeconds !== MAX_VALIDATION_TIMEOUT_SECONDS) {
    throw codedError(
      "CUSTODY_MAX_COMMAND_TIMEOUT",
      `authorizationPolicy.maxCommandTimeoutSeconds must remain ${MAX_VALIDATION_TIMEOUT_SECONDS}`,
    );
  }
}

/**
 * @param {object} config
 * @returns {{ run: Function, close: Function }}
 */
function createExecutionCustodyController(config) {
  requireNodeMajorAtLeast(20);

  if (!isPlainObject(config)) {
    throw codedError("CUSTODY_CONFIG_REQUIRED", "config object required");
  }

  const {
    trustedRepository,
    stateRoot: stateRootInput,
    workspaceRoot: workspaceRootInput,
    authorizationPolicy,
    clock,
    agentProgram,
    validationProgram,
  } = config;

  if (!isPlainObject(trustedRepository)
    || !isNonEmptyString(trustedRepository.repositoryId)
    || !isAbsoluteNormalizedFsPath(trustedRepository.repositoryPath)) {
    throw codedError(
      "CUSTODY_TRUSTED_REPOSITORY",
      "trustedRepository must be { repositoryId, repositoryPath } with absolute normalized path",
    );
  }
  if (!isAbsoluteNormalizedFsPath(stateRootInput)) {
    throw codedError("CUSTODY_STATE_ROOT", "stateRoot must be absolute normalized path");
  }
  if (!isAbsoluteNormalizedFsPath(workspaceRootInput)) {
    throw codedError("CUSTODY_WORKSPACE_ROOT", "workspaceRoot must be absolute normalized path");
  }
  if (typeof clock !== "function") {
    throw codedError("CUSTODY_CLOCK", "clock must be a function returning exact UTC timestamp string");
  }

  validateAuthorizationPolicyShape(authorizationPolicy);

  if (!isPlainObject(agentProgram)
    || agentProgram.workerProfile !== authorizationPolicy.provider.workerProfile) {
    throw codedError(
      "CUSTODY_AGENT_PROFILE_MISMATCH",
      "agentProgram.workerProfile must equal authorizationPolicy.provider.workerProfile",
    );
  }

  const repositoryPath = canonicalExistingRoot(
    trustedRepository.repositoryPath,
    "trustedRepository.repositoryPath",
  );
  const repositoryId = trustedRepository.repositoryId;

  fs.mkdirSync(stateRootInput, { recursive: true });
  fs.mkdirSync(workspaceRootInput, { recursive: true });

  const stateRoot = canonicalExistingRoot(stateRootInput, "stateRoot");
  const workspaceRoot = canonicalExistingRoot(workspaceRootInput, "workspaceRoot");

  rootsPairwiseSeparated(repositoryPath, stateRoot, "repositoryPath", "stateRoot");
  rootsPairwiseSeparated(repositoryPath, workspaceRoot, "repositoryPath", "workspaceRoot");
  rootsPairwiseSeparated(stateRoot, workspaceRoot, "stateRoot", "workspaceRoot");

  const approvedRootCanon = canonicalExistingRoot(
    authorizationPolicy.workspacePolicy.approvedRoot,
    "authorizationPolicy.workspacePolicy.approvedRoot",
  );
  if (approvedRootCanon !== workspaceRoot) {
    throw codedError(
      "CUSTODY_APPROVED_ROOT",
      "canonical approvedRoot must equal canonical workspaceRoot",
    );
  }

  const boundPolicy = {
    authorizationTtlSeconds: authorizationPolicy.authorizationTtlSeconds,
    maxReadinessAgeSeconds: authorizationPolicy.maxReadinessAgeSeconds,
    maxCommandTimeoutSeconds: authorizationPolicy.maxCommandTimeoutSeconds,
    provider: {
      id: authorizationPolicy.provider.id,
      workerProfile: authorizationPolicy.provider.workerProfile,
    },
    workspacePolicy: {
      schemaVersion: "workspace-policy/v1",
      approvedRoot: workspaceRoot,
    },
  };

  const executionBindings = createLazyExecutionBindings({
    agentProgram,
    validationProgram,
    expectedWorkerProfile: boundPolicy.provider.workerProfile,
    maxValidationTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
  });

  const gitHome = ensureIsolatedGitHome(stateRoot);
  const { gitExecutablePath } = resolveGitExecutable(gitHome);
  runGit(gitExecutablePath, repositoryPath, ["rev-parse", "--is-inside-work-tree"], gitHome);

  const controllerInstanceNonce = crypto.randomBytes(16).toString("hex");
  const ownerBody = {
    schemaVersion: OWNER_SCHEMA,
    controllerInstanceNonce,
    repositoryId,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    processId: process.pid,
    createdAt: clock(),
  };
  const ownerDigest = ownerDigestFor(ownerBody);
  const ownerRecord = { ...ownerBody, ownerDigest };
  const ownerPath = path.join(stateRoot, OWNER_FILE_NAME);

  try {
    writeJsonNoReplace(ownerPath, ownerRecord);
  } catch (err) {
    if (err && (err.code === "EEXIST" || err.code === "EPERM")) {
      throw codedError(
        "CUSTODY_STATE_OWNED",
        "stateRoot already has a controller-owner.json (second controller rejected)",
        { causeCode: err.code },
      );
    }
    throw codedError(
      "CUSTODY_OWNER_PUBLISH_FAILED",
      `failed to publish controller-owner.json: ${err.message}`,
      { causeCode: err.code },
    );
  }

  let closed = false;
  let activeCalls = 0;
  /** Controller-scoped authenticated agent spawn counter. */
  let agentSpawnCount = 0;

  const attemptCtx = {
    repositoryId,
    repositoryPath,
    stateRoot,
    workspaceRoot,
    boundPolicy,
    bindExecutionTools: executionBindings.bindForNewAttempt,
    gitHome,
    gitExecutablePath,
    clock,
    maxValidationTimeoutSeconds: MAX_VALIDATION_TIMEOUT_SECONDS,
    agentTimeoutSeconds: AGENT_TIMEOUT_SECONDS,
    recordAgentSpawn() {
      agentSpawnCount += 1;
      return agentSpawnCount;
    },
    getAgentSpawnCount() {
      return agentSpawnCount;
    },
  };

  async function run(request) {
    if (closed) {
      throw codedError("CUSTODY_CONTROLLER_CLOSED", "controller is closed");
    }
    activeCalls += 1;
    try {
      const result = await executeAttempt(attemptCtx, request);
      return {
        ...result,
        agentSpawnCount,
      };
    } finally {
      activeCalls -= 1;
    }
  }

  async function close() {
    if (closed) {
      return { ok: true, idempotent: true };
    }
    if (activeCalls > 0) {
      throw codedError(
        "CUSTODY_CLOSE_ACTIVE",
        "close() rejected while run() is active; owner record retained",
      );
    }

    let onDisk;
    try {
      onDisk = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    } catch (err) {
      throw codedError(
        "CUSTODY_OWNER_MISSING",
        `controller-owner.json unreadable during close: ${err.message}`,
      );
    }

    if (!isPlainObject(onDisk)
      || onDisk.controllerInstanceNonce !== controllerInstanceNonce
      || onDisk.ownerDigest !== ownerDigest) {
      throw codedError(
        "CUSTODY_OWNER_MISMATCH",
        "stored owner record does not match this controller instance; not removed",
      );
    }

    fs.unlinkSync(ownerPath);
    closed = true;
    return { ok: true, idempotent: false };
  }

  return { run, close, getAgentSpawnCount: () => agentSpawnCount };
}

module.exports = {
  createExecutionCustodyController,
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
  AGENT_TIMEOUT_SECONDS,
  OWNER_FILE_NAME,
  publishNoReplace,
  sha256File,
  CONTROLLER_AUTHOR_NAME,
  CONTROLLER_AUTHOR_EMAIL,
};
