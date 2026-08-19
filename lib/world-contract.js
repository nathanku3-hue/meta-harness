"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const LEGACY_WORLD_TRANSITION_SCHEMA = "world-transition/v1";
const LEGACY_WORLD_TRANSITION_DOMAIN = "meta-harness-world-transition/v1";
const WORLD_TRANSITION_SCHEMA = "world-transition/v2";
const WORLD_TRANSITION_DOMAIN = "meta-harness-world-transition/v2";
const LEGACY_WORLD_HEAD_SCHEMA = "world-head/v1";
const LEGACY_WORLD_HEAD_DOMAIN = "meta-harness-world-head/v1";
const WORLD_HEAD_SCHEMA = "world-head/v2";
const WORLD_HEAD_DOMAIN = "meta-harness-world-head/v2";
const WORLD_PROJECTION_DOMAIN = "meta-harness-world-projection/v1";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_WORLD_TRANSITION_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORLD_TRANSITION_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORLD_TRANSITION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function computeWorldProjectionDigest(worldDigest, attestationDigest) {
  requireDigest(worldDigest, "worldDigest");
  requireDigest(attestationDigest, "attestationDigest");
  return domainDigest(WORLD_PROJECTION_DOMAIN, { worldDigest, attestationDigest });
}

function transitionBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.transitionDigest;
  return body;
}

function transitionDomain(value) {
  return value?.schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA
    ? LEGACY_WORLD_TRANSITION_DOMAIN
    : WORLD_TRANSITION_DOMAIN;
}

function computeWorldTransitionDigest(value) {
  return domainDigest(transitionDomain(value), transitionBody(value));
}

function validateCause(cause, schemaVersion = WORLD_TRANSITION_SCHEMA) {
  if (!cause || typeof cause !== "object" || Array.isArray(cause)) {
    fail("MH_WORLD_TRANSITION_CAUSE", "worldTransition.cause must be an object");
  }
  if (cause.type === "REALITY_REFRESH") {
    exactKeys(cause, ["type", "projectionDigest"], "worldTransition.cause");
    requireDigest(cause.projectionDigest, "worldTransition.cause.projectionDigest");
    return;
  }
  if (cause.type === "ATTEMPT_LEARNING") {
    const keys = schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA
      ? ["type", "executionClosureDigest", "interpretationDigest"]
      : ["type", "executionClosureDigest", "interpretationDigest", "integrationDigest"];
    exactKeys(cause, keys, "worldTransition.cause");
    requireDigest(cause.executionClosureDigest, "worldTransition.cause.executionClosureDigest");
    requireDigest(cause.interpretationDigest, "worldTransition.cause.interpretationDigest");
    if (schemaVersion !== LEGACY_WORLD_TRANSITION_SCHEMA && cause.integrationDigest !== null) {
      requireDigest(cause.integrationDigest, "worldTransition.cause.integrationDigest");
    }
    return;
  }
  if (cause.type === "ATTEMPT_ABORTED") {
    exactKeys(cause, ["type", "executionClosureDigest"], "worldTransition.cause");
    requireDigest(cause.executionClosureDigest, "worldTransition.cause.executionClosureDigest");
    return;
  }
  if (schemaVersion !== LEGACY_WORLD_TRANSITION_SCHEMA && cause.type === "PRODUCT_HEAD_MIGRATION") {
    exactKeys(cause, ["type", "seedProductCommit", "integrationDigests"], "worldTransition.cause");
    if (!/^[a-f0-9]{40,64}$/u.test(String(cause.seedProductCommit || ""))) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "PRODUCT_HEAD_MIGRATION seedProductCommit must be a Git commit id");
    }
    if (!Array.isArray(cause.integrationDigests)
        || new Set(cause.integrationDigests).size !== cause.integrationDigests.length) {
      fail("MH_WORLD_TRANSITION_PRODUCT", "PRODUCT_HEAD_MIGRATION integrationDigests must be a unique ordered array");
    }
    cause.integrationDigests.forEach((digest, index) => requireDigest(digest, `worldTransition.cause.integrationDigests[${index}]`));
    return;
  }
  fail("MH_WORLD_TRANSITION_CAUSE", "worldTransition.cause.type is invalid for this transition schema");
}

function validateWorldTransition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORLD_TRANSITION_SHAPE", "worldTransition must be an object");
  }
  const legacy = value.schemaVersion === LEGACY_WORLD_TRANSITION_SCHEMA;
  if (!legacy && value.schemaVersion !== WORLD_TRANSITION_SCHEMA) {
    fail("MH_WORLD_TRANSITION_SCHEMA", `worldTransition.schemaVersion must be ${WORLD_TRANSITION_SCHEMA} for active authority or ${LEGACY_WORLD_TRANSITION_SCHEMA} for retained history`);
  }
  exactKeys(value, legacy
    ? ["schemaVersion", "predecessorHeadDigest", "cause", "successorWorldDigest", "successorAttestationDigest", "transitionDigest"]
    : ["schemaVersion", "predecessorHeadDigest", "cause", "successorWorldDigest", "successorAttestationDigest", "successorProductCommit", "transitionDigest"], "worldTransition");
  if (value.predecessorHeadDigest !== null) requireDigest(value.predecessorHeadDigest, "worldTransition.predecessorHeadDigest");
  validateCause(value.cause, value.schemaVersion);
  requireDigest(value.successorWorldDigest, "worldTransition.successorWorldDigest");
  requireDigest(value.successorAttestationDigest, "worldTransition.successorAttestationDigest");
  if (!legacy && !/^[a-f0-9]{40,64}$/u.test(String(value.successorProductCommit || ""))) {
    fail("MH_WORLD_TRANSITION_PRODUCT", "worldTransition.successorProductCommit must be a Git commit id");
  }
  requireDigest(value.transitionDigest, "worldTransition.transitionDigest");
  if (value.transitionDigest !== computeWorldTransitionDigest(value)) {
    fail("MH_WORLD_TRANSITION_DIGEST", "worldTransition.transitionDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function headBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.headDigest;
  return body;
}

function headDomain(value) {
  return value?.schemaVersion === LEGACY_WORLD_HEAD_SCHEMA
    ? LEGACY_WORLD_HEAD_DOMAIN
    : WORLD_HEAD_DOMAIN;
}

function computeWorldHeadDigest(value) {
  return domainDigest(headDomain(value), headBody(value));
}

function validateWorldHead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORLD_HEAD_SHAPE", "worldHead must be an object");
  }
  const legacy = value.schemaVersion === LEGACY_WORLD_HEAD_SCHEMA;
  if (!legacy && value.schemaVersion !== WORLD_HEAD_SCHEMA) {
    fail("MH_WORLD_HEAD_SCHEMA", `worldHead.schemaVersion must be ${WORLD_HEAD_SCHEMA} or retained ${LEGACY_WORLD_HEAD_SCHEMA}`);
  }
  exactKeys(value, legacy
    ? ["schemaVersion", "generation", "worldDigest", "attestationDigest", "lastTransitionDigest", "headDigest"]
    : ["schemaVersion", "generation", "worldDigest", "attestationDigest", "productCommit", "lastTransitionDigest", "headDigest"], "worldHead");
  if (!Number.isInteger(value.generation) || value.generation < 1) fail("MH_WORLD_HEAD_VALUE", "worldHead.generation must be a positive integer");
  requireDigest(value.worldDigest, "worldHead.worldDigest");
  requireDigest(value.attestationDigest, "worldHead.attestationDigest");
  if (!legacy && !/^[a-f0-9]{40,64}$/u.test(String(value.productCommit || ""))) {
    fail("MH_WORLD_HEAD_PRODUCT", "worldHead.productCommit must be a Git commit id");
  }
  requireDigest(value.lastTransitionDigest, "worldHead.lastTransitionDigest");
  requireDigest(value.headDigest, "worldHead.headDigest");
  if (value.headDigest !== computeWorldHeadDigest(value)) fail("MH_WORLD_HEAD_DIGEST", "worldHead.headDigest does not match its body");
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

module.exports = {
  LEGACY_WORLD_HEAD_SCHEMA,
  LEGACY_WORLD_TRANSITION_SCHEMA,
  WORLD_HEAD_DOMAIN,
  WORLD_HEAD_SCHEMA,
  WORLD_PROJECTION_DOMAIN,
  WORLD_TRANSITION_DOMAIN,
  WORLD_TRANSITION_SCHEMA,
  computeWorldHeadDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  validateWorldHead,
  validateWorldTransition,
};
