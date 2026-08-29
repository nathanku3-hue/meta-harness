"use strict";

const crypto = require("node:crypto");

const { buildCodingPrompt } = require("./coding-worker");
const { domainDigest, isDigest } = require("./contracts/digest");
const {
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
  validateAttemptEntry,
  validateExecutionPermit,
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

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new TypeError(`${label} has missing or unexpected fields`);
  }
}

function validateProposalWorkerPacket(value, { prompt = null, workerResultSchema = null } = {}) {
  exactKeys(value, [
    "schemaVersion",
    "permitDigest",
    "attemptEntryDigest",
    "promptDigest",
    "workerResultSchemaDigest",
    "baseline",
    "packetDigest",
  ], "proposal worker packet");
  if (value.schemaVersion !== PROPOSAL_WORKER_PACKET_SCHEMA) {
    throw new TypeError(`proposal worker packet schema must be ${PROPOSAL_WORKER_PACKET_SCHEMA}`);
  }
  for (const field of ["permitDigest", "attemptEntryDigest", "promptDigest", "workerResultSchemaDigest", "packetDigest"]) {
    if (!isDigest(value[field])) throw new TypeError(`proposal worker packet ${field} must be a sha256 digest`);
  }
  exactKeys(value.baseline, ["head", "treeOid", "dirtyManifestDigest"], "proposal worker packet baseline");
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.baseline.head || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(value.baseline.treeOid || ""))
      || !isDigest(value.baseline.dirtyManifestDigest)) {
    throw new TypeError("proposal worker packet baseline is invalid");
  }
  if (value.packetDigest !== domainDigest(PROPOSAL_WORKER_PACKET_DOMAIN, packetBody(value))) {
    throw new TypeError("proposal worker packet digest does not match its body");
  }
  if (prompt !== null && value.promptDigest !== rawSha256(String(prompt))) {
    throw new TypeError("proposal worker packet prompt digest does not match the supplied prompt");
  }
  if (workerResultSchema !== null
      && value.workerResultSchemaDigest !== rawSha256(JSON.stringify(workerResultSchema))) {
    throw new TypeError("proposal worker packet result-schema digest does not match the supplied schema");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function delegatedCodeProposeProjection(permit, attemptEntry) {
  const validatedPermit = validateExecutionPermit(permit);
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.permitDigest !== validatedPermit.permitDigest
      || entry.attemptId !== validatedPermit.attemptId
      || entry.generation !== validatedPermit.generation
      || entry.sessionDigest !== validatedPermit.authority.sessionDigest
      || entry.workspaceId !== validatedPermit.authority.workspaceId) {
    throw new TypeError("delegated proposal authority requires the exact entered ExecutionPermit");
  }
  return [
    "ROUTE         EXTERNAL_CODE_PROPOSE",
    `ORIGIN_PERMIT ${validatedPermit.permitDigest}`,
    `ATTEMPT_ENTRY ${entry.entryDigest}`,
    `GENERATION    ${entry.generation}`,
    `SESSION       ${entry.sessionDigest}`,
    `BASELINE      ${validatedPermit.authority.baselineHead} @ ${validatedPermit.authority.branch || "DETACHED"}`,
    "CAPABILITY    CODE_PROPOSE only",
    "MATERIAL      read/search/list and return typed proposal operations only",
    "CONTROLLER    materialization, validation, commit, push, completion, and Claim release remain forbidden",
    "LIVE_PERMIT   the originating process-owned ExecutionPermit is provenance only after dispatch and must not be treated as current authority",
    "REPLAY        only the exact durably retained external route may continue this entered attempt",
  ].join("\n");
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
    authorityProjection: delegatedCodeProposeProjection(permit, attemptEntry),
    authorityRules: [
      "- Treat the delegated CODE_PROPOSE projection above as the complete external authority for this attempt. Never infer controller authority from the originating permit provenance.",
      "- The originating ExecutionPermit is not a live external lease. Do not attempt materialization, validation, commit, push, completion, or Claim release.",
      "- Continue only this exact already-entered proposal operation; do not manufacture another attempt or transport route.",
    ],
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
  const packet = validateProposalWorkerPacket({
    ...body,
    packetDigest: domainDigest(PROPOSAL_WORKER_PACKET_DOMAIN, body),
  }, { prompt, workerResultSchema: WORKER_RESULT_SCHEMA });
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
  delegatedCodeProposeProjection,
  validateProposalWorkerPacket,
};
