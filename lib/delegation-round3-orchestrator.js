"use strict";

const {
  acceptDelegationRound2FanIn,
  validateDelegationRound2Contract,
} = require("./delegation-round2-contract");
const { listDelegationHoldCheckpoints } = require("./delegation-round3-checkpoint");
const {
  applyGrill,
  computeDecisionFrontierDigest,
  MAX_FRONTIER_LANES,
  validateDelegationFrontierCandidate,
} = require("./delegation-round3-frontier");
const { applyLifecycle, resolveDelegationSnapshots, spawnRefill } = require("./delegation-round3-host");
const {
  createSurfacedDelegationFrontier,
  latestSurfacedDelegationFrontier,
  persistSurfacedDelegationFrontier,
} = require("./delegation-round3-gate-record");
const { runDelegationFrontierPlanner, runDelegationGrill } = require("./delegation-round3-model");
const { delegationLearningFromAcceptance } = require("./delegation-round3-learning");
const { findDelegationLanding, landDelegationLearning } = require("./delegation-round3-landing");
const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const { compileRepoPlannerInput } = require("./repo-planner-input");
const { readImmutableJson } = require("./world-authority");
const { readCurrentWorldState } = require("./world-transition");

const DELEGATION_ROUND3_RESULT_SCHEMA = "delegation-round3-result/v1";
const MAX_DELEGATION_FAMILY = 16;
const MAX_FRONTIER_EVIDENCE = 96;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function nonEmpty(value, label, max = 8000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function laneIdentity(value) {
  return `${value.delegationId}\u001f${value.laneKey}`;
}

function acceptedFamily(delegations) {
  if (!Array.isArray(delegations) || delegations.length > MAX_DELEGATION_FAMILY) {
    fail("MH_DELEGATION_R3_FAMILY", `delegations must contain at most ${MAX_DELEGATION_FAMILY} retained delegation snapshots`);
  }
  const ids = new Set();
  return Object.freeze(delegations.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !entry.contract || !entry.snapshot) {
      fail("MH_DELEGATION_R3_FAMILY", `delegations[${index}] must contain contract and snapshot`);
    }
    const contract = validateDelegationRound2Contract(entry.contract);
    const acceptance = acceptDelegationRound2FanIn({ contract, snapshot: entry.snapshot });
    if (ids.has(acceptance.delegationId)) {
      fail("MH_DELEGATION_R3_FAMILY", `duplicate delegationId in retained family: ${acceptance.delegationId}`);
    }
    ids.add(acceptance.delegationId);
    return Object.freeze({ contract, acceptance });
  }));
}

function gateForFamily(explicitGate, family) {
  if (explicitGate !== undefined && explicitGate !== null) return nonEmpty(explicitGate, "gate");
  const retained = family.at(-1)?.contract?.memory?.gate;
  if (retained) return nonEmpty(retained, "retained delegation gate");
  fail("MH_DELEGATION_R3_GATE", "an explicit current gate is required before the first delegation frontier exists");
}

function familyLaneRecords(family) {
  const records = [];
  for (const entry of family) {
    for (const lane of entry.acceptance.lanes) {
      const sealed = entry.contract.lanes.find((candidate) => candidate.laneKey === lane.laneKey);
      if (!sealed) fail("MH_DELEGATION_R3_FAMILY", `accepted lane ${lane.laneKey} has no sealed lane contract`);
      records.push(Object.freeze({
        delegationId: entry.acceptance.delegationId,
        contract: entry.contract,
        contractLane: sealed,
        acceptanceLane: Object.freeze({ ...lane, delegationId: entry.acceptance.delegationId }),
      }));
    }
  }
  return Object.freeze(records);
}

function currentLandedResult(repositoryPath, current, record) {
  if (!record.acceptanceLane.result) return null;
  return findDelegationLanding(repositoryPath, current, record.acceptanceLane.result.resultDigest);
}

function addEvidence(index, ref, summary) {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) return;
  const cleanSummary = String(summary || "").replace(/\r/gu, "").trim().slice(0, 1000);
  if (!cleanSummary || index.has(ref)) return;
  index.set(ref, cleanSummary);
}

function checkpointEvidence(repositoryPath, index) {
  const projected = listDelegationHoldCheckpoints(repositoryPath).map((checkpoint) => ({
    checkpoint,
    generation: readImmutableJson(repositoryPath, "heads", checkpoint.worldHeadDigest).generation,
  })).sort((left, right) => right.generation - left.generation
    || left.checkpoint.checkpointDigest.localeCompare(right.checkpoint.checkpointDigest));
  const seenOutcomes = new Set();
  for (const { checkpoint } of projected) {
    if (seenOutcomes.has(checkpoint.outcomeDigest)) continue;
    seenOutcomes.add(checkpoint.outcomeDigest);
    const objective = readOutcome(repositoryPath, checkpoint.outcomeDigest).desiredState;
    addEvidence(
      index,
      checkpoint.checkpointDigest,
      `Retained HOLD checkpoint for ${objective}. Reason: ${checkpoint.reason}`,
    );
    if (seenOutcomes.size >= 16) break;
  }
}

function frontierEvidenceIndex({ repositoryPath, current, plannerInput, records }) {
  const index = new Map();
  addEvidence(index, plannerInput.ownerIntent.productFrame.productDirectionDigest, "Current owner-authored PRODUCT direction.");
  addEvidence(index, current.head.headDigest, "Current authoritative WorldHead for this frontier reconciliation.");
  addEvidence(index, current.head.worldDigest, "Current accepted World referenced by the authoritative WorldHead.");

  for (const record of records) {
    for (const evidence of record.contract.memory.evidenceIndex) addEvidence(index, evidence.ref, evidence.summary);
    const result = record.acceptanceLane.result;
    if (!result || !currentLandedResult(repositoryPath, current, record)) continue;
    addEvidence(
      index,
      result.resultDigest,
      `Authoritatively landed compact lane result ${record.delegationId}/${record.acceptanceLane.laneKey}: ${result.acceptance}. ${result.claim}`,
    );
    const namespace = result.resultDigest.slice(-16);
    for (const evidence of result.evidenceIndex) {
      addEvidence(index, `lane-evidence:${namespace}:${evidence.ref}`, `Evidence from ${result.resultDigest}: ${evidence.summary}`);
    }
  }
  checkpointEvidence(repositoryPath, index);
  const entries = [...index.entries()].map(([ref, summary]) => Object.freeze({ ref, summary }));
  if (entries.length > MAX_FRONTIER_EVIDENCE) {
    fail("MH_DELEGATION_R3_EVIDENCE", `bounded delegation frontier evidence exceeds ${MAX_FRONTIER_EVIDENCE} entries`);
  }
  return Object.freeze(entries);
}

function liveLaneState(records, suppressed) {
  const live = records.filter((record) => record.acceptanceLane.acceptance === "PENDING"
    && !suppressed.has(laneIdentity(record.acceptanceLane)));
  if (live.length > MAX_FRONTIER_LANES) {
    fail("MH_DELEGATION_R3_CAPACITY", `live delegation lanes exceed the bounded ${MAX_FRONTIER_LANES}-lane frontier`);
  }
  return live;
}

function compileFrontierInput({ repositoryPath, current, recovered, gate, records, suppressed }) {
  const plannerInput = compileRepoPlannerInput({ repositoryPath, current, recovered });
  const liveRecords = liveLaneState(records, suppressed);
  const liveLanes = Object.freeze(liveRecords.map((record) => Object.freeze({
    delegationId: record.delegationId,
    laneKey: record.acceptanceLane.laneKey,
    outcomeDigest: record.acceptanceLane.outcomeDigest,
    objective: record.contractLane.objective,
    acceptanceCriteria: record.contractLane.acceptanceCriteria,
  })));
  return Object.freeze({
    input: Object.freeze({
      endgame: plannerInput.ownerIntent.productFrame.endgame,
      world: Object.freeze({
        head: Object.freeze({
          headDigest: current.head.headDigest,
          worldDigest: current.head.worldDigest,
          productCommit: current.head.productCommit,
        }),
        currentWorld: current.world,
      }),
      currentGate: gate,
      liveLanes,
      evidenceIndex: frontierEvidenceIndex({ repositoryPath, current, plannerInput, records }),
      availableSlots: Math.max(0, MAX_FRONTIER_LANES - liveRecords.length),
    }),
    liveRecords: Object.freeze(liveRecords),
  });
}

function runnerResult(value, label) {
  if (value?.result && typeof value.result === "object") return value.result;
  if (value && typeof value === "object") return value;
  fail("MH_DELEGATION_R3_MODEL", `${label} did not return a structured candidate`);
}

async function challengedFrontier({
  repositoryPath,
  current,
  recovered,
  gate,
  records,
  suppressed,
  frontierRunner,
  grillRunner,
  model,
  timeoutSeconds,
  env,
  signal,
  staleAttempts = 0,
}) {
  const compiled = compileFrontierInput({ repositoryPath, current, recovered, gate, records, suppressed });
  const options = {
    liveLanes: compiled.input.liveLanes,
    availableSlots: compiled.input.availableSlots,
    knownEvidenceRefs: new Set(compiled.input.evidenceIndex.map((entry) => entry.ref)),
  };
  const proposedRaw = await frontierRunner({
    repositoryPath, input: compiled.input, model, timeoutSeconds, env, signal,
  });
  const proposed = validateDelegationFrontierCandidate(runnerResult(proposedRaw, "frontier planner"), options);
  const grillRaw = await grillRunner({
    repositoryPath, input: compiled.input, frontier: proposed, model, timeoutSeconds, env, signal,
  });
  const final = applyGrill(proposed, runnerResult(grillRaw, "Grill"), options);
  const latest = readCurrentWorldState(repositoryPath);
  if (latest.head.headDigest !== current.head.headDigest) {
    if (staleAttempts >= 2) fail("MH_DELEGATION_R3_FRONTIER_STALE", "delegation frontier kept changing during bounded reconciliation");
    return challengedFrontier({
      repositoryPath, current: latest, recovered, gate, records, suppressed, frontierRunner, grillRunner,
      model, timeoutSeconds, env, signal, staleAttempts: staleAttempts + 1,
    });
  }
  return Object.freeze({ input: compiled.input, liveRecords: compiled.liveRecords, frontier: final, grillRuns: staleAttempts + 1 });
}

function sortedUnlandedResults(repositoryPath, current, records) {
  return records.filter((record) => record.acceptanceLane.result
    && !currentLandedResult(repositoryPath, current, record))
    .sort((left, right) => {
      const time = Date.parse(left.acceptanceLane.result.submittedAt) - Date.parse(right.acceptanceLane.result.submittedAt);
      return time || left.delegationId.localeCompare(right.delegationId)
        || left.acceptanceLane.laneKey.localeCompare(right.acceptanceLane.laneKey);
    });
}

function closeActions(records) {
  return records.filter((record) => record.acceptanceLane.result).map((record) => Object.freeze({
    delegationId: record.delegationId,
    laneKey: record.acceptanceLane.laneKey,
    action: "CLOSE",
    checkpointDigest: null,
  }));
}

async function runDelegationRound3({
  repositoryPath,
  delegations = [],
  gate,
  recovered = [],
  previousFrontierDigest = null,
  host = {},
  frontierRunner = runDelegationFrontierPlanner,
  grillRunner = runDelegationGrill,
  interpret,
  now = () => new Date(),
  model,
  timeoutSeconds = 300,
  env = process.env,
  signal,
} = {}) {
  if (previousFrontierDigest !== null && !isDigest(previousFrontierDigest)) {
    fail("MH_DELEGATION_R3_FRONTIER_DIGEST", "previousFrontierDigest must be null or a sha256 digest");
  }
  const family = acceptedFamily(await resolveDelegationSnapshots(delegations, host, MAX_DELEGATION_FAMILY));
  const initialGate = gateForFamily(gate, family);
  const records = familyLaneRecords(family);
  const suppressed = new Set();
  const resumedDelegations = new Set();
  const lifecycleActions = closeActions(records);
  const landings = [];
  let current = readCurrentWorldState(repositoryPath, { now: now() });
  let planned = null;
  let grillRuns = 0;

  const backlog = sortedUnlandedResults(repositoryPath, current, records);
  for (const record of backlog) {
    const learning = delegationLearningFromAcceptance({
      contract: record.contract,
      acceptance: family.find((entry) => entry.acceptance.delegationId === record.delegationId).acceptance,
      laneKey: record.acceptanceLane.laneKey,
    });
    const landed = landDelegationLearning({
      repositoryPath,
      learning,
      ...(interpret ? { interpret } : {}),
      now,
    });
    landings.push(landed);
    current = readCurrentWorldState(repositoryPath, { now: now() });
    planned = await challengedFrontier({
      repositoryPath,
      current,
      recovered,
      gate: initialGate,
      records,
      suppressed,
      frontierRunner,
      grillRunner,
      model,
      timeoutSeconds,
      env,
      signal,
    });
    grillRuns += planned.grillRuns;
    await applyLifecycle({ repositoryPath, planned, suppressed, host, lifecycleActions, resumedDelegations });
  }

  if (!planned) {
    current = readCurrentWorldState(repositoryPath, { now: now() });
    planned = await challengedFrontier({
      repositoryPath,
      current,
      recovered,
      gate: initialGate,
      records,
      suppressed,
      frontierRunner,
      grillRunner,
      model,
      timeoutSeconds,
      env,
      signal,
    });
    grillRuns += planned.grillRuns;
    await applyLifecycle({ repositoryPath, planned, suppressed, host, lifecycleActions, resumedDelegations });
  }

  const refill = await spawnRefill({ repositoryPath, recovered, planned, host });
  const finalCurrent = readCurrentWorldState(repositoryPath, { now: now() });
  const decisionFrontierDigest = computeDecisionFrontierDigest(planned.frontier);
  const retainedSurface = latestSurfacedDelegationFrontier(repositoryPath, finalCurrent);
  if (previousFrontierDigest !== null && retainedSurface && retainedSurface.frontierDigest !== previousFrontierDigest) {
    fail("MH_DELEGATION_R3_FRONTIER_CONTINUITY", "caller frontier continuity disagrees with retained surfaced-gate evidence", {
      caller: previousFrontierDigest,
      retained: retainedSurface.frontierDigest,
    });
  }
  const comparisonFrontierDigest = retainedSurface?.frontierDigest || previousFrontierDigest;
  const semanticFrontierChanged = comparisonFrontierDigest !== null
    ? comparisonFrontierDigest !== decisionFrontierDigest
    : planned.frontier.gate.statement !== initialGate;
  const surfacedGate = planned.frontier.gate.kind === "CONTINUE" || !semanticFrontierChanged
    ? null
    : planned.frontier.gate;
  const surfacedFrontierRecord = surfacedGate ? persistSurfacedDelegationFrontier(
    repositoryPath,
    createSurfacedDelegationFrontier({
      worldHeadDigest: finalCurrent.head.headDigest,
      frontierDigest: decisionFrontierDigest,
      gate: surfacedGate,
      now: now(),
    }),
  ) : null;

  return Object.freeze({
    schemaVersion: DELEGATION_ROUND3_RESULT_SCHEMA,
    worldHeadDigest: finalCurrent.head.headDigest,
    productCommit: finalCurrent.head.productCommit,
    landings: Object.freeze(landings),
    lifecycleActions: Object.freeze(lifecycleActions),
    refill,
    grillRuns,
    decisionFrontierDigest,
    frontier: planned.frontier,
    surfacedGate,
    surfacedFrontierRecordDigest: surfacedFrontierRecord?.recordDigest || null,
  });
}

module.exports = {
  DELEGATION_ROUND3_RESULT_SCHEMA,
  MAX_DELEGATION_FAMILY,
  compileFrontierInput,
  runDelegationRound3,
};
