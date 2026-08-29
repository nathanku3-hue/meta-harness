"use strict";

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { compileProposalWorkerPacket } = require("./proposal-worker-packet");
const {
  assertProposalDispatchReceiptBinding,
  assertProposalDispatchResultBinding,
  persistProposalDispatchIntent,
  persistProposalDispatchReceipt,
  persistProposalDispatchResult,
  readProposalDispatchReceipt,
  readProposalDispatchResult,
  validateEnsureRequest,
} = require("./proposal-dispatch");

const PROPOSAL_RECONCILE_SCHEMA = "meta-proposal-reconcile/v1";
const EXTERNAL_OPEN_CONTROL = "EXTERNAL_OPEN";
const INTERNAL_PROPOSAL_ENDPOINT_ENV = "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_ENDPOINT";
const INTERNAL_PROPOSAL_TOKEN_ENV = "META_HARNESS_INTERNAL_DEVSPACE_PROPOSAL_TOKEN";
const INTERNAL_HOST_RESULT_ENV = "META_HARNESS_INTERNAL_HOST_RESULT";
const MAX_HOST_RESPONSE_BYTES = 128 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    fail(code, `${label} has missing or unexpected fields`);
  }
}

function validateProposalReconcile(value, expectedPacketDigest = null) {
  exactKeys(
    value,
    ["schemaVersion", "state", "packetDigest", "taskId", "taskDigest", "resultDigest", "activationEstablished"],
    "MH_PROPOSAL_HOST_RESPONSE",
    "DevSpace proposal reconcile response",
  );
  if (value.schemaVersion !== PROPOSAL_RECONCILE_SCHEMA
      || !["RUNNING", "RESULT_READY"].includes(value.state)
      || !isDigest(value.packetDigest)
      || typeof value.taskId !== "string" || value.taskId.trim() === ""
      || !isDigest(value.taskDigest)
      || typeof value.activationEstablished !== "boolean"
      || (value.resultDigest !== null && !isDigest(value.resultDigest))) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal reconcile response is invalid");
  }
  if ((value.state === "RUNNING" && (value.resultDigest !== null || value.activationEstablished !== true))
      || (value.state === "RESULT_READY" && (!isDigest(value.resultDigest) || value.activationEstablished !== false))) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal reconcile state is internally inconsistent");
  }
  if (expectedPacketDigest && value.packetDigest !== expectedPacketDigest) {
    fail("MH_PROPOSAL_HOST_RESPONSE", "DevSpace proposal reconcile response belongs to a different packet");
  }
  return Object.freeze({ ...value });
}

function validateProposalHostResult(value, binding) {
  exactKeys(
    value,
    ["schemaVersion", "taskId", "taskDigest", "packetDigest", "result", "resultDigest", "submittedAt"],
    "MH_PROPOSAL_HOST_RESULT",
    "DevSpace proposal result response",
  );
  if (value.schemaVersion !== "meta-proposal-result/v1"
      || value.taskId !== binding.taskId
      || value.taskDigest !== binding.taskDigest
      || value.packetDigest !== binding.packetDigest
      || !isDigest(value.resultDigest)
      || !Number.isFinite(Date.parse(value.submittedAt))) {
    fail("MH_PROPOSAL_HOST_RESULT", "DevSpace proposal result response does not match the exact task binding");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function validateProposalRelease(value, binding) {
  exactKeys(
    value,
    ["schemaVersion", "packetDigest", "taskId", "taskDigest", "released"],
    "MH_PROPOSAL_HOST_RELEASE",
    "DevSpace proposal release response",
  );
  if (value.schemaVersion !== "meta-proposal-release-ack/v1"
      || value.packetDigest !== binding.packetDigest
      || value.taskId !== binding.taskId
      || value.taskDigest !== binding.taskDigest
      || value.released !== true) {
    fail("MH_PROPOSAL_HOST_RELEASE", "DevSpace proposal release acknowledgement does not match the exact task binding");
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
  return parsed;
}

function createDevSpaceProposalHost({ endpoint, token, fetchImpl = globalThis.fetch }) {
  const hostEndpoint = validateLoopbackEndpoint(endpoint);
  if (typeof token !== "string" || token.length < 32) {
    fail("MH_PROPOSAL_HOST_TOKEN", "DevSpace proposal host capability token is missing or too short");
  }
  if (typeof fetchImpl !== "function") {
    fail("MH_PROPOSAL_HOST_TRANSPORT", "DevSpace proposal host requires fetch support");
  }

  async function post(url, payload, label, { signal } = {}) {
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      fail("MH_PROPOSAL_HOST_UNAVAILABLE", `DevSpace proposal host is unavailable during ${label}: ${error.message}`);
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      fail("MH_PROPOSAL_HOST_RESPONSE", `DevSpace proposal host ${label} response is unreadable: ${error.message}`);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_HOST_RESPONSE_BYTES) {
      fail("MH_PROPOSAL_HOST_RESPONSE", `DevSpace proposal host ${label} response exceeds the bounded response size`);
    }
    if (!response.ok) {
      fail("MH_PROPOSAL_HOST_UNAVAILABLE", `DevSpace proposal host rejected ${label} with HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      fail("MH_PROPOSAL_HOST_RESPONSE", `DevSpace proposal host ${label} returned invalid JSON: ${error.message}`);
    }
  }

  return Object.freeze({
    endpoint: hostEndpoint.toString(),
    async ensureActivation(request, { signal } = {}) {
      const validatedRequest = validateEnsureRequest(request);
      const parsed = await post(hostEndpoint, validatedRequest, "reconcile", { signal });
      return validateProposalReconcile(parsed, validatedRequest.packet.packetDigest);
    },
    async readResult(binding, { signal } = {}) {
      const parsed = await post(new URL("result", hostEndpoint), {
        schemaVersion: "meta-proposal-result-read/v1",
        packetDigest: binding.packetDigest,
        taskId: binding.taskId,
        taskDigest: binding.taskDigest,
      }, "result read", { signal });
      if (parsed?.schemaVersion === "meta-proposal-result-pending/v1") return null;
      return validateProposalHostResult(parsed, binding);
    },
    async release(binding, { signal } = {}) {
      const parsed = await post(new URL("release", hostEndpoint), {
        schemaVersion: "meta-proposal-release/v1",
        packetDigest: binding.packetDigest,
        taskId: binding.taskId,
        taskDigest: binding.taskDigest,
      }, "release", { signal });
      return validateProposalRelease(parsed, binding);
    },
  });
}

function extractInternalDevSpaceProposalHost(env = process.env) {
  const endpoint = env?.[INTERNAL_PROPOSAL_ENDPOINT_ENV];
  const token = env?.[INTERNAL_PROPOSAL_TOKEN_ENV];
  const modelEnv = { ...(env || {}) };
  delete modelEnv[INTERNAL_PROPOSAL_ENDPOINT_ENV];
  delete modelEnv[INTERNAL_PROPOSAL_TOKEN_ENV];
  delete modelEnv[INTERNAL_HOST_RESULT_ENV];
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
  return validateProposalReconcile(result, validatedRequest.packet.packetDigest);
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

async function releaseCapturedProposal(proposalHost, receipt, signal) {
  if (!proposalHost || typeof proposalHost.release !== "function" || !receipt) return null;
  const binding = {
    packetDigest: receipt.packetDigest,
    taskId: receipt.taskId,
    taskDigest: receipt.taskDigest,
  };
  try {
    return await proposalHost.release(binding, { signal });
  } catch (error) {
    return Object.freeze({ releaseError: error });
  }
}

async function reconcileProposalDispatch({ proposalHost, workspaceRegistryDir, intent, signal }) {
  const retainedReceipt = readProposalDispatchReceipt({
    workspaceRegistryDir,
    workspaceId: intent.authority.workspaceId,
    generation: intent.authority.generation,
    optional: true,
  });
  const retainedResult = readProposalDispatchResult({
    workspaceRegistryDir,
    workspaceId: intent.authority.workspaceId,
    generation: intent.authority.generation,
    optional: true,
  });
  if (retainedResult) {
    const receipt = assertProposalDispatchReceiptBinding(intent, retainedReceipt);
    const result = assertProposalDispatchResultBinding(intent, receipt, retainedResult);
    const release = await releaseCapturedProposal(proposalHost, receipt, signal);
    return Object.freeze({
      established: true,
      state: "RESULT_READY",
      receipt,
      result,
      error: null,
      releaseError: release?.releaseError || null,
    });
  }

  let hostResult;
  try {
    hostResult = await ensureProposalActivation(proposalHost, intent.request, { signal });
  } catch (error) {
    return Object.freeze({ established: false, state: "RUNNING", receipt: retainedReceipt, result: null, error, releaseError: null });
  }
  const receipt = persistProposalDispatchReceipt({ workspaceRegistryDir, intent, hostResult });
  if (hostResult.state !== "RESULT_READY") {
    return Object.freeze({ established: true, state: "RUNNING", receipt, result: null, error: null, releaseError: null });
  }
  if (!proposalHost || typeof proposalHost.readResult !== "function") {
    fail("MH_PROPOSAL_HOST_REQUIRED", "RESULT_READY requires the bounded DevSpace proposal result-read capability");
  }

  let durableResult;
  try {
    durableResult = await proposalHost.readResult({
      packetDigest: receipt.packetDigest,
      taskId: receipt.taskId,
      taskDigest: receipt.taskDigest,
    }, { signal });
  } catch (error) {
    return Object.freeze({ established: true, state: "RESULT_READY", receipt, result: null, error, releaseError: null });
  }
  if (!durableResult) {
    fail("MH_PROPOSAL_DISPATCH_SETTLEMENT", "DevSpace reported RESULT_READY but did not return the exact durable proposal result");
  }
  const result = persistProposalDispatchResult({
    workspaceRegistryDir,
    intent,
    receipt,
    hostResult: durableResult,
  });
  const release = await releaseCapturedProposal(proposalHost, receipt, signal);
  return Object.freeze({
    established: true,
    state: "RESULT_READY",
    receipt,
    result,
    error: null,
    releaseError: release?.releaseError || null,
  });
}

module.exports = {
  EXTERNAL_OPEN_CONTROL,
  INTERNAL_HOST_RESULT_ENV,
  INTERNAL_PROPOSAL_ENDPOINT_ENV,
  INTERNAL_PROPOSAL_TOKEN_ENV,
  PROPOSAL_RECONCILE_SCHEMA,
  createDevSpaceProposalHost,
  extractInternalDevSpaceProposalHost,
  createExternalProposalRunner,
  ensureProposalActivation,
  isExternalOpenResult,
  reconcileProposalDispatch,
  validateLoopbackEndpoint,
  validateProposalHostResult,
  validateProposalReconcile,
};
