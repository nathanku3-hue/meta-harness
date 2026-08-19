"use strict";

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { verifyCandidate, verifyProductProof } = require("./work-verifier");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function verifyRetainedSessionObligation({
  workspacePath,
  dependencySourcePath = workspacePath,
  session,
  candidateTreeOid,
  env = process.env,
}) {
  if (!session || typeof session !== "object"
      || !/^[a-f0-9]{40,64}$/u.test(String(candidateTreeOid || ""))) {
    fail("MH_WORK_RETAINED_PROOF", "retained obligation verification requires a sealed session and cumulative candidate tree");
  }
  const syntheticSealBody = {
    sessionDigest: session.sessionDigest,
    baseHead: session.base.commit,
    candidateTreeOid,
  };
  const syntheticSeal = {
    ...syntheticSealBody,
    workspaceId: "product-integration",
    generation: 1,
    sealDigest: domainDigest("meta-harness-retained-obligation-seal/v1", syntheticSealBody),
  };
  const verification = verifyCandidate({
    workspacePath,
    dependencySourcePath,
    candidateSeal: syntheticSeal,
    commands: session.validation,
    env,
  });
  const validationPassed = verification.commands.length === session.validation.length
    && verification.commands.every((command) => command.passed === true);
  const productProof = verifyProductProof({
    workspacePath,
    dependencySourcePath,
    session,
    candidateSeal: syntheticSeal,
    env,
  });
  const body = {
    schemaVersion: "retained-product-obligation-proof/v1",
    sessionDigest: session.sessionDigest,
    candidateTreeOid,
    verificationDigest: verification.verificationDigest,
    productProofDigest: productProof.productProofDigest,
    passed: validationPassed && productProof.state === "PROVEN",
  };
  return Object.freeze({
    ...body,
    verification,
    productProof,
    proofDigest: domainDigest("meta-harness-retained-product-obligation-proof/v1", body),
  });
}

module.exports = {
  verifyRetainedSessionObligation,
};
