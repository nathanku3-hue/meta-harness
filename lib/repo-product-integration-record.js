"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { readImmutableJson } = require("./world-authority");

const PRODUCT_INTEGRATION_SCHEMA = "product-integration/v1";
const PRODUCT_INTEGRATION_DOMAIN = "meta-harness-product-integration/v1";
const PRODUCT_HEAD_REF = "refs/meta-harness/product-head";
const OID_RE = /^[a-f0-9]{40,64}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_PRODUCT_INTEGRATION_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_PRODUCT_INTEGRATION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_PRODUCT_INTEGRATION_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function requireOid(value, label) {
  if (!OID_RE.test(String(value || ""))) fail("MH_PRODUCT_INTEGRATION_GIT", `${label} must be a Git object id`);
  return value;
}

function retainedObligation(value) {
  exactKeys(value, ["sessionDigest", "claimDigest", "closureDigest", "workResultDigest"], "retainedObligation");
  for (const field of ["sessionDigest", "claimDigest", "closureDigest", "workResultDigest"]) {
    requireDigest(value[field], `retainedObligation.${field}`);
  }
  return Object.freeze({ ...value });
}

function integrationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.integrationDigest;
  return body;
}

function computeProductIntegrationDigest(value) {
  return domainDigest(PRODUCT_INTEGRATION_DOMAIN, integrationBody(value));
}

function validateProductIntegration(value) {
  exactKeys(value, [
    "schemaVersion", "predecessorProductCommit", "bankCommit", "sessionDigest", "outcomeDigest",
    "claimDigest", "closureDigest", "workResultDigest", "candidateSealDigest", "integratedTreeOid",
    "integratedCommit", "retainedObligations", "retainedProofDigests", "validationDigest",
    "productProofDigests", "integratedAt", "integrationDigest",
  ], "productIntegration");
  if (value.schemaVersion !== PRODUCT_INTEGRATION_SCHEMA) {
    fail("MH_PRODUCT_INTEGRATION_SCHEMA", `productIntegration.schemaVersion must be ${PRODUCT_INTEGRATION_SCHEMA}`);
  }
  for (const field of ["predecessorProductCommit", "bankCommit", "integratedTreeOid", "integratedCommit"]) {
    requireOid(value[field], `productIntegration.${field}`);
  }
  for (const field of ["sessionDigest", "outcomeDigest", "claimDigest", "closureDigest", "workResultDigest", "candidateSealDigest", "validationDigest", "integrationDigest"]) {
    requireDigest(value[field], `productIntegration.${field}`);
  }
  if (!Array.isArray(value.retainedObligations) || value.retainedObligations.length === 0) {
    fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "productIntegration.retainedObligations must be non-empty");
  }
  const obligations = value.retainedObligations.map(retainedObligation);
  if (new Set(obligations.map((entry) => entry.sessionDigest)).size !== obligations.length) {
    fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "retained obligations must not repeat a session");
  }
  for (const [field, values] of [
    ["retainedProofDigests", value.retainedProofDigests],
    ["productProofDigests", value.productProofDigests],
  ]) {
    if (!Array.isArray(values) || values.length !== obligations.length) {
      fail("MH_PRODUCT_INTEGRATION_OBLIGATION", `${field} must bind every retained obligation`);
    }
    values.forEach((digest, index) => requireDigest(digest, `productIntegration.${field}[${index}]`));
  }
  if (!Number.isFinite(Date.parse(value.integratedAt))) fail("MH_PRODUCT_INTEGRATION_TIME", "integratedAt must be an ISO timestamp");
  if (value.integrationDigest !== computeProductIntegrationDigest(value)) {
    fail("MH_PRODUCT_INTEGRATION_DIGEST", "productIntegration.integrationDigest does not match its body");
  }
  return Object.freeze({ ...JSON.parse(JSON.stringify(value)), retainedObligations: Object.freeze(obligations) });
}

function readProductIntegration(repositoryPath, integrationDigest) {
  requireDigest(integrationDigest, "integrationDigest");
  const value = validateProductIntegration(readImmutableJson(repositoryPath, "product-integrations", integrationDigest));
  if (value.integrationDigest !== integrationDigest) {
    fail("MH_PRODUCT_INTEGRATION_DIGEST", "product integration path identity does not match its body");
  }
  return value;
}

function latestIntegrationReceiptForHead(repositoryPath, head) {
  let cursor = head;
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.headDigest)) fail("MH_PRODUCT_INTEGRATION_LINEAGE", "WorldHead lineage contains a cycle");
    seen.add(cursor.headDigest);
    const transition = readImmutableJson(repositoryPath, "transitions", cursor.lastTransitionDigest);
    if (transition.schemaVersion === "world-transition/v2") {
      if (transition.cause?.type === "ATTEMPT_LEARNING" && isDigest(transition.cause.integrationDigest)) {
        return readProductIntegration(repositoryPath, transition.cause.integrationDigest);
      }
      if (transition.cause?.type === "PRODUCT_HEAD_MIGRATION" && transition.cause.integrationDigests.length > 0) {
        return readProductIntegration(repositoryPath, transition.cause.integrationDigests.at(-1));
      }
    }
    if (!transition.predecessorHeadDigest) return null;
    cursor = readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest);
  }
  return null;
}

function retainedObligationsForHead(repositoryPath, head) {
  const receipt = latestIntegrationReceiptForHead(repositoryPath, head);
  return receipt ? receipt.retainedObligations : [];
}

module.exports = {
  OID_RE,
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  computeProductIntegrationDigest,
  latestIntegrationReceiptForHead,
  readProductIntegration,
  requireDigest,
  requireOid,
  retainedObligation,
  retainedObligationsForHead,
  validateProductIntegration,
};
