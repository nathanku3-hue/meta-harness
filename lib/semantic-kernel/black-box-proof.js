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
} = require("./contract-utils");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const BLACK_BOX_PROOF_SCHEMA = "black-box-proof/v1";
const BLACK_BOX_PROOF_DOMAIN = "meta-harness-black-box-proof/v1";
const PROOF_ORACLE_DOMAIN = "meta-harness-proof-oracle/v1";

function proofBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.proofDigest;
  return body;
}

function computeBlackBoxProofDigest(value) {
  return domainDigest(BLACK_BOX_PROOF_DOMAIN, proofBody(value));
}

function computeProofOracleDigest(proofOracle) {
  return domainDigest(PROOF_ORACLE_DOMAIN, proofOracle);
}

function validateExecutionSurface(value, packageCandidate) {
  requireExactKeys(value, [
    "type",
    "tarballDigest",
    "installationIdentity",
    "freshEnvironmentProofDigest",
  ], "BlackBoxProof.executionSurface");
  if (value.type !== "installed-package") {
    throw contractError("BLACK_BOX_SURFACE_INVALID", "terminal black-box proof must execute the installed package");
  }
  requireDigest(value.tarballDigest, "executionSurface.tarballDigest");
  requireNonEmptyString(value.installationIdentity, "executionSurface.installationIdentity");
  requireDigest(value.freshEnvironmentProofDigest, "executionSurface.freshEnvironmentProofDigest");
  if (value.tarballDigest !== packageCandidate.tarballDigest) {
    throw contractError("BLACK_BOX_TARBALL_MISMATCH", "installed proof tarball differs from PackageCandidate");
  }
}

function validateOperatorActions(value, expectedFlow) {
  const actions = requireArray(value, "BlackBoxProof.operatorActions", { min: 1, max: 1000 });
  if (actions.length !== expectedFlow.length) {
    throw contractError("BLACK_BOX_OPERATOR_FLOW_COUNT", "operator action count does not match SliceAcceptance");
  }
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    requireExactKeys(action, ["sequence", "actionId", "action", "observationId"], `operatorActions[${index}]`);
    requireInteger(action.sequence, `operatorActions[${index}].sequence`, { min: 1 });
    if (action.sequence !== index + 1) {
      throw contractError("BLACK_BOX_OPERATOR_FLOW_ORDER", "operator actions must be contiguous and ordered");
    }
    requireNonEmptyString(action.actionId, `operatorActions[${index}].actionId`);
    requireNonEmptyString(action.action, `operatorActions[${index}].action`);
    requireNonEmptyString(action.observationId, `operatorActions[${index}].observationId`);
    if (action.action !== expectedFlow[index]) {
      throw contractError("BLACK_BOX_OPERATOR_FLOW_MISMATCH", `operator action ${index + 1} differs from exact accepted flow`);
    }
  }
}

function validateQuantitativeEvaluations(value, predicateIds, quantitativeBounds) {
  const evaluations = requireArray(value, "BlackBoxProof.quantitativeEvaluations", { min: 1, max: 1000 });
  if (evaluations.length !== predicateIds.length) {
    throw contractError("BLACK_BOX_PREDICATE_COUNT", "proof must evaluate every pre-authorized predicate exactly once");
  }
  const boundsById = new Map(quantitativeBounds.map((bound) => [bound.boundId, bound]));
  for (let index = 0; index < evaluations.length; index += 1) {
    const evaluation = evaluations[index];
    requireExactKeys(evaluation, ["predicateId", "actual", "passed", "evidenceDigest"], `quantitativeEvaluations[${index}]`);
    requireNonEmptyString(evaluation.predicateId, `quantitativeEvaluations[${index}].predicateId`);
    if (evaluation.predicateId !== predicateIds[index]) {
      throw contractError("BLACK_BOX_PREDICATE_ORDER", "proof predicate order must match the owner-authorized oracle");
    }
    if (!["string", "number", "boolean"].includes(typeof evaluation.actual) || !Number.isFinite(evaluation.actual) && typeof evaluation.actual === "number") {
      throw contractError("BLACK_BOX_PREDICATE_ACTUAL", `unsupported predicate actual value at index ${index}`);
    }
    if (requireBoolean(evaluation.passed, `quantitativeEvaluations[${index}].passed`) !== true) {
      throw contractError("BLACK_BOX_PREDICATE_FAILED", `predicate failed: ${evaluation.predicateId}`);
    }
    const bound = boundsById.get(evaluation.predicateId);
    if (bound) {
      if (typeof evaluation.actual !== "number" || !Number.isFinite(evaluation.actual)) {
        throw contractError("BLACK_BOX_BOUND_ACTUAL_INVALID", `typed bound ${bound.boundId} requires a finite numeric actual value`);
      }
      if (evaluation.actual < bound.min || evaluation.actual > bound.max) {
        throw contractError(
          "BLACK_BOX_BOUND_FAILED",
          `typed bound ${bound.boundId} actual ${evaluation.actual} is outside [${bound.min}, ${bound.max}]`,
        );
      }
    }
    requireDigest(evaluation.evidenceDigest, `quantitativeEvaluations[${index}].evidenceDigest`);
  }
}

function validateBlackBoxProof(value, {
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  observedEvaluatorDigest,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "executionSurface",
    "operatorActions",
    "inputIdentityDigest",
    "fixtureIdentityDigest",
    "observationTranscriptDigest",
    "exitStatus",
    "quantitativeEvaluations",
    "proofOracleDigest",
    "evaluatorExecutableDigest",
    "evaluatorPackageDigest",
    "noImplementationWorkerExpectedOutput",
    "executedAt",
    "proofDigest",
  ], "BlackBoxProof");
  if (value.schemaVersion !== BLACK_BOX_PROOF_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `BlackBoxProof schema must be ${BLACK_BOX_PROOF_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "BlackBoxProof.sliceId");
  requireInteger(value.generation, "BlackBoxProof.generation", { min: 1 });
  for (const field of [
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "releaseCandidateDigest",
    "inputIdentityDigest",
    "fixtureIdentityDigest",
    "observationTranscriptDigest",
    "proofOracleDigest",
    "evaluatorExecutableDigest",
    "proofDigest",
  ]) requireDigest(value[field], `BlackBoxProof.${field}`);
  validateExecutionSurface(value.executionSurface, packageCandidate);
  validateOperatorActions(value.operatorActions, sliceAuthorization.sliceAcceptance.operatorUserFlow);
  requireInteger(value.exitStatus, "BlackBoxProof.exitStatus", { min: 0, max: 0 });
  validateQuantitativeEvaluations(
    value.quantitativeEvaluations,
    sliceAuthorization.sliceAcceptance.proofOracle.predicateIds,
    sliceAuthorization.sliceAcceptance.quantitativeBounds,
  );
  const oracle = sliceAuthorization.sliceAcceptance.proofOracle;
  const expectedOracleDigest = computeProofOracleDigest(oracle);
  if (value.proofOracleDigest !== expectedOracleDigest) {
    throw contractError("BLACK_BOX_ORACLE_DIGEST_MISMATCH", "proof oracle differs from owner-authorized bytes");
  }
  if (value.evaluatorExecutableDigest !== oracle.evaluatorArtifactDigest
    || observedEvaluatorDigest !== oracle.evaluatorArtifactDigest) {
    throw contractError("BLACK_BOX_EVALUATOR_MISMATCH", "evaluator executable differs from pre-authorized proof oracle");
  }
  if (oracle.evaluatorPackageDigest === null) {
    if (value.evaluatorPackageDigest !== null) {
      throw contractError("BLACK_BOX_EVALUATOR_PACKAGE_UNEXPECTED", "non-package evaluator proof must not claim a package digest");
    }
  } else {
    requireDigest(value.evaluatorPackageDigest, "BlackBoxProof.evaluatorPackageDigest");
    if (value.evaluatorPackageDigest !== oracle.evaluatorPackageDigest) {
      throw contractError("BLACK_BOX_EVALUATOR_PACKAGE_MISMATCH", "evaluator package differs from pre-authorized oracle");
    }
  }
  if (requireBoolean(value.noImplementationWorkerExpectedOutput, "BlackBoxProof.noImplementationWorkerExpectedOutput") !== true) {
    throw contractError("BLACK_BOX_EXPECTED_OUTPUT_UNTRUSTED", "implementation worker may not author expected proof output");
  }
  requireExactUtc(value.executedAt, "BlackBoxProof.executedAt");
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("BLACK_BOX_BINDING_MISMATCH", `BlackBoxProof.${field} does not match the frozen release candidate`);
    }
  }
  if (Date.parse(value.executedAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("BLACK_BOX_SLICE_DEADLINE", "black-box proof completed after mustCompleteBy");
  }
  if (value.proofDigest !== computeBlackBoxProofDigest(value)) {
    throw contractError("BLACK_BOX_PROOF_DIGEST_MISMATCH", "BlackBoxProof digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  BLACK_BOX_PROOF_DOMAIN,
  BLACK_BOX_PROOF_SCHEMA,
  PROOF_ORACLE_DOMAIN,
  computeBlackBoxProofDigest,
  computeProofOracleDigest,
  validateBlackBoxProof,
};
