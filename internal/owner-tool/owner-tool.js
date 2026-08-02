"use strict";

const crypto = require("node:crypto");

const { canonicalize } = require("../../lib/contracts/canonical-json");
const { domainDigest } = require("../../lib/contracts/digest");
const { ownerPublicKeyDigest } = require("../../lib/semantic-kernel/owner-pin");
const {
  signEd25519ForTests,
} = require("../../lib/semantic-kernel/contract-utils");
const {
  G_SCOPE_SIGNATURE_DOMAIN,
  computeGScopeDigest,
  decisionSigningBody,
  validateGScopeDecision,
} = require("../../lib/semantic-kernel/g-scope");
const {
  PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN,
  computePublicationExceptionDigest,
  publicationExceptionSigningBody,
  validatePublicationException,
} = require("../../lib/semantic-kernel/publication-exception");
const {
  PUBLICATION_INTENT_SCHEMA,
  PUBLICATION_INTENT_SIGNATURE_DOMAIN,
  computePublicationIntentDigest,
  publicationIntentSigningBody,
  validatePublicationIntent,
  validatePublicationIntentDraft,
} = require("../../lib/semantic-kernel/publication-intent");

function ownerIdentity(privateKey) {
  const publicKeyObject = crypto.createPublicKey(privateKey);
  const ownerPublicKey = publicKeyObject.export({ format: "jwk" });
  const ownerKeyId = ownerPublicKeyDigest(ownerPublicKey);
  return Object.freeze({ ownerPublicKey, ownerKeyId });
}

function syntheticOwnerPin(repositoryId, identity) {
  return {
    schemaVersion: "authority-genesis-pin/v2",
    repositoryId,
    ownerKeyId: identity.ownerKeyId,
    ownerPublicKey: identity.ownerPublicKey,
    ownerPublicKeyDigest: identity.ownerKeyId,
    installedByExplicitOwnerAction: true,
    installedAt: "1970-01-01T00:00:00.000Z",
    pinDigest: domainDigest("meta-harness-owner-tool-synthetic-pin/v1", {
      repositoryId,
      ownerKeyId: identity.ownerKeyId,
    }),
  };
}

function signGScope(unsignedValue, privateKey) {
  const identity = ownerIdentity(privateKey);
  const signed = {
    ...JSON.parse(JSON.stringify(unsignedValue)),
    ownerKeyId: identity.ownerKeyId,
    decisionDigest: "pending",
    ownerSignature: "pending",
  };
  signed.decisionDigest = computeGScopeDigest(signed);
  signed.ownerSignature = signEd25519ForTests({
    domain: G_SCOPE_SIGNATURE_DOMAIN,
    body: decisionSigningBody(signed),
    privateKey,
  });
  validateGScopeDecision(signed, syntheticOwnerPin(signed.repositoryId, identity));
  return Object.freeze({
    signed,
    canonicalSigningBody: canonicalize(decisionSigningBody(signed)),
    objectDigest: signed.decisionDigest,
    ownerKeyId: identity.ownerKeyId,
  });
}

function signPublicationIntent(unsignedValue, privateKey) {
  const draft = validatePublicationIntentDraft(unsignedValue);
  const identity = ownerIdentity(privateKey);
  const signed = {
    ...JSON.parse(JSON.stringify(draft)),
    schemaVersion: PUBLICATION_INTENT_SCHEMA,
    ownerKeyId: identity.ownerKeyId,
    intentDigest: "pending",
    ownerSignature: "pending",
  };
  signed.intentDigest = computePublicationIntentDigest(signed);
  signed.ownerSignature = signEd25519ForTests({
    domain: PUBLICATION_INTENT_SIGNATURE_DOMAIN,
    body: publicationIntentSigningBody(signed),
    privateKey,
  });
  validatePublicationIntent(signed, {
    ownerPin: syntheticOwnerPin(signed.repositoryId, identity),
    expectedOwnerKeyId: identity.ownerKeyId,
  });
  return Object.freeze({
    signed,
    canonicalSigningBody: canonicalize(publicationIntentSigningBody(signed)),
    objectDigest: signed.intentDigest,
    ownerKeyId: identity.ownerKeyId,
  });
}

function signPublicationException(unsignedValue, privateKey) {
  const identity = ownerIdentity(privateKey);
  const signed = {
    ...JSON.parse(JSON.stringify(unsignedValue)),
    ownerKeyId: identity.ownerKeyId,
    exceptionDigest: "pending",
    ownerSignature: "pending",
  };
  signed.exceptionDigest = computePublicationExceptionDigest(signed);
  signed.ownerSignature = signEd25519ForTests({
    domain: PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN,
    body: publicationExceptionSigningBody(signed),
    privateKey,
  });
  validatePublicationException(signed, syntheticOwnerPin(signed.repositoryId, identity));
  return Object.freeze({
    signed,
    canonicalSigningBody: canonicalize(publicationExceptionSigningBody(signed)),
    objectDigest: signed.exceptionDigest,
    ownerKeyId: identity.ownerKeyId,
  });
}

module.exports = {
  ownerIdentity,
  signGScope,
  signPublicationException,
  signPublicationIntent,
};
