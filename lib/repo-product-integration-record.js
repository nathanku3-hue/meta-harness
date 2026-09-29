"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { readStructuralSaw } = require("./repo-structural-saw");
const { PRODUCT_HEAD_REF } = require("./product-head");
const { protocolRoot, readImmutableJson } = require("./protocol-store");

const PRODUCT_INTEGRATION_SCHEMA = "product-integration/v5";
const PRODUCT_INTEGRATION_DOMAIN = "meta-harness-product-integration/v5";
const PRODUCT_INTEGRATION_VALIDATION_DOMAIN = "meta-harness-product-integration-validation/v5";
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

function integrationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.integrationDigest;
  return body;
}

function computeProductIntegrationDigest(value) {
  if (value?.schemaVersion !== PRODUCT_INTEGRATION_SCHEMA) {
    fail("MH_PRODUCT_INTEGRATION_SCHEMA", `productIntegration.schemaVersion must be ${PRODUCT_INTEGRATION_SCHEMA}`);
  }
  return domainDigest(PRODUCT_INTEGRATION_DOMAIN, integrationBody(value));
}

function validateProductIntegration(value) {
  exactKeys(value, [
    "schemaVersion",
    "predecessorProductCommit",
    "bankCommit",
    "sessionDigest",
    "outcomeDigest",
    "closureDigest",
    "workResultDigest",
    "candidateSealDigest",
    "integratedTreeOid",
    "integratedCommit",
    "structuralSawDigest",
    "validationDigest",
    "integratedAt",
    "integrationDigest",
  ], "productIntegration");
  if (value.schemaVersion !== PRODUCT_INTEGRATION_SCHEMA) {
    fail("MH_PRODUCT_INTEGRATION_SCHEMA", `productIntegration.schemaVersion must be ${PRODUCT_INTEGRATION_SCHEMA}`);
  }
  for (const field of ["predecessorProductCommit", "bankCommit", "integratedTreeOid", "integratedCommit"]) {
    requireOid(value[field], `productIntegration.${field}`);
  }
  for (const field of [
    "sessionDigest",
    "outcomeDigest",
    "closureDigest",
    "workResultDigest",
    "candidateSealDigest",
    "structuralSawDigest",
    "validationDigest",
    "integrationDigest",
  ]) {
    requireDigest(value[field], `productIntegration.${field}`);
  }
  if (!Number.isFinite(Date.parse(value.integratedAt))) {
    fail("MH_PRODUCT_INTEGRATION_TIME", "integratedAt must be an ISO timestamp");
  }
  if (value.integrationDigest !== computeProductIntegrationDigest(value)) {
    fail("MH_PRODUCT_INTEGRATION_DIGEST", "productIntegration.integrationDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function validateStructuralSawBinding(repositoryPath, receipt) {
  const saw = readStructuralSaw(repositoryPath, receipt.structuralSawDigest);
  if (!saw.passed
      || saw.predecessorProductCommit !== receipt.predecessorProductCommit
      || saw.candidateTreeOid !== receipt.integratedTreeOid) {
    fail("MH_PRODUCT_INTEGRATION_SAW", "product integration structural SAW binding does not match the accepted product tree");
  }
  return saw;
}

function readProductIntegration(repositoryPath, integrationDigest) {
  requireDigest(integrationDigest, "integrationDigest");
  const value = validateProductIntegration(readImmutableJson(repositoryPath, "product-integrations", integrationDigest));
  if (value.integrationDigest !== integrationDigest) {
    fail("MH_PRODUCT_INTEGRATION_DIGEST", "product integration path identity does not match its body");
  }
  validateStructuralSawBinding(repositoryPath, value);
  return value;
}

function productIntegrationDirectory(repositoryPath) {
  return path.join(protocolRoot(repositoryPath), "objects", "product-integrations");
}

function currentReceiptDigests(repositoryPath) {
  const directory = productIntegrationDirectory(repositoryPath);
  if (!fs.existsSync(directory)) return [];
  const digests = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    let header;
    try {
      header = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_) {
      continue;
    }
    if (header?.schemaVersion !== PRODUCT_INTEGRATION_SCHEMA) continue;
    digests.push(`sha256:${entry.name.slice(0, 64)}`);
  }
  return digests;
}

function allProductIntegrationReceipts(repositoryPath) {
  return currentReceiptDigests(repositoryPath).map((digest) => readProductIntegration(repositoryPath, digest));
}

function receiptIdentity(receipt) {
  const value = { ...receipt };
  delete value.integratedAt;
  delete value.integrationDigest;
  return JSON.stringify(value);
}

function integrationReceiptsForProductCommit(repositoryPath, productCommit) {
  requireOid(productCommit, "productCommit");
  const receipts = allProductIntegrationReceipts(repositoryPath)
    .filter((receipt) => receipt.integratedCommit === productCommit);
  if (receipts.length > 1) {
    const identity = receiptIdentity(receipts[0]);
    if (receipts.some((receipt) => receiptIdentity(receipt) !== identity)) {
      fail("MH_PRODUCT_INTEGRATION_LINEAGE", "one product commit resolves to conflicting integration facts", {
        productCommit,
        integrationDigests: receipts.map((receipt) => receipt.integrationDigest),
      });
    }
  }
  return receipts.sort((left, right) => Date.parse(left.integratedAt) - Date.parse(right.integratedAt));
}

function latestIntegrationReceiptForProductCommit(repositoryPath, productCommit) {
  const receipts = integrationReceiptsForProductCommit(repositoryPath, productCommit);
  return receipts.length > 0 ? receipts.at(-1) : null;
}

module.exports = {
  OID_RE,
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  PRODUCT_INTEGRATION_VALIDATION_DOMAIN,
  allProductIntegrationReceipts,
  computeProductIntegrationDigest,
  integrationReceiptsForProductCommit,
  latestIntegrationReceiptForProductCommit,
  readProductIntegration,
  requireDigest,
  requireOid,
  validateProductIntegration,
  validateStructuralSawBinding,
};
