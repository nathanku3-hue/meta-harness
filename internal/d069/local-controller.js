"use strict";

/**
 * D070-A1 private local walking-slice controller (lineage: internal/d069).
 *
 * Temporary directory name retained until post-dogfood R1A.
 * Not packaged. No public API. No kernel expansion.
 *
 * Locked provider:
 *   id: meta-harness-ao-codex
 *   workerProfile: d070-ao-artifact-v1
 *
 * Seam: sealed authorization → claim → async Codex :read-only →
 * schema-bound artifact → controller materialize/commit → validation →
 * IMPLEMENTATION_VERIFIED → create-only durable ref → terminal replay.
 */

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
const { executeAttempt } = require("./run-attempt");
const {
  PROVIDER_ID,
  WORKER_PROFILE,
  FIXED_TIMEOUT_SECONDS,
  AO_TIMEOUT_SECONDS,
} = require("./ao-constants");
const { createLazyExecutionBindings } = require("./execution-bindings");

const OWNER_FILE_NAME = "controller-owner.json";
const OWNER_SCHEMA = "d069-controller-owner/v1";

function validateAuthorizationPolicyShape(policy) {
  if (!isPlainObject(policy)) {
    throw codedError("D069_POLICY_REQUIRED", "authorizationPolicy is required");
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
      throw codedError("D069_POLICY_SHAPE", `authorizationPolicy.${key} required`);
    }
  }
  if (!isPlainObject(policy.provider)
    || policy.provider.id !== PROVIDER_ID
    || policy.provider.workerProfile !== WORKER_PROFILE) {
    throw codedError(
      "D069_PROVIDER_IDENTITY",
      `authorizationPolicy.provider must be { id: "${PROVIDER_ID}", workerProfile: "${WORKER_PROFILE}" }`,
    );
  }
  if (!isPlainObject(policy.workspacePolicy)
    || policy.workspacePolicy.schemaVersion !== "workspace-policy/v1"
    || !isAbsoluteNormalizedFsPath(policy.workspacePolicy.approvedRoot)) {
    throw codedError(
      "D069_WORKSPACE_POLICY",
      "authorizationPolicy.workspacePolicy must be { schemaVersion: workspace-policy/v1, approvedRoot: absolute normalized path }",
    );
  }
  if (policy.maxCommandTimeoutSeconds !== FIXED_TIMEOUT_SECONDS) {
    throw codedError(
      "D070_MAX_COMMAND_TIMEOUT",
      `authorizationPolicy.maxCommandTimeoutSeconds must remain ${FIXED_TIMEOUT_SECONDS} (AO uses separate ${AO_TIMEOUT_SECONDS}s)`,
    );
  }
}

/**
 * @param {object} config
 * @returns {{ run: Function, close: Function }}
 */
function createLocalWalkingSliceController(config) {
  requireNodeMajorAtLeast(20);

  if (!isPlainObject(config)) {
    throw codedError("D069_CONFIG_REQUIRED", "config object required");
  }

  const {
    trustedRepository,
    stateRoot: stateRootInput,
    workspaceRoot: workspaceRootInput,
    authorizationPolicy,
    clock,
    codexProgram,
    validationProgram,
  } = config;

  if (!isPlainObject(trustedRepository)
    || !isNonEmptyString(trustedRepository.repositoryId)
    || !isAbsoluteNormalizedFsPath(trustedRepository.repositoryPath)) {
    throw codedError(
      "D069_TRUSTED_REPO",
      "trustedRepository must be { repositoryId, repositoryPath } with absolute normalized path",
    );
  }
  if (!isAbsoluteNormalizedFsPath(stateRootInput)) {
    throw codedError("D069_STATE_ROOT", "stateRoot must be absolute normalized path");
  }
  if (!isAbsoluteNormalizedFsPath(workspaceRootInput)) {
    throw codedError("D069_WORKSPACE_ROOT", "workspaceRoot must be absolute normalized path");
  }
  if (typeof clock !== "function") {
    throw codedError("D069_CLOCK", "clock must be a function returning exact UTC timestamp string");
  }

  validateAuthorizationPolicyShape(authorizationPolicy);

  if (!isPlainObject(codexProgram)
    || codexProgram.workerProfile !== authorizationPolicy.provider.workerProfile) {
    throw codedError(
      "D070_CODEX_PROFILE_MISMATCH",
      "codexProgram.workerProfile must equal authorizationPolicy.provider.workerProfile",
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
      "D069_APPROVED_ROOT",
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
    codexProgram,
    validationProgram,
    expectedWorkerProfile: boundPolicy.provider.workerProfile,
    fixedTimeoutSeconds: FIXED_TIMEOUT_SECONDS,
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
        "D069_STATE_OWNED",
        "stateRoot already has a controller-owner.json (second controller rejected)",
        { causeCode: err.code },
      );
    }
    throw codedError(
      "D069_OWNER_PUBLISH_FAILED",
      `failed to publish controller-owner.json: ${err.message}`,
      { causeCode: err.code },
    );
  }

  let closed = false;
  let activeCalls = 0;
  /** Controller-scoped AO spawn counter (offline replay proofs). */
  let aoSpawnCount = 0;

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
    fixedTimeoutSeconds: FIXED_TIMEOUT_SECONDS,
    aoTimeoutSeconds: AO_TIMEOUT_SECONDS,
    recordAoSpawn() {
      aoSpawnCount += 1;
      return aoSpawnCount;
    },
    getAoSpawnCount() {
      return aoSpawnCount;
    },
  };

  async function run(request) {
    if (closed) {
      throw codedError("D069_CONTROLLER_CLOSED", "controller is closed");
    }
    activeCalls += 1;
    try {
      const result = await executeAttempt(attemptCtx, request);
      return {
        ...result,
        aoSpawnCount: aoSpawnCount,
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
        "D069_CLOSE_ACTIVE",
        "close() rejected while run() is active; owner record retained",
      );
    }

    let onDisk;
    try {
      onDisk = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    } catch (err) {
      throw codedError(
        "D069_OWNER_MISSING",
        `controller-owner.json unreadable during close: ${err.message}`,
      );
    }

    if (!isPlainObject(onDisk)
      || onDisk.controllerInstanceNonce !== controllerInstanceNonce
      || onDisk.ownerDigest !== ownerDigest) {
      throw codedError(
        "D069_OWNER_MISMATCH",
        "stored owner record does not match this controller instance; not removed",
      );
    }

    fs.unlinkSync(ownerPath);
    closed = true;
    return { ok: true, idempotent: false };
  }

  return { run, close, getAoSpawnCount: () => aoSpawnCount };
}

module.exports = {
  createLocalWalkingSliceController,
  PROVIDER_ID,
  WORKER_PROFILE,
  FIXED_TIMEOUT_SECONDS,
  AO_TIMEOUT_SECONDS,
  OWNER_FILE_NAME,
  publishNoReplace,
  sha256File,
  CONTROLLER_AUTHOR_NAME,
  CONTROLLER_AUTHOR_EMAIL,
};
