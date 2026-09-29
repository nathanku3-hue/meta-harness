"use strict";

const crypto = require("node:crypto");

const { buildCodingPrompt } = require("./coding-worker");
const { domainDigest, isDigest } = require("./contracts/digest");
const { attemptInputKey } = require("./execution-identity");
const {
  ATTEMPT_ENTRY_SCHEMA,
  dirtyManifestDigest,
  validateAttemptEntry,
} = require("./execution-attempt");
const { assertProductDirectionUnchanged } = require("./product-direction");
const { renderProfessionalSkillBodies } = require("./professional-skill-catalog");
const {
  assertRepositoryContractBindingsCurrent,
  compileRepositoryContractBindings,
  renderRepositoryContractBindings,
} = require("./repository-contract-binding");
const { WORKER_RESULT_SCHEMA } = require("./worker-result");
const { assertWorkspaceCustodyExecutable } = require("./workspace-custody");

const PROPOSAL_WORKER_PACKET_SCHEMA = "proposal-worker-packet/v2";
const PROPOSAL_WORKER_PACKET_DOMAIN = "meta-harness-proposal-worker-packet/v2";

function rawSha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function packetBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.packetDigest;
  return body;
}

function packetDomain(value) {
  if (value?.schemaVersion !== PROPOSAL_WORKER_PACKET_SCHEMA) {
    throw new TypeError(`proposal worker packet schema must be ${PROPOSAL_WORKER_PACKET_SCHEMA}`);
  }
  return PROPOSAL_WORKER_PACKET_DOMAIN;
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
  if (value?.schemaVersion !== PROPOSAL_WORKER_PACKET_SCHEMA) {
    throw new TypeError(`proposal worker packet schema must be ${PROPOSAL_WORKER_PACKET_SCHEMA}`);
  }
  exactKeys(value, [
    "schemaVersion",
    "attemptInputKey",
    "attemptEntryDigest",
    "promptDigest",
    "workerResultSchemaDigest",
    "baseline",
    "packetDigest",
  ], "proposal worker packet");
  for (const field of ["attemptInputKey", "attemptEntryDigest", "promptDigest", "workerResultSchemaDigest", "packetDigest"]) {
    if (!isDigest(value[field])) throw new TypeError(`proposal worker packet ${field} must be a sha256 digest`);
  }
  exactKeys(value.baseline, ["head", "treeOid", "dirtyManifestDigest"], "proposal worker packet baseline");
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.baseline.head || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(value.baseline.treeOid || ""))
      || !isDigest(value.baseline.dirtyManifestDigest)) {
    throw new TypeError("proposal worker packet baseline is invalid");
  }
  if (value.packetDigest !== domainDigest(packetDomain(value), packetBody(value))) {
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

function runCodeProposeProjection(boundary, attemptEntry) {
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.schemaVersion !== ATTEMPT_ENTRY_SCHEMA || entry.mechanism !== "RUN_CAPABILITY") {
    throw new TypeError("proposal operation requires a RUN_CAPABILITY AttemptEntry");
  }
  return [
    "Operation      inspect this exact snapshot and return a code proposal",
    `Snapshot       ${boundary.head} @ ${boundary.branch || "DETACHED"}`,
    `Iteration      ${entry.generation}`,
    "Available      read/search/list plus typed WRITE, DELETE, or MOVE proposal output",
    "Unavailable    direct mutation, validation, commit, push, publication, or completion",
    "Continuation   continue only this exact retained proposal operation",
  ].join("\n");
}

function compileProposalWorkerPacket({
  repositoryPath,
  session,
  workspace,
  boundary,
  attemptEntry,
  attempt,
  runtimeCapabilityDigest = null,
  priorFailure = "",
}) {
  if (session?.origin?.type !== "REPO_RUN") {
    throw new TypeError("new proposal worker packets require a current REPO_RUN session");
  }
  if (!workspace || typeof workspace !== "object") {
    throw new TypeError("proposal worker packets require the exact Meta-Harness workspace");
  }
  const entry = validateAttemptEntry(attemptEntry);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt !== entry.generation) {
    throw new TypeError("proposal worker packet attempt must equal the current execution generation");
  }

  const observedAttemptInputKey = attemptInputKey({
    session,
    snapshotTreeOid: boundary.treeOid,
    runtimeCapabilityDigest,
    workspaceMode: workspace.mode,
  });
  if (entry.schemaVersion !== ATTEMPT_ENTRY_SCHEMA
      || entry.mechanism !== "RUN_CAPABILITY"
      || entry.sessionDigest !== session.sessionDigest
      || entry.workspaceId !== workspace.workspaceId
      || entry.attemptInputKey !== observedAttemptInputKey
      || boundary.head !== workspace.custody.baseHead) {
    throw new TypeError("proposal worker packet requires the exact RUN_CAPABILITY attempt and baseline");
  }
  assertProductDirectionUnchanged(session.productDirection, repositoryPath);
  assertWorkspaceCustodyExecutable({
    custody: workspace.custody,
    sessionDigest: session.sessionDigest,
    repositoryRoot: repositoryPath,
    workspacePath: workspace.workspacePath,
    branch: boundary.branch,
    baseHead: workspace.custody.baseHead,
    generation: entry.generation,
    dirtyManifestDigest: dirtyManifestDigest(boundary),
  });
  const promptProjection = runCodeProposeProjection(boundary, entry);
  const repositoryContracts = compileRepositoryContractBindings({
    repositoryPath: workspace.workspacePath,
    baseCommit: session.base.commit,
  });
  if (repositoryContracts) {
    assertRepositoryContractBindingsCurrent({
      repositoryPath: workspace.workspacePath,
      compiled: repositoryContracts,
      runValidators: true,
    });
  }

  const prompt = buildCodingPrompt(session, {
    attempt,
    priorFailure,
    workspaceMode: workspace.mode,
    operationProjection: promptProjection,
    repositoryContractsProjection: [
      renderRepositoryContractBindings(repositoryContracts),
      renderProfessionalSkillBodies(workspace.workspacePath, { productCommit: session.base.commit }),
    ].filter(Boolean).join("\n\n"),
  });
  const workerResultSchemaJson = JSON.stringify(WORKER_RESULT_SCHEMA);
  const body = {
    schemaVersion: PROPOSAL_WORKER_PACKET_SCHEMA,
    attemptInputKey: entry.attemptInputKey,
    attemptEntryDigest: entry.entryDigest,
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
    packetDigest: domainDigest(packetDomain(body), body),
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
  runCodeProposeProjection,
  validateProposalWorkerPacket,
};
