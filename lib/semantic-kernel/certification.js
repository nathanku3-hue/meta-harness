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
const {
  computeProofOracleDigest,
  validateOperatorActions,
  validateQuantitativeEvaluations,
} = require("./black-box-proof");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const CERTIFICATION_CANDIDATE_SCHEMA = "certification-candidate/v1";
const CERTIFICATION_CANDIDATE_DOMAIN = "meta-harness-certification-candidate/v1";
const CERTIFICATION_PROOF_SCHEMA = "certification-proof/v1";
const CERTIFICATION_PROOF_DOMAIN = "meta-harness-certification-proof/v1";
const CERTIFICATION_REVIEW_SCHEMA = "certification-reviewer-assessment/v1";
const CERTIFICATION_REVIEW_DOMAIN = "meta-harness-certification-reviewer-assessment/v1";
const CERTIFICATION_REVIEW_MANIFEST_DOMAIN = "meta-harness-certification-review-input-manifest/v1";
const CERTIFICATION_ASSESSMENT_SCHEMA = "certification-assessment/v1";
const CERTIFICATION_ASSESSMENT_DOMAIN = "meta-harness-certification-assessment/v1";
const CERTIFICATION_VERDICT = "CERTIFICATION_VERIFIED";
const REVIEW_ROLES = Object.freeze(new Map([
  ["PRODUCT", "product"],
  ["DOMAIN", "domain"],
  ["CUSTODY", "custody"],
]));
const FAILURE_VERDICTS = Object.freeze(new Set([
  "PRODUCT_REVIEW_FAILED",
  "DOMAIN_REVIEW_FAILED",
  "CUSTODY_REVIEW_FAILED",
]));

function cloneWithout(value, field) {
  const body = JSON.parse(JSON.stringify(value));
  delete body[field];
  return body;
}

function requireObjectId(value, label) {
  requireNonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw contractError("CERTIFICATION_OBJECT_ID_INVALID", `${label} must be a lowercase Git object ID`);
  }
}

function requireRelativePath(value, label) {
  requireNonEmptyString(value, label);
  if (value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw contractError("CERTIFICATION_PATH_INVALID", `${label} must be normalized and repository-relative`);
  }
}

function computeCertificationCandidateDigest(value) {
  return domainDigest(CERTIFICATION_CANDIDATE_DOMAIN, cloneWithout(value, "certificationCandidateDigest"));
}

function validateCertificationCandidate(value, integratedCandidate, sliceAuthorization) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "integratedCandidateDigest",
    "candidateHead",
    "candidateTree",
    "installedEnvironmentIdentityDigest",
    "dependencyLockDigest",
    "applicationEntryPoint",
    "environmentManifestDigest",
    "preparedAt",
    "certificationCandidateDigest",
  ], "CertificationCandidate");
  if (value.schemaVersion !== CERTIFICATION_CANDIDATE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `CertificationCandidate schema must be ${CERTIFICATION_CANDIDATE_SCHEMA}`);
  }
  if (sliceAuthorization.sliceMode !== "CERTIFICATION") {
    throw contractError("CERTIFICATION_MODE_REQUIRED", "CertificationCandidate requires a CERTIFICATION authorization");
  }
  requireNonEmptyString(value.sliceId, "CertificationCandidate.sliceId");
  requireInteger(value.generation, "CertificationCandidate.generation", { min: 1 });
  for (const field of [
    "integratedCandidateDigest",
    "installedEnvironmentIdentityDigest",
    "dependencyLockDigest",
    "environmentManifestDigest",
    "certificationCandidateDigest",
  ]) requireDigest(value[field], `CertificationCandidate.${field}`);
  requireObjectId(value.candidateHead, "CertificationCandidate.candidateHead");
  requireObjectId(value.candidateTree, "CertificationCandidate.candidateTree");
  requireRelativePath(value.applicationEntryPoint, "CertificationCandidate.applicationEntryPoint");
  requireExactUtc(value.preparedAt, "CertificationCandidate.preparedAt");
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    candidateHead: integratedCandidate.finalHeadRevision,
    candidateTree: integratedCandidate.finalTreeDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("CERTIFICATION_CANDIDATE_BINDING_MISMATCH", `CertificationCandidate.${field} differs from integrated candidate`);
    }
  }
  if (Date.parse(value.preparedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("CERTIFICATION_CANDIDATE_DEADLINE", "CertificationCandidate was prepared after mustCompleteBy");
  }
  if (value.certificationCandidateDigest !== computeCertificationCandidateDigest(value)) {
    throw contractError("CERTIFICATION_CANDIDATE_DIGEST_MISMATCH", "CertificationCandidate digest does not match its body");
  }
  return immutable(value);
}

function computeCertificationProofDigest(value) {
  return domainDigest(CERTIFICATION_PROOF_DOMAIN, cloneWithout(value, "proofDigest"));
}

function validateCertificationProof(value, {
  sliceAuthorization,
  integratedCandidate,
  certificationCandidate,
  observedEvaluatorDigest,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "executionSurface",
    "operatorActions",
    "inputIdentityDigest",
    "fixtureIdentityDigest",
    "observationTranscriptDigest",
    "quantitativeEvaluations",
    "proofOracleDigest",
    "evaluatorExecutableDigest",
    "noImplementationWorkerExpectedOutput",
    "executedAt",
    "proofDigest",
  ], "CertificationProof");
  if (value.schemaVersion !== CERTIFICATION_PROOF_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `CertificationProof schema must be ${CERTIFICATION_PROOF_SCHEMA}`);
  }
  if (sliceAuthorization.sliceMode !== "CERTIFICATION") {
    throw contractError("CERTIFICATION_MODE_REQUIRED", "CertificationProof requires a CERTIFICATION authorization");
  }
  requireNonEmptyString(value.sliceId, "CertificationProof.sliceId");
  requireInteger(value.generation, "CertificationProof.generation", { min: 1 });
  for (const field of [
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "inputIdentityDigest",
    "fixtureIdentityDigest",
    "observationTranscriptDigest",
    "proofOracleDigest",
    "evaluatorExecutableDigest",
    "proofDigest",
  ]) requireDigest(value[field], `CertificationProof.${field}`);
  requireExactKeys(value.executionSurface, [
    "type",
    "candidateHead",
    "candidateTree",
    "installedEnvironmentIdentityDigest",
    "dependencyLockDigest",
    "applicationEntryPoint",
  ], "CertificationProof.executionSurface");
  if (value.executionSurface.type !== "repository-application") {
    throw contractError("CERTIFICATION_SURFACE_INVALID", "CertificationProof must execute a repository application");
  }
  requireObjectId(value.executionSurface.candidateHead, "executionSurface.candidateHead");
  requireObjectId(value.executionSurface.candidateTree, "executionSurface.candidateTree");
  requireDigest(value.executionSurface.installedEnvironmentIdentityDigest, "executionSurface.installedEnvironmentIdentityDigest");
  requireDigest(value.executionSurface.dependencyLockDigest, "executionSurface.dependencyLockDigest");
  requireRelativePath(value.executionSurface.applicationEntryPoint, "executionSurface.applicationEntryPoint");
  validateOperatorActions(value.operatorActions, sliceAuthorization.sliceAcceptance.operatorUserFlow);
  validateQuantitativeEvaluations(
    value.quantitativeEvaluations,
    sliceAuthorization.sliceAcceptance.proofOracle.predicateIds,
    sliceAuthorization.sliceAcceptance.quantitativeBounds,
  );
  const oracle = sliceAuthorization.sliceAcceptance.proofOracle;
  if (value.proofOracleDigest !== computeProofOracleDigest(oracle)) {
    throw contractError("CERTIFICATION_ORACLE_DIGEST_MISMATCH", "CertificationProof oracle differs from owner-authorized bytes");
  }
  if (value.evaluatorExecutableDigest !== oracle.evaluatorArtifactDigest
    || observedEvaluatorDigest !== oracle.evaluatorArtifactDigest) {
    throw contractError("CERTIFICATION_EVALUATOR_MISMATCH", "Certification evaluator differs from owner-authorized bytes");
  }
  if (requireBoolean(value.noImplementationWorkerExpectedOutput, "CertificationProof.noImplementationWorkerExpectedOutput") !== true) {
    throw contractError("CERTIFICATION_EXPECTED_OUTPUT_UNTRUSTED", "implementation output cannot supply expected certification output");
  }
  requireExactUtc(value.executedAt, "CertificationProof.executedAt");
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("CERTIFICATION_PROOF_BINDING_MISMATCH", `CertificationProof.${field} differs from certified candidate`);
    }
  }
  const expectedSurface = {
    candidateHead: certificationCandidate.candidateHead,
    candidateTree: certificationCandidate.candidateTree,
    installedEnvironmentIdentityDigest: certificationCandidate.installedEnvironmentIdentityDigest,
    dependencyLockDigest: certificationCandidate.dependencyLockDigest,
    applicationEntryPoint: certificationCandidate.applicationEntryPoint,
  };
  for (const [field, expectedValue] of Object.entries(expectedSurface)) {
    if (value.executionSurface[field] !== expectedValue) {
      throw contractError("CERTIFICATION_SURFACE_BINDING_MISMATCH", `executionSurface.${field} differs from CertificationCandidate`);
    }
  }
  if (Date.parse(value.executedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("CERTIFICATION_PROOF_DEADLINE", "CertificationProof completed after mustCompleteBy");
  }
  if (value.proofDigest !== computeCertificationProofDigest(value)) {
    throw contractError("CERTIFICATION_PROOF_DIGEST_MISMATCH", "CertificationProof digest does not match its body");
  }
  return immutable(value);
}

function computeCertificationReviewInputManifestDigest({
  role,
  sliceAcceptanceDigest,
  integratedCandidateDigest,
  certificationCandidateDigest,
  proofDigest,
  executableDigest,
  policyDigest,
  environmentPolicyDigest,
  networkPolicy,
}) {
  return domainDigest(CERTIFICATION_REVIEW_MANIFEST_DOMAIN, {
    role,
    sliceAcceptanceDigest,
    integratedCandidateDigest,
    certificationCandidateDigest,
    proofDigest,
    executableDigest,
    policyDigest,
    environmentPolicyDigest,
    networkPolicy,
  });
}

function computeCertificationReviewerAssessmentDigest(value) {
  return domainDigest(CERTIFICATION_REVIEW_DOMAIN, cloneWithout(value, "assessmentDigest"));
}

function validateCertificationReviewerAssessment(value, {
  sliceAuthorization,
  integratedCandidate,
  certificationCandidate,
  certificationProof,
  observedExecutableDigest,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "role",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "certificationProofDigest",
    "processId",
    "processExecutableDigest",
    "rolePolicyDigest",
    "environmentPolicyDigest",
    "networkPolicy",
    "inputManifestDigest",
    "readOnlyCandidateAccess",
    "implementationProcessReuse",
    "previousReviewerOutputsVisible",
    "result",
    "findingsDigest",
    "reviewedAt",
    "assessmentDigest",
  ], "CertificationReviewerAssessment");
  if (value.schemaVersion !== CERTIFICATION_REVIEW_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `CertificationReviewerAssessment schema must be ${CERTIFICATION_REVIEW_SCHEMA}`);
  }
  if (!REVIEW_ROLES.has(value.role)) {
    throw contractError("CERTIFICATION_REVIEW_ROLE_INVALID", `unsupported certification reviewer role: ${value.role}`);
  }
  requireNonEmptyString(value.sliceId, "CertificationReviewerAssessment.sliceId");
  requireInteger(value.generation, "CertificationReviewerAssessment.generation", { min: 1 });
  for (const field of [
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "certificationProofDigest",
    "processExecutableDigest",
    "rolePolicyDigest",
    "environmentPolicyDigest",
    "inputManifestDigest",
    "findingsDigest",
    "assessmentDigest",
  ]) requireDigest(value[field], `CertificationReviewerAssessment.${field}`);
  requireNonEmptyString(value.processId, "CertificationReviewerAssessment.processId");
  requireNonEmptyString(value.networkPolicy, "CertificationReviewerAssessment.networkPolicy");
  if (requireBoolean(value.readOnlyCandidateAccess, "CertificationReviewerAssessment.readOnlyCandidateAccess") !== true
    || requireBoolean(value.implementationProcessReuse, "CertificationReviewerAssessment.implementationProcessReuse") !== false
    || requireBoolean(value.previousReviewerOutputsVisible, "CertificationReviewerAssessment.previousReviewerOutputsVisible") !== false) {
    throw contractError("CERTIFICATION_REVIEW_ISOLATION_INVALID", "certification reviewer isolation claims are invalid");
  }
  if (!new Set(["PASS", "FAIL"]).has(value.result)) {
    throw contractError("CERTIFICATION_REVIEW_RESULT_INVALID", "certification review result must be PASS or FAIL");
  }
  requireExactUtc(value.reviewedAt, "CertificationReviewerAssessment.reviewedAt");
  const policy = sliceAuthorization.reviewPolicy[REVIEW_ROLES.get(value.role)];
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
    certificationProofDigest: certificationProof.proofDigest,
    processExecutableDigest: policy.executableDigest,
    rolePolicyDigest: policy.policyDigest,
    environmentPolicyDigest: policy.environmentPolicyDigest,
    networkPolicy: policy.networkPolicy,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("CERTIFICATION_REVIEW_BINDING_MISMATCH", `CertificationReviewerAssessment.${field} differs from owner-bound inputs`);
    }
  }
  if (observedExecutableDigest !== value.processExecutableDigest) {
    throw contractError("CERTIFICATION_REVIEW_EXECUTABLE_MISMATCH", "launched reviewer executable differs from owner-bound digest");
  }
  const expectedManifest = computeCertificationReviewInputManifestDigest({
    role: value.role,
    sliceAcceptanceDigest: value.sliceAcceptanceDigest,
    integratedCandidateDigest: value.integratedCandidateDigest,
    certificationCandidateDigest: value.certificationCandidateDigest,
    proofDigest: value.certificationProofDigest,
    executableDigest: value.processExecutableDigest,
    policyDigest: value.rolePolicyDigest,
    environmentPolicyDigest: value.environmentPolicyDigest,
    networkPolicy: value.networkPolicy,
  });
  if (value.inputManifestDigest !== expectedManifest) {
    throw contractError("CERTIFICATION_REVIEW_MANIFEST_MISMATCH", "certification review manifest digest differs from exact inputs");
  }
  if (Date.parse(value.reviewedAt) < Date.parse(certificationProof.executedAt)) {
    throw contractError("CERTIFICATION_REVIEW_BEFORE_PROOF", "certification review cannot predate proof");
  }
  if (Date.parse(value.reviewedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("CERTIFICATION_REVIEW_DEADLINE", "certification review completed after mustCompleteBy");
  }
  if (value.assessmentDigest !== computeCertificationReviewerAssessmentDigest(value)) {
    throw contractError("CERTIFICATION_REVIEW_DIGEST_MISMATCH", "CertificationReviewerAssessment digest does not match its body");
  }
  return immutable(value);
}

function expectedCertificationVerdict(reviews) {
  if (reviews.PRODUCT.result !== "PASS") return "PRODUCT_REVIEW_FAILED";
  if (reviews.DOMAIN.result !== "PASS") return "DOMAIN_REVIEW_FAILED";
  if (reviews.CUSTODY.result !== "PASS") return "CUSTODY_REVIEW_FAILED";
  return CERTIFICATION_VERDICT;
}

function computeCertificationAssessmentDigest(value) {
  return domainDigest(CERTIFICATION_ASSESSMENT_DOMAIN, cloneWithout(value, "assessmentDigest"));
}

function validateCertificationAssessment(value, {
  sliceAuthorization,
  integratedCandidate,
  certificationCandidate,
  certificationProof,
  reviewerAssessments,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "certificationProofDigest",
    "productReviewDigest",
    "domainReviewDigest",
    "custodyReviewDigest",
    "controllerBindingDigest",
    "assessedAt",
    "verdict",
    "assessmentDigest",
  ], "CertificationAssessment");
  if (value.schemaVersion !== CERTIFICATION_ASSESSMENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `CertificationAssessment schema must be ${CERTIFICATION_ASSESSMENT_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "CertificationAssessment.sliceId");
  requireInteger(value.generation, "CertificationAssessment.generation", { min: 1 });
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "certificationCandidateDigest",
    "certificationProofDigest",
    "productReviewDigest",
    "domainReviewDigest",
    "custodyReviewDigest",
    "controllerBindingDigest",
    "assessmentDigest",
  ]) requireDigest(value[field], `CertificationAssessment.${field}`);
  requireExactUtc(value.assessedAt, "CertificationAssessment.assessedAt");
  if (value.verdict !== CERTIFICATION_VERDICT && !FAILURE_VERDICTS.has(value.verdict)) {
    throw contractError("CERTIFICATION_VERDICT_INVALID", `unsupported certification verdict: ${value.verdict}`);
  }
  const reviews = Object.fromEntries(reviewerAssessments.map((review) => [review.role, review]));
  if (reviewerAssessments.length !== 3 || !reviews.PRODUCT || !reviews.DOMAIN || !reviews.CUSTODY) {
    throw contractError("CERTIFICATION_REVIEW_SET_INVALID", "certification requires PRODUCT, DOMAIN, and CUSTODY reviews");
  }
  const processIds = reviewerAssessments.map((review) => review.processId);
  if (new Set(processIds).size !== processIds.length) {
    throw contractError("CERTIFICATION_REVIEW_PROCESS_REUSE", "certification reviewers must use distinct processes");
  }
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
    certificationProofDigest: certificationProof.proofDigest,
    productReviewDigest: reviews.PRODUCT.assessmentDigest,
    domainReviewDigest: reviews.DOMAIN.assessmentDigest,
    custodyReviewDigest: reviews.CUSTODY.assessmentDigest,
    controllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", sliceAuthorization.controllerBinding),
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("CERTIFICATION_ASSESSMENT_BINDING_MISMATCH", `CertificationAssessment.${field} differs from certification evidence`);
    }
  }
  const expectedVerdict = expectedCertificationVerdict(reviews);
  if (value.verdict !== expectedVerdict) {
    throw contractError("CERTIFICATION_VERDICT_MISMATCH", `certification verdict must be ${expectedVerdict}`);
  }
  for (const review of reviewerAssessments) {
    if (Date.parse(review.reviewedAt) > Date.parse(value.assessedAt)) {
      throw contractError("CERTIFICATION_REVIEW_TIME_INVALID", `${review.role} review postdates certification assessment`);
    }
  }
  if (Date.parse(value.assessedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("CERTIFICATION_ASSESSMENT_DEADLINE", "certification assessment completed after mustCompleteBy");
  }
  if (value.assessmentDigest !== computeCertificationAssessmentDigest(value)) {
    throw contractError("CERTIFICATION_ASSESSMENT_DIGEST_MISMATCH", "CertificationAssessment digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  CERTIFICATION_ASSESSMENT_DOMAIN,
  CERTIFICATION_ASSESSMENT_SCHEMA,
  CERTIFICATION_CANDIDATE_DOMAIN,
  CERTIFICATION_CANDIDATE_SCHEMA,
  CERTIFICATION_PROOF_DOMAIN,
  CERTIFICATION_PROOF_SCHEMA,
  CERTIFICATION_REVIEW_DOMAIN,
  CERTIFICATION_REVIEW_MANIFEST_DOMAIN,
  CERTIFICATION_REVIEW_SCHEMA,
  CERTIFICATION_VERDICT,
  computeCertificationAssessmentDigest,
  computeCertificationCandidateDigest,
  computeCertificationProofDigest,
  computeCertificationReviewInputManifestDigest,
  computeCertificationReviewerAssessmentDigest,
  expectedCertificationVerdict,
  validateCertificationAssessment,
  validateCertificationCandidate,
  validateCertificationProof,
  validateCertificationReviewerAssessment,
};
