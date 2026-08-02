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
const { validatePublicationIntent } = require("./publication-intent");

const PUBLICATION_OBSERVATION_SCHEMA = "publication-observation/v2";
const PUBLICATION_OBSERVATION_DOMAIN = "meta-harness-publication-observation/v2";
const PUBLICATION_DISPOSITIONS = Object.freeze(new Set([
  "PUBLISHED_EXACT",
  "NOT_PUBLISHED",
  "PUBLICATION_OUTCOME_UNKNOWN",
  "PUBLISHED_DIFFERENT",
]));
const CANONICAL_CLOSURE_SCHEMA = "canonical-closure-projection/v2";
const CANONICAL_CLOSURE_DOMAIN = "meta-harness-canonical-closure-projection/v2";

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

function validateGithubTransport(value, publicationIntent) {
  requireExactKeys(value, [
    "provider",
    "repository",
    "workflowFilename",
    "workflowRef",
    "runId",
    "runAttempt",
    "eventName",
    "releaseId",
    "releaseTag",
    "githubSha",
  ], "PublicationObservation.transport");
  for (const field of [
    "provider",
    "repository",
    "workflowFilename",
    "workflowRef",
    "runId",
    "runAttempt",
    "eventName",
    "releaseTag",
    "githubSha",
  ]) requireNonEmptyString(value[field], `PublicationObservation.transport.${field}`);
  requireInteger(value.releaseId, "PublicationObservation.transport.releaseId", { min: 1 });
  const expected = publicationIntent.transport;
  if (value.provider !== expected.provider
    || value.repository !== expected.repository
    || value.workflowFilename !== expected.workflowFilename) {
    throw contractError("PUBLICATION_TRANSPORT_BINDING", "PublicationObservation transport differs from PublicationIntent");
  }
  if (value.eventName !== "release") {
    throw contractError("PUBLICATION_TRANSPORT_EVENT", "publication transport event must be release");
  }
  if (value.releaseTag !== publicationIntent.gitTag || value.githubSha !== publicationIntent.gitTagTargetRevision) {
    throw contractError("PUBLICATION_TRANSPORT_RELEASE", "publication transport tag or SHA differs from PublicationIntent");
  }
  const workflowNeedle = `${value.repository}/.github/workflows/${value.workflowFilename}@`;
  if (!value.workflowRef.startsWith(workflowNeedle)) {
    throw contractError("PUBLICATION_TRANSPORT_WORKFLOW_REF", "workflowRef does not identify the trusted publisher workflow");
  }
}

function validatePublicationObservation(
  value,
  publicationIntent,
  releaseCandidate,
  sliceAuthorization,
  packageCandidate,
  terminalAssessment,
) {
  validatePublicationIntent(publicationIntent, {
    sliceAuthorization,
    packageCandidate,
    releaseCandidate,
    terminalAssessment,
  });
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "publicationIntentDigest",
    "releaseCandidateDigest",
    "registry",
    "packageName",
    "version",
    "requestedTarballDigest",
    "requestedTarballIntegrity",
    "transport",
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
    "publicationIntentDigest",
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
  validateGithubTransport(value.transport, publicationIntent);
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
    publicationIntentDigest: publicationIntent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    registry: releaseCandidate.registry,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    requestedTarballDigest: releaseCandidate.tarballDigest,
    requestedTarballIntegrity: releaseCandidate.tarballIntegrity,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("PUBLICATION_BINDING_MISMATCH", `PublicationObservation.${field} differs from PublicationIntent or ReleaseCandidate`);
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
  if (Date.parse(value.requestStartedAt) > Date.parse(publicationIntent.publishBy)) {
    throw contractError("PUBLICATION_DEADLINE", "publish request began after PublicationIntent.publishBy");
  }
  if (value.observationDigest !== computePublicationObservationDigest(value)) {
    throw contractError("PUBLICATION_OBSERVATION_DIGEST_MISMATCH", "PublicationObservation digest does not match its body");
  }
  return immutable(value);
}

function createCanonicalClosureProjection({
  sliceAuthorization,
  integratedCandidate,
  releaseCandidate,
  terminalAssessment,
  publicationIntent,
  publicationObservation,
}) {
  const draft = {
    schemaVersion: CANONICAL_CLOSURE_SCHEMA,
    repositoryId: sliceAuthorization.repositoryId,
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: terminalAssessment.sliceAcceptanceDigest,
    terminalAssessmentDigest: terminalAssessment.terminalAssessmentDigest,
    publicationIntentDigest: publicationIntent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    finalCommit: integratedCandidate.finalHeadRevision,
    finalTree: integratedCandidate.finalTreeDigest,
    tarballDigest: releaseCandidate.tarballDigest,
    publicationObservationDigest: publicationObservation.observationDigest,
    publicationState: publicationObservation.disposition,
    closedAt: publicationObservation.observedAt,
    nextSliceState: "AWAITING_OWNER_AUTHORIZATION",
    projectionDigest: "pending",
  };
  draft.projectionDigest = computeCanonicalClosureProjectionDigest(draft);
  return validateCanonicalClosureProjection(draft, {
    sliceAuthorization,
    integratedCandidate,
    releaseCandidate,
    terminalAssessment,
    publicationIntent,
    publicationObservation,
  });
}

function validateCanonicalClosureProjection(value, {
  sliceAuthorization,
  integratedCandidate,
  releaseCandidate,
  terminalAssessment,
  publicationIntent,
  publicationObservation,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "repositoryId",
    "sliceId",
    "generation",
    "sliceAcceptanceDigest",
    "terminalAssessmentDigest",
    "publicationIntentDigest",
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
    "publicationIntentDigest",
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
    publicationIntentDigest: publicationIntent.intentDigest,
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
  createCanonicalClosureProjection,
  validateCanonicalClosureProjection,
  validatePublicationObservation,
};
