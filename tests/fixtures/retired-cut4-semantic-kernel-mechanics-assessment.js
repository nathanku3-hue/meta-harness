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

const MECHANICS_ASSESSMENT_SCHEMA = "mechanics-assessment/v1";
const MECHANICS_ASSESSMENT_DOMAIN = "meta-harness-mechanics-assessment/v1";
const MECHANICS_VERDICT = "MECHANICS_VERIFIED";
const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "sliceId",
  "generation",
  "sliceAuthorizationDigest",
  "sliceAcceptanceDigest",
  "runSpecDigest",
  "repositoryId",
  "parentRevision",
  "contributedRevision",
  "resultingTree",
  "changedPaths",
  "validationResults",
  "cleanStateProof",
  "assessedAt",
  "verdict",
  "assessmentDigest",
]);

function validateObjectId(value, label) {
  requireNonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw contractError("MECHANICS_OBJECT_ID_INVALID", `${label} must be a 40- or 64-character lowercase Git object ID`);
  }
}

function validateValidationResults(value, runSpec) {
  const results = requireArray(value, "MechanicsAssessment.validationResults", { min: 1, max: 1000 });
  if (results.length !== runSpec.validation.commands.length) {
    throw contractError("MECHANICS_VALIDATION_COUNT_MISMATCH", "mechanics results must cover every RunSpec validation command exactly once");
  }
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    requireExactKeys(result, [
      "commandId",
      "exitStatus",
      "timedOut",
      "networkUsed",
      "stdoutDigest",
      "stderrDigest",
      "startedAt",
      "finishedAt",
    ], `MechanicsAssessment.validationResults[${index}]`);
    requireDigest(result.commandId, `validationResults[${index}].commandId`);
    requireInteger(result.exitStatus, `validationResults[${index}].exitStatus`, { min: 0, max: 255 });
    requireBoolean(result.timedOut, `validationResults[${index}].timedOut`);
    requireBoolean(result.networkUsed, `validationResults[${index}].networkUsed`);
    requireDigest(result.stdoutDigest, `validationResults[${index}].stdoutDigest`);
    requireDigest(result.stderrDigest, `validationResults[${index}].stderrDigest`);
    requireExactUtc(result.startedAt, `validationResults[${index}].startedAt`);
    requireExactUtc(result.finishedAt, `validationResults[${index}].finishedAt`);
    if (result.commandId !== runSpec.validation.commands[index].commandId) {
      throw contractError("MECHANICS_COMMAND_BINDING_MISMATCH", `validation result ${index} does not match RunSpec command order`);
    }
    if (result.exitStatus !== 0 || result.timedOut || result.networkUsed) {
      throw contractError("MECHANICS_VALIDATION_FAILED", `validation command ${index} did not satisfy mechanics policy`);
    }
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      throw contractError("MECHANICS_VALIDATION_TIME_INVALID", `validation command ${index} finished before it started`);
    }
  }
}

function validateCleanStateProof(value, assessment) {
  requireExactKeys(value, ["statusPorcelainDigest", "statusPorcelainBytes", "isClean", "checkedAt"], "MechanicsAssessment.cleanStateProof");
  requireDigest(value.statusPorcelainDigest, "cleanStateProof.statusPorcelainDigest");
  requireInteger(value.statusPorcelainBytes, "cleanStateProof.statusPorcelainBytes", { min: 0, max: 0 });
  if (requireBoolean(value.isClean, "cleanStateProof.isClean") !== true) {
    throw contractError("MECHANICS_TARGET_DIRTY", "mechanics target must be clean");
  }
  requireExactUtc(value.checkedAt, "cleanStateProof.checkedAt");
  if (Date.parse(value.checkedAt) > Date.parse(assessment.assessedAt)) {
    throw contractError("MECHANICS_CLEAN_PROOF_TIME_INVALID", "clean-state proof cannot postdate assessment");
  }
}

function mechanicsBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.assessmentDigest;
  return body;
}

function computeMechanicsAssessmentDigest(value) {
  return domainDigest(MECHANICS_ASSESSMENT_DOMAIN, mechanicsBody(value));
}

function validateMechanicsAssessment(value, runSpec, sliceAuthorization, options = {}) {
  requireExactKeys(value, TOP_KEYS, "MechanicsAssessment");
  if (value.schemaVersion !== MECHANICS_ASSESSMENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `MechanicsAssessment schema must be ${MECHANICS_ASSESSMENT_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "MechanicsAssessment.sliceId");
  requireInteger(value.generation, "MechanicsAssessment.generation", { min: 1 });
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "runSpecDigest",
    "repositoryId",
    "assessmentDigest",
  ]) requireDigest(value[field], `MechanicsAssessment.${field}`);
  validateObjectId(value.parentRevision, "MechanicsAssessment.parentRevision");
  validateObjectId(value.contributedRevision, "MechanicsAssessment.contributedRevision");
  validateObjectId(value.resultingTree, "MechanicsAssessment.resultingTree");
  const changedPaths = requireSortedUniqueStrings(value.changedPaths, "MechanicsAssessment.changedPaths", { min: 1, max: 10000 });
  const allowedPaths = runSpec.mechanicalTask.targetPaths;
  if (JSON.stringify(changedPaths) !== JSON.stringify(allowedPaths)) {
    throw contractError("MECHANICS_CHANGED_PATH_MISMATCH", "changed paths must exactly match the RunSpec target paths");
  }
  requireExactUtc(value.assessedAt, "MechanicsAssessment.assessedAt");
  validateValidationResults(value.validationResults, runSpec);
  validateCleanStateProof(value.cleanStateProof, value);
  if (value.verdict !== MECHANICS_VERDICT) {
    throw contractError("MECHANICS_VERDICT_INVALID", `mechanics verdict must be ${MECHANICS_VERDICT}`);
  }
  if (value.assessmentDigest !== computeMechanicsAssessmentDigest(value)) {
    throw contractError("MECHANICS_DIGEST_MISMATCH", "MechanicsAssessment digest does not match its body");
  }

  const expected = {
    sliceId: runSpec.sliceId,
    generation: runSpec.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    runSpecDigest: runSpec.runSpecDigest,
    repositoryId: runSpec.repository.repositoryId,
    parentRevision: runSpec.repository.expectedParentRevision,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("MECHANICS_BINDING_MISMATCH", `MechanicsAssessment.${field} does not match RunSpec or SliceAuthorization`);
    }
  }
  if (value.contributedRevision === value.parentRevision) {
    throw contractError("MECHANICS_NO_COMMIT", "mechanics contribution must create a new revision");
  }
  if (options.expectedContributedRevision && value.contributedRevision !== options.expectedContributedRevision) {
    throw contractError("MECHANICS_REVISION_MISMATCH", "mechanics contribution revision does not match observed Git state");
  }
  if (options.expectedTree && value.resultingTree !== options.expectedTree) {
    throw contractError("MECHANICS_TREE_MISMATCH", "mechanics resulting tree does not match observed Git state");
  }
  if (Date.parse(value.assessedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("MECHANICS_SLICE_DEADLINE", "mechanics assessment cannot complete after mustCompleteBy");
  }
  return immutable(value);
}

module.exports = {
  MECHANICS_ASSESSMENT_DOMAIN,
  MECHANICS_ASSESSMENT_SCHEMA,
  MECHANICS_VERDICT,
  computeMechanicsAssessmentDigest,
  mechanicsBody,
  validateMechanicsAssessment,
};
