"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");

const SLICE_STATE_SCHEMA = "slice-state/v1";
const SLICE_STATE_DOMAIN = "meta-harness-slice-state/v1";
const STAGES = Object.freeze([
  "AUTHORIZED",
  "ACTIVE",
  "TERMINAL_CANDIDATE",
  "TERMINAL_VERIFIED",
  "PUBLISHED",
  "CLOSED",
  "ABORTED",
]);
const STAGE_ORDER = Object.freeze(new Map(STAGES.map((stage, index) => [stage, index])));
const TERMINAL_STAGES = Object.freeze(new Set(["CLOSED", "ABORTED"]));
const KEYS = Object.freeze([
  "schemaVersion",
  "repositoryId",
  "sliceId",
  "generation",
  "stage",
  "sliceAuthorizationDigest",
  "acceptanceDigest",
  "activationDigest",
  "terminalCandidateDigest",
  "releaseCandidateDigest",
  "certificationCandidateDigest",
  "terminalAssessmentDigest",
  "publicationObservationDigest",
  "priorStateDigest",
  "supersedesGenerationDigest",
  "stateDigest",
]);

function requireNullableDigest(value, label) {
  if (value === null) return;
  requireDigest(value, label);
}

function stateBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.stateDigest;
  return body;
}

function computeSliceStateDigest(value) {
  return domainDigest(SLICE_STATE_DOMAIN, stateBody(value));
}

function validateArtifactFields(value) {
  for (const field of [
    "activationDigest",
    "terminalCandidateDigest",
    "releaseCandidateDigest",
    "certificationCandidateDigest",
    "terminalAssessmentDigest",
    "publicationObservationDigest",
    "priorStateDigest",
    "supersedesGenerationDigest",
  ]) requireNullableDigest(value[field], `SliceState.${field}`);
  if (value.certificationCandidateDigest !== null) {
    throw contractError(
      "SLICE_STATE_RETIRED_AUTHORITY_EVIDENCE",
      "certificationCandidateDigest is retained only as a null historical compatibility field",
    );
  }

  const requirePresent = (field) => {
    if (value[field] === null) {
      throw contractError("SLICE_STATE_EVIDENCE_MISSING", `${field} is required at stage ${value.stage}`);
    }
  };
  if (value.stage !== "AUTHORIZED") requirePresent("activationDigest");
  const deliveryStages = new Set(["TERMINAL_CANDIDATE", "TERMINAL_VERIFIED", "PUBLISHED", "CLOSED"]);
  if (deliveryStages.has(value.stage)) {
    requirePresent("terminalCandidateDigest");
    requirePresent("releaseCandidateDigest");
  }
  if (new Set(["TERMINAL_VERIFIED", "PUBLISHED", "CLOSED"]).has(value.stage)) {
    requirePresent("terminalAssessmentDigest");
  }
  if (new Set(["PUBLISHED", "CLOSED"]).has(value.stage)) {
    requirePresent("publicationObservationDigest");
  }
}

function validateSliceState(value) {
  requireExactKeys(value, KEYS, "SliceState");
  if (value.schemaVersion !== SLICE_STATE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `SliceState schema must be ${SLICE_STATE_SCHEMA}`);
  }
  requireDigest(value.repositoryId, "SliceState.repositoryId");
  requireNonEmptyString(value.sliceId, "SliceState.sliceId");
  requireInteger(value.generation, "SliceState.generation", { min: 1 });
  if (!STAGE_ORDER.has(value.stage)) {
    throw contractError("SLICE_STATE_STAGE_INVALID", `unsupported SliceState stage: ${value.stage}`);
  }
  requireDigest(value.sliceAuthorizationDigest, "SliceState.sliceAuthorizationDigest");
  requireDigest(value.acceptanceDigest, "SliceState.acceptanceDigest");
  validateArtifactFields(value);
  requireDigest(value.stateDigest, "SliceState.stateDigest");
  if (value.stateDigest !== computeSliceStateDigest(value)) {
    throw contractError("SLICE_STATE_DIGEST_MISMATCH", "SliceState digest does not match its body");
  }
  if (value.generation === 1 && value.supersedesGenerationDigest !== null) {
    throw contractError("SLICE_STATE_SUPERSESSION_INVALID", "generation 1 cannot supersede another generation");
  }
  if (value.stage === "AUTHORIZED" && value.activationDigest !== null) {
    throw contractError("SLICE_STATE_ACTIVATION_PREMATURE", "AUTHORIZED state cannot already bind activation");
  }
  return immutable(value);
}

function validateSliceStateTransition(priorValue, nextValue) {
  const prior = validateSliceState(priorValue);
  const next = validateSliceState(nextValue);
  for (const field of ["repositoryId", "sliceId", "sliceAuthorizationDigest", "acceptanceDigest"]) {
    if (next[field] !== prior[field]) {
      throw contractError("SLICE_STATE_IDENTITY_CHANGE", `SliceState transition changed immutable field ${field}`);
    }
  }
  if (next.priorStateDigest !== prior.stateDigest) {
    throw contractError("SLICE_STATE_PREDECESSOR_MISMATCH", "SliceState transition does not bind the prior state digest");
  }
  if (TERMINAL_STAGES.has(prior.stage)) {
    throw contractError("SLICE_STATE_ALREADY_TERMINAL", `cannot transition a ${prior.stage} slice`);
  }

  if (next.generation === prior.generation) {
    if (next.supersedesGenerationDigest !== prior.supersedesGenerationDigest) {
      throw contractError("SLICE_STATE_SUPERSESSION_CHANGE", "same-generation transition changed supersession identity");
    }
    if (next.stage === "ABORTED") return next;
    if (STAGE_ORDER.get(next.stage) <= STAGE_ORDER.get(prior.stage)) {
      throw contractError("SLICE_STATE_NON_MONOTONIC", "stages must advance monotonically within a generation");
    }
    return next;
  }

  if (next.generation !== prior.generation + 1) {
    throw contractError("SLICE_STATE_GENERATION_INVALID", "candidate mutation must advance generation by exactly one");
  }
  if (next.stage !== "ACTIVE") {
    throw contractError("SLICE_STATE_GENERATION_STAGE", "a new generation must restart at ACTIVE");
  }
  if (next.supersedesGenerationDigest !== prior.stateDigest) {
    throw contractError("SLICE_STATE_SUPERSESSION_MISMATCH", "new generation must bind the superseded generation digest");
  }
  if (next.terminalCandidateDigest !== null
    || next.releaseCandidateDigest !== null
    || next.certificationCandidateDigest !== null
    || next.terminalAssessmentDigest !== null
    || next.publicationObservationDigest !== null) {
    throw contractError("SLICE_STATE_GENERATION_EVIDENCE", "new generation cannot reuse terminal evidence from an earlier generation");
  }
  return next;
}

module.exports = {
  KEYS,
  SLICE_STATE_DOMAIN,
  SLICE_STATE_SCHEMA,
  STAGES,
  STAGE_ORDER,
  TERMINAL_STAGES,
  computeSliceStateDigest,
  stateBody,
  validateSliceState,
  validateSliceStateTransition,
};
