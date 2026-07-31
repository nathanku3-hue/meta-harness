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
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const REVIEWER_ASSESSMENT_SCHEMA = "reviewer-assessment/v1";
const REVIEWER_ASSESSMENT_DOMAIN = "meta-harness-reviewer-assessment/v1";
const REVIEW_INPUT_MANIFEST_DOMAIN = "meta-harness-review-input-manifest/v1";
const ROLES = Object.freeze(new Map([
  ["PRODUCT", "product"],
  ["DOMAIN", "domain"],
  ["CUSTODY", "custody"],
]));
const RESULTS = Object.freeze(new Set(["PASS", "FAIL"]));

function assessmentBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.assessmentDigest;
  return body;
}

function computeReviewerAssessmentDigest(value) {
  return domainDigest(REVIEWER_ASSESSMENT_DOMAIN, assessmentBody(value));
}

function computeReviewInputManifestDigest({
  role,
  sliceAcceptanceDigest,
  integratedCandidateDigest,
  packageCandidateDigest,
  releaseCandidateDigest,
  blackBoxProofDigest,
  executableDigest,
  policyDigest,
  environmentPolicyDigest,
  networkPolicy,
}) {
  return domainDigest(REVIEW_INPUT_MANIFEST_DOMAIN, {
    role,
    sliceAcceptanceDigest,
    integratedCandidateDigest,
    packageCandidateDigest,
    releaseCandidateDigest,
    blackBoxProofDigest,
    executableDigest,
    policyDigest,
    environmentPolicyDigest,
    networkPolicy,
  });
}

function validateReviewerAssessment(value, {
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  observedExecutableDigest,
  implementationProcessId,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "role",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "blackBoxProofDigest",
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
  ], "ReviewerAssessment");
  if (value.schemaVersion !== REVIEWER_ASSESSMENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `ReviewerAssessment schema must be ${REVIEWER_ASSESSMENT_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "ReviewerAssessment.sliceId");
  requireInteger(value.generation, "ReviewerAssessment.generation", { min: 1 });
  if (!ROLES.has(value.role)) {
    throw contractError("REVIEW_ROLE_INVALID", `unsupported reviewer role: ${value.role}`);
  }
  for (const field of [
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "blackBoxProofDigest",
    "processExecutableDigest",
    "rolePolicyDigest",
    "environmentPolicyDigest",
    "inputManifestDigest",
    "findingsDigest",
    "assessmentDigest",
  ]) requireDigest(value[field], `ReviewerAssessment.${field}`);
  requireNonEmptyString(value.processId, "ReviewerAssessment.processId");
  requireNonEmptyString(value.networkPolicy, "ReviewerAssessment.networkPolicy");
  if (requireBoolean(value.readOnlyCandidateAccess, "ReviewerAssessment.readOnlyCandidateAccess") !== true) {
    throw contractError("REVIEW_CANDIDATE_WRITABLE", "reviewer must have read-only candidate and package access");
  }
  if (requireBoolean(value.implementationProcessReuse, "ReviewerAssessment.implementationProcessReuse") !== false) {
    throw contractError("REVIEW_IMPLEMENTATION_PROCESS_REUSE", "implementation process cannot fill a reviewer role");
  }
  if (requireBoolean(value.previousReviewerOutputsVisible, "ReviewerAssessment.previousReviewerOutputsVisible") !== false) {
    throw contractError("REVIEW_CONCLUSION_LEAK", "reviewer may not see a previous reviewer conclusion");
  }
  if (!RESULTS.has(value.result)) {
    throw contractError("REVIEW_RESULT_INVALID", `review result must be PASS or FAIL`);
  }
  requireExactUtc(value.reviewedAt, "ReviewerAssessment.reviewedAt");
  const policy = sliceAuthorization.reviewPolicy[ROLES.get(value.role)];
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: blackBoxProof.proofDigest,
    processExecutableDigest: policy.executableDigest,
    rolePolicyDigest: policy.policyDigest,
    environmentPolicyDigest: policy.environmentPolicyDigest,
    networkPolicy: policy.networkPolicy,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("REVIEW_BINDING_MISMATCH", `ReviewerAssessment.${field} does not match owner-bound reviewer input`);
    }
  }
  if (observedExecutableDigest !== value.processExecutableDigest) {
    throw contractError("REVIEW_EXECUTABLE_MISMATCH", "launched reviewer executable differs from owner-bound digest");
  }
  if (implementationProcessId && value.processId === implementationProcessId) {
    throw contractError("REVIEW_IMPLEMENTATION_PROCESS_REUSE", "implementation process identity cannot review its own work");
  }
  const expectedManifestDigest = computeReviewInputManifestDigest({
    role: value.role,
    sliceAcceptanceDigest: value.sliceAcceptanceDigest,
    integratedCandidateDigest: value.integratedCandidateDigest,
    packageCandidateDigest: value.packageCandidateDigest,
    releaseCandidateDigest: value.releaseCandidateDigest,
    blackBoxProofDigest: value.blackBoxProofDigest,
    executableDigest: value.processExecutableDigest,
    policyDigest: value.rolePolicyDigest,
    environmentPolicyDigest: value.environmentPolicyDigest,
    networkPolicy: value.networkPolicy,
  });
  if (value.inputManifestDigest !== expectedManifestDigest) {
    throw contractError("REVIEW_INPUT_MANIFEST_MISMATCH", "reviewer input manifest does not match exact immutable inputs");
  }
  if (Date.parse(value.reviewedAt) < Date.parse(blackBoxProof.executedAt)) {
    throw contractError("REVIEW_BEFORE_PROOF", "review cannot predate installed black-box proof");
  }
  if (Date.parse(value.reviewedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("REVIEW_SLICE_DEADLINE", "review completed after mustCompleteBy");
  }
  if (value.assessmentDigest !== computeReviewerAssessmentDigest(value)) {
    throw contractError("REVIEW_ASSESSMENT_DIGEST_MISMATCH", "ReviewerAssessment digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  RESULTS,
  REVIEWER_ASSESSMENT_DOMAIN,
  REVIEWER_ASSESSMENT_SCHEMA,
  REVIEW_INPUT_MANIFEST_DOMAIN,
  ROLES,
  computeReviewInputManifestDigest,
  computeReviewerAssessmentDigest,
  validateReviewerAssessment,
};
