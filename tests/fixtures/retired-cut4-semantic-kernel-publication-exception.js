"use strict";

const {
  assertSealedDigest,
  bodyWithout,
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
  sealDigest,
  verifyEd25519Signature,
} = require("./contract-utils");

const PUBLICATION_EXCEPTION_SCHEMA = "publication-exception/v1";
const PUBLICATION_EXCEPTION_DOMAIN = "meta-harness-publication-exception/v1";
const PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN = "meta-harness-publication-exception-signature/v1";
const ALLOWED_ACTION = "RETRY_IDENTICAL_NOT_PUBLISHED_RELEASE";

function publicationExceptionSigningBody(value) {
  return bodyWithout(value, ["ownerSignature"]);
}

function computePublicationExceptionDigest(value) {
  return sealDigest(PUBLICATION_EXCEPTION_DOMAIN, value, "exceptionDigest", ["ownerSignature"]);
}

function validatePublicationException(value, ownerPin, options = {}) {
  requireExactKeys(value, [
    "schemaVersion",
    "repositoryId",
    "sliceId",
    "releaseCandidateDigest",
    "priorPublicationObservationDigest",
    "allowedAction",
    "newPublishBy",
    "maxPublicationAttempts",
    "reason",
    "issuedAt",
    "ownerKeyId",
    "exceptionDigest",
    "ownerSignature",
  ], "PublicationException");
  if (value.schemaVersion !== PUBLICATION_EXCEPTION_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `PublicationException schema must be ${PUBLICATION_EXCEPTION_SCHEMA}`);
  }
  for (const field of [
    "repositoryId",
    "releaseCandidateDigest",
    "priorPublicationObservationDigest",
    "ownerKeyId",
    "exceptionDigest",
  ]) requireDigest(value[field], `PublicationException.${field}`);
  requireNonEmptyString(value.sliceId, "PublicationException.sliceId");
  if (value.allowedAction !== ALLOWED_ACTION) {
    throw contractError("PUBLICATION_EXCEPTION_ACTION_INVALID", `allowedAction must be ${ALLOWED_ACTION}`);
  }
  requireExactUtc(value.newPublishBy, "PublicationException.newPublishBy");
  if (requireInteger(value.maxPublicationAttempts, "PublicationException.maxPublicationAttempts", { min: 1, max: 1 }) !== 1) {
    throw contractError("PUBLICATION_EXCEPTION_ATTEMPTS", "publication exception permits exactly one identical retry");
  }
  requireNonEmptyString(value.reason, "PublicationException.reason");
  requireExactUtc(value.issuedAt, "PublicationException.issuedAt");
  if (Date.parse(value.newPublishBy) <= Date.parse(value.issuedAt)) {
    throw contractError("PUBLICATION_EXCEPTION_WINDOW", "newPublishBy must follow issuedAt");
  }
  requireNonEmptyString(value.ownerSignature, "PublicationException.ownerSignature");
  assertSealedDigest(
    PUBLICATION_EXCEPTION_DOMAIN,
    value,
    "exceptionDigest",
    ["ownerSignature"],
    "PublicationException",
  );
  if (!ownerPin || value.repositoryId !== ownerPin.repositoryId || value.ownerKeyId !== ownerPin.ownerKeyId) {
    throw contractError("PUBLICATION_EXCEPTION_OWNER_MISMATCH", "PublicationException does not match external owner pin");
  }
  for (const [field, expected] of Object.entries(options)) {
    if (expected !== undefined && value[field] !== expected) {
      throw contractError("PUBLICATION_EXCEPTION_BINDING_MISMATCH", `PublicationException.${field} does not match failed release`);
    }
  }
  verifyEd25519Signature({
    domain: PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN,
    body: publicationExceptionSigningBody(value),
    signature: value.ownerSignature,
    publicKeyJwk: ownerPin.ownerPublicKey,
    label: "PublicationException",
  });
  return immutable(value);
}

module.exports = {
  ALLOWED_ACTION,
  PUBLICATION_EXCEPTION_DOMAIN,
  PUBLICATION_EXCEPTION_SCHEMA,
  PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN,
  computePublicationExceptionDigest,
  publicationExceptionSigningBody,
  validatePublicationException,
};
