"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { cloneStrict, freezeDeep, isOrdinaryPlainObject } = require("./contracts/canonical-json");
const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { objectPath, persistImmutableJson, readImmutableJson } = require("./world-authority");

const DELEGATION_HOLD_CHECKPOINT_SCHEMA = "delegation-hold-checkpoint/v1";
const DELEGATION_HOLD_CHECKPOINT_DOMAIN = "meta-harness-delegation-hold-checkpoint/v1";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!isOrdinaryPlainObject(value)) fail("MH_DELEGATION_R3_CHECKPOINT_SHAPE", `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_DELEGATION_R3_CHECKPOINT_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function oneLine(value, label, max = 200) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r") || value.includes("\n")) {
    fail("MH_DELEGATION_R3_CHECKPOINT_VALUE", `${label} must be non-empty one-line text no longer than ${max} characters`);
  }
  return value;
}

function text(value, label, max = 4000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\r")) {
    fail("MH_DELEGATION_R3_CHECKPOINT_VALUE", `${label} must be non-empty LF-only text no longer than ${max} characters`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_DELEGATION_R3_CHECKPOINT_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function checkpointBody(value) {
  const body = cloneStrict(value);
  delete body.checkpointDigest;
  return body;
}

function computeDelegationHoldCheckpointDigest(value) {
  return domainDigest(DELEGATION_HOLD_CHECKPOINT_DOMAIN, checkpointBody(value));
}

function validateDelegationHoldCheckpoint(value) {
  exactKeys(value, [
    "schemaVersion",
    "delegationId",
    "contractDigest",
    "contextDigest",
    "laneKey",
    "outcomeDigest",
    "taskId",
    "workspaceId",
    "laneBriefDigest",
    "bootPromptDigest",
    "worldHeadDigest",
    "gate",
    "reason",
    "evidenceRefs",
    "checkpointDigest",
  ], "delegationHoldCheckpoint");
  if (value.schemaVersion !== DELEGATION_HOLD_CHECKPOINT_SCHEMA) {
    fail("MH_DELEGATION_R3_CHECKPOINT_SCHEMA", `delegationHoldCheckpoint.schemaVersion must be ${DELEGATION_HOLD_CHECKPOINT_SCHEMA}`);
  }
  for (const field of ["delegationId", "laneKey", "taskId", "workspaceId"]) {
    oneLine(value[field], `delegationHoldCheckpoint.${field}`, field === "laneKey" ? 64 : 200);
  }
  for (const field of [
    "contractDigest",
    "contextDigest",
    "outcomeDigest",
    "laneBriefDigest",
    "bootPromptDigest",
    "worldHeadDigest",
    "checkpointDigest",
  ]) requireDigest(value[field], `delegationHoldCheckpoint.${field}`);
  text(value.gate, "delegationHoldCheckpoint.gate", 8000);
  text(value.reason, "delegationHoldCheckpoint.reason", 2000);
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 20) {
    fail("MH_DELEGATION_R3_CHECKPOINT_VALUE", "delegationHoldCheckpoint.evidenceRefs must contain 1-20 refs");
  }
  const refs = value.evidenceRefs.map((entry, index) => oneLine(entry, `delegationHoldCheckpoint.evidenceRefs[${index}]`, 200));
  if (new Set(refs).size !== refs.length) fail("MH_DELEGATION_R3_CHECKPOINT_VALUE", "delegationHoldCheckpoint.evidenceRefs must be unique");
  if (value.checkpointDigest !== computeDelegationHoldCheckpointDigest(value)) {
    fail("MH_DELEGATION_R3_CHECKPOINT_DIGEST", "delegationHoldCheckpoint.checkpointDigest does not match its body");
  }
  return freezeDeep(cloneStrict({ ...value, evidenceRefs: refs }));
}

function createDelegationHoldCheckpoint({ contract, acceptanceLane, worldHeadDigest, gate, reason, evidenceRefs }) {
  if (!contract || !acceptanceLane) fail("MH_DELEGATION_R3_CHECKPOINT_BINDING", "HOLD checkpoint requires the sealed contract and exact accepted lane identity");
  const contractLane = contract.lanes?.find((entry) => entry.laneKey === acceptanceLane.laneKey);
  if (!contractLane || contractLane.outcomeDigest !== acceptanceLane.outcomeDigest) {
    fail("MH_DELEGATION_R3_CHECKPOINT_BINDING", "HOLD checkpoint lane does not belong to the sealed delegation contract");
  }
  const body = {
    schemaVersion: DELEGATION_HOLD_CHECKPOINT_SCHEMA,
    delegationId: acceptanceLane.delegationId,
    contractDigest: contract.contractDigest,
    contextDigest: contract.devspaceContextDigest,
    laneKey: acceptanceLane.laneKey,
    outcomeDigest: acceptanceLane.outcomeDigest,
    taskId: acceptanceLane.taskId,
    workspaceId: acceptanceLane.workspaceId,
    laneBriefDigest: acceptanceLane.laneBriefDigest,
    bootPromptDigest: acceptanceLane.bootPromptDigest,
    worldHeadDigest,
    gate,
    reason,
    evidenceRefs: [...evidenceRefs],
  };
  return validateDelegationHoldCheckpoint({ ...body, checkpointDigest: computeDelegationHoldCheckpointDigest(body) });
}

function persistDelegationHoldCheckpoint(repositoryPath, value) {
  const checkpoint = validateDelegationHoldCheckpoint(value);
  persistImmutableJson(repositoryPath, "delegation-checkpoints", checkpoint.checkpointDigest, checkpoint, "MH_DELEGATION_R3_CHECKPOINT_WRITE");
  return checkpoint;
}

function listDelegationHoldCheckpoints(repositoryPath) {
  const directory = path.dirname(objectPath(repositoryPath, "delegation-checkpoints", `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return Object.freeze([]);
  return Object.freeze(fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => readDelegationHoldCheckpoint(repositoryPath, `sha256:${name.slice(0, 64)}`))
    .sort((left, right) => left.checkpointDigest.localeCompare(right.checkpointDigest)));
}

function readDelegationHoldCheckpoint(repositoryPath, checkpointDigest) {
  requireDigest(checkpointDigest, "checkpointDigest");
  const checkpoint = validateDelegationHoldCheckpoint(readImmutableJson(repositoryPath, "delegation-checkpoints", checkpointDigest));
  if (checkpoint.checkpointDigest !== checkpointDigest) {
    fail("MH_DELEGATION_R3_CHECKPOINT_DIGEST", "delegation checkpoint path identity does not match its body");
  }
  return checkpoint;
}

module.exports = {
  DELEGATION_HOLD_CHECKPOINT_DOMAIN,
  DELEGATION_HOLD_CHECKPOINT_SCHEMA,
  computeDelegationHoldCheckpointDigest,
  createDelegationHoldCheckpoint,
  listDelegationHoldCheckpoints,
  persistDelegationHoldCheckpoint,
  readDelegationHoldCheckpoint,
  validateDelegationHoldCheckpoint,
};
