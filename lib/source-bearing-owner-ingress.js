"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  MAX_EXPERT_SOURCE_COUNT,
  validateExpertSourceDescriptor,
} = require("./expert-source-ingress");
const {
  protocolRoot,
  withWorldAuthorityLock,
  writeCreateOnlyJson,
} = require("./world-authority");

const SOURCE_BEARING_OWNER_INGRESS_SCHEMA = "owner-goal-ingress/v2";
const SOURCE_BEARING_OWNER_INGRESS_DOMAIN = "meta-harness-owner-goal-ingress/v2";
const MAX_OWNER_INGRESS_TEXT_BYTES = 128 * 1024;
const RECEIPT_DIRECTORY = "owner-ingresses";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function rawTextDigest(rawText) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(rawText, "utf8")).digest("hex")}`;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > MAX_EXPERT_SOURCE_COUNT) {
    fail("MH_OWNER_INGRESS_SOURCES", `source-bearing owner ingress requires 1-${MAX_EXPERT_SOURCE_COUNT} expert sources`);
  }
  return Object.freeze(sources.map((source, index) => (
    validateExpertSourceDescriptor(source, `ownerIngress.sources[${index}]`)
  )));
}

function ingressIdentity(rawText, sources) {
  if (typeof rawText !== "string" || rawText.length === 0 || rawText.trim() === "") {
    fail("MH_OWNER_INGRESS_TEXT", "source-bearing owner ingress rawText must be non-empty");
  }
  if (Buffer.byteLength(rawText, "utf8") > MAX_OWNER_INGRESS_TEXT_BYTES) {
    fail("MH_OWNER_INGRESS_TEXT", `source-bearing owner ingress rawText exceeds ${MAX_OWNER_INGRESS_TEXT_BYTES} UTF-8 bytes`);
  }
  const normalizedSources = normalizeSources(sources);
  const textDigest = rawTextDigest(rawText);
  const ingressDigest = domainDigest(SOURCE_BEARING_OWNER_INGRESS_DOMAIN, {
    textDigest,
    sources: normalizedSources,
  });
  return Object.freeze({ rawText, textDigest, sources: normalizedSources, ingressDigest });
}

function receiptPath(repositoryPath, ingressDigest, { create = true } = {}) {
  if (!isDigest(ingressDigest)) fail("MH_OWNER_INGRESS_DIGEST", "ingressDigest must be sha256:<hex>");
  const directory = path.join(protocolRoot(repositoryPath, { create }), RECEIPT_DIRECTORY);
  if (create) fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${ingressDigest.slice("sha256:".length)}.json`);
}

function validateSourceBearingOwnerIngress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_OWNER_INGRESS_SHAPE", "source-bearing owner ingress must be an object");
  }
  const actual = Object.keys(value).sort();
  const expected = ["schemaVersion", "rawText", "textDigest", "sources", "ingressDigest", "receivedAt"].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || value.schemaVersion !== SOURCE_BEARING_OWNER_INGRESS_SCHEMA) {
    fail("MH_OWNER_INGRESS_SHAPE", "source-bearing owner ingress has missing or unexpected fields");
  }
  const identity = ingressIdentity(value.rawText, value.sources);
  if (value.textDigest !== identity.textDigest || value.ingressDigest !== identity.ingressDigest) {
    fail("MH_OWNER_INGRESS_DIGEST", "source-bearing owner ingress identity does not match exact text/source content");
  }
  if (typeof value.receivedAt !== "string" || !Number.isFinite(Date.parse(value.receivedAt))) {
    fail("MH_OWNER_INGRESS_TIME", "source-bearing owner ingress receivedAt must be an ISO timestamp");
  }
  return Object.freeze({
    schemaVersion: SOURCE_BEARING_OWNER_INGRESS_SCHEMA,
    rawText: identity.rawText,
    textDigest: identity.textDigest,
    sources: identity.sources,
    ingressDigest: identity.ingressDigest,
    receivedAt: value.receivedAt,
  });
}

function readSourceBearingOwnerIngress(repositoryPath, ingressDigest, { optional = false } = {}) {
  const filePath = receiptPath(repositoryPath, ingressDigest, { create: false });
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_OWNER_INGRESS_READ", `source-bearing owner ingress is unreadable: ${error.message}`, { ingressDigest });
  }
  const ingress = validateSourceBearingOwnerIngress(parsed);
  if (ingress.ingressDigest !== ingressDigest) {
    fail("MH_OWNER_INGRESS_DIGEST", "source-bearing owner ingress filename/content identity mismatch", { ingressDigest });
  }
  return ingress;
}

function persistSourceBearingOwnerIngress(repositoryPath, rawText, sources, { now = new Date() } = {}) {
  const identity = ingressIdentity(rawText, sources);
  return withWorldAuthorityLock(repositoryPath, () => {
    const existing = readSourceBearingOwnerIngress(repositoryPath, identity.ingressDigest, { optional: true });
    if (existing) return existing;
    const receipt = validateSourceBearingOwnerIngress({
      schemaVersion: SOURCE_BEARING_OWNER_INGRESS_SCHEMA,
      ...identity,
      receivedAt: now instanceof Date ? now.toISOString() : String(now),
    });
    writeCreateOnlyJson(
      receiptPath(repositoryPath, receipt.ingressDigest),
      receipt,
      "MH_OWNER_INGRESS_WRITE",
    );
    return readSourceBearingOwnerIngress(repositoryPath, receipt.ingressDigest);
  });
}

module.exports = {
  MAX_OWNER_INGRESS_TEXT_BYTES,
  SOURCE_BEARING_OWNER_INGRESS_DOMAIN,
  SOURCE_BEARING_OWNER_INGRESS_SCHEMA,
  persistSourceBearingOwnerIngress,
  rawTextDigest,
  readSourceBearingOwnerIngress,
  receiptPath,
  validateSourceBearingOwnerIngress,
};
