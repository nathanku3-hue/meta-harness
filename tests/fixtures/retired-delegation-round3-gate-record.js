"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { cloneStrict, freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { OWNER_AUTHORITY_KINDS } = require("./work-forward-motion-record");
const { objectPath, persistImmutableJson, readImmutableJson } = require("./world-authority");
const { readCurrentWorldState, validateWorldHead, validateWorldTransition } = require("./world-transition");

const SURFACED_DELEGATION_FRONTIER_SCHEMA = "delegation-surfaced-frontier/v1";
const SURFACED_DELEGATION_FRONTIER_DOMAIN = "meta-harness-delegation-surfaced-frontier/v1";
const SURFACED_GATE_KINDS = new Set(["FORWARD_GATE", "OWNER_DECISION"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R3_GATE_RECORD_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R3_GATE_RECORD_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label, max = 4000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function oneLine(value, label, max = 200) {
  const result = nonEmpty(value, label, max);
  if (result.includes("\n")) fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", `${label} must be one line`);
  return result;
}

function refs(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", `${label} must contain 1-20 refs`);
  }
  const normalized = value.map((entry, index) => oneLine(entry, `${label}[${index}]`, 200));
  if (new Set(normalized).size !== normalized.length) fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", `${label} must be unique`);
  return Object.freeze(normalized);
}

function validateOwnerRequest(value) {
  if (value === null) return null;
  exactKeys(value, ["kind", "question", "evidenceRefs"], "surfacedFrontier.gate.ownerRequest");
  if (!OWNER_AUTHORITY_KINDS.includes(value.kind)) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", "surfaced owner request kind is not owner-exclusive");
  }
  return Object.freeze({
    kind: value.kind,
    question: nonEmpty(value.question, "surfacedFrontier.gate.ownerRequest.question", 2000),
    evidenceRefs: refs(value.evidenceRefs, "surfacedFrontier.gate.ownerRequest.evidenceRefs"),
  });
}

function validateGate(value) {
  exactKeys(value, ["kind", "key", "statement", "evidenceRefs", "ownerRequest"], "surfacedFrontier.gate");
  if (!SURFACED_GATE_KINDS.has(value.kind)) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", "only a forward or owner gate may be retained as surfaced evidence");
  }
  const ownerRequest = validateOwnerRequest(value.ownerRequest);
  if (value.kind === "OWNER_DECISION" && ownerRequest === null) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", "OWNER_DECISION surfaced evidence requires its owner request");
  }
  if (value.kind === "FORWARD_GATE" && ownerRequest !== null) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", "FORWARD_GATE surfaced evidence may not carry an owner request");
  }
  return Object.freeze({
    kind: value.kind,
    key: oneLine(value.key, "surfacedFrontier.gate.key", 200),
    statement: nonEmpty(value.statement, "surfacedFrontier.gate.statement", 4000),
    evidenceRefs: refs(value.evidenceRefs, "surfacedFrontier.gate.evidenceRefs"),
    ownerRequest,
  });
}

function body(value) {
  const result = cloneStrict(value);
  delete result.recordDigest;
  return result;
}

function computeSurfacedDelegationFrontierDigest(value) {
  return domainDigest(SURFACED_DELEGATION_FRONTIER_DOMAIN, body(value));
}

function validateSurfacedDelegationFrontier(value) {
  exactKeys(value, ["schemaVersion", "worldHeadDigest", "frontierDigest", "gate", "surfacedAt", "recordDigest"], "surfacedFrontier");
  if (value.schemaVersion !== SURFACED_DELEGATION_FRONTIER_SCHEMA) {
    fail("MH_DELEGATION_R3_GATE_RECORD_SCHEMA", `surfacedFrontier.schemaVersion must be ${SURFACED_DELEGATION_FRONTIER_SCHEMA}`);
  }
  if (!isDigest(value.worldHeadDigest) || !isDigest(value.frontierDigest) || !isDigest(value.recordDigest)) {
    fail("MH_DELEGATION_R3_GATE_RECORD_DIGEST", "surfaced frontier identities must be sha256 digests");
  }
  const gate = validateGate(value.gate);
  if (typeof value.surfacedAt !== "string" || !Number.isFinite(Date.parse(value.surfacedAt))) {
    fail("MH_DELEGATION_R3_GATE_RECORD_VALUE", "surfacedFrontier.surfacedAt must be an ISO timestamp");
  }
  if (value.recordDigest !== computeSurfacedDelegationFrontierDigest(value)) {
    fail("MH_DELEGATION_R3_GATE_RECORD_DIGEST", "surfacedFrontier.recordDigest does not match its body");
  }
  return freezeDeep({ ...cloneStrict(value), gate });
}

function createSurfacedDelegationFrontier({ worldHeadDigest, frontierDigest, gate, now = new Date() }) {
  const draft = {
    schemaVersion: SURFACED_DELEGATION_FRONTIER_SCHEMA,
    worldHeadDigest,
    frontierDigest,
    gate: cloneStrict(gate),
    surfacedAt: now.toISOString(),
  };
  return validateSurfacedDelegationFrontier({
    ...draft,
    recordDigest: computeSurfacedDelegationFrontierDigest(draft),
  });
}

function persistSurfacedDelegationFrontier(repositoryPath, value) {
  const record = validateSurfacedDelegationFrontier(value);
  readImmutableJson(repositoryPath, "heads", record.worldHeadDigest);
  const current = readCurrentWorldState(repositoryPath);
  if (current.head.headDigest !== record.worldHeadDigest) {
    fail("MH_DELEGATION_R3_GATE_STALE", "owner-visible delegation gate became stale before durable surfacing evidence was retained", {
      expected: record.worldHeadDigest,
      actual: current.head.headDigest,
    });
  }
  persistImmutableJson(repositoryPath, "delegation-frontiers", record.recordDigest, record, "MH_DELEGATION_R3_GATE_RECORD_WRITE");
  return record;
}

function readSurfacedDelegationFrontier(repositoryPath, recordDigest) {
  const value = validateSurfacedDelegationFrontier(readImmutableJson(repositoryPath, "delegation-frontiers", recordDigest));
  if (value.recordDigest !== recordDigest) fail("MH_DELEGATION_R3_GATE_RECORD_DIGEST", "surfaced-frontier path identity does not match its body");
  return value;
}

function recordDigests(repositoryPath) {
  const directory = path.dirname(objectPath(repositoryPath, "delegation-frontiers", `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `sha256:${name.slice(0, 64)}`);
}

function currentLineage(repositoryPath, current) {
  const digests = new Set();
  let head = current.head;
  while (head) {
    digests.add(head.headDigest);
    const transition = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (transition.predecessorHeadDigest === null) break;
    head = validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
  }
  return digests;
}

function latestSurfacedDelegationFrontier(repositoryPath, current = null) {
  const state = current || readCurrentWorldState(repositoryPath);
  const lineage = currentLineage(repositoryPath, state);
  const records = recordDigests(repositoryPath)
    .map((digest) => readSurfacedDelegationFrontier(repositoryPath, digest))
    .filter((record) => lineage.has(record.worldHeadDigest))
    .map((record) => ({
      record,
      generation: readImmutableJson(repositoryPath, "heads", record.worldHeadDigest).generation,
    }))
    .sort((left, right) => right.generation - left.generation
      || Date.parse(right.record.surfacedAt) - Date.parse(left.record.surfacedAt)
      || right.record.recordDigest.localeCompare(left.record.recordDigest));
  return records[0]?.record || null;
}

module.exports = {
  SURFACED_DELEGATION_FRONTIER_DOMAIN,
  SURFACED_DELEGATION_FRONTIER_SCHEMA,
  computeSurfacedDelegationFrontierDigest,
  createSurfacedDelegationFrontier,
  latestSurfacedDelegationFrontier,
  persistSurfacedDelegationFrontier,
  readSurfacedDelegationFrontier,
  validateSurfacedDelegationFrontier,
};
