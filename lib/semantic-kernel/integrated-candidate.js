"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireArray,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
  requireSortedUniqueStrings,
} = require("./contract-utils");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const INTEGRATED_CANDIDATE_SCHEMA = "integrated-candidate/v1";
const INTEGRATED_CANDIDATE_DOMAIN = "meta-harness-integrated-candidate/v1";
const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "sliceId",
  "generation",
  "sliceAuthorizationDigest",
  "sliceAcceptanceDigest",
  "repositoryId",
  "initialBaseRevision",
  "contributions",
  "integrationControllerBindingDigest",
  "changedPathUnion",
  "rejectedAttempts",
  "supersededAttempts",
  "finalHeadRevision",
  "finalTreeDigest",
  "cleanStateProof",
  "integratedAt",
  "candidateDigest",
]);

function validateObjectId(value, label) {
  requireNonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw contractError("INTEGRATION_OBJECT_ID_INVALID", `${label} must be a lowercase Git object ID`);
  }
}

function validateContribution(value, index, expectedParent) {
  requireExactKeys(value, [
    "order",
    "runSpecDigest",
    "mechanicsAssessmentDigest",
    "parentRevision",
    "contributedRevision",
    "operation",
    "resultingRevision",
    "resultingTree",
    "changedPaths",
  ], `IntegratedCandidate.contributions[${index}]`);
  requireInteger(value.order, `contributions[${index}].order`, { min: 1 });
  if (value.order !== index + 1) {
    throw contractError("INTEGRATION_ORDER_INVALID", "contribution order must be contiguous and controller-selected");
  }
  requireDigest(value.runSpecDigest, `contributions[${index}].runSpecDigest`);
  requireDigest(value.mechanicsAssessmentDigest, `contributions[${index}].mechanicsAssessmentDigest`);
  validateObjectId(value.parentRevision, `contributions[${index}].parentRevision`);
  validateObjectId(value.contributedRevision, `contributions[${index}].contributedRevision`);
  validateObjectId(value.resultingRevision, `contributions[${index}].resultingRevision`);
  validateObjectId(value.resultingTree, `contributions[${index}].resultingTree`);
  if (value.operation !== "fast-forward") {
    throw contractError("INTEGRATION_OPERATION_INVALID", "Meta-Harness 0.4 permits fast-forward integration only");
  }
  if (value.parentRevision !== expectedParent) {
    throw contractError("INTEGRATION_PARENT_CHAIN_BROKEN", `contribution ${index + 1} does not extend the current integrated revision`);
  }
  if (value.contributedRevision !== value.resultingRevision) {
    throw contractError("INTEGRATION_NOT_FAST_FORWARD", "fast-forward contribution must result in its exact contributed revision");
  }
  return requireSortedUniqueStrings(value.changedPaths, `contributions[${index}].changedPaths`, { min: 1, max: 10000 });
}

function validateCleanStateProof(value, integratedAt) {
  requireExactKeys(value, ["statusPorcelainDigest", "statusPorcelainBytes", "isClean", "checkedAt"], "IntegratedCandidate.cleanStateProof");
  requireDigest(value.statusPorcelainDigest, "IntegratedCandidate.cleanStateProof.statusPorcelainDigest");
  requireInteger(value.statusPorcelainBytes, "IntegratedCandidate.cleanStateProof.statusPorcelainBytes", { min: 0, max: 0 });
  if (requireBoolean(value.isClean, "IntegratedCandidate.cleanStateProof.isClean") !== true) {
    throw contractError("INTEGRATION_TARGET_DIRTY", "integrated candidate target must be clean");
  }
  requireExactUtc(value.checkedAt, "IntegratedCandidate.cleanStateProof.checkedAt");
  if (Date.parse(value.checkedAt) > Date.parse(integratedAt)) {
    throw contractError("INTEGRATION_CLEAN_PROOF_TIME_INVALID", "clean-state proof cannot postdate integration");
  }
}

function candidateBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.candidateDigest;
  return body;
}

function computeIntegratedCandidateDigest(value) {
  return domainDigest(INTEGRATED_CANDIDATE_DOMAIN, candidateBody(value));
}

function validateIntegratedCandidate(value, sliceAuthorization, mechanicsByDigest = new Map(), options = {}) {
  requireExactKeys(value, TOP_KEYS, "IntegratedCandidate");
  if (value.schemaVersion !== INTEGRATED_CANDIDATE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `IntegratedCandidate schema must be ${INTEGRATED_CANDIDATE_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "IntegratedCandidate.sliceId");
  requireInteger(value.generation, "IntegratedCandidate.generation", { min: 1 });
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "repositoryId",
    "integrationControllerBindingDigest",
    "candidateDigest",
  ]) requireDigest(value[field], `IntegratedCandidate.${field}`);
  validateObjectId(value.initialBaseRevision, "IntegratedCandidate.initialBaseRevision");
  validateObjectId(value.finalHeadRevision, "IntegratedCandidate.finalHeadRevision");
  validateObjectId(value.finalTreeDigest, "IntegratedCandidate.finalTreeDigest");
  requireExactUtc(value.integratedAt, "IntegratedCandidate.integratedAt");
  const contributions = requireArray(value.contributions, "IntegratedCandidate.contributions", { min: 1, max: 100000 });
  const union = new Set();
  const runSpecs = new Set();
  const assessments = new Set();
  let expectedParent = value.initialBaseRevision;
  for (let index = 0; index < contributions.length; index += 1) {
    const contribution = contributions[index];
    const paths = validateContribution(contribution, index, expectedParent);
    if (runSpecs.has(contribution.runSpecDigest) || assessments.has(contribution.mechanicsAssessmentDigest)) {
      throw contractError("INTEGRATION_CONTRIBUTION_REUSE", "RunSpec and mechanics assessment may contribute exactly once");
    }
    runSpecs.add(contribution.runSpecDigest);
    assessments.add(contribution.mechanicsAssessmentDigest);
    for (const changedPath of paths) union.add(changedPath);
    const assessment = mechanicsByDigest.get(contribution.mechanicsAssessmentDigest);
    if (assessment) {
      const expected = {
        runSpecDigest: contribution.runSpecDigest,
        parentRevision: contribution.parentRevision,
        contributedRevision: contribution.contributedRevision,
        resultingTree: contribution.resultingTree,
      };
      for (const [field, expectedValue] of Object.entries(expected)) {
        if (assessment[field] !== expectedValue) {
          throw contractError("INTEGRATION_MECHANICS_MISMATCH", `contribution ${index + 1} does not match MechanicsAssessment.${field}`);
        }
      }
      if (JSON.stringify(assessment.changedPaths) !== JSON.stringify(contribution.changedPaths)) {
        throw contractError("INTEGRATION_MECHANICS_PATH_MISMATCH", `contribution ${index + 1} paths do not match MechanicsAssessment`);
      }
    } else if (options.requireMechanics !== false) {
      throw contractError("INTEGRATION_MECHANICS_MISSING", `mechanics assessment is missing for contribution ${index + 1}`);
    }
    expectedParent = contribution.resultingRevision;
  }
  if (value.finalHeadRevision !== expectedParent) {
    throw contractError("INTEGRATION_FINAL_HEAD_MISMATCH", "final head is not the result of the ordered contribution chain");
  }
  if (value.finalTreeDigest !== contributions.at(-1).resultingTree) {
    throw contractError("INTEGRATION_FINAL_TREE_MISMATCH", "final tree does not match the last independently verified contribution tree");
  }
  const changedPathUnion = requireSortedUniqueStrings(value.changedPathUnion, "IntegratedCandidate.changedPathUnion", { min: 1, max: 10000 });
  if (JSON.stringify(changedPathUnion) !== JSON.stringify([...union].sort())) {
    throw contractError("INTEGRATION_PATH_UNION_MISMATCH", "changedPathUnion does not equal contribution provenance");
  }
  const rejected = requireSortedUniqueStrings(value.rejectedAttempts, "IntegratedCandidate.rejectedAttempts", { min: 0, max: 100000 });
  const superseded = requireSortedUniqueStrings(value.supersededAttempts, "IntegratedCandidate.supersededAttempts", { min: 0, max: 100000 });
  for (const digest of [...rejected, ...superseded]) {
    requireDigest(digest, "IntegratedCandidate rejected/superseded attempt digest");
    if (assessments.has(digest) || runSpecs.has(digest)) {
      throw contractError("INTEGRATION_REJECTED_ANCESTRY", "rejected or superseded attempt appears in candidate provenance");
    }
  }
  if (new Set([...rejected, ...superseded]).size !== rejected.length + superseded.length) {
    throw contractError("INTEGRATION_ATTEMPT_CLASSIFICATION_OVERLAP", "attempt cannot be both rejected and superseded");
  }
  validateCleanStateProof(value.cleanStateProof, value.integratedAt);
  if (value.candidateDigest !== computeIntegratedCandidateDigest(value)) {
    throw contractError("INTEGRATION_CANDIDATE_DIGEST_MISMATCH", "IntegratedCandidate digest does not match its body");
  }

  const expected = {
    sliceId: sliceAuthorization.sliceId,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    repositoryId: sliceAuthorization.repositoryId,
    initialBaseRevision: sliceAuthorization.initialBaseRevision,
    integrationControllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", sliceAuthorization.controllerBinding),
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("INTEGRATION_BINDING_MISMATCH", `IntegratedCandidate.${field} does not match SliceAuthorization`);
    }
  }
  if (options.generation !== undefined && value.generation !== options.generation) {
    throw contractError("INTEGRATION_GENERATION_MISMATCH", "IntegratedCandidate generation is stale");
  }
  if (options.recomputedFinalTree && value.finalTreeDigest !== options.recomputedFinalTree) {
    throw contractError("INTEGRATION_TREE_RECOMPUTE_MISMATCH", "independent final tree recomputation differs");
  }
  if (Date.parse(value.integratedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("INTEGRATION_SLICE_DEADLINE", "integration completed after mustCompleteBy");
  }
  return immutable(value);
}

module.exports = {
  INTEGRATED_CANDIDATE_DOMAIN,
  INTEGRATED_CANDIDATE_SCHEMA,
  computeIntegratedCandidateDigest,
  validateIntegratedCandidate,
};
