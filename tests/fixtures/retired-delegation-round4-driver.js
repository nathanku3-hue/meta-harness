"use strict";

const crypto = require("node:crypto");

const { acceptDelegationRound2FanIn } = require("./delegation-round2-contract");
const { resolveDelegationSnapshots } = require("./delegation-round3-host");
const {
  MAX_DELEGATION_FAMILY,
  runDelegationRound3,
} = require("./delegation-round3-orchestrator");
const { ConfigError } = require("./errors");
const { readCurrentWorldState } = require("./world-transition");

const DEFAULT_DELEGATION_POLL_INTERVAL_MS = 500;
const MAX_DELEGATION_POLL_INTERVAL_MS = 60_000;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function pollInterval(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DELEGATION_POLL_INTERVAL_MS) {
    fail(
      "MH_DELEGATION_R4_POLL",
      `delegation poll interval must be an integer from 1 to ${MAX_DELEGATION_POLL_INTERVAL_MS} milliseconds`,
    );
  }
  return value;
}

async function captureDelegationHostState(request) {
  const delegations = request.delegations || [];
  if (delegations.length === 0) {
    return Object.freeze({ digest: digest([]), pendingLanes: 0 });
  }
  const resolved = await resolveDelegationSnapshots(
    delegations,
    request.host || {},
    MAX_DELEGATION_FAMILY,
    { forceRefresh: true },
  );
  const lanes = [];
  for (const entry of resolved) {
    const acceptance = acceptDelegationRound2FanIn({
      contract: entry.contract,
      snapshot: entry.snapshot,
    });
    for (const lane of acceptance.lanes) {
      lanes.push({
        delegationId: acceptance.delegationId,
        contractDigest: acceptance.contractDigest,
        laneKey: lane.laneKey,
        taskId: lane.taskId,
        workspaceId: lane.workspaceId,
        launchStatus: lane.launchStatus,
        acceptance: lane.acceptance,
        resultDigest: lane.result?.resultDigest || null,
      });
    }
  }
  lanes.sort((left, right) => left.delegationId.localeCompare(right.delegationId)
    || left.laneKey.localeCompare(right.laneKey));
  return Object.freeze({
    digest: digest(lanes),
    pendingLanes: lanes.filter((lane) => lane.acceptance === "PENDING").length,
  });
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createDelegationRound4Driver({
  repositoryPath,
  request,
  runner = runDelegationRound3,
  env = process.env,
  model,
  timeoutSeconds,
  signal,
  pollIntervalMs = DEFAULT_DELEGATION_POLL_INTERVAL_MS,
} = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    fail("MH_DELEGATION_R4_REQUEST", "Round 4 requires one retained Round-3 reconciliation request");
  }
  const interval = pollInterval(pollIntervalMs);
  let hostStateDigest = null;
  let pendingLanes = 0;
  let lastWorldHeadDigest = null;
  let dirty = false;

  async function reconcile() {
    const result = await runner({
      ...request,
      repositoryPath,
      env,
      model,
      timeoutSeconds,
      signal,
    });
    const state = await captureDelegationHostState(request);
    hostStateDigest = state.digest;
    pendingLanes = state.pendingLanes;
    lastWorldHeadDigest = result.worldHeadDigest;
    dirty = false;
    return result;
  }

  function shouldReconcile(worldHeadDigest) {
    return dirty || (lastWorldHeadDigest !== null && lastWorldHeadDigest !== worldHeadDigest);
  }

  async function waitForRelevantChange(watchSignal) {
    if (pendingLanes === 0 || watchSignal?.aborted) return false;
    while (!watchSignal?.aborted) {
      const elapsed = await wait(interval, watchSignal);
      if (!elapsed) return false;
      const current = readCurrentWorldState(repositoryPath);
      if (lastWorldHeadDigest !== null && current.head.headDigest !== lastWorldHeadDigest) {
        dirty = true;
        return true;
      }
      const state = await captureDelegationHostState(request);
      if (state.digest !== hostStateDigest) {
        dirty = true;
        pendingLanes = state.pendingLanes;
        return true;
      }
    }
    return false;
  }

  return Object.freeze({
    hasPendingLanes: () => pendingLanes > 0,
    reconcile,
    shouldReconcile,
    waitForRelevantChange,
  });
}

module.exports = {
  DEFAULT_DELEGATION_POLL_INTERVAL_MS,
  MAX_DELEGATION_POLL_INTERVAL_MS,
  captureDelegationHostState,
  createDelegationRound4Driver,
};
