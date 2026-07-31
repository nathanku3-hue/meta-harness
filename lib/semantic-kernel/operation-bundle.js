"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { canonicalize, cloneStrict } = require("../contracts/canonical-json");
const { domainDigest, isDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
  requirePlain,
} = require("./contract-utils");
const { exactUtcNow, monotonicTimeNs } = require("./clock");

const OPERATION_EVENT_SCHEMA = "operation-event/v1";
const OPERATION_EVENT_DOMAIN = "meta-harness-operation-event/v1";
const CONTROLLER_SEAL_DOMAIN = "meta-harness-controller-seal/v1";
const COMMIT_MANIFEST_SCHEMA = "operation-bundle-commit-manifest/v1";
const COMMIT_MANIFEST_DOMAIN = "meta-harness-operation-bundle-manifest/v1";
const BUNDLE_DIRECTORY = "operation-bundle";
const STAGING_DIRECTORY = "operation-staging";

const EVENT_KEYS = Object.freeze([
  "schemaVersion",
  "operationId",
  "objectId",
  "objectRelativePath",
  "repositoryId",
  "sliceId",
  "generation",
  "sequence",
  "priorEventDigest",
  "capability",
  "objectType",
  "objectBodyDigest",
  "custodyClaimDigest",
  "controllerInstanceId",
  "occurredAtUtc",
  "monotonicTimeNs",
  "eventDigest",
]);
const SEAL_KEYS = Object.freeze([
  "operationEventDigest",
  "objectBodyDigest",
  "custodyClaimDigest",
  "sealDigest",
]);
const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "eventDigest",
  "eventFileDigest",
  "objectFileDigest",
  "objectRelativePath",
  "createdAtUtc",
  "manifestDigest",
]);

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalize(value)}\n`, "utf8");
}

function safeRelativePath(value, label) {
  requireNonEmptyString(value, label);
  if (path.isAbsolute(value)
    || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw contractError("OPERATION_OBJECT_PATH_INVALID", `${label} must be a normalized relative path`);
  }
  return value;
}

function eventBody(event) {
  const body = cloneStrict(event);
  delete body.eventDigest;
  return body;
}

function manifestBody(manifest) {
  const body = cloneStrict(manifest);
  delete body.manifestDigest;
  return body;
}

function controllerSealBody(seal) {
  const body = cloneStrict(seal);
  delete body.sealDigest;
  return body;
}

function objectBody(authoritativeObject) {
  requirePlain(authoritativeObject, "authoritative object envelope");
  requireExactKeys(
    authoritativeObject,
    ["schemaVersion", "objectType", "objectBody", "controllerSeal"],
    "authoritative object envelope",
  );
  if (authoritativeObject.schemaVersion !== "controller-sealed-object/v1") {
    throw contractError("UNSUPPORTED_SCHEMA", "authoritative object envelope must use controller-sealed-object/v1");
  }
  requireNonEmptyString(authoritativeObject.objectType, "authoritative object envelope.objectType");
  requirePlain(authoritativeObject.objectBody, "authoritative object envelope.objectBody");
  return cloneStrict(authoritativeObject.objectBody);
}

function validateOperationEvent(event) {
  requireExactKeys(event, EVENT_KEYS, "OperationEvent");
  if (event.schemaVersion !== OPERATION_EVENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `OperationEvent schema must be ${OPERATION_EVENT_SCHEMA}`);
  }
  for (const field of [
    "operationId",
    "objectId",
    "sliceId",
    "capability",
    "objectType",
    "controllerInstanceId",
    "monotonicTimeNs",
  ]) requireNonEmptyString(event[field], `OperationEvent.${field}`);
  safeRelativePath(event.objectRelativePath, "OperationEvent.objectRelativePath");
  for (const field of [
    "repositoryId",
    "priorEventDigest",
    "objectBodyDigest",
    "custodyClaimDigest",
  ]) requireDigest(event[field], `OperationEvent.${field}`);
  requireInteger(event.generation, "OperationEvent.generation", { min: 1 });
  requireInteger(event.sequence, "OperationEvent.sequence", { min: 1 });
  if (!/^(?:0|[1-9]\d*)$/.test(event.monotonicTimeNs)) {
    throw contractError("OPERATION_MONOTONIC_INVALID", "OperationEvent.monotonicTimeNs must be an unsigned integer string");
  }
  requireExactUtc(event.occurredAtUtc, "OperationEvent.occurredAtUtc");
  requireDigest(event.eventDigest, "OperationEvent.eventDigest");
  const expected = domainDigest(OPERATION_EVENT_DOMAIN, eventBody(event));
  if (event.eventDigest !== expected) {
    throw contractError("OPERATION_EVENT_DIGEST_MISMATCH", "OperationEvent digest does not match its body");
  }
  return immutable(event);
}

function validateControllerSeal(seal, event) {
  requireExactKeys(seal, SEAL_KEYS, "controllerSeal");
  for (const field of [
    "operationEventDigest",
    "objectBodyDigest",
    "custodyClaimDigest",
    "sealDigest",
  ]) requireDigest(seal[field], `controllerSeal.${field}`);
  if (seal.operationEventDigest !== event.eventDigest
    || seal.objectBodyDigest !== event.objectBodyDigest
    || seal.custodyClaimDigest !== event.custodyClaimDigest) {
    throw contractError("CONTROLLER_SEAL_BINDING_MISMATCH", "controllerSeal does not bind the OperationEvent");
  }
  const expected = domainDigest(CONTROLLER_SEAL_DOMAIN, controllerSealBody(seal));
  if (seal.sealDigest !== expected) {
    throw contractError("CONTROLLER_SEAL_DIGEST_MISMATCH", "controllerSeal digest does not match");
  }
  return immutable(seal);
}

function validateManifest(manifest) {
  requireExactKeys(manifest, MANIFEST_KEYS, "operation bundle manifest");
  if (manifest.schemaVersion !== COMMIT_MANIFEST_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `operation bundle manifest schema must be ${COMMIT_MANIFEST_SCHEMA}`);
  }
  for (const field of ["eventDigest", "eventFileDigest", "objectFileDigest", "manifestDigest"]) {
    requireDigest(manifest[field], `operation bundle manifest.${field}`);
  }
  safeRelativePath(manifest.objectRelativePath, "operation bundle manifest.objectRelativePath");
  requireExactUtc(manifest.createdAtUtc, "operation bundle manifest.createdAtUtc");
  const expected = domainDigest(COMMIT_MANIFEST_DOMAIN, manifestBody(manifest));
  if (manifest.manifestDigest !== expected) {
    throw contractError("OPERATION_MANIFEST_DIGEST_MISMATCH", "operation bundle manifest digest does not match");
  }
  return immutable(manifest);
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeCreateOnly(filePath, bytes) {
  const fd = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function computeControllerSeal(event) {
  const body = {
    operationEventDigest: event.eventDigest,
    objectBodyDigest: event.objectBodyDigest,
    custodyClaimDigest: event.custodyClaimDigest,
  };
  return Object.freeze({
    ...body,
    sealDigest: domainDigest(CONTROLLER_SEAL_DOMAIN, body),
  });
}

function buildOperationBundle({
  repositoryId,
  sliceId,
  generation,
  sequence,
  priorEventDigest,
  capability,
  objectType,
  objectId,
  objectRelativePath,
  authoritativeObjectBody,
  custodyClaimDigest,
  controllerInstanceId,
  operationId = crypto.randomUUID(),
  occurredAtUtc = exactUtcNow(),
  monotonic = monotonicTimeNs(),
}) {
  requirePlain(authoritativeObjectBody, "authoritativeObjectBody");
  if (Object.prototype.hasOwnProperty.call(authoritativeObjectBody, "controllerSeal")) {
    throw contractError("OPERATION_OBJECT_PRESEALED", "authoritative object body must exclude controllerSeal");
  }
  const immutableBody = immutable(authoritativeObjectBody);
  const eventDraft = {
    schemaVersion: OPERATION_EVENT_SCHEMA,
    operationId,
    objectId,
    objectRelativePath: safeRelativePath(objectRelativePath, "objectRelativePath"),
    repositoryId,
    sliceId,
    generation,
    sequence,
    priorEventDigest,
    capability,
    objectType,
    objectBodyDigest: domainDigest(`meta-harness-authoritative-object/${objectType}`, immutableBody),
    custodyClaimDigest,
    controllerInstanceId,
    occurredAtUtc,
    monotonicTimeNs: String(monotonic),
    eventDigest: "pending",
  };
  eventDraft.eventDigest = domainDigest(OPERATION_EVENT_DOMAIN, eventBody(eventDraft));
  const event = validateOperationEvent(eventDraft);
  const controllerSeal = computeControllerSeal(event);
  const authoritativeObject = immutable({
    schemaVersion: "controller-sealed-object/v1",
    objectType,
    objectBody: immutableBody,
    controllerSeal,
  });
  return Object.freeze({ event, authoritativeObject });
}

function publishOperationBundle({ stateRoot, bundle, compareAndSwapHead }) {
  requireNonEmptyString(stateRoot, "stateRoot");
  if (!bundle || !bundle.event || !bundle.authoritativeObject) {
    throw contractError("OPERATION_BUNDLE_REQUIRED", "bundle must contain event and authoritativeObject");
  }
  const event = validateOperationEvent(bundle.event);
  const authoritativeObject = immutable(bundle.authoritativeObject);
  if (authoritativeObject.objectType !== event.objectType) {
    throw contractError("OPERATION_OBJECT_TYPE_MISMATCH", "authoritative object envelope type differs from OperationEvent");
  }
  validateControllerSeal(authoritativeObject.controllerSeal, event);
  const observedObjectBodyDigest = domainDigest(
    `meta-harness-authoritative-object/${event.objectType}`,
    objectBody(authoritativeObject),
  );
  if (observedObjectBodyDigest !== event.objectBodyDigest) {
    throw contractError("OPERATION_OBJECT_DIGEST_MISMATCH", "authoritative object body does not match OperationEvent");
  }

  const bundlesRoot = path.join(stateRoot, BUNDLE_DIRECTORY);
  const stagingRoot = path.join(stateRoot, STAGING_DIRECTORY);
  fs.mkdirSync(bundlesRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const suffix = event.eventDigest.slice("sha256:".length);
  const finalPath = path.join(bundlesRoot, suffix);
  if (fs.existsSync(finalPath)) {
    throw contractError("OPERATION_BUNDLE_EXISTS", "operation bundle final path already exists");
  }
  const stagingPath = path.join(stagingRoot, `${event.operationId}-${crypto.randomBytes(8).toString("hex")}`);
  fs.mkdirSync(stagingPath, { recursive: false, mode: 0o700 });

  const eventBytes = canonicalBytes(event);
  const objectBytes = canonicalBytes(authoritativeObject);
  const eventPath = path.join(stagingPath, "operation-event.json");
  const objectPath = path.join(stagingPath, "authoritative-object.json");
  const manifestPath = path.join(stagingPath, "commit-manifest.json");

  try {
    writeCreateOnly(eventPath, eventBytes);
    writeCreateOnly(objectPath, objectBytes);
    const manifestBodyValue = {
      schemaVersion: COMMIT_MANIFEST_SCHEMA,
      eventDigest: event.eventDigest,
      eventFileDigest: sha256Bytes(eventBytes),
      objectFileDigest: sha256Bytes(objectBytes),
      objectRelativePath: event.objectRelativePath,
      createdAtUtc: event.occurredAtUtc,
    };
    const manifest = {
      ...manifestBodyValue,
      manifestDigest: domainDigest(COMMIT_MANIFEST_DOMAIN, manifestBodyValue),
    };
    writeCreateOnly(manifestPath, canonicalBytes(manifest));
    fsyncFile(manifestPath);
    fsyncDirectory(stagingPath);
    fs.renameSync(stagingPath, finalPath);
    fsyncDirectory(bundlesRoot);

    if (typeof compareAndSwapHead !== "function") {
      throw contractError("OPERATION_HEAD_CAS_REQUIRED", "operation bundle publication requires a head compare-and-swap callback");
    }
    compareAndSwapHead({
      expectedPriorEventDigest: event.priorEventDigest,
      nextEventDigest: event.eventDigest,
      event,
      bundlePath: finalPath,
    });
    return validateOperationBundle({ bundlePath: finalPath });
  } catch (error) {
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function readCanonicalJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw contractError("OPERATION_BUNDLE_READ", `${label} is unreadable: ${error.message}`);
  }
  return value;
}

function validateOperationBundle({ bundlePath, expectedPriorEventDigest }) {
  const manifestPath = path.join(bundlePath, "commit-manifest.json");
  const eventPath = path.join(bundlePath, "operation-event.json");
  const objectPath = path.join(bundlePath, "authoritative-object.json");
  if (!fs.existsSync(manifestPath)) {
    throw contractError("OPERATION_BUNDLE_INCOMPLETE", "operation bundle has no final commit manifest");
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const eventBytes = fs.readFileSync(eventPath);
  const objectBytes = fs.readFileSync(objectPath);
  const manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.eventFileDigest !== sha256Bytes(eventBytes)
    || manifest.objectFileDigest !== sha256Bytes(objectBytes)) {
    throw contractError("OPERATION_BUNDLE_FILE_DIGEST_MISMATCH", "operation bundle file digest does not match manifest");
  }
  const event = validateOperationEvent(JSON.parse(eventBytes.toString("utf8")));
  if (manifest.eventDigest !== event.eventDigest) {
    throw contractError("OPERATION_BUNDLE_EVENT_MISMATCH", "manifest and event digest differ");
  }
  if (expectedPriorEventDigest !== undefined && event.priorEventDigest !== expectedPriorEventDigest) {
    throw contractError("OPERATION_BUNDLE_PREDECESSOR_MISMATCH", "operation event does not name the expected predecessor");
  }
  const authoritativeObject = immutable(JSON.parse(objectBytes.toString("utf8")));
  if (authoritativeObject.objectType !== event.objectType) {
    throw contractError("OPERATION_OBJECT_TYPE_MISMATCH", "authoritative object envelope type differs from OperationEvent");
  }
  validateControllerSeal(authoritativeObject.controllerSeal, event);
  const actualObjectBodyDigest = domainDigest(
    `meta-harness-authoritative-object/${event.objectType}`,
    objectBody(authoritativeObject),
  );
  if (actualObjectBodyDigest !== event.objectBodyDigest) {
    throw contractError("OPERATION_OBJECT_DIGEST_MISMATCH", "authoritative object body does not match event");
  }
  return Object.freeze({
    manifest,
    event,
    authoritativeObject,
    bundlePath,
  });
}

function operationBundlePath(stateRoot, eventDigest) {
  requireDigest(eventDigest, "eventDigest");
  return path.join(stateRoot, BUNDLE_DIRECTORY, eventDigest.slice("sha256:".length));
}

function loadCommittedOperation(stateRoot, eventDigest, expectedPriorEventDigest) {
  return validateOperationBundle({
    bundlePath: operationBundlePath(stateRoot, eventDigest),
    expectedPriorEventDigest,
  });
}

function loadCommittedObjectById(stateRoot, objectType, objectId) {
  requireNonEmptyString(objectType, "objectType");
  requireNonEmptyString(objectId, "objectId");
  const bundlesRoot = path.join(stateRoot, BUNDLE_DIRECTORY);
  if (!fs.existsSync(bundlesRoot)) {
    throw contractError("OPERATION_OBJECT_NOT_COMMITTED", `no committed operation object matches ${objectType} ${objectId}`);
  }
  let match = null;
  for (const entry of fs.readdirSync(bundlesRoot).sort()) {
    if (!/^[a-f0-9]{64}$/.test(entry)) continue;
    const committed = loadCommittedOperation(stateRoot, `sha256:${entry}`);
    if (committed.event.objectType !== objectType || committed.event.objectId !== objectId) continue;
    if (match) {
      throw contractError("OPERATION_OBJECT_DUPLICATE", `multiple committed operation objects match ${objectType} ${objectId}`);
    }
    match = committed;
  }
  if (!match) {
    throw contractError("OPERATION_OBJECT_NOT_COMMITTED", `no committed operation object matches ${objectType} ${objectId}`);
  }
  return match;
}

function cleanIncompleteStaging(stateRoot) {
  const stagingRoot = path.join(stateRoot, STAGING_DIRECTORY);
  if (!fs.existsSync(stagingRoot)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(stagingRoot)) {
    const candidate = path.join(stagingRoot, entry);
    if (!fs.lstatSync(candidate).isDirectory()) continue;
    fs.rmSync(candidate, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

module.exports = {
  BUNDLE_DIRECTORY,
  COMMIT_MANIFEST_DOMAIN,
  COMMIT_MANIFEST_SCHEMA,
  CONTROLLER_SEAL_DOMAIN,
  EVENT_KEYS,
  OPERATION_EVENT_DOMAIN,
  OPERATION_EVENT_SCHEMA,
  STAGING_DIRECTORY,
  buildOperationBundle,
  cleanIncompleteStaging,
  loadCommittedObjectById,
  loadCommittedOperation,
  objectBody,
  operationBundlePath,
  publishOperationBundle,
  validateControllerSeal,
  validateOperationBundle,
  validateOperationEvent,
  validateManifest,
};
