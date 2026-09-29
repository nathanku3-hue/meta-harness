"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const TERMINAL_SLICE_ASSESSMENT_SCHEMA = "terminal-slice-assessment/v1";
const TERMINAL_SLICE_ASSESSMENT_DOMAIN = "meta-harness-terminal-slice-assessment/v1";
const TERMINAL_VERDICT = "TERMINAL_SLICE_VERIFIED";
const FAILURE_VERDICTS = Object.freeze(new Set([
  "PRODUCT_REVIEW_FAILED",
  "DOMAIN_REVIEW_FAILED",
  "CUSTODY_REVIEW_FAILED",
]));

function terminalBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.terminalAssessmentDigest;
  return body;
}

function computeTerminalSliceAssessmentDigest(value) {
  return domainDigest(TERMINAL_SLICE_ASSESSMENT_DOMAIN, terminalBody(value));
}

function expectedVerdict(reviews) {
  if (reviews.PRODUCT.result !== "PASS") return "PRODUCT_REVIEW_FAILED";
  if (reviews.DOMAIN.result !== "PASS") return "DOMAIN_REVIEW_FAILED";
  if (reviews.CUSTODY.result !== "PASS") return "CUSTODY_REVIEW_FAILED";
  return TERMINAL_VERDICT;
}

function validateTerminalSliceAssessment(value, {
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  reviewerAssessments,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "blackBoxProofDigest",
    "productReviewDigest",
    "domainReviewDigest",
    "custodyReviewDigest",
    "controllerBindingDigest",
    "assessedAt",
    "verdict",
    "terminalAssessmentDigest",
  ], "TerminalSliceAssessment");
  if (value.schemaVersion !== TERMINAL_SLICE_ASSESSMENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `TerminalSliceAssessment schema must be ${TERMINAL_SLICE_ASSESSMENT_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "TerminalSliceAssessment.sliceId");
  requireInteger(value.generation, "TerminalSliceAssessment.generation", { min: 1 });
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "blackBoxProofDigest",
    "productReviewDigest",
    "domainReviewDigest",
    "custodyReviewDigest",
    "controllerBindingDigest",
    "terminalAssessmentDigest",
  ]) requireDigest(value[field], `TerminalSliceAssessment.${field}`);
  requireExactUtc(value.assessedAt, "TerminalSliceAssessment.assessedAt");
  if (value.verdict !== TERMINAL_VERDICT && !FAILURE_VERDICTS.has(value.verdict)) {
    throw contractError("TERMINAL_VERDICT_INVALID", `unsupported terminal verdict: ${value.verdict}`);
  }
  const reviews = {};
  for (const assessment of reviewerAssessments) {
    if (!assessment || !new Set(["PRODUCT", "DOMAIN", "CUSTODY"]).has(assessment.role)) {
      throw contractError("TERMINAL_REVIEW_ROLE_INVALID", "terminal assessment requires PRODUCT, DOMAIN, and CUSTODY reviews");
    }
    if (reviews[assessment.role]) {
      throw contractError("TERMINAL_REVIEW_ROLE_REUSE", `duplicate terminal reviewer role: ${assessment.role}`);
    }
    reviews[assessment.role] = assessment;
  }
  if (!reviews.PRODUCT || !reviews.DOMAIN || !reviews.CUSTODY) {
    throw contractError("TERMINAL_REVIEW_MISSING", "terminal assessment requires all three reviewer roles");
  }
  const processIds = Object.values(reviews).map((review) => review.processId);
  if (new Set(processIds).size !== processIds.length) {
    throw contractError("TERMINAL_REVIEW_PROCESS_REUSE", "Reviewer A/B/C must run in distinct isolated processes");
  }
  const executableDigests = Object.values(reviews).map((review) => review.processExecutableDigest);
  if (new Set(executableDigests).size !== executableDigests.length) {
    throw contractError("TERMINAL_REVIEW_EXECUTABLE_REUSE", "Reviewer A/B/C must use distinct owner-bound executables");
  }
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: blackBoxProof.proofDigest,
    productReviewDigest: reviews.PRODUCT.assessmentDigest,
    domainReviewDigest: reviews.DOMAIN.assessmentDigest,
    custodyReviewDigest: reviews.CUSTODY.assessmentDigest,
    controllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", sliceAuthorization.controllerBinding),
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("TERMINAL_BINDING_MISMATCH", `TerminalSliceAssessment.${field} does not match terminal evidence`);
    }
  }
  for (const review of Object.values(reviews)) {
    for (const [field, expectedValue] of Object.entries({
      generation: value.generation,
      sliceAcceptanceDigest: value.sliceAcceptanceDigest,
      integratedCandidateDigest: value.integratedCandidateDigest,
      packageCandidateDigest: value.packageCandidateDigest,
      releaseCandidateDigest: value.releaseCandidateDigest,
      blackBoxProofDigest: value.blackBoxProofDigest,
    })) {
      if (review[field] !== expectedValue) {
        throw contractError("TERMINAL_REVIEW_BINDING_MISMATCH", `${review.role} review ${field} differs from terminal candidate`);
      }
    }
    if (Date.parse(review.reviewedAt) > Date.parse(value.assessedAt)) {
      throw contractError("TERMINAL_REVIEW_TIME_INVALID", `${review.role} review postdates terminal assessment`);
    }
  }
  const requiredVerdict = expectedVerdict(reviews);
  if (value.verdict !== requiredVerdict) {
    throw contractError("TERMINAL_VERDICT_MISMATCH", `terminal verdict must be ${requiredVerdict}`);
  }
  if (Date.parse(value.assessedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("TERMINAL_SLICE_DEADLINE", "terminal assessment completed after mustCompleteBy");
  }
  if (value.terminalAssessmentDigest !== computeTerminalSliceAssessmentDigest(value)) {
    throw contractError("TERMINAL_ASSESSMENT_DIGEST_MISMATCH", "TerminalSliceAssessment digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  FAILURE_VERDICTS,
  TERMINAL_SLICE_ASSESSMENT_DOMAIN,
  TERMINAL_SLICE_ASSESSMENT_SCHEMA,
  TERMINAL_VERDICT,
  computeTerminalSliceAssessmentDigest,
  expectedVerdict,
  validateTerminalSliceAssessment,
};
