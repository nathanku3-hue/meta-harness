"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalize, exactKeys, isOrdinaryPlainObject,
} = require("./contracts/canonical-json");
const { domainDigest } = require("./contracts/digest");
const { assertContainedPath } = require("./truth-paths");

const AUTHORITY_SCHEMA = "meta-harness-truth-authority-public/v1";
const PUBLIC_KEY_RELATIVE_PATH = path.join(".meta-harness", "contracts", "truth-authority-public.json");
const AUTHORITY_KEYS = Object.freeze(["schema_version", "repository_id", "public_key"]);

function authorityError(message, code = "TRUTH_AUTHORITY_KEY_INVALID") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicKeyPath(targetRoot) {
  return path.join(path.resolve(targetRoot), PUBLIC_KEY_RELATIVE_PATH);
}

function hasTruthAuthority(targetRoot) {
  const filePath = publicKeyPath(targetRoot);
  if (!fs.existsSync(filePath)) return false;
  assertContainedPath(targetRoot, filePath, {
    leafType: "file",
    label: "canonical authority contract",
  });
  return true;
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw authorityError(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
  if (!isOrdinaryPlainObject(parsed)) {
    throw authorityError(`${label} must be a JSON object`);
  }
  return parsed;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePublicJwk(publicJwk) {
  if (!isOrdinaryPlainObject(publicJwk)) {
    throw authorityError("truth authority public_key must be a JSON object");
  }
  if (publicJwk.kty !== "OKP" || publicJwk.crv !== "Ed25519" || !nonEmptyString(publicJwk.x)) {
    throw authorityError("truth authority public_key must be an OKP Ed25519 public JWK with x present");
  }
  if (Object.prototype.hasOwnProperty.call(publicJwk, "d")) {
    throw authorityError("truth authority public_key must not contain private key material");
  }
  try {
    crypto.createPublicKey({ key: publicJwk, format: "jwk" });
  } catch (error) {
    throw authorityError(`truth authority public_key is invalid: ${error.message}`);
  }
  return publicJwk;
}

function normalizePublicAuthority(document, { allowLegacy = true } = {}) {
  if (isOrdinaryPlainObject(document) && exactKeys(document, AUTHORITY_KEYS)) {
    if (document.schema_version !== AUTHORITY_SCHEMA) {
      throw authorityError(`truth authority schema_version must be ${AUTHORITY_SCHEMA}`);
    }
    if (!nonEmptyString(document.repository_id)) {
      throw authorityError("truth authority repository_id must be a non-empty string");
    }
    return {
      legacy: false,
      schema_version: AUTHORITY_SCHEMA,
      repository_id: document.repository_id,
      public_key: validatePublicJwk(document.public_key),
      document,
    };
  }

  if (allowLegacy && isOrdinaryPlainObject(document) && nonEmptyString(document.kty)) {
    return {
      legacy: true,
      schema_version: null,
      repository_id: null,
      public_key: validatePublicJwk(document),
      document,
    };
  }

  throw authorityError(`truth authority must use ${AUTHORITY_SCHEMA}`);
}

function loadPublicAuthority(targetRoot, options = {}) {
  const filePath = publicKeyPath(targetRoot);
  if (!fs.existsSync(filePath)) {
    throw authorityError(
      "truth authority public key is missing; install the tracked verifier contract before canonical mutation",
      "TRUTH_AUTHORITY_SETUP_REQUIRED",
    );
  }
  assertContainedPath(targetRoot, filePath, {
    leafType: "file",
    label: "canonical authority contract",
  });
  return normalizePublicAuthority(readJson(filePath, "truth authority public key"), options);
}

function validatePublicAuthorityInstallation(targetRoot, document) {
  const authority = normalizePublicAuthority(document, { allowLegacy: false });
  const filePath = publicKeyPath(targetRoot);
  assertContainedPath(targetRoot, filePath, {
    allowMissingTail: true,
    leafType: "file",
    label: "canonical authority contract",
  });
  if (!fs.existsSync(filePath)) return authority;

  const existing = normalizePublicAuthority(readJson(filePath, "truth authority public key"));
  if (existing.legacy) {
    throw authorityError(
      "legacy truth authority public key is present; create a reviewed structured authority migration before bootstrap",
      "TRUTH_AUTHORITY_LEGACY_KEY_PRESENT",
    );
  }
  if (canonicalize(existing.document) !== canonicalize(authority.document)) {
    throw authorityError(
      "truth authority public key already exists with different repository identity or key material",
      "TRUTH_AUTHORITY_KEY_MISMATCH",
    );
  }
  return authority;
}

function installPublicAuthority(targetRoot, document) {
  const authority = validatePublicAuthorityInstallation(targetRoot, document);
  const filePath = publicKeyPath(targetRoot);
  if (fs.existsSync(filePath)) return authority;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  assertContainedPath(targetRoot, path.dirname(filePath), {
    leafType: "directory",
    label: "canonical authority directory",
  });
  assertContainedPath(targetRoot, filePath, {
    allowMissingLeaf: true,
    leafType: "file",
    label: "canonical authority contract",
  });
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(authority.document, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return authority;
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
    return validatePublicAuthorityInstallation(targetRoot, document);
  }
}

function loadPublicKey(targetRoot) {
  return loadPublicAuthority(targetRoot).public_key;
}

function signerKeyId(publicJwk) {
  return domainDigest("truth-authority-public-key/v1", publicJwk);
}

module.exports = {
  AUTHORITY_SCHEMA,
  PUBLIC_KEY_RELATIVE_PATH,
  hasTruthAuthority,
  installPublicAuthority,
  loadPublicAuthority,
  loadPublicKey,
  normalizePublicAuthority,
  signerKeyId,
  validatePublicAuthorityInstallation,
};
