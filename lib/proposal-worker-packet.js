"use strict";

const crypto = require("node:crypto");

const { buildCodingPrompt } = require("./coding-worker");
const { domainDigest } = require("./contracts/digest");
const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
} = require("./execution-permit");
const { assertOutcomeClaimExecution } = require("./outcome-claim");
const { WORKER_RESULT_SCHEMA } = require("./worker-result");

const PROPOSAL_WORKER_PACKET_SCHEMA = "proposal-worker-packet/v1";
const PROPOSAL_WORKER_PACKET_DOMAIN = "meta-harness-proposal-worker-packet/v1";

function rawSha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function packetBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.packetDigest;
  return body;
}

function compileProposalWorkerPacket({
  repositoryPath,
  stateDirectory,
  session,
  workspace,
  workspaceLease,
  boundary,
  executionPermit,
  attemptEntry,
  attempt,
  priorFailure = "",
}) {
  if (session?.origin?.type !== "REPO_OUTCOME") {
    throw new TypeError("proposal worker packets require a Claim-bound REPO_OUTCOME WorkSession");
  }
  if (!workspace || typeof workspace !== "object") {
    throw new TypeError("proposal worker packets require the exact Meta-Harness workspace");
  }
  if (!Number.isInteger(attempt) || attempt < 1 || attempt !== executionPermit?.generation) {
    throw new TypeError("proposal worker packet attempt must equal the current execution generation");
  }

  const permit = assertExecutionPermitCurrent({
    permit: executionPermit,
    session,
    repositoryRoot: repositoryPath,
    workspacePath: workspace.workspacePath,
    workspaceCustody: workspace.custody,
    workspaceLease,
    workspaceRegistryDir: workspace.registryDir,
    boundary,
    requireInitialDirtyManifest: true,
  });
  assertEnteredPermitCapability({
    stateDirectory,
    permit,
    attemptEntry,
    capability: "CODE_PROPOSE",
  });
  assertOutcomeClaimExecution({
    repositoryPath,
    claimDigest: session.origin.claimDigest,
    outcomeDigest: session.origin.outcomeDigest,
    sessionDigest: session.sessionDigest,
    workspaceId: workspace.workspaceId,
  });

  const prompt = buildCodingPrompt(session, {
    attempt,
    priorFailure,
    workspaceMode: workspace.mode,
    executionPermit: permit,
  });
  const workerResultSchemaJson = JSON.stringify(WORKER_RESULT_SCHEMA);
  const body = {
    schemaVersion: PROPOSAL_WORKER_PACKET_SCHEMA,
    permitDigest: permit.permitDigest,
    attemptEntryDigest: attemptEntry.entryDigest,
    promptDigest: rawSha256(prompt),
    workerResultSchemaDigest: rawSha256(workerResultSchemaJson),
    baseline: {
      head: boundary.head,
      treeOid: boundary.treeOid,
      dirtyManifestDigest: dirtyManifestDigest(boundary),
    },
  };
  const packet = Object.freeze({
    ...body,
    packetDigest: domainDigest(PROPOSAL_WORKER_PACKET_DOMAIN, body),
  });
  return Object.freeze({
    packet,
    prompt,
    workerResultSchema: WORKER_RESULT_SCHEMA,
  });
}

module.exports = {
  PROPOSAL_WORKER_PACKET_DOMAIN,
  PROPOSAL_WORKER_PACKET_SCHEMA,
  compileProposalWorkerPacket,
};
