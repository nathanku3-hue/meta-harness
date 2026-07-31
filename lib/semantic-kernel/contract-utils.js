"use strict";

const crypto = require("node:crypto");

const {
  assertStrictJsonData,
  canonicalize,
  cloneStrict,
  exactKeys,
  freezeDeep,
  isExactUtcTimestamp,
  isOrdinaryPlainObject,
} = require("../contracts/canonical-json");
const { domainDigest, isDigest } = require("../contracts/digest");

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePlain(value, label) {
  if (!isOrdinaryPlainObject(value)) {
    throw contractError("CONTRACT_OBJECT_REQUIRED", `${label} must be a plain object`);
  }
  return value;
}

function requireExactKeys(value, keys, label) {
  requirePlain(value, label);
  if (!exactKeys(value, keys)) {
    throw contractError("CONTRACT_SHAPE_INVALID", `${label} has unexpected or missing fields`, {
      expected: [...keys].sort(),
      actual: Object.keys(value).sort(),
    });
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw contractError("CONTRACT_STRING_REQUIRED", `${label} must be a non-empty string`);
  }
  return value;
}

function requireOptionalString(value, label) {
  if (value === null) return null;
  return requireNonEmptyString(value, label);
}

function requireDigest(value, label) {
  if (!isDigest(value)) {
    throw contractError("CONTRACT_DIGEST_REQUIRED", `${label} must be a sha256 digest`);
  }
  return value;
}

function requireExactUtc(value, label) {
  if (!isExactUtcTimestamp(value)) {
    throw contractError("CONTRACT_TIMESTAMP_INVALID", `${label} must be exact UTC YYYY-MM-DDTHH:mm:ss.sssZ`);
  }
  return value;
}

function requireInteger(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw contractError("CONTRACT_INTEGER_INVALID", `${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw contractError("CONTRACT_BOOLEAN_REQUIRED", `${label} must be boolean`);
  }
  return value;
}

function requireArray(value, label, { min = 0, max = 10000 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw contractError("CONTRACT_ARRAY_INVALID", `${label} must contain between ${min} and ${max} items`);
  }
  return value;
}

function requireUniqueStrings(value, label, options = {}) {
  const entries = requireArray(value, label, options).map((entry, index) => (
    requireNonEmptyString(entry, `${label}[${index}]`)
  ));
  if (new Set(entries).size !== entries.length) {
    throw contractError("CONTRACT_ARRAY_DUPLICATE", `${label} must contain unique strings`);
  }
  return entries;
}

function requireSortedUniqueStrings(value, label, options = {}) {
  const entries = requireUniqueStrings(value, label, options);
  const sorted = [...entries].sort();
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) {
    throw contractError("CONTRACT_ARRAY_ORDER", `${label} must be lexicographically sorted`);
  }
  return entries;
}

function bodyWithout(value, excludedKeys) {
  requirePlain(value, "contract");
  const body = cloneStrict(value);
  for (const key of excludedKeys) delete body[key];
  return body;
}

function sealDigest(domain, value, digestField, excludedFields = []) {
  const body = bodyWithout(value, [digestField, ...excludedFields]);
  return domainDigest(domain, body);
}

function assertSealedDigest(domain, value, digestField, excludedFields = [], label = "contract") {
  requireDigest(value[digestField], `${label}.${digestField}`);
  const expected = sealDigest(domain, value, digestField, excludedFields);
  if (value[digestField] !== expected) {
    throw contractError("CONTRACT_DIGEST_MISMATCH", `${label}.${digestField} does not match its canonical body`, {
      expected,
      actual: value[digestField],
    });
  }
  return expected;
}

function signingBytes(domain, body) {
  assertStrictJsonData(body);
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(body), "utf8"),
  ]);
}

function decodeBase64Url(value, label) {
  requireNonEmptyString(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw contractError("CONTRACT_SIGNATURE_ENCODING", `${label} must be unpadded base64url`);
  }
  let bytes;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch (error) {
    throw contractError("CONTRACT_SIGNATURE_ENCODING", `${label} is invalid base64url: ${error.message}`);
  }
  if (bytes.toString("base64url") !== value) {
    throw contractError("CONTRACT_SIGNATURE_ENCODING", `${label} is not canonical unpadded base64url`);
  }
  return bytes;
}

function verifyEd25519Signature({ domain, body, signature, publicKeyJwk, label }) {
  const signatureBytes = decodeBase64Url(signature, `${label}.signature`);
  if (signatureBytes.length !== 64) {
    throw contractError("CONTRACT_SIGNATURE_LENGTH", `${label}.signature must be exactly 64 bytes`);
  }
  let key;
  try {
    key = crypto.createPublicKey({ key: publicKeyJwk, format: "jwk" });
  } catch (error) {
    throw contractError("CONTRACT_PUBLIC_KEY_INVALID", `${label} public key is invalid: ${error.message}`);
  }
  const ok = crypto.verify(null, signingBytes(domain, body), key, signatureBytes);
  if (!ok) {
    throw contractError("CONTRACT_SIGNATURE_INVALID", `${label} signature is invalid`);
  }
  return true;
}

function signEd25519ForTests({ domain, body, privateKey }) {
  return crypto.sign(null, signingBytes(domain, body), privateKey).toString("base64url");
}

function immutable(value) {
  assertStrictJsonData(value);
  return freezeDeep(cloneStrict(value));
}

module.exports = {
  assertSealedDigest,
  bodyWithout,
  contractError,
  decodeBase64Url,
  immutable,
  requireArray,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
  requireOptionalString,
  requirePlain,
  requireSortedUniqueStrings,
  requireUniqueStrings,
  sealDigest,
  signEd25519ForTests,
  signingBytes,
  verifyEd25519Signature,
};
