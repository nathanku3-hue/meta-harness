"use strict";

const { cloneStrict, freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { OWNER_AUTHORITY_KINDS } = require("./work-forward-motion-record");

const DELEGATION_FRONTIER_SCHEMA = "delegation-frontier-candidate/v1";
const DELEGATION_GRILL_SCHEMA = "delegation-grill-candidate/v1";
const DELEGATION_FRONTIER_DOMAIN = "meta-harness-delegation-frontier/v1";
const LANE_DECISIONS = new Set(["CONTINUE", "HOLD", "OBSOLETE"]);
const GATE_KINDS = new Set(["CONTINUE", "FORWARD_GATE", "OWNER_DECISION"]);
const MAX_FRONTIER_LANES = 4;
const MAX_BLOCKERS = 12;

const EVIDENCE_REFS_SCHEMA = Object.freeze({
  type: "array",
  minItems: 1,
  maxItems: 20,
  items: { type: "string", minLength: 1, maxLength: 200 },
});

const FRONTIER_CANDIDATE_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "laneDecisions", "newOutcomes", "blockers", "gate"],
  properties: {
    schemaVersion: { type: "string", const: DELEGATION_FRONTIER_SCHEMA },
    laneDecisions: {
      type: "array",
      maxItems: MAX_FRONTIER_LANES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["delegationId", "laneKey", "decision", "reason", "evidenceRefs"],
        properties: {
          delegationId: { type: "string", minLength: 1, maxLength: 200 },
          laneKey: { type: "string", minLength: 1, maxLength: 64 },
          decision: { type: "string", enum: ["CONTINUE", "HOLD", "OBSOLETE"] },
          reason: { type: "string", minLength: 1, maxLength: 2000 },
          evidenceRefs: EVIDENCE_REFS_SCHEMA,
        },
      },
    },
    newOutcomes: {
      type: "array",
      maxItems: 0,
    },
    blockers: {
      type: "array",
      maxItems: MAX_BLOCKERS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "evidenceRefs"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 200 },
          statement: { type: "string", minLength: 1, maxLength: 2000 },
          evidenceRefs: EVIDENCE_REFS_SCHEMA,
        },
      },
    },
    gate: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "key", "statement", "evidenceRefs", "ownerRequest"],
      properties: {
        kind: { type: "string", enum: ["CONTINUE", "FORWARD_GATE", "OWNER_DECISION"] },
        key: { type: "string", minLength: 1, maxLength: 200 },
        statement: { type: "string", minLength: 1, maxLength: 4000 },
        evidenceRefs: EVIDENCE_REFS_SCHEMA,
        ownerRequest: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["kind", "question", "evidenceRefs"],
              properties: {
                kind: { type: "string", enum: OWNER_AUTHORITY_KINDS },
                question: { type: "string", minLength: 1, maxLength: 2000 },
                evidenceRefs: EVIDENCE_REFS_SCHEMA,
              },
            },
          ],
        },
      },
    },
  },
});

const GRILL_CANDIDATE_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "verdict", "challenge", "replacement"],
  properties: {
    schemaVersion: { type: "string", const: DELEGATION_GRILL_SCHEMA },
    verdict: { type: "string", enum: ["ACCEPT", "REPLACE"] },
    challenge: { type: "string", minLength: 1, maxLength: 3000 },
    replacement: { anyOf: [{ type: "null" }, FRONTIER_CANDIDATE_JSON_SCHEMA] },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R3_FRONTIER_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R3_FRONTIER_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function text(value, label, max = 4000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_FRONTIER_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function oneLine(value, label, max = 200) {
  const normalized = text(value, label, max);
  if (normalized.includes("\n")) fail("MH_DELEGATION_R3_FRONTIER_VALUE", `${label} must be one line`);
  return normalized;
}

function evidenceRefs(value, label, knownEvidenceRefs) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    fail("MH_DELEGATION_R3_FRONTIER_EVIDENCE", `${label} must contain 1-20 evidence refs`);
  }
  const refs = value.map((entry, index) => oneLine(entry, `${label}[${index}]`, 200));
  if (new Set(refs).size !== refs.length) fail("MH_DELEGATION_R3_FRONTIER_EVIDENCE", `${label} must not contain duplicate refs`);
  if (knownEvidenceRefs && refs.some((ref) => !knownEvidenceRefs.has(ref))) {
    fail("MH_DELEGATION_R3_FRONTIER_EVIDENCE", `${label} references evidence outside the bounded frontier input`);
  }
  return Object.freeze(refs);
}

function laneIdentity(lane) {
  return `${lane.delegationId}\u001f${lane.laneKey}`;
}

function normalizeLiveLane(lane, index) {
  exactKeys(lane, ["delegationId", "laneKey", "outcomeDigest", "objective", "acceptanceCriteria"], `liveLanes[${index}]`);
  return Object.freeze({
    delegationId: oneLine(lane.delegationId, `liveLanes[${index}].delegationId`, 200),
    laneKey: oneLine(lane.laneKey, `liveLanes[${index}].laneKey`, 64),
    outcomeDigest: oneLine(lane.outcomeDigest, `liveLanes[${index}].outcomeDigest`, 80),
    objective: text(lane.objective, `liveLanes[${index}].objective`, 4000),
    acceptanceCriteria: freezeDeep(cloneStrict(lane.acceptanceCriteria)),
  });
}

function validationContext(options = {}) {
  const liveLanes = Array.isArray(options.liveLanes) ? options.liveLanes.map(normalizeLiveLane) : [];
  if (liveLanes.length > MAX_FRONTIER_LANES) {
    fail("MH_DELEGATION_R3_FRONTIER_CAPACITY", `frontier cannot contain more than ${MAX_FRONTIER_LANES} live lanes`);
  }
  const liveIds = liveLanes.map(laneIdentity);
  if (new Set(liveIds).size !== liveIds.length) fail("MH_DELEGATION_R3_FRONTIER_VALUE", "live lane identities must be unique");
  const knownEvidenceRefs = options.knownEvidenceRefs instanceof Set
    ? options.knownEvidenceRefs
    : new Set(options.knownEvidenceRefs || []);
  return { liveLanes, liveIds: new Set(liveIds), knownEvidenceRefs };
}

function validateOwnerRequest(value, label, knownEvidenceRefs) {
  if (value === null) return null;
  exactKeys(value, ["kind", "question", "evidenceRefs"], label);
  if (!OWNER_AUTHORITY_KINDS.includes(value.kind)) {
    fail("MH_DELEGATION_R3_OWNER", `${label}.kind is not an owner-exclusive authority kind`);
  }
  return Object.freeze({
    kind: value.kind,
    question: text(value.question, `${label}.question`, 2000),
    evidenceRefs: evidenceRefs(value.evidenceRefs, `${label}.evidenceRefs`, knownEvidenceRefs),
  });
}

function validateDelegationFrontierCandidate(value, options = {}) {
  const context = validationContext(options);
  exactKeys(value, ["schemaVersion", "laneDecisions", "newOutcomes", "blockers", "gate"], "delegationFrontier");
  if (value.schemaVersion !== DELEGATION_FRONTIER_SCHEMA) {
    fail("MH_DELEGATION_R3_FRONTIER_SCHEMA", `delegationFrontier.schemaVersion must be ${DELEGATION_FRONTIER_SCHEMA}`);
  }
  if (!Array.isArray(value.laneDecisions) || value.laneDecisions.length !== context.liveLanes.length) {
    fail("MH_DELEGATION_R3_FRONTIER_LANES", "frontier must decide every live lane exactly once");
  }
  const laneDecisions = value.laneDecisions.map((entry, index) => {
    exactKeys(entry, ["delegationId", "laneKey", "decision", "reason", "evidenceRefs"], `delegationFrontier.laneDecisions[${index}]`);
    const normalized = {
      delegationId: oneLine(entry.delegationId, `delegationFrontier.laneDecisions[${index}].delegationId`, 200),
      laneKey: oneLine(entry.laneKey, `delegationFrontier.laneDecisions[${index}].laneKey`, 64),
      decision: entry.decision,
      reason: text(entry.reason, `delegationFrontier.laneDecisions[${index}].reason`, 2000),
      evidenceRefs: evidenceRefs(entry.evidenceRefs, `delegationFrontier.laneDecisions[${index}].evidenceRefs`, context.knownEvidenceRefs),
    };
    if (!LANE_DECISIONS.has(normalized.decision)) {
      fail("MH_DELEGATION_R3_FRONTIER_LANES", `frontier lane decision is invalid: ${normalized.decision}`);
    }
    if (!context.liveIds.has(laneIdentity(normalized))) {
      fail("MH_DELEGATION_R3_FRONTIER_LANES", "frontier may decide only exact currently live lane identities");
    }
    return Object.freeze(normalized);
  });
  if (new Set(laneDecisions.map(laneIdentity)).size !== laneDecisions.length) {
    fail("MH_DELEGATION_R3_FRONTIER_LANES", "frontier lane decisions must be unique");
  }

  if (!Array.isArray(value.newOutcomes) || value.newOutcomes.length !== 0) {
    fail(
      "MH_DELEGATION_R3_FRESH_WORK_AUTHORITY",
      "Round 3 owns retained delegation lifecycle only; fresh Outcomes must enter through the logical planner and durable Claim admission",
    );
  }
  const newOutcomes = Object.freeze([]);

  if (!Array.isArray(value.blockers) || value.blockers.length > MAX_BLOCKERS) {
    fail("MH_DELEGATION_R3_FRONTIER_VALUE", `frontier blockers must contain at most ${MAX_BLOCKERS} entries`);
  }
  const blockerIds = new Set();
  const blockers = value.blockers.map((entry, index) => {
    exactKeys(entry, ["id", "statement", "evidenceRefs"], `delegationFrontier.blockers[${index}]`);
    const id = oneLine(entry.id, `delegationFrontier.blockers[${index}].id`, 200);
    if (blockerIds.has(id)) fail("MH_DELEGATION_R3_FRONTIER_VALUE", `duplicate blocker id: ${id}`);
    blockerIds.add(id);
    return Object.freeze({
      id,
      statement: text(entry.statement, `delegationFrontier.blockers[${index}].statement`, 2000),
      evidenceRefs: evidenceRefs(entry.evidenceRefs, `delegationFrontier.blockers[${index}].evidenceRefs`, context.knownEvidenceRefs),
    });
  });

  exactKeys(value.gate, ["kind", "key", "statement", "evidenceRefs", "ownerRequest"], "delegationFrontier.gate");
  if (!GATE_KINDS.has(value.gate.kind)) fail("MH_DELEGATION_R3_GATE", `frontier gate kind is invalid: ${value.gate.kind}`);
  const ownerRequest = validateOwnerRequest(value.gate.ownerRequest, "delegationFrontier.gate.ownerRequest", context.knownEvidenceRefs);
  if (value.gate.kind === "OWNER_DECISION" && ownerRequest === null) {
    fail("MH_DELEGATION_R3_GATE", "OWNER_DECISION requires a typed owner-exclusive request");
  }
  if (value.gate.kind !== "OWNER_DECISION" && ownerRequest !== null) {
    fail("MH_DELEGATION_R3_GATE", "only OWNER_DECISION may carry ownerRequest");
  }
  const continuingLanes = laneDecisions.filter((entry) => entry.decision === "CONTINUE").length;
  if (value.gate.kind === "FORWARD_GATE" && continuingLanes > 0) {
    fail("MH_DELEGATION_R3_GATE", "FORWARD_GATE may surface only when lifecycle decisions leave no current autonomous positive-value lane");
  }
  if (value.gate.kind === "CONTINUE" && continuingLanes === 0) {
    fail("MH_DELEGATION_R3_GATE", "CONTINUE requires at least one continuing retained lane");
  }
  const gate = Object.freeze({
    kind: value.gate.kind,
    key: oneLine(value.gate.key, "delegationFrontier.gate.key", 200),
    statement: text(value.gate.statement, "delegationFrontier.gate.statement", 4000),
    evidenceRefs: evidenceRefs(value.gate.evidenceRefs, "delegationFrontier.gate.evidenceRefs", context.knownEvidenceRefs),
    ownerRequest,
  });

  return freezeDeep({
    schemaVersion: DELEGATION_FRONTIER_SCHEMA,
    laneDecisions,
    newOutcomes,
    blockers,
    gate,
  });
}

function semanticFrontier(value) {
  const frontier = cloneStrict(value);
  return {
    continuingLanes: frontier.laneDecisions
      .filter((entry) => entry.decision === "CONTINUE")
      .map(({ delegationId, laneKey }) => ({ delegationId, laneKey })),
    newOutcomes: [],
    blockers: frontier.blockers.map(({ id, statement }) => ({ id, statement })),
    gate: {
      kind: frontier.gate.kind,
      key: frontier.gate.key,
      statement: frontier.gate.statement,
      ownerRequest: frontier.gate.ownerRequest
        ? { kind: frontier.gate.ownerRequest.kind, question: frontier.gate.ownerRequest.question }
        : null,
    },
  };
}

function computeDecisionFrontierDigest(frontier) {
  return domainDigest(DELEGATION_FRONTIER_DOMAIN, semanticFrontier(frontier));
}

function validateDelegationGrillCandidate(value, options = {}) {
  exactKeys(value, ["schemaVersion", "verdict", "challenge", "replacement"], "delegationGrill");
  if (value.schemaVersion !== DELEGATION_GRILL_SCHEMA) {
    fail("MH_DELEGATION_R3_GRILL_SCHEMA", `delegationGrill.schemaVersion must be ${DELEGATION_GRILL_SCHEMA}`);
  }
  if (!["ACCEPT", "REPLACE"].includes(value.verdict)) fail("MH_DELEGATION_R3_GRILL_VALUE", "Grill verdict must be ACCEPT or REPLACE");
  const challenge = text(value.challenge, "delegationGrill.challenge", 3000);
  if (value.verdict === "ACCEPT" && value.replacement !== null) {
    fail("MH_DELEGATION_R3_GRILL_VALUE", "ACCEPT must not carry a replacement frontier");
  }
  if (value.verdict === "REPLACE" && value.replacement === null) {
    fail("MH_DELEGATION_R3_GRILL_VALUE", "REPLACE must carry one complete replacement frontier");
  }
  const replacement = value.replacement === null ? null : validateDelegationFrontierCandidate(value.replacement, options);
  return freezeDeep({ schemaVersion: DELEGATION_GRILL_SCHEMA, verdict: value.verdict, challenge, replacement });
}

function applyGrill(frontier, grill, options = {}) {
  const candidate = validateDelegationFrontierCandidate(frontier, options);
  const challenged = validateDelegationGrillCandidate(grill, options);
  return challenged.verdict === "REPLACE" ? challenged.replacement : candidate;
}

module.exports = {
  DELEGATION_FRONTIER_DOMAIN,
  DELEGATION_FRONTIER_SCHEMA,
  DELEGATION_GRILL_SCHEMA,
  FRONTIER_CANDIDATE_JSON_SCHEMA,
  GRILL_CANDIDATE_JSON_SCHEMA,
  MAX_FRONTIER_LANES,
  applyGrill,
  computeDecisionFrontierDigest,
  validateDelegationFrontierCandidate,
  validateDelegationGrillCandidate,
};
