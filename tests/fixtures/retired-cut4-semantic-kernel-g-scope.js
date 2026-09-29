"use strict";

const {
  assertSealedDigest,
  bodyWithout,
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireNonEmptyString,
  sealDigest,
  verifyEd25519Signature,
} = require("./contract-utils");
const { computeSliceAcceptanceDigest, validateSliceAuthorization } = require("./slice-authorization");

const G_SCOPE_SCHEMA = "g-scope-acceptance-change/v1";
const G_SCOPE_DOMAIN = "meta-harness-g-scope-acceptance-change/v1";
const G_SCOPE_SIGNATURE_DOMAIN = "meta-harness-g-scope-acceptance-change-signature/v1";
const KEYS = Object.freeze([
  "schemaVersion",
  "repositoryId",
  "sliceId",
  "priorSliceAuthorizationDigest",
  "priorAcceptanceDigest",
  "replacementSliceAuthorizationDigest",
  "replacementAcceptanceDigest",
  "reason",
  "issuedAt",
  "ownerKeyId",
  "decisionDigest",
  "ownerSignature",
]);

function decisionSigningBody(value) {
  return bodyWithout(value, ["ownerSignature"]);
}

function computeGScopeDigest(value) {
  return sealDigest(G_SCOPE_DOMAIN, value, "decisionDigest", ["ownerSignature"]);
}

function validateGScopeDecision(value, ownerPin, options = {}) {
  requireExactKeys(value, KEYS, "G-SCOPE decision");
  if (value.schemaVersion !== G_SCOPE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `G-SCOPE schema must be ${G_SCOPE_SCHEMA}`);
  }
  for (const field of [
    "repositoryId",
    "priorSliceAuthorizationDigest",
    "priorAcceptanceDigest",
    "replacementSliceAuthorizationDigest",
    "replacementAcceptanceDigest",
    "ownerKeyId",
  ]) requireDigest(value[field], `G-SCOPE.${field}`);
  requireNonEmptyString(value.sliceId, "G-SCOPE.sliceId");
  requireNonEmptyString(value.reason, "G-SCOPE.reason");
  requireExactUtc(value.issuedAt, "G-SCOPE.issuedAt");
  requireNonEmptyString(value.ownerSignature, "G-SCOPE.ownerSignature");
  assertSealedDigest(G_SCOPE_DOMAIN, value, "decisionDigest", ["ownerSignature"], "G-SCOPE");

  if (value.priorAcceptanceDigest === value.replacementAcceptanceDigest) {
    throw contractError("G_SCOPE_NO_ACCEPTANCE_CHANGE", "G-SCOPE must bind a byte-changing acceptance replacement");
  }
  if (!ownerPin || value.repositoryId !== ownerPin.repositoryId || value.ownerKeyId !== ownerPin.ownerKeyId) {
    throw contractError("G_SCOPE_OWNER_MISMATCH", "G-SCOPE does not match the external owner pin");
  }
  for (const [field, expected] of Object.entries(options)) {
    if (expected !== undefined && value[field] !== expected) {
      throw contractError("G_SCOPE_BINDING_MISMATCH", `G-SCOPE ${field} does not match the replacement operation`);
    }
  }
  verifyEd25519Signature({
    domain: G_SCOPE_SIGNATURE_DOMAIN,
    body: decisionSigningBody(value),
    signature: value.ownerSignature,
    publicKeyJwk: ownerPin.ownerPublicKey,
    label: "G-SCOPE",
  });
  return immutable(value);
}

function validateSliceAuthorizationReplacement({ priorAuthorization, replacementAuthorization, gScopeDecision, ownerPin }) {
  const prior = validateSliceAuthorization(priorAuthorization, ownerPin);
  const replacement = validateSliceAuthorization(replacementAuthorization, ownerPin);
  if (prior.repositoryId !== replacement.repositoryId || prior.sliceId !== replacement.sliceId) {
    throw contractError("G_SCOPE_SLICE_MISMATCH", "replacement authorization must preserve repository and slice identity");
  }
  const priorAcceptanceDigest = computeSliceAcceptanceDigest(prior.sliceAcceptance);
  const replacementAcceptanceDigest = computeSliceAcceptanceDigest(replacement.sliceAcceptance);
  if (priorAcceptanceDigest === replacementAcceptanceDigest) {
    if (gScopeDecision !== null && gScopeDecision !== undefined) {
      throw contractError("G_SCOPE_UNNECESSARY", "byte-identical acceptance does not permit a G-SCOPE change receipt");
    }
    return immutable({ prior, replacement, acceptanceChanged: false, gScopeDecision: null });
  }
  if (!gScopeDecision) {
    throw contractError("G_SCOPE_REQUIRED", "any SliceAcceptance byte change requires an owner-signed G-SCOPE decision");
  }
  const decision = validateGScopeDecision(gScopeDecision, ownerPin, {
    repositoryId: prior.repositoryId,
    sliceId: prior.sliceId,
    priorSliceAuthorizationDigest: prior.authorizationDigest,
    priorAcceptanceDigest,
    replacementSliceAuthorizationDigest: replacement.authorizationDigest,
    replacementAcceptanceDigest,
  });
  return immutable({ prior, replacement, acceptanceChanged: true, gScopeDecision: decision });
}

module.exports = {
  G_SCOPE_DOMAIN,
  G_SCOPE_SCHEMA,
  G_SCOPE_SIGNATURE_DOMAIN,
  computeGScopeDigest,
  decisionSigningBody,
  validateGScopeDecision,
  validateSliceAuthorizationReplacement,
};
