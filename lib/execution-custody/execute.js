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
  "RECORD_TERMINAL_CANDIDATE",
  "RECORD_TERMINAL_ASSESSMENT",
  "RECORD_PUBLICATION_OBSERVATION",
  "CLOSE_SLICE",
]));
const PAYLOAD_KEYS = Object.freeze({
  ACTIVATE_SLICE: Object.freeze([]),
  SEAL_RUN_SPEC: Object.freeze(["runSpec"]),
  RECORD_MECHANICS: Object.freeze(["runSpec", "mechanicsAssessment"]),
  RECORD_TERMINAL_CANDIDATE: Object.freeze([
    "integratedCandidate",
    "mechanicsAssessments",
    "packageCandidate",
    "releaseCandidate",
    "blackBoxProof",
    "reviewerAssessments",
    "implementationProcessId",
  ]),
  RECORD_TERMINAL_ASSESSMENT: Object.freeze([
    "integratedCandidate",
    "packageCandidate",
    "releaseCandidate",
    "blackBoxProof",
    "reviewerAssessments",
    "terminalAssessment",
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
  for (const forbidden of [
    "stateRoot",
    "custodyRoot",
    "repositoryId",
    "controllerPolicyDigest",
    "clock",
    "now",
    "timeProvider",
  ]) {
    if (Object.prototype.hasOwnProperty.call(request, forbidden)) {
      throw contractError("EXECUTION_REQUEST_FORBIDDEN_FIELD", `${forbidden} is not request-controlled in 0.4`);
    }
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
    throw contractError("EXECUTION_REQUEST_FILE", "request must be a regular non-symlink JSON file");
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
    productAcceptance: disposition === "SLICE_CLOSED" ? "TERMINAL_SLICE_VERIFIED" : "NOT_EVALUATED",
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
        mechanicsAssessment: request.payload.mechanicsAssessment,
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

    if (request.action === "RECORD_TERMINAL_CANDIDATE") {
      const mechanicsByDigest = new Map(
        request.payload.mechanicsAssessments.map((assessment) => [assessment.assessmentDigest, assessment]),
      );
      const recorded = recordTerminalCandidate({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        integratedCandidate: request.payload.integratedCandidate,
        mechanicsByDigest,
        packageCandidate: request.payload.packageCandidate,
        releaseCandidate: request.payload.releaseCandidate,
        blackBoxProof: request.payload.blackBoxProof,
        reviewerAssessments: request.payload.reviewerAssessments,
        implementationProcessId: request.payload.implementationProcessId,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, "TERMINAL_CANDIDATE", {
        sliceId: recorded.integrated.sliceId,
        generation: recorded.integrated.generation,
        integratedCandidateDigest: recorded.integrated.candidateDigest,
        releaseCandidateDigest: recorded.releaseCandidate.releaseCandidateDigest,
        terminalCandidateDigest: recorded.transition.state.terminalCandidateDigest,
      });
    }

    if (request.action === "RECORD_TERMINAL_ASSESSMENT") {
      const recorded = recordTerminalAssessment({
        repositoryPath,
        sliceAuthorization: request.sliceAuthorization,
        integratedCandidate: request.payload.integratedCandidate,
        packageCandidate: request.payload.packageCandidate,
        releaseCandidate: request.payload.releaseCandidate,
        blackBoxProof: request.payload.blackBoxProof,
        reviewerAssessments: request.payload.reviewerAssessments,
        terminalAssessment: request.payload.terminalAssessment,
        controllerInstanceId,
        packageRoot: options.packageRoot,
      });
      return result(request.action, recorded.terminalAssessment.verdict, {
        sliceId: recorded.terminalAssessment.sliceId,
        generation: recorded.terminalAssessment.generation,
        terminalAssessmentDigest: recorded.terminalAssessment.terminalAssessmentDigest,
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
