"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");

const PUBLICATION_OBSERVATION_SCHEMA = "publication-observation/v1";
const PUBLICATION_OBSERVATION_DOMAIN = "meta-harness-publication-observation/v1";
const PUBLICATION_DISPOSITIONS = Object.freeze(new Set([
  "PUBLISHED_EXACT",
  "NOT_PUBLISHED",
  "PUBLICATION_OUTCOME_UNKNOWN",
  "PUBLISHED_DIFFERENT",
]));
const CANONICAL_CLOSURE_SCHEMA = "canonical-closure-projection/v1";
const CANONICAL_CLOSURE_DOMAIN = "meta-harness-canonical-closure-projection/v1";

function publicationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.observationDigest;
  return body;
}

function closureBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.projectionDigest;
  return body;
}

function computePublicationObservationDigest(value) {
  return domainDigest(PUBLICATION_OBSERVATION_DOMAIN, publicationBody(value));
}

function computeCanonicalClosureProjectionDigest(value) {
  return domainDigest(CANONICAL_CLOSURE_DOMAIN, closureBody(value));
}

function requireNullableString(value, label) {
  if (value === null) return;
  requireNonEmptyString(value, label);
}

function requireNullableInteger(value, label) {
  if (value === null) return;
  requireInteger(value, label, { min: 0, max: 255 });
}

function validatePublicationObservation(value, releaseCandidate, sliceAuthorization) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "releaseCandidateDigest",
    "registry",
    "packageName",
    "version",
    "requestedTarballDigest",
    "requestedTarballIntegrity",
    "commandIdentityDigest",
    "requestStartedAt",
    "processExitCode",
    "processTimedOut",
    "processStdoutDigest",
    "processStderrDigest",
    "registryVersionObserved",
    "registryIntegrityObserved",
    "observedAt",
    "disposition",
    "observationDigest",
  ], "PublicationObservation");
  if (value.schemaVersion !== PUBLICATION_OBSERVATION_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `PublicationObservation schema must be ${PUBLICATION_OBSERVATION_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "PublicationObservation.sliceId");
  requireInteger(value.generation, "PublicationObservation.generation", { min: 1 });
  for (const field of [
    "releaseCandidateDigest",
    "requestedTarballDigest",
    "commandIdentityDigest",
    "processStdoutDigest",
    "processStderrDigest",
    "observationDigest",
  ]) requireDigest(value[field], `PublicationObservation.${field}`);
  for (const field of ["registry", "packageName", "version", "requestedTarballIntegrity"]) {
    requireNonEmptyString(value[field], `PublicationObservation.${field}`);
  }
  requireExactUtc(value.requestStartedAt, "PublicationObservation.requestStartedAt");
  requireNullableInteger(value.processExitCode, "PublicationObservation.processExitCode");
  requireBoolean(value.processTimedOut, "PublicationObservation.processTimedOut");
  requireNullableString(value.registryVersionObserved, "PublicationObservation.registryVersionObserved");
  requireNullableString(value.registryIntegrityObserved, "PublicationObservation.registryIntegrityObserved");
  requireExactUtc(value.observedAt, "PublicationObservation.observedAt");
  if (!PUBLICATION_DISPOSITIONS.has(value.disposition)) {
    throw contractError("PUBLICATION_DISPOSITION_INVALID", `unsupported publication disposition: ${value.disposition}`);
  }
  if (Date.parse(value.observedAt) < Date.parse(value.requestStartedAt)) {
    throw contractError("PUBLICATION_OBSERVATION_TIME_INVALID", "publication observation cannot predate request start");
  }
  const expected = {
    sliceId: releaseCandidate.sliceId,
    generation: releaseCandidate.generation,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    registry: releaseCandidate.registry,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    requestedTarballDigest: releaseCandidate.tarballDigest,
    requestedTarballIntegrity: releaseCandidate.tarballIntegrity,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("PUBLICATION_BINDING_MISMATCH", `PublicationObservation.${field} differs from ReleaseCandidate`);
    }
  }
  const exactRegistryMatch = value.registryVersionObserved === value.version
    && value.registryIntegrityObserved === value.requestedTarballIntegrity;
  if (value.disposition === "PUBLISHED_EXACT" && !exactRegistryMatch) {
    throw contractError("PUBLICATION_EXACT_UNPROVEN", "PUBLISHED_EXACT requires independently observed exact version and integrity");
  }
  if (value.disposition === "NOT_PUBLISHED"
    && (value.registryVersionObserved !== null || value.registryIntegrityObserved !== null)) {
    throw contractError("PUBLICATION_NOT_PUBLISHED_CONTRADICTION", "NOT_PUBLISHED cannot include observed registry version or integrity");
  }
  if (value.disposition === "PUBLISHED_DIFFERENT" && exactRegistryMatch) {
    throw contractError("PUBLICATION_DIFFERENT_CONTRADICTION", "PUBLISHED_DIFFERENT cannot match exact release identity");
  }
  if (Date.parse(value.requestStartedAt) > Date.parse(sliceAuthorization.publicationPolicy.publishBy)) {
    throw contractError("PUBLICATION_DEADLINE", "publish request began after owner-bound publishBy deadline");
  }
  if (value.observationDigest !== computePublicationObservationDigest(value)) {
    throw contractError("PUBLICATION_OBSERVATION_DIGEST_MISMATCH", "PublicationObservation digest does not match its body");
  }
  return immutable(value);
}

function validateCanonicalClosureProjection(value, {
  sliceAuthorization,
  integratedCandidate,
  releaseCandidate,
  terminalAssessment,
  publicationObservation,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "repositoryId",
    "sliceId",
    "generation",
    "sliceAcceptanceDigest",
    "terminalAssessmentDigest",
    "releaseCandidateDigest",
    "finalCommit",
    "finalTree",
    "tarballDigest",
    "publicationObservationDigest",
    "publicationState",
    "closedAt",
    "nextSliceState",
    "projectionDigest",
  ], "CanonicalClosureProjection");
  if (value.schemaVersion !== CANONICAL_CLOSURE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `CanonicalClosureProjection schema must be ${CANONICAL_CLOSURE_SCHEMA}`);
  }
  requireDigest(value.repositoryId, "CanonicalClosureProjection.repositoryId");
  requireNonEmptyString(value.sliceId, "CanonicalClosureProjection.sliceId");
  requireInteger(value.generation, "CanonicalClosureProjection.generation", { min: 1 });
  for (const field of [
    "sliceAcceptanceDigest",
    "terminalAssessmentDigest",
    "releaseCandidateDigest",
    "tarballDigest",
    "publicationObservationDigest",
    "projectionDigest",
  ]) requireDigest(value[field], `CanonicalClosureProjection.${field}`);
  for (const field of ["finalCommit", "finalTree"]) requireNonEmptyString(value[field], `CanonicalClosureProjection.${field}`);
  requireExactUtc(value.closedAt, "CanonicalClosureProjection.closedAt");
  if (value.publicationState !== "PUBLISHED_EXACT") {
    throw contractError("CANONICAL_CLOSURE_PUBLICATION_STATE", "canonical closure requires PUBLISHED_EXACT");
  }
  if (value.nextSliceState !== "AWAITING_OWNER_AUTHORIZATION") {
    throw contractError("CANONICAL_CLOSURE_NEXT_STATE", "nextSliceState must be the fixed AWAITING_OWNER_AUTHORIZATION enum");
  }
  if (terminalAssessment.verdict !== "TERMINAL_SLICE_VERIFIED") {
    throw contractError("CANONICAL_CLOSURE_TERMINAL_REQUIRED", "canonical closure requires terminal slice verification");
  }
  if (publicationObservation.disposition !== "PUBLISHED_EXACT") {
    throw contractError("CANONICAL_CLOSURE_PUBLICATION_REQUIRED", "canonical closure requires exact registry reconciliation");
  }
  const expected = {
    repositoryId: sliceAuthorization.repositoryId,
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: terminalAssessment.sliceAcceptanceDigest,
    terminalAssessmentDigest: terminalAssessment.terminalAssessmentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    finalCommit: integratedCandidate.finalHeadRevision,
    finalTree: integratedCandidate.finalTreeDigest,
    tarballDigest: releaseCandidate.tarballDigest,
    publicationObservationDigest: publicationObservation.observationDigest,
    publicationState: publicationObservation.disposition,
    closedAt: publicationObservation.observedAt,
    nextSliceState: "AWAITING_OWNER_AUTHORIZATION",
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("CANONICAL_CLOSURE_BINDING_MISMATCH", `CanonicalClosureProjection.${field} is not the deterministic terminal projection`);
    }
  }
  if (value.projectionDigest !== computeCanonicalClosureProjectionDigest(value)) {
    throw contractError("CANONICAL_CLOSURE_DIGEST_MISMATCH", "CanonicalClosureProjection digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  CANONICAL_CLOSURE_DOMAIN,
  CANONICAL_CLOSURE_SCHEMA,
  PUBLICATION_DISPOSITIONS,
  PUBLICATION_OBSERVATION_DOMAIN,
  PUBLICATION_OBSERVATION_SCHEMA,
  computeCanonicalClosureProjectionDigest,
  computePublicationObservationDigest,
  validateCanonicalClosureProjection,
  validatePublicationObservation,
};
