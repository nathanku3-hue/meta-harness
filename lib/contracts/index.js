"use strict";

/** Meta-Harness 0.4 public verification and controller contract surface. */

const repositoryState = require("../semantic-kernel/repository-state");
const ownerPin = require("../semantic-kernel/owner-pin");
const activeSliceIndex = require("../semantic-kernel/active-slice-index");
const legacyCutoff = require("../semantic-kernel/legacy-cutoff");
const sliceAuthorization = require("../semantic-kernel/slice-authorization");
const gScope = require("../semantic-kernel/g-scope");
const publicationException = require("../semantic-kernel/publication-exception");
const sliceActivation = require("../semantic-kernel/slice-activation");
const operationBundle = require("../semantic-kernel/operation-bundle");
const runSpec = require("../semantic-kernel/run-spec-v2");
const mechanicsAssessment = require("../semantic-kernel/mechanics-assessment");
const sliceState = require("../semantic-kernel/slice-state");
const integratedCandidate = require("../semantic-kernel/integrated-candidate");
const releaseCandidate = require("../semantic-kernel/release-candidate");
const blackBoxProof = require("../semantic-kernel/black-box-proof");
const reviewerAssessment = require("../semantic-kernel/reviewer-assessment");
const terminalAssessment = require("../semantic-kernel/terminal-slice-assessment");
const publicationIntent = require("../semantic-kernel/publication-intent");
const publication = require("../semantic-kernel/publication");
const controllerBinding = require("../semantic-kernel/controller-binding");
const semanticController = require("../semantic-kernel/semantic-controller");

module.exports = {
  resolveRepositoryIdentity: repositoryState.resolveRepositoryIdentity,
  resolveRepositoryStateRoot: repositoryState.resolveRepositoryStateRoot,

  bootstrapOwnerPin: ownerPin.bootstrapOwnerPin,
  loadOwnerPin: ownerPin.loadOwnerPin,
  ownerPublicKeyDigest: ownerPin.ownerPublicKeyDigest,
  validateOwnerPin: ownerPin.validateOwnerPin,

  readActiveSliceIndex: activeSliceIndex.readActiveSliceIndex,
  takeoverExpiredSliceLease: activeSliceIndex.takeoverExpiredLease,

  rejectRetiredObject: legacyCutoff.rejectRetiredObject,

  SLICE_AUTHORIZATION_SCHEMA: sliceAuthorization.SLICE_AUTHORIZATION_SCHEMA,
  EXPLICIT_OWNER_AUTHORIZATION: sliceAuthorization.EXPLICIT_OWNER_AUTHORIZATION,
  computeSliceAcceptanceDigest: sliceAuthorization.computeSliceAcceptanceDigest,
  computeSliceAuthorizationDigest: sliceAuthorization.computeSliceAuthorizationDigest,
  validateSliceAcceptance: sliceAuthorization.validateSliceAcceptance,
  validateSliceAuthorization: sliceAuthorization.validateSliceAuthorization,

  G_SCOPE_SCHEMA: gScope.G_SCOPE_SCHEMA,
  G_SCOPE_SIGNATURE_DOMAIN: gScope.G_SCOPE_SIGNATURE_DOMAIN,
  computeGScopeDigest: gScope.computeGScopeDigest,
  validateGScopeDecision: gScope.validateGScopeDecision,
  validateSliceAuthorizationReplacement: gScope.validateSliceAuthorizationReplacement,

  PUBLICATION_EXCEPTION_SCHEMA: publicationException.PUBLICATION_EXCEPTION_SCHEMA,
  PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN: publicationException.PUBLICATION_EXCEPTION_SIGNATURE_DOMAIN,
  computePublicationExceptionDigest: publicationException.computePublicationExceptionDigest,
  validatePublicationException: publicationException.validatePublicationException,

  SLICE_ACTIVATION_SCHEMA: sliceActivation.SLICE_ACTIVATION_SCHEMA,
  computeSliceActivationDigest: sliceActivation.computeSliceActivationDigest,
  validateSliceActivation: sliceActivation.validateSliceActivation,

  OPERATION_EVENT_SCHEMA: operationBundle.OPERATION_EVENT_SCHEMA,
  validateOperationEvent: operationBundle.validateOperationEvent,
  validateOperationBundle: operationBundle.validateOperationBundle,

  RUN_SPEC_SCHEMA: runSpec.RUN_SPEC_SCHEMA,
  computeRunSpecDigest: runSpec.computeRunSpecDigest,
  validateRunSpec: runSpec.validateRunSpec,

  MECHANICS_ASSESSMENT_SCHEMA: mechanicsAssessment.MECHANICS_ASSESSMENT_SCHEMA,
  MECHANICS_VERDICT: mechanicsAssessment.MECHANICS_VERDICT,
  computeMechanicsAssessmentDigest: mechanicsAssessment.computeMechanicsAssessmentDigest,
  validateMechanicsAssessment: mechanicsAssessment.validateMechanicsAssessment,

  SLICE_STATE_SCHEMA: sliceState.SLICE_STATE_SCHEMA,
  computeSliceStateDigest: sliceState.computeSliceStateDigest,
  validateSliceState: sliceState.validateSliceState,
  validateSliceStateTransition: sliceState.validateSliceStateTransition,

  INTEGRATED_CANDIDATE_SCHEMA: integratedCandidate.INTEGRATED_CANDIDATE_SCHEMA,
  computeIntegratedCandidateDigest: integratedCandidate.computeIntegratedCandidateDigest,
  validateIntegratedCandidate: integratedCandidate.validateIntegratedCandidate,

  PACKAGE_CANDIDATE_SCHEMA: releaseCandidate.PACKAGE_CANDIDATE_SCHEMA,
  RELEASE_CANDIDATE_SCHEMA: releaseCandidate.RELEASE_CANDIDATE_SCHEMA,
  computePackageCandidateDigest: releaseCandidate.computePackageCandidateDigest,
  computeReleaseCandidateDigest: releaseCandidate.computeReleaseCandidateDigest,
  validatePackageCandidate: releaseCandidate.validatePackageCandidate,
  validateReleaseCandidate: releaseCandidate.validateReleaseCandidate,

  BLACK_BOX_PROOF_SCHEMA: blackBoxProof.BLACK_BOX_PROOF_SCHEMA,
  computeBlackBoxProofDigest: blackBoxProof.computeBlackBoxProofDigest,
  computeProofOracleDigest: blackBoxProof.computeProofOracleDigest,
  validateBlackBoxProof: blackBoxProof.validateBlackBoxProof,

  REVIEWER_ASSESSMENT_SCHEMA: reviewerAssessment.REVIEWER_ASSESSMENT_SCHEMA,
  computeReviewInputManifestDigest: reviewerAssessment.computeReviewInputManifestDigest,
  computeReviewerAssessmentDigest: reviewerAssessment.computeReviewerAssessmentDigest,
  validateReviewerAssessment: reviewerAssessment.validateReviewerAssessment,

  TERMINAL_SLICE_ASSESSMENT_SCHEMA: terminalAssessment.TERMINAL_SLICE_ASSESSMENT_SCHEMA,
  TERMINAL_VERDICT: terminalAssessment.TERMINAL_VERDICT,
  computeTerminalSliceAssessmentDigest: terminalAssessment.computeTerminalSliceAssessmentDigest,
  validateTerminalSliceAssessment: terminalAssessment.validateTerminalSliceAssessment,

  PUBLICATION_INTENT_SCHEMA: publicationIntent.PUBLICATION_INTENT_SCHEMA,
  computePublicationAssetManifestDigest: publicationIntent.computePublicationAssetManifestDigest,
  computePublicationIntentDigest: publicationIntent.computePublicationIntentDigest,
  createPublicationAssetManifest: publicationIntent.createPublicationAssetManifest,
  validatePublicationIntent: publicationIntent.validatePublicationIntent,
  verifyPublicationAssetFiles: publicationIntent.verifyPublicationAssetFiles,

  PUBLICATION_OBSERVATION_SCHEMA: publication.PUBLICATION_OBSERVATION_SCHEMA,
  CANONICAL_CLOSURE_SCHEMA: publication.CANONICAL_CLOSURE_SCHEMA,
  computePublicationObservationDigest: publication.computePublicationObservationDigest,
  computeCanonicalClosureProjectionDigest: publication.computeCanonicalClosureProjectionDigest,
  createCanonicalClosureProjection: publication.createCanonicalClosureProjection,
  validatePublicationObservation: publication.validatePublicationObservation,
  validateCanonicalClosureProjection: publication.validateCanonicalClosureProjection,

  resolveInstalledControllerBinding: controllerBinding.resolveInstalledControllerBinding,
  activateSlice: semanticController.activateSlice,
  takeoverSliceLease: semanticController.takeoverSliceLease,
  reserveExecutionAttempt: semanticController.reserveExecutionAttempt,
  sealRunSpec: semanticController.sealRunSpec,
  recordMechanicsAssessment: semanticController.recordMechanicsAssessment,
  recordTerminalCandidate: semanticController.recordTerminalCandidate,
  recordTerminalAssessment: semanticController.recordTerminalAssessment,
  recordPublicationIntent: semanticController.recordPublicationIntent,
  recordPublicationObservation: semanticController.recordPublicationObservation,
  closeSlice: semanticController.closeSlice,
  transitionSliceState: semanticController.transitionSliceState,
};
