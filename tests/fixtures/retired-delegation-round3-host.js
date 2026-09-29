"use strict";

const {
  createDelegationHoldCheckpoint,
  persistDelegationHoldCheckpoint,
} = require("./delegation-round3-checkpoint");
const { ConfigError } = require("./errors");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function laneIdentity(value) {
  return `${value.delegationId}\u001f${value.laneKey}`;
}

function hostFunction(host, name, message) {
  const fn = host?.[name];
  if (typeof fn !== "function") fail("MH_DELEGATION_R3_HOST", message || `delegation host must provide ${name}()`);
  return fn;
}

function hostSnapshot(value) {
  return value?.structuredContent || value?.snapshot || value;
}

async function resolveDelegationSnapshots(delegations, host, maxFamily, { forceRefresh = false } = {}) {
  if (!Array.isArray(delegations) || delegations.length > maxFamily) {
    fail("MH_DELEGATION_R3_FAMILY", `delegations must contain at most ${maxFamily} retained delegation references`);
  }
  return Promise.all(delegations.map(async (entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !entry.contract) {
      fail("MH_DELEGATION_R3_FAMILY", `delegations[${index}] must contain its sealed Round-2 contract`);
    }
    if (entry.snapshot && !forceRefresh) return { contract: entry.contract, snapshot: entry.snapshot };
    const delegationId = typeof entry.delegationId === "string" && entry.delegationId.trim() !== ""
      ? entry.delegationId
      : typeof entry.snapshot?.delegationId === "string" && entry.snapshot.delegationId.trim() !== ""
        ? entry.snapshot.delegationId
        : null;
    if (!delegationId) {
      fail("MH_DELEGATION_R3_FAMILY", `delegations[${index}] must contain snapshot or retained delegationId`);
    }
    const getDelegation = hostFunction(
      host,
      "getDelegation",
      "retained delegationId reconciliation requires DevSpace get_delegation",
    );
    const fetched = await getDelegation({ delegationId });
    const snapshot = hostSnapshot(fetched);
    if (!snapshot || snapshot.delegationId !== delegationId) {
      fail("MH_DELEGATION_R3_HOST", "getDelegation must return the exact retained delegation snapshot requested by id");
    }
    return { contract: entry.contract, snapshot };
  }));
}

async function applyLifecycle({ repositoryPath, planned, suppressed, host, lifecycleActions, resumedDelegations }) {
  const byId = new Map(planned.liveRecords.map((record) => [laneIdentity(record.acceptanceLane), record]));
  const resumeDelegations = new Set();
  for (const decision of planned.frontier.laneDecisions) {
    const id = laneIdentity(decision);
    const record = byId.get(id);
    if (!record) fail("MH_DELEGATION_R3_LIFECYCLE", "challenged frontier decided a lane outside its exact live set");
    const lane = record.acceptanceLane;
    if (decision.decision === "CONTINUE") {
      lifecycleActions.push(Object.freeze({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
        action: "CONTINUE",
        checkpointDigest: null,
      }));
      if (["FAILED", "INTERRUPTED"].includes(lane.launchStatus)) resumeDelegations.add(lane.delegationId);
      continue;
    }

    if (decision.decision === "HOLD") {
      const checkpoint = persistDelegationHoldCheckpoint(repositoryPath, createDelegationHoldCheckpoint({
        contract: record.contract,
        acceptanceLane: lane,
        worldHeadDigest: planned.input.world.head.headDigest,
        gate: planned.frontier.gate.statement,
        reason: decision.reason,
        evidenceRefs: decision.evidenceRefs,
      }));
      const cancelLane = hostFunction(
        host,
        "cancelLane",
        "HOLD requires a retained Meta-Harness checkpoint followed by DevSpace cancel_lane",
      );
      await cancelLane({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
      });
      suppressed.add(id);
      lifecycleActions.push(Object.freeze({
        delegationId: lane.delegationId,
        laneKey: lane.laneKey,
        action: "HOLD",
        checkpointDigest: checkpoint.checkpointDigest,
      }));
      continue;
    }

    const cancelLane = hostFunction(
      host,
      "cancelLane",
      "OBSOLETE requires DevSpace cancel_lane before capacity is reused",
    );
    await cancelLane({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
    });
    suppressed.add(id);
    lifecycleActions.push(Object.freeze({
      delegationId: lane.delegationId,
      laneKey: lane.laneKey,
      action: "OBSOLETE",
      checkpointDigest: null,
    }));
  }

  if (resumeDelegations.size === 0) return;
  const resumeDelegation = hostFunction(
    host,
    "resumeDelegation",
    "a continuing interrupted/failed lane requires DevSpace resume_delegation",
  );
  for (const delegationId of [...resumeDelegations].sort()) {
    if (resumedDelegations.has(delegationId)) continue;
    await resumeDelegation({ delegationId });
    resumedDelegations.add(delegationId);
    lifecycleActions.push(Object.freeze({
      delegationId,
      laneKey: null,
      action: "RESUME",
      checkpointDigest: null,
    }));
  }
}

module.exports = {
  applyLifecycle,
  resolveDelegationSnapshots,
};
