"use strict";

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { compileProposalWorkerPacket } = require("./proposal-worker-packet");
const {
  persistProposalDispatchIntent,
  persistProposalDispatchReceipt,
  validateEnsureRequest,
} = require("./proposal-dispatch");

const PROPOSAL_ACTIVATION_SCHEMA = "meta-proposal-activation/v1";
const EXTERNAL_OPEN_CONTROL = "EXTERNAL_OPEN";
const INTERNAL_PROPOSAL_ENDPOINT_ENV = "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT";
const INTERNAL_PROPOSAL_TOKEN_ENV = "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN";
const MAX_HOST_RESPONSE_BYTES = 128 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function validateProposalActivation(value, expectedPacketDigest = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal host response must be an object");
  }
  const expected = ["schemaVersion", "packetDigest", "taskId", "taskDigest", "activationEstablished"].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")
      || value.schemaVersion !== PROPOSAL_ACTIVATION_SCHEMA
      || !isDigest(value.packetDigest)
      || typeof value.taskId !== "string" || value.taskId.trim() === ""
      || !isDigest(value.taskDigest)
      || value.activationEstablished !== true) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal host response is invalid");
  }
  if (expectedPacketDigest && value.packetDigest !== expectedPacketDigest) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal host response belongs to a different packet");
  }
  return Object.freeze({ ...value });
}

function validateLoopbackEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    fail("MH_PROPOSAL_HOST_ENDPOINT", `DevSpace proposal host endpoint is invalid: ${error.message}`);
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password || parsed.hash) {
    fail("MH_PROPOSAL_HOST_ENDPOINT", "DevSpace proposal host endpoint must be unauthenticated HTTP on 127.0.0.1 with bearer capability auth");
  }
  return parsed.toString();
}

function createDevSpaceProposalHost({ endpoint, token, fetchImpl = globalThis.fetch }) {
  const hostEndpoint = validateLoopbackEndpoint(endpoint);
  if (typeof token !== "string" || token.length < 32) {
    fail("MH_PROPOSAL_HOST_TOKEN", "DevSpace proposal host capability token is missing or too short");
  }
  if (typeof fetchImpl !== "function") {
    fail("MH_PROPOSAL_HOST_TRANSPORT", "DevSpace proposal host requires fetch support");
  }
  return Object.freeze({
    endpoint: hostEndpoint,
    async ensureActivation(request, { signal } = {}) {
      const validatedRequest = validateEnsureRequest(request);
      let response;
      try {
        response = await fetchImpl(hostEndpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(validatedRequest),
          signal,
        });
      } catch (error) {
        fail("MH_PROPOSAL_HOST_UNAVAILABLE", `DevSpace proposal host is unavailable: ${error.message}`);
      }
      let text;
      try {
        text = await response.text();
      } catch (error) {
        fail("MH_PROPOSAL_HOST_RESPONSE", `DevSpace proposal host response is unreadable: ${error.message}`);
      }
      if (Buffer.byteLength(text, "utf8") > MAX_HOST_RESPONSE_BYTES) {
        fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal host response exceeds the bounded response size");
      }
      if (!response.ok) {
        fail("MH_PROPOSAL_HOST_UNAVAILABLE", `DevSpace proposal host rejected ensureActivation with HTTP ${response.status}`);
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        fail("MH_PROPOSAL_HOST_RESPONSE", `DevSpace proposal host returned invalid JSON: ${error.message}`);
      }
      return validateProposalActivation(parsed, validatedRequest.packet.packetDigest);
    },
  });
}

function extractInternalDevSpaceProposalHost(env = process.env) {
  const endpoint = env?.[INTERNAL_PROPOSAL_ENDPOINT_ENV];
  const token = env?.[INTERNAL_PROPOSAL_TOKEN_ENV];
  const modelEnv = { ...(env || {}) };
  delete modelEnv[INTERNAL_PROPOSAL_ENDPOINT_ENV];
  delete modelEnv[INTERNAL_PROPOSAL_TOKEN_ENV];
  if (!endpoint && !token) return Object.freeze({ proposalHost: null, modelEnv: Object.freeze(modelEnv) });
  if (!endpoint || !token) {
    fail("MH_PROPOSAL_HOST_CAPABILITY", "internal DevSpace proposal host capability is incomplete");
  }
  return Object.freeze({
    proposalHost: createDevSpaceProposalHost({ endpoint, token }),
    modelEnv: Object.freeze(modelEnv),
  });
}

async function ensureProposalActivation(proposalHost, request, { signal } = {}) {
  if (!proposalHost || typeof proposalHost.ensureActivation !== "function") {
    fail("MH_PROPOSAL_HOST_REQUIRED", "external proposal execution requires an injected DevSpace proposal host");
  }
  const validatedRequest = validateEnsureRequest(request);
  const result = await proposalHost.ensureActivation(validatedRequest, { signal });
  return validateProposalActivation(result, validatedRequest.packet.packetDigest);
}

function externalOpenResult(intent, receipt = null, hostError = null) {
  return Object.freeze({
    control: EXTERNAL_OPEN_CONTROL,
    worker: "devspace-external-proposal",
    packetDigest: intent.request.packet.packetDigest,
    intentDigest: intent.intentDigest,
    receiptDigest: receipt?.receiptDigest || null,
    hostError: hostError ? String(hostError.code || hostError.name || "HOST_UNAVAILABLE") : null,
  });
}

function isExternalOpenResult(value) {
  return value?.control === EXTERNAL_OPEN_CONTROL;
}

function createExternalProposalRunner(proposalHost) {
  if (!proposalHost || typeof proposalHost.ensureActivation !== "function") {
    fail("MH_PROPOSAL_HOST_REQUIRED", "external proposal runner requires an injected DevSpace proposal host");
  }
  return async function runExternalProposal({
    repositoryPath,
    stateDirectory,
    workspace,
    workspaceLease,
    attemptBoundary,
    session,
    executionPermit,
    attemptEntry,
    attempt,
    priorFailure = "",
    signal,
  }) {
    const compiled = compileProposalWorkerPacket({
      repositoryPath,
      stateDirectory,
      session,
      workspace,
      workspaceLease,
      boundary: attemptBoundary,
      executionPermit,
      attemptEntry,
      attempt,
      priorFailure,
    });
    const intent = persistProposalDispatchIntent({
      workspaceRegistryDir: workspace.registryDir,
      session,
      workspace,
      executionPermit,
      attemptEntry,
      packet: compiled.packet,
      prompt: compiled.prompt,
      workerResultSchema: compiled.workerResultSchema,
    });
    let hostResult;
    try {
      hostResult = await ensureProposalActivation(proposalHost, intent.request, { signal });
    } catch (error) {
      return externalOpenResult(intent, null, error);
    }
    const receipt = persistProposalDispatchReceipt({
      workspaceRegistryDir: workspace.registryDir,
      intent,
      hostResult,
    });
    return externalOpenResult(intent, receipt, null);
  };
}

async function reconcileProposalDispatch({ proposalHost, workspaceRegistryDir, intent, signal }) {
  let hostResult;
  try {
    hostResult = await ensureProposalActivation(proposalHost, intent.request, { signal });
  } catch (error) {
    return Object.freeze({ established: false, receipt: null, error });
  }
  const receipt = persistProposalDispatchReceipt({ workspaceRegistryDir, intent, hostResult });
  return Object.freeze({ established: true, receipt, error: null });
}

module.exports = {
  EXTERNAL_OPEN_CONTROL,
  INTERNAL_PROPOSAL_ENDPOINT_ENV,
  INTERNAL_PROPOSAL_TOKEN_ENV,
  PROPOSAL_ACTIVATION_SCHEMA,
  createDevSpaceProposalHost,
  extractInternalDevSpaceProposalHost,
  createExternalProposalRunner,
  ensureProposalActivation,
  isExternalOpenResult,
  reconcileProposalDispatch,
  validateProposalActivation,
  validateLoopbackEndpoint,
};
