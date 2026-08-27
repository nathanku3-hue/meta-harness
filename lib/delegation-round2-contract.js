"use strict";

const crypto = require("node:crypto");

const { canonicalize, cloneStrict, freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { readOutcome } = require("./outcome");
const { compileRepoPlannerInput } = require("./repo-planner-input");

const DELEGATION_ROUND2_SCHEMA = "meta-harness-delegation-round2/v1";
const DELEGATION_ACCEPTANCE_SCHEMA = "meta-harness-delegation-acceptance/v1";
const DELEGATION_ROUND2_DOMAIN = "meta-harness-delegation-round2/v1";
const DEVSPACE_CONTEXT_SCHEMA = "delegation-context/v1";
const DEVSPACE_SLICE = "DELEGATION-R2";
const MAX_LANES = 4;
const MAX_GATE_CHARS = 8_000;
const MAX_WORLD_CHARS = 20_000;
const MAX_ENDGAME_CHARS = 20_000;
const MAX_EVIDENCE_INDEX = 32;
const MAX_EVIDENCE_REF_CHARS = 200;
const MAX_EVIDENCE_SUMMARY_CHARS = 1_000;
const LANE_KEY_RE = /^[A-Za-z0-9._-]+$/u;
const CRITERION_VERDICTS = new Set(["PASS", "FAIL", "UNKNOWN"]);
const DEVSPACE_LANE_STATUSES = new Set(["PENDING", "BOOTING", "LAUNCHED", "FAILED", "INTERRUPTED", "CANCELLED"]);
const LANE_STATES = new Set(["PENDING", "FAIL", "UNKNOWN", "PASS", "CANCELLED"]);
const FORBIDDEN_TRANSCRIPT_KEYS = new Set([
  "transcript",
  "transcripts",
  "messages",
  "messageHistory",
  "conversationHistory",
  "assistantOutput",
  "assistantMessages",
  "rawConversation",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function nonEmpty(value, label, max = 20_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R2_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function oneLine(value, label, max = 200) {
  const text = nonEmpty(value, label, max);
  if (text.includes("\n")) fail("MH_DELEGATION_R2_VALUE", `${label} must be one line`);
  return text;
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R2_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R2_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function rawSha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function devspaceContextDigest(memory) {
  const body = {
    schemaVersion: DEVSPACE_CONTEXT_SCHEMA,
    endgame: memory.endgame,
    world: memory.world,
    gate: memory.gate,
    evidenceIndex: memory.evidenceIndex,
  };
  return rawSha256(JSON.stringify(body));
}

function boundedEvidence(ref, summary) {
  return Object.freeze({
    ref: oneLine(ref, "evidence.ref", MAX_EVIDENCE_REF_CHARS),
    summary: nonEmpty(summary, "evidence.summary", MAX_EVIDENCE_SUMMARY_CHARS),
  });
}

function evidenceIndexFor({ plannerInput, current, laneOutcomes }) {
  const evidence = [
    boundedEvidence(plannerInput.ownerIntent.productFrame.productDirectionDigest, "Owner-authored PRODUCT direction pinned for this delegation memory."),
    boundedEvidence(current.head.headDigest, "Authoritative WorldHead from which this delegation memory was projected."),
    boundedEvidence(current.head.worldDigest, "Immutable current accepted World referenced by the retained WorldHead."),
  ];
  for (const outcome of laneOutcomes) {
    evidence.push(boundedEvidence(outcome.outcomeDigest, `Immutable Outcome ${outcome.id}: ${outcome.desiredState}`));
  }
  if (evidence.length > MAX_EVIDENCE_INDEX) {
    fail("MH_DELEGATION_R2_EVIDENCE", `delegation memory evidence index exceeds ${MAX_EVIDENCE_INDEX} entries`);
  }
  return Object.freeze(evidence);
}

function normalizedLaneInput(lane, index) {
  exactKeys(lane, ["laneKey", "outcomeDigest"], `lanes[${index}]`);
  const laneKey = oneLine(lane.laneKey, `lanes[${index}].laneKey`, 64);
  if (!LANE_KEY_RE.test(laneKey)) {
    fail("MH_DELEGATION_R2_LANE", `lanes[${index}].laneKey contains unsupported characters`);
  }
  if (!isDigest(lane.outcomeDigest)) {
    fail("MH_DELEGATION_R2_LANE", `lanes[${index}].outcomeDigest must be a sha256 digest`);
  }
  return Object.freeze({ laneKey, outcomeDigest: lane.outcomeDigest });
}

function laneContract(repositoryPath, lane) {
  const outcome = readOutcome(repositoryPath, lane.outcomeDigest);
  return Object.freeze({
    laneKey: lane.laneKey,
    outcomeDigest: outcome.outcomeDigest,
    objective: outcome.desiredState,
    acceptanceCriteria: Object.freeze([
      Object.freeze({ id: "desired-state", text: outcome.desiredState }),
      Object.freeze({ id: "evidence-requirement", text: outcome.evidenceRequirement }),
    ]),
  });
}

function contractBody(value) {
  const body = cloneStrict(value);
  delete body.contractDigest;
  return body;
}

function computeDelegationRound2Digest(value) {
  return domainDigest(DELEGATION_ROUND2_DOMAIN, contractBody(value));
}

function validateDelegationRound2Contract(value) {
  exactKeys(value, [
    "schemaVersion",
    "originWorldHeadDigest",
    "productDirectionDigest",
    "memory",
    "devspaceContextDigest",
    "lanes",
    "contractDigest",
  ], "delegationRound2");
  if (value.schemaVersion !== DELEGATION_ROUND2_SCHEMA) {
    fail("MH_DELEGATION_R2_SCHEMA", `delegationRound2.schemaVersion must be ${DELEGATION_ROUND2_SCHEMA}`);
  }
  if (!isDigest(value.originWorldHeadDigest) || !isDigest(value.productDirectionDigest)) {
    fail("MH_DELEGATION_R2_DIGEST", "delegationRound2 origin/product digests must be sha256 digests");
  }
  exactKeys(value.memory, ["endgame", "world", "gate", "evidenceIndex"], "delegationRound2.memory");
  nonEmpty(value.memory.endgame, "delegationRound2.memory.endgame", MAX_ENDGAME_CHARS);
  nonEmpty(value.memory.world, "delegationRound2.memory.world", MAX_WORLD_CHARS);
  nonEmpty(value.memory.gate, "delegationRound2.memory.gate", MAX_GATE_CHARS);
  if (!Array.isArray(value.memory.evidenceIndex) || value.memory.evidenceIndex.length > MAX_EVIDENCE_INDEX) {
    fail("MH_DELEGATION_R2_EVIDENCE", `delegationRound2.memory.evidenceIndex must contain at most ${MAX_EVIDENCE_INDEX} entries`);
  }
  const evidenceRefs = new Set();
  for (const [index, entry] of value.memory.evidenceIndex.entries()) {
    exactKeys(entry, ["ref", "summary"], `delegationRound2.memory.evidenceIndex[${index}]`);
    const ref = oneLine(entry.ref, `delegationRound2.memory.evidenceIndex[${index}].ref`, MAX_EVIDENCE_REF_CHARS);
    nonEmpty(entry.summary, `delegationRound2.memory.evidenceIndex[${index}].summary`, MAX_EVIDENCE_SUMMARY_CHARS);
    if (evidenceRefs.has(ref)) fail("MH_DELEGATION_R2_EVIDENCE", `duplicate delegation memory evidence ref: ${ref}`);
    evidenceRefs.add(ref);
  }
  if (!Array.isArray(value.lanes) || value.lanes.length < 1 || value.lanes.length > MAX_LANES) {
    fail("MH_DELEGATION_R2_LANE", `delegationRound2.lanes must contain 1-${MAX_LANES} lanes`);
  }
  const laneKeys = new Set();
  const outcomeDigests = new Set();
  for (const [index, lane] of value.lanes.entries()) {
    exactKeys(lane, ["laneKey", "outcomeDigest", "objective", "acceptanceCriteria"], `delegationRound2.lanes[${index}]`);
    const laneKey = oneLine(lane.laneKey, `delegationRound2.lanes[${index}].laneKey`, 64);
    if (!LANE_KEY_RE.test(laneKey) || laneKeys.has(laneKey.toLowerCase())) {
      fail("MH_DELEGATION_R2_LANE", `delegationRound2 lane key is invalid or duplicated: ${laneKey}`);
    }
    laneKeys.add(laneKey.toLowerCase());
    if (!isDigest(lane.outcomeDigest) || outcomeDigests.has(lane.outcomeDigest)) {
      fail("MH_DELEGATION_R2_LANE", `delegationRound2 lane Outcome is invalid or duplicated: ${lane.outcomeDigest}`);
    }
    outcomeDigests.add(lane.outcomeDigest);
    nonEmpty(lane.objective, `delegationRound2.lanes[${index}].objective`, 4_000);
    if (!Array.isArray(lane.acceptanceCriteria) || lane.acceptanceCriteria.length !== 2) {
      fail("MH_DELEGATION_R2_LANE", "Meta-Harness Round-2 lane criteria must contain desired-state and evidence-requirement exactly");
    }
    const expectedIds = ["desired-state", "evidence-requirement"];
    lane.acceptanceCriteria.forEach((criterion, criterionIndex) => {
      exactKeys(criterion, ["id", "text"], `delegationRound2.lanes[${index}].acceptanceCriteria[${criterionIndex}]`);
      if (criterion.id !== expectedIds[criterionIndex]) {
        fail("MH_DELEGATION_R2_LANE", `delegationRound2 criterion ${criterionIndex} must be ${expectedIds[criterionIndex]}`);
      }
      nonEmpty(criterion.text, `delegationRound2 criterion ${criterion.id}`, 1_000);
    });
  }
  const expectedContextDigest = devspaceContextDigest(value.memory);
  if (value.devspaceContextDigest !== expectedContextDigest) {
    fail("MH_DELEGATION_R2_DIGEST", "delegationRound2.devspaceContextDigest does not match the exact DevSpace memory packet");
  }
  if (!isDigest(value.contractDigest) || value.contractDigest !== computeDelegationRound2Digest(value)) {
    fail("MH_DELEGATION_R2_DIGEST", "delegationRound2.contractDigest does not match its body");
  }
  return freezeDeep(cloneStrict(value));
}

function compileDelegationRound2Contract({ repositoryPath, current, recovered = [], gate, lanes }) {
  const plannerInput = compileRepoPlannerInput({ repositoryPath, current, recovered });
  const normalized = Array.isArray(lanes) ? lanes.map(normalizedLaneInput) : [];
  if (normalized.length < 1 || normalized.length > MAX_LANES) {
    fail("MH_DELEGATION_R2_LANE", `lanes must contain 1-${MAX_LANES} entries`);
  }
  const laneContracts = normalized.map((lane) => laneContract(repositoryPath, lane));
  const endgame = nonEmpty(plannerInput.ownerIntent.productFrame.endgame, "PRODUCT Endgame projection", MAX_ENDGAME_CHARS);
  const world = canonicalize({
    head: {
      headDigest: current.head.headDigest,
      worldDigest: current.head.worldDigest,
      productCommit: current.head.productCommit,
    },
    currentWorld: plannerInput.currentWorld,
  });
  if (world.length > MAX_WORLD_CHARS) {
    fail("MH_DELEGATION_R2_WORLD", `current accepted World projection exceeds DevSpace ${MAX_WORLD_CHARS}-character memory bound`);
  }
  const memory = Object.freeze({
    endgame,
    world,
    gate: nonEmpty(gate, "current gate", MAX_GATE_CHARS),
    evidenceIndex: evidenceIndexFor({ plannerInput, current, laneOutcomes: laneContracts }),
  });
  const body = {
    schemaVersion: DELEGATION_ROUND2_SCHEMA,
    originWorldHeadDigest: current.head.headDigest,
    productDirectionDigest: plannerInput.ownerIntent.productFrame.productDirectionDigest,
    memory,
    devspaceContextDigest: devspaceContextDigest(memory),
    lanes: Object.freeze(laneContracts),
  };
  return validateDelegationRound2Contract({
    ...body,
    contractDigest: computeDelegationRound2Digest(body),
  });
}

function rejectTranscriptKeys(value, path = "$", seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail("MH_DELEGATION_R2_FANIN", `fan-in snapshot contains a cycle at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => rejectTranscriptKeys(entry, `${path}[${index}]`, seen));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_TRANSCRIPT_KEYS.has(key)) {
        fail("MH_DELEGATION_R2_TRANSCRIPT", `fan-in snapshot must not contain child transcript field ${path}.${key}`);
      }
      rejectTranscriptKeys(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function validateEvidenceIndex(index, label) {
  if (!Array.isArray(index) || index.length < 1 || index.length > 20) {
    fail("MH_DELEGATION_R2_FANIN", `${label} must contain 1-20 compact evidence entries`);
  }
  const refs = new Set();
  for (const [entryIndex, entry] of index.entries()) {
    exactKeys(entry, ["ref", "summary"], `${label}[${entryIndex}]`);
    const ref = oneLine(entry.ref, `${label}[${entryIndex}].ref`, 128);
    nonEmpty(entry.summary, `${label}[${entryIndex}].summary`, 500);
    if (refs.has(ref)) fail("MH_DELEGATION_R2_FANIN", `${label} contains duplicate evidence ref ${ref}`);
    refs.add(ref);
  }
  return refs;
}

function aggregateCriteria(criteria) {
  if (criteria.some((criterion) => criterion.verdict === "FAIL")) return "FAIL";
  if (criteria.every((criterion) => criterion.verdict === "PASS")) return "PASS";
  return "UNKNOWN";
}

function validateResultCard(card, laneContract, label) {
  if (!card) return null;
  exactKeys(card, [
    "schemaVersion",
    "resultDigest",
    "taskOutcome",
    "claim",
    "criteria",
    "evidenceIndex",
    "worldDelta",
    "remainingUncertainty",
    "recommendedHandoff",
    "submittedAt",
  ], label);
  if (card.schemaVersion !== "lane-result-card/v1" || !isDigest(card.resultDigest)) {
    fail("MH_DELEGATION_R2_FANIN", `${label} has invalid result schema/digest`);
  }
  if (!["READY", "DONE", "UNVERIFIED", "BLOCKED"].includes(card.taskOutcome)) {
    fail("MH_DELEGATION_R2_FANIN", `${label}.taskOutcome is invalid`);
  }
  nonEmpty(card.claim, `${label}.claim`, 2_000);
  const evidenceRefs = validateEvidenceIndex(card.evidenceIndex, `${label}.evidenceIndex`);
  if (!Array.isArray(card.criteria) || card.criteria.length !== laneContract.acceptanceCriteria.length) {
    fail("MH_DELEGATION_R2_FANIN", `${label}.criteria must cover every sealed criterion exactly once`);
  }
  const criteria = card.criteria.map((criterion, index) => {
    exactKeys(criterion, ["id", "verdict", "evidenceRefs"], `${label}.criteria[${index}]`);
    if (criterion.id !== laneContract.acceptanceCriteria[index].id || !CRITERION_VERDICTS.has(criterion.verdict)) {
      fail("MH_DELEGATION_R2_FANIN", `${label}.criteria[${index}] does not match the sealed lane criterion`);
    }
    if (!Array.isArray(criterion.evidenceRefs) || criterion.evidenceRefs.length < 1
        || criterion.evidenceRefs.some((ref) => !evidenceRefs.has(ref))) {
      fail("MH_DELEGATION_R2_FANIN", `${label}.criteria[${index}] references evidence outside the compact result index`);
    }
    return Object.freeze({
      id: criterion.id,
      verdict: criterion.verdict,
      evidenceRefs: Object.freeze([...criterion.evidenceRefs]),
    });
  });
  for (const field of ["worldDelta", "remainingUncertainty"]) {
    if (!Array.isArray(card[field]) || card[field].length > 12) {
      fail("MH_DELEGATION_R2_FANIN", `${label}.${field} must be a bounded array`);
    }
    card[field].forEach((entry, index) => {
      exactKeys(entry, ["fact", "evidenceRefs"], `${label}.${field}[${index}]`);
      nonEmpty(entry.fact, `${label}.${field}[${index}].fact`, 1_000);
      if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length < 1
          || entry.evidenceRefs.some((ref) => !evidenceRefs.has(ref))) {
        fail("MH_DELEGATION_R2_FANIN", `${label}.${field}[${index}] references unknown evidence`);
      }
    });
  }
  if (card.recommendedHandoff !== null) nonEmpty(card.recommendedHandoff, `${label}.recommendedHandoff`, 2_000);
  if (typeof card.submittedAt !== "string" || !Number.isFinite(Date.parse(card.submittedAt))) {
    fail("MH_DELEGATION_R2_FANIN", `${label}.submittedAt must be a timestamp`);
  }
  return Object.freeze({
    resultDigest: card.resultDigest,
    taskOutcome: card.taskOutcome,
    claim: card.claim,
    acceptance: aggregateCriteria(criteria),
    criteria: Object.freeze(criteria),
    evidenceIndex: freezeDeep(cloneStrict(card.evidenceIndex)),
    worldDelta: freezeDeep(cloneStrict(card.worldDelta)),
    remainingUncertainty: freezeDeep(cloneStrict(card.remainingUncertainty)),
    recommendedHandoff: card.recommendedHandoff,
    submittedAt: card.submittedAt,
  });
}

function acceptDelegationRound2FanIn({ contract, snapshot }) {
  const expected = validateDelegationRound2Contract(contract);
  rejectTranscriptKeys(snapshot);
  if (!isOrdinaryPlainObject(snapshot) || snapshot.slice !== DEVSPACE_SLICE) {
    fail("MH_DELEGATION_R2_FANIN", `fan-in snapshot must be ${DEVSPACE_SLICE}`);
  }
  if (snapshot.contextDigest !== expected.devspaceContextDigest) {
    fail("MH_DELEGATION_R2_FANIN", "fan-in snapshot contextDigest does not match the sealed Meta-Harness delegation memory");
  }
  if (snapshot.selectedEvidence !== undefined) {
    fail("MH_DELEGATION_R2_FANIN", "compact acceptance must not ingest selectively expanded evidence bodies");
  }
  if (!Array.isArray(snapshot.lanes) || snapshot.lanes.length !== expected.lanes.length) {
    fail("MH_DELEGATION_R2_FANIN", "fan-in snapshot lane set does not match the sealed delegation contract");
  }
  const snapshotByLane = new Map(snapshot.lanes.map((lane) => [lane.laneKey, lane]));
  const matrix = expected.lanes.map((laneContract, index) => {
    const lane = snapshotByLane.get(laneContract.laneKey);
    if (!lane) fail("MH_DELEGATION_R2_FANIN", `fan-in snapshot is missing lane ${laneContract.laneKey}`);
    if (lane.objective !== laneContract.objective
        || JSON.stringify(lane.acceptanceCriteria) !== JSON.stringify(laneContract.acceptanceCriteria)) {
      fail("MH_DELEGATION_R2_FANIN", `fan-in lane ${laneContract.laneKey} does not match its sealed Outcome projection`);
    }
    oneLine(lane.taskId, `snapshot.lanes[${index}].taskId`, 200);
    oneLine(lane.workspaceId, `snapshot.lanes[${index}].workspaceId`, 200);
    if (!DEVSPACE_LANE_STATUSES.has(lane.status)) {
      fail("MH_DELEGATION_R2_FANIN", `fan-in lane ${laneContract.laneKey} has invalid DevSpace launch status`);
    }
    if (!isDigest(lane.laneBriefDigest) || !isDigest(lane.bootPromptDigest)) {
      fail("MH_DELEGATION_R2_FANIN", `fan-in lane ${laneContract.laneKey} is missing server-bound brief/prompt digests`);
    }
    const result = validateResultCard(lane.result, laneContract, `snapshot.lanes[${index}].result`);
    const acceptance = result
      ? result.acceptance
      : lane.status === "CANCELLED" ? "CANCELLED" : "PENDING";
    if (!LANE_STATES.has(acceptance)) fail("MH_DELEGATION_R2_FANIN", `fan-in lane ${laneContract.laneKey} has invalid acceptance`);
    return Object.freeze({
      laneKey: laneContract.laneKey,
      outcomeDigest: laneContract.outcomeDigest,
      taskId: lane.taskId,
      workspaceId: lane.workspaceId,
      laneBriefDigest: lane.laneBriefDigest,
      bootPromptDigest: lane.bootPromptDigest,
      launchStatus: lane.status,
      acceptance,
      result,
    });
  });
  const summary = {
    pass: matrix.filter((lane) => lane.acceptance === "PASS").length,
    fail: matrix.filter((lane) => lane.acceptance === "FAIL").length,
    unknown: matrix.filter((lane) => lane.acceptance === "UNKNOWN").length,
    pending: matrix.filter((lane) => lane.acceptance === "PENDING").length,
    cancelled: matrix.filter((lane) => lane.acceptance === "CANCELLED").length,
  };
  return freezeDeep({
    schemaVersion: DELEGATION_ACCEPTANCE_SCHEMA,
    delegationId: oneLine(snapshot.delegationId, "snapshot.delegationId", 200),
    contextDigest: expected.devspaceContextDigest,
    contractDigest: expected.contractDigest,
    complete: summary.pending === 0,
    summary,
    lanes: matrix,
  });
}

function compileDelegationEvidenceRequest({ acceptance, laneKey, refs }) {
  if (!isOrdinaryPlainObject(acceptance) || acceptance.schemaVersion !== DELEGATION_ACCEPTANCE_SCHEMA) {
    fail("MH_DELEGATION_R2_EVIDENCE", `acceptance must use ${DELEGATION_ACCEPTANCE_SCHEMA}`);
  }
  const key = oneLine(laneKey, "laneKey", 64);
  const lane = acceptance.lanes?.find((entry) => entry.laneKey === key);
  if (!lane?.result) fail("MH_DELEGATION_R2_EVIDENCE", `accepted fan-in lane ${key} has no compact result evidence index`);
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 10) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence request must contain 1-10 refs");
  }
  const known = new Set(lane.result.evidenceIndex.map((entry) => entry.ref));
  const requested = refs.map((ref, index) => oneLine(ref, `refs[${index}]`, 128));
  if (new Set(requested).size !== requested.length || requested.some((ref) => !known.has(ref))) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence request must contain unique refs already named by the compact lane result");
  }
  return freezeDeep({
    delegationId: acceptance.delegationId,
    evidence: { laneKey: key, refs: requested },
  });
}

function validateDelegationEvidenceResponse({ request, acceptance, snapshot }) {
  rejectTranscriptKeys(snapshot);
  if (!isOrdinaryPlainObject(request) || !isOrdinaryPlainObject(request.evidence)) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence request is invalid");
  }
  if (!isOrdinaryPlainObject(acceptance) || acceptance.schemaVersion !== DELEGATION_ACCEPTANCE_SCHEMA) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence response validation requires the compact acceptance matrix that authorized the request");
  }
  if (snapshot.delegationId !== request.delegationId
      || snapshot.delegationId !== acceptance.delegationId
      || snapshot.contextDigest !== acceptance.contextDigest
      || !Array.isArray(snapshot.selectedEvidence)) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence response does not bind the requested delegation/context or selected evidence list");
  }
  const acceptedLane = acceptance.lanes?.find((entry) => entry.laneKey === request.evidence.laneKey);
  if (!acceptedLane?.result?.resultDigest) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence response lane has no compact accepted result identity");
  }
  const compactLane = snapshot.lanes?.find((entry) => entry.laneKey === request.evidence.laneKey);
  if (compactLane?.result?.resultDigest !== acceptedLane.result.resultDigest) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence response compact result changed since acceptance");
  }
  const expectedRefs = request.evidence.refs;
  if (snapshot.selectedEvidence.length !== expectedRefs.length) {
    fail("MH_DELEGATION_R2_EVIDENCE", "evidence response returned a different number of evidence bodies than requested");
  }
  const selected = snapshot.selectedEvidence.map((entry, index) => {
    exactKeys(entry, ["laneKey", "resultDigest", "ref", "summary", "detail"], `selectedEvidence[${index}]`);
    if (entry.laneKey !== request.evidence.laneKey
        || entry.ref !== expectedRefs[index]
        || entry.resultDigest !== acceptedLane.result.resultDigest) {
      fail("MH_DELEGATION_R2_EVIDENCE", "evidence response returned unrequested, stale, or misbound evidence");
    }
    nonEmpty(entry.summary, `selectedEvidence[${index}].summary`, 500);
    nonEmpty(entry.detail, `selectedEvidence[${index}].detail`, 5_000);
    return cloneStrict(entry);
  });
  return freezeDeep(selected);
}

module.exports = {
  DELEGATION_ACCEPTANCE_SCHEMA,
  DELEGATION_ROUND2_DOMAIN,
  DELEGATION_ROUND2_SCHEMA,
  acceptDelegationRound2FanIn,
  compileDelegationEvidenceRequest,
  compileDelegationRound2Contract,
  computeDelegationRound2Digest,
  devspaceContextDigest,
  validateDelegationEvidenceResponse,
  validateDelegationRound2Contract,
};
