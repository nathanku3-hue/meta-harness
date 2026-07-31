"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { canonicalize, exactKeys, isOrdinaryPlainObject } = require("../contracts/canonical-json");
const { domainDigest } = require("../contracts/digest");
const {
  codedError,
  hostRealPath,
  rootsPairwiseSeparated,
  writeJsonNoReplace,
} = require("../execution-custody/support");
const { exactUtcNow } = require("./clock");
const {
  resolveRepositoryStateRoot,
  resolveRepositoryStateRootForTests,
} = require("./repository-state");

const OWNER_PIN_SCHEMA = "authority-genesis-pin/v2";
const OWNER_KEY_DOMAIN = "meta-harness-owner-public-key/v2";
const OWNER_PIN_DOMAIN = "meta-harness-authority-genesis-pin/v2";
const OWNER_PIN_RELATIVE_PATH = path.join("authority", "owner-pin.json");
const BOOTSTRAP_LOCK_RELATIVE_PATH = path.join("locks", "owner-pin-bootstrap.lock");
const PIN_KEYS = Object.freeze([
  "schemaVersion",
  "repositoryId",
  "ownerKeyId",
  "ownerPublicKey",
  "ownerPublicKeyDigest",
  "installedByExplicitOwnerAction",
  "installedAt",
  "pinDigest",
]);

function validatePublicKey(publicKey) {
  if (!isOrdinaryPlainObject(publicKey)
    || publicKey.kty !== "OKP"
    || publicKey.crv !== "Ed25519"
    || typeof publicKey.x !== "string"
    || publicKey.x.length === 0
    || Object.prototype.hasOwnProperty.call(publicKey, "d")) {
    throw codedError(
      "OWNER_PIN_PUBLIC_KEY_INVALID",
      "owner public key must be a public Ed25519 JWK without private key material",
    );
  }
  try {
    crypto.createPublicKey({ key: publicKey, format: "jwk" });
  } catch (error) {
    throw codedError("OWNER_PIN_PUBLIC_KEY_INVALID", `owner public key is invalid: ${error.message}`);
  }
  return JSON.parse(canonicalize(publicKey));
}

function ownerPublicKeyDigest(publicKey) {
  return domainDigest(OWNER_KEY_DOMAIN, validatePublicKey(publicKey));
}

function pinBody(pin) {
  const body = { ...pin };
  delete body.pinDigest;
  return body;
}

function validateOwnerPin(pin, expectedRepositoryId) {
  if (!isOrdinaryPlainObject(pin) || !exactKeys(pin, PIN_KEYS)) {
    throw codedError("OWNER_PIN_SHAPE_INVALID", "owner pin has unexpected or missing fields");
  }
  if (pin.schemaVersion !== OWNER_PIN_SCHEMA) {
    throw codedError("UNSUPPORTED_SCHEMA", `owner pin schema must be ${OWNER_PIN_SCHEMA}`);
  }
  if (pin.repositoryId !== expectedRepositoryId) {
    throw codedError("OWNER_PIN_REPOSITORY_MISMATCH", "owner pin belongs to another repository state universe");
  }
  const publicKey = validatePublicKey(pin.ownerPublicKey);
  const keyDigest = ownerPublicKeyDigest(publicKey);
  if (pin.ownerPublicKeyDigest !== keyDigest || pin.ownerKeyId !== keyDigest) {
    throw codedError("OWNER_PIN_KEY_DIGEST_MISMATCH", "owner pin key identity does not match its public key");
  }
  if (pin.installedByExplicitOwnerAction !== true) {
    throw codedError("OWNER_PIN_EXPLICIT_ACTION_REQUIRED", "owner pin must record explicit owner bootstrap");
  }
  if (typeof pin.installedAt !== "string" || Number.isNaN(Date.parse(pin.installedAt))) {
    throw codedError("OWNER_PIN_TIMESTAMP_INVALID", "owner pin installedAt must be an exact timestamp");
  }
  const expectedPinDigest = domainDigest(OWNER_PIN_DOMAIN, pinBody(pin));
  if (pin.pinDigest !== expectedPinDigest) {
    throw codedError("OWNER_PIN_DIGEST_MISMATCH", "owner pin digest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(pin)));
}

function ensureStateRootOutsideRepository(state) {
  fs.mkdirSync(state.stateRoot, { recursive: true, mode: 0o700 });
  const canonicalStateRoot = hostRealPath(state.stateRoot);
  rootsPairwiseSeparated(state.repositoryPath, canonicalStateRoot, "repositoryPath", "stateRoot");
  rootsPairwiseSeparated(state.canonicalGitCommonDir, canonicalStateRoot, "gitCommonDir", "stateRoot");
  return canonicalStateRoot;
}

function withBootstrapLock(stateRoot, operation) {
  const lockPath = path.join(stateRoot, BOOTSTRAP_LOCK_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(handle, `${process.pid}\n`, "utf8");
    fs.fsyncSync(handle);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw codedError("OWNER_PIN_BOOTSTRAP_LOCKED", "owner pin bootstrap is already in progress or requires recovery");
    }
    throw error;
  }

  try {
    return operation();
  } finally {
    try { fs.closeSync(handle); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* retain on unexpected failure */ }
  }
}

function bootstrapAtResolvedState(state, ownerPublicKey) {
  const stateRoot = ensureStateRootOutsideRepository(state);
  const pinPath = path.join(stateRoot, OWNER_PIN_RELATIVE_PATH);
  return withBootstrapLock(stateRoot, () => {
    if (fs.existsSync(pinPath)) {
      throw codedError(
        "OWNER_PIN_ALREADY_INSTALLED",
        "owner pin is create-only and already exists for this repository state universe",
      );
    }
    const publicKey = validatePublicKey(ownerPublicKey);
    const keyDigest = ownerPublicKeyDigest(publicKey);
    const body = {
      schemaVersion: OWNER_PIN_SCHEMA,
      repositoryId: state.repositoryIdentityDigest,
      ownerKeyId: keyDigest,
      ownerPublicKey: publicKey,
      ownerPublicKeyDigest: keyDigest,
      installedByExplicitOwnerAction: true,
      installedAt: exactUtcNow(),
    };
    const pin = { ...body, pinDigest: domainDigest(OWNER_PIN_DOMAIN, body) };
    fs.mkdirSync(path.dirname(pinPath), { recursive: true, mode: 0o700 });
    writeJsonNoReplace(pinPath, pin);
    return Object.freeze({ pin: validateOwnerPin(pin, state.repositoryIdentityDigest), pinPath, stateRoot });
  });
}

function bootstrapOwnerPin({ repositoryPath, ownerPublicKey }) {
  return bootstrapAtResolvedState(resolveRepositoryStateRoot(repositoryPath), ownerPublicKey);
}

function bootstrapOwnerPinForTests({ repositoryPath, ownerPublicKey, stateBase }) {
  return bootstrapAtResolvedState(
    resolveRepositoryStateRootForTests(repositoryPath, stateBase),
    ownerPublicKey,
  );
}

function loadAtResolvedState(state) {
  const stateRoot = ensureStateRootOutsideRepository(state);
  const pinPath = path.join(stateRoot, OWNER_PIN_RELATIVE_PATH);
  if (!fs.existsSync(pinPath)) {
    throw codedError("OWNER_PIN_REQUIRED", "external owner pin is not installed for this repository state universe");
  }
  const stat = fs.lstatSync(pinPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError("OWNER_PIN_STORAGE_INVALID", "owner pin must be a regular non-symlink file");
  }
  let pin;
  try {
    pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  } catch (error) {
    throw codedError("OWNER_PIN_UNREADABLE", `owner pin is unreadable: ${error.message}`);
  }
  return Object.freeze({
    pin: validateOwnerPin(pin, state.repositoryIdentityDigest),
    pinPath,
    stateRoot,
  });
}

function loadOwnerPin(repositoryPath) {
  return loadAtResolvedState(resolveRepositoryStateRoot(repositoryPath));
}

function loadOwnerPinForTests(repositoryPath, stateBase) {
  return loadAtResolvedState(resolveRepositoryStateRootForTests(repositoryPath, stateBase));
}

module.exports = {
  BOOTSTRAP_LOCK_RELATIVE_PATH,
  OWNER_KEY_DOMAIN,
  OWNER_PIN_DOMAIN,
  OWNER_PIN_RELATIVE_PATH,
  OWNER_PIN_SCHEMA,
  bootstrapOwnerPin,
  bootstrapOwnerPinForTests,
  loadOwnerPin,
  loadOwnerPinForTests,
  ownerPublicKeyDigest,
  validateOwnerPin,
};
