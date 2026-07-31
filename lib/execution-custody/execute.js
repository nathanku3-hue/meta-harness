"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  exactKeys,
  isOrdinaryPlainObject,
} = require("../contracts/canonical-json");
const { rejectRetiredObject } = require("../semantic-kernel/legacy-cutoff");
const { rejectRequestClockControls } = require("../semantic-kernel/clock");
const { resolveRepositoryStateRoot } = require("../semantic-kernel/repository-state");
const {
  readActiveSliceIndex,
  yieldActiveLease,
} = require("../semantic-kernel/active-slice-index");
const {
  activateSlice,
  certifyCandidate,
  closeSlice,
  recordMechanicsAssessment,
  recordPublicationObservation,
  recordTerminalAssessment,
  recordTerminalCandidate,
  reserveExecutionAttempt,
  sealRunSpec,
  takeoverSliceLease,
} = require("../semantic-kernel/semantic-controller");
const { createControllerInstanceId } = require("../semantic-kernel/clock");
const { contractError, immutable } = require("../semantic-kernel/contract-utils");

const REQUEST_SCHEMA = "meta-harness-execution-request/v2";
const RESULT_SCHEMA = "meta-harness-execute-result/v2";
const ACTIONS = Object.freeze(new Set([
  "ACTIVATE_SLICE",
  "SEAL_RUN_SPEC",
  "RECORD_MECHANICS",
  "CERTIFY_CANDIDATE",
  "RECORD_TERMINAL_CANDIDATE",
  "RECORD_PUBLICATION_OBSERVATION",
  "CLOSE_SLICE",
]));
const PAYLOAD_KEYS = Object.freeze({
  ACTIVATE_SLICE: Object.freeze([]),
  SEAL_RUN_SPEC: Object.freeze(["runSpec"]),
  RECORD_MECHANICS: Object.freeze(["runSpec", "expectedContributedRevision"]),
  CERTIFY_CANDIDATE: Object.freeze(["integratedCandidate", "certificationRequest"]),
  RECORD_TERMINAL_CANDIDATE: Object.freeze([
    "integratedCandidate",
    "packageCandidate",
    "releaseCandidate",
    "proofRequest",
  ]),
  RECORD_PUBLICATION_OBSERVATION: Object.freeze([
    "releaseCandidate",
    "publicationObservation",
  ]),
  CLOSE_SLICE: Object.freeze([
    "integratedCandidate",
    "releaseCandidate",
    "terminalAssessment",
    "publicationObservation",
    "canonicalClosureProjection",
  ]),
});

function requirePlain(value, label) {
  if (!isOrdinaryPlainObject(value)) {
    throw contractError("EXECUTION_REQUEST_OBJECT", `${label} must be a plain object`);
  }
  return value;
}

function validateExecutionRequest(request) {
  requirePlain(request, "execution request");
  rejectRetiredObject(request);
  rejectRequestClockControls(request);
  if (request.schemaVersion !== REQUEST_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `execution request schema must be ${REQUEST_SCHEMA}`);
  }
  for (const forbidden of ["stateRoot", "custodyRoot"]) {
    if (Object.prototype.hasOwnProperty.call(request, forbidden)) {
      throw contractError("CALLER_STATE_ROOT_FORBIDDEN", `${forbidden} is derived by the installed controller`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(request, "repositoryId")) {
    throw contractError("REQUEST_REPOSITORY_ID_FORBIDDEN", "repositoryId is derived from the trusted repository path");
  }
  if (Object.prototype.hasOwnProperty.call(request, "controllerPolicyDigest")) {
    throw contractError("EXECUTION_REQUEST_FORBIDDEN_FIELD", "controllerPolicyDigest is not request-controlled in 0.4");
  }
  if (!exactKeys(request, ["schemaVersion", "action", "sliceAuthorization", "payload"])) {
    throw contractError(
      "EXECUTION_REQUEST_SHAPE",
      "execution request must contain only schemaVersion, action, sliceAuthorization, and payload",
    );
  }
  if (!ACTIONS.has(request.action)) {
    throw contractError("EXECUTION_ACTION_UNSUPPORTED", `unsupported execution action: ${String(request.action)}`);
  }
  requirePlain(request.sliceAuthorization, "execution request SliceAuthorization");
  requirePlain(request.payload, "execution request payload");
  if (!exactKeys(request.payload, PAYLOAD_KEYS[request.action])) {
    throw contractError(
      "EXECUTION_PAYLOAD_SHAPE",
      `${request.action} payload has missing or unexpected fields`,
      { expected: PAYLOAD_KEYS[request.action], actual: Object.keys(request.payload).sort() },
    );
  }
  return immutable(request);
}

function loadExecutionRequestEnvelope(requestPath) {
  if (typeof requestPath !== "string" || !path.isAbsolute(requestPath) || path.normalize(requestPath) !== requestPath) {
    throw contractError("EXECUTION_REQUEST_PATH", "request path must be absolute and normalized");
  }
  let stat;
  try {
    stat = fs.lstatSync(requestPath);
  } catch (error) {
    throw contractError("EXECUTION_REQUEST_READ", `request is unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw contractError("EXECUTION_REQUEST_FILE", "request JSON must be a regular non-symlink file");
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  } catch (error) {
    throw contractError("EXECUTION_REQUEST_JSON", `request JSON is invalid: ${error.message}`);
  }
  return validateExecutionRequest(parsed);
}

function acquireSameSliceLease({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot }) {
  const state = resolveRepositoryStateRoot(repositoryPath);
  const active = readActiveSliceIndex(state.stateRoot);
  if (!active) {
    throw contractError("ACTIVE_SLICE_REQUIRED", "activate the owner-authorized slice before this action");
  }
  if (Date.parse(active.leaseExpiresAt) > Date.now()) {
    throw contractError(
      "ACTIVE_LEASE_HELD",
      "the active slice lease is still held; a replacement controller may take over only after expiry",
      {
        activeSliceId: active.activeSliceId,
        generation: active.activeGeneration,
        leaseExpiresAt: active.leaseExpiresAt,
      },
    );
  }
  return takeoverSliceLease({
    repositoryPath,
    sliceAuthorization,
    expectedPriorIndexDigest: active.indexDigest,
    priorLeaseOwnerClaimDigest: active.leaseOwnerClaimDigest,
    replacementControllerInstanceId: controllerInstanceId,
    packageRoot,
  });
}

function result(action, disposition, details = {}) {
  return immutable({
    schemaVersion: RESULT_SCHEMA,
    action,
    disposition,
    productAcceptance: new Set(["SLICE_CLOSED", "TERMINAL_SLICE_VERIFIED"]).has(disposition)
      ? "TERMINAL_SLICE_VERIFIED"
      : disposition === "CERTIFICATION_VERIFIED"
        ? "CERTIFICATION_VERIFIED"
        : "NOT_EVALUATED",
    ...details,
  });
}

async function executeRequest(requestValue, options = {}) {
  const request = validateExecutionRequest(requestValue);
  const repositoryPath = options.repositoryPath;
  if (typeof repositoryPath !== "string" || !path.isAbsolute(repositoryPath)) {
    throw contractError("EXECUTION_REPOSITORY_PATH", "trusted repositoryPath must be an absolute controller input");
  }
  const controllerInstanceId = createControllerInstanceId();
  let leaseOwned = false;
  try {
    if (request.action === "ACTIVATE_SLICE") {
      const activated = activateSlice({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      leaseOwned = true;
      return result(request.action, "SLICE_ACTIVE", {
        sliceId: activated.authorization.sliceId,
        generation: activated.activation.generation,
        activationDigest: activated.activation.activationDigest,
        stateDigest: activated.initialState.stateDigest,
        operationEventDigest: activated.operation.event.eventDigest,
      });
    }

    acquireSameSliceLease({
      repositoryPath,
      sliceAuthorization: request.sliceAuthorization,
      controllerInstanceId,
      packageRoot: options.packageRoot,
    });
    leaseOwned = true;

    if (request.action === "SEAL_RUN_SPEC") {
      const attemptIndex = reserveExecutionAttempt({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      const sealed = sealRunSpec({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        runSpec: request.payload.runSpec,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, "RUN_SPEC_SEALED", {
        sliceId: sealed.runSpec.sliceId,
        generation: sealed.runSpec.generation,
        runSpecDigest: sealed.runSpec.runSpecDigest,
        operationEventDigest: sealed.operation.event.eventDigest,
        attemptCount: attemptIndex.attemptCount,
      });
    }

    if (request.action === "RECORD_MECHANICS") {
      const recorded = recordMechanicsAssessment({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        runSpec: request.payload.runSpec,
        expectedContributedRevision: request.payload.expectedContributedRevision,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, "MECHANICS_VERIFIED", {
        sliceId: recorded.mechanicsAssessment.sliceId,
        generation: recorded.mechanicsAssessment.generation,
        mechanicsAssessmentDigest: recorded.mechanicsAssessment.assessmentDigest,
        contributedRevision: recorded.mechanicsAssessment.contributedRevision,
        operationEventDigest: recorded.operation.event.eventDigest,
      });
    }

    if (request.action === "CERTIFY_CANDIDATE") {
      const certified = certifyCandidate({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        integratedCandidate: request.payload.integratedCandidate,
        certificationRequest: request.payload.certificationRequest,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, certified.assessment.verdict, {
        sliceId: certified.integrated.sliceId,
        generation: certified.integrated.generation,
        integratedCandidateDigest: certified.integrated.candidateDigest,
        certificationCandidateDigest: certified.certificationCandidate.certificationCandidateDigest,
        certificationProofDigest: certified.proof.proofDigest,
        certificationAssessmentDigest: certified.assessment.assessmentDigest,
      });
    }

    if (request.action === "RECORD_TERMINAL_CANDIDATE") {
      const recorded = recordTerminalCandidate({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        integratedCandidate: request.payload.integratedCandidate,
        packageCandidate: request.payload.packageCandidate,
        releaseCandidate: request.payload.releaseCandidate,
        proofRequest: request.payload.proofRequest,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      const assessed = recordTerminalAssessment({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        integratedCandidate: recorded.integrated,
        packageCandidate: recorded.packageCandidate,
        releaseCandidate: recorded.releaseCandidate,
        blackBoxProof: recorded.proof,
        reviewerAssessments: recorded.reviews,
        terminalAssessment: recorded.terminalAssessment,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, assessed.terminalAssessment.verdict, {
        sliceId: recorded.integrated.sliceId,
        generation: recorded.integrated.generation,
        integratedCandidateDigest: recorded.integrated.candidateDigest,
        releaseCandidateDigest: recorded.releaseCandidate.releaseCandidateDigest,
        terminalCandidateDigest: recorded.transition.state.terminalCandidateDigest,
        terminalAssessmentDigest: assessed.terminalAssessment.terminalAssessmentDigest,
      });
    }

    if (request.action === "RECORD_PUBLICATION_OBSERVATION") {
      const recorded = recordPublicationObservation({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        releaseCandidate: request.payload.releaseCandidate,
        publicationObservation: request.payload.publicationObservation,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, recorded.publicationObservation.disposition, {
        sliceId: recorded.publicationObservation.sliceId,
        generation: recorded.publicationObservation.generation,
        publicationObservationDigest: recorded.publicationObservation.observationDigest,
      });
    }

    const closed = closeSlice({
      repositoryPath,
      sliceAuthorization: request.sliceAuthorization,
      integratedCandidate: request.payload.integratedCandidate,
      releaseCandidate: request.payload.releaseCandidate,
      terminalAssessment: request.payload.terminalAssessment,
      publicationObservation: request.payload.publicationObservation,
      canonicalClosureProjection: request.payload.canonicalClosureProjection,
      controllerInstanceId,
      packageRoot: options.packageRoot,
    });
    return result(request.action, "SLICE_CLOSED", {
      sliceId: closed.canonicalClosureProjection.sliceId,
      generation: closed.canonicalClosureProjection.generation,
      projectionDigest: closed.canonicalClosureProjection.projectionDigest,
      nextSliceState: closed.canonicalClosureProjection.nextSliceState,
    });
  } finally {
    if (leaseOwned) {
      try {
        const state = resolveRepositoryStateRoot(repositoryPath);
        const active = readActiveSliceIndex(state.stateRoot);
        if (active && active.leaseControllerInstanceId === controllerInstanceId) {
          yieldActiveLease({
            stateRoot: state.stateRoot,
            expectedPriorIndexDigest: active.indexDigest,
            controllerInstanceId,
          });
        }
      } catch {
        // The active slice remains authoritative; failed yield falls back to expiry-based same-slice takeover.
      }
    }
  }
}

module.exports = {
  ACTIONS,
  PAYLOAD_KEYS,
  REQUEST_SCHEMA,
  RESULT_SCHEMA,
  executeRequest,
  loadExecutionRequestEnvelope,
  validateExecutionRequest,
};
