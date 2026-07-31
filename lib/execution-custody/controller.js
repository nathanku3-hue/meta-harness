"use strict";

const path = require("node:path");

const { executeRequest } = require("./execute");
const { contractError } = require("../semantic-kernel/contract-utils");
const { resolveRepositoryStateRoot } = require("../semantic-kernel/repository-state");
const {
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
} = require("./constants");
const { sha256File } = require("./support");

function requireTrustedRepository(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw contractError("CONTROLLER_CONFIG_REQUIRED", "controller config must be a plain object");
  }
  for (const forbidden of ["stateRoot", "custodyRoot", "clock", "now", "timeProvider", "repositoryId"]) {
    if (Object.prototype.hasOwnProperty.call(config, forbidden)) {
      throw contractError(
        forbidden === "stateRoot" || forbidden === "custodyRoot"
          ? "CALLER_STATE_ROOT_FORBIDDEN"
          : forbidden === "repositoryId"
            ? "REQUEST_REPOSITORY_ID_FORBIDDEN"
            : "REQUEST_CLOCK_FORBIDDEN",
        `${forbidden} is not accepted by the Meta-Harness 0.4 controller`,
      );
    }
  }
  const trusted = config.trustedRepository;
  if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) {
    throw contractError("CONTROLLER_TRUSTED_REPOSITORY", "trustedRepository is required");
  }
  if (Object.prototype.hasOwnProperty.call(trusted, "repositoryId")) {
    throw contractError(
      "REQUEST_REPOSITORY_ID_FORBIDDEN",
      "repository identity is derived from the canonical Git common directory",
    );
  }
  if (typeof trusted.repositoryPath !== "string" || !path.isAbsolute(trusted.repositoryPath)) {
    throw contractError(
      "CONTROLLER_TRUSTED_REPOSITORY",
      "trustedRepository.repositoryPath must be an absolute path",
    );
  }
  return path.resolve(trusted.repositoryPath);
}

function createExecutionCustodyController(config) {
  const repositoryPath = requireTrustedRepository(config);
  const repositoryState = resolveRepositoryStateRoot(repositoryPath);
  let closed = false;

  async function run(request) {
    if (closed) throw contractError("CONTROLLER_CLOSED", "controller is closed");
    return executeRequest(request, { repositoryPath });
  }

  async function close() {
    if (closed) return Object.freeze({ ok: true, idempotent: true });
    closed = true;
    return Object.freeze({ ok: true, idempotent: false });
  }

  return Object.freeze({
    run,
    close,
    getAgentSpawnCount: () => 0,
    repositoryState,
  });
}

module.exports = {
  createExecutionCustodyController,
  PROVIDER_ID,
  WORKER_PROFILE,
  MAX_VALIDATION_TIMEOUT_SECONDS,
  sha256File,
};
