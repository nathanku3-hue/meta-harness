"use strict";

const crypto = require("node:crypto");

const { buildCodingPrompt } = require("./coding-worker");
const { domainDigest, isDigest } = require("./contracts/digest");
const { attemptInputKey } = require("./execution-identity");
const {
  ATTEMPT_ENTRY_SCHEMA,
  assertEnteredPermitCapability,
  assertExecutionPermitCurrent,
  dirtyManifestDigest,
  validateAttemptEntry,
  validateExecutionPermit,
} = require("./execution-permit");
const { assertOutcomeClaimSessionExecution } = require("./outcome-claim");
const { assertProductDirectionUnchanged } = require("./product-direction");
const { WORKER_RESULT_SCHEMA } = require("./worker-result");
const {
  assertWorkspaceCustodyExecutable,
  assertWorkspaceExecutionLease,
} = require("./workspace-custody");

const LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA = "proposal-worker-packet/v1";
const LEGACY_PROPOSAL_WORKER_PACKET_DOMAIN = "meta-harness-proposal-worker-packet/v1";
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
  if (value?.schemaVersion === LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA) return LEGACY_PROPOSAL_WORKER_PACKET_DOMAIN;
  if (value?.schemaVersion === PROPOSAL_WORKER_PACKET_SCHEMA) return PROPOSAL_WORKER_PACKET_DOMAIN;
  throw new TypeError(`unsupported proposal worker packet schema: ${String(value?.schemaVersion || "missing")}`);
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
  const legacy = value?.schemaVersion === LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA;
  if (!legacy && value?.schemaVersion !== PROPOSAL_WORKER_PACKET_SCHEMA) {
    throw new TypeError(`proposal worker packet schema must be ${PROPOSAL_WORKER_PACKET_SCHEMA} or legacy ${LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA}`);
  }
  exactKeys(value, legacy ? [
    "schemaVersion",
    "permitDigest",
    "attemptEntryDigest",
    "promptDigest",
    "workerResultSchemaDigest",
    "baseline",
    "packetDigest",
  ] : [
    "schemaVersion",
    "attemptInputKey",
    "attemptEntryDigest",
    "promptDigest",
    "workerResultSchemaDigest",
    "baseline",
    "packetDigest",
  ], "proposal worker packet");
  for (const field of ["attemptEntryDigest", "promptDigest", "workerResultSchemaDigest", "packetDigest"]) {
    if (!isDigest(value[field])) throw new TypeError(`proposal worker packet ${field} must be a sha256 digest`);
  }
  if (legacy) {
    if (!isDigest(value.permitDigest)) throw new TypeError("legacy proposal worker packet permitDigest must be a sha256 digest");
  } else if (!isDigest(value.attemptInputKey)) {
    throw new TypeError("proposal worker packet attemptInputKey must be a sha256 digest");
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
    "Operation      inspect this exact snapshot and return a code proposal",
    `Snapshot       ${validatedPermit.authority.baselineHead} @ ${validatedPermit.authority.branch || "DETACHED"}`,
    `Iteration      ${entry.generation}`,
    "Available      read/search/list plus typed WRITE, DELETE, or MOVE proposal output",
    "Unavailable    direct mutation, validation, commit, push, publication, or completion",
    "Continuation   continue only this exact retained proposal operation",
  ].join("\n");
}

function runCodeProposeProjection(boundary, attemptEntry) {
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.schemaVersion !== ATTEMPT_ENTRY_SCHEMA || entry.mechanism !== "RUN_CAPABILITY") {
    throw new TypeError("claimless proposal operation requires a RUN_CAPABILITY AttemptEntry");
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
  stateDirectory,
  session,
  workspace,
  workspaceLease,
  boundary,
  executionPermit = null,
  attemptEntry,
  attempt,
  runtimeCapabilityDigest = null,
  priorFailure = "",
}) {
  if (!["REPO_RUN", "REPO_OUTCOME"].includes(session?.origin?.type)) {
    throw new TypeError("proposal worker packets require a repository Outcome run");
  }
  if (!workspace || typeof workspace !== "object") {
    throw new TypeError("proposal worker packets require the exact Meta-Harness workspace");
  }
  const entry = validateAttemptEntry(attemptEntry);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt !== entry.generation) {
    throw new TypeError("proposal worker packet attempt must equal the current execution generation");
  }

  let promptProjection;
  let packetIdentity;
  if (session.origin.type === "REPO_RUN") {
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
      throw new TypeError("claimless proposal worker packet requires the exact RUN_CAPABILITY attempt and baseline");
    }
    assertProductDirectionUnchanged(session.productDirection, repositoryPath);
    assertWorkspaceExecutionLease({
      registryDir: workspace.registryDir,
      lease: workspaceLease,
      workspaceId: workspace.workspaceId,
    });
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
    promptProjection = runCodeProposeProjection(boundary, entry);
    packetIdentity = { attemptInputKey: entry.attemptInputKey };
  } else {
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
      attemptEntry: entry,
      capability: "CODE_PROPOSE",
    });
    assertOutcomeClaimSessionExecution({
      repositoryPath,
      claimDigest: session.origin.claimDigest,
      outcomeDigest: session.origin.outcomeDigest,
      sessionDigest: session.sessionDigest,
    });
    promptProjection = delegatedCodeProposeProjection(permit, entry);
    packetIdentity = { permitDigest: permit.permitDigest };
  }

  const prompt = buildCodingPrompt(session, {
    attempt,
    priorFailure,
    workspaceMode: workspace.mode,
    authorityProjection: promptProjection,
    authorityRules: [
      "- Use only the external operation listed above; the controller performs all effects outside proposal generation.",
      "- Do not attempt materialization, validation, commit, push, publication, or completion.",
      "- Continue only this exact retained proposal operation; do not manufacture another execution route.",
    ],
  });
  const workerResultSchemaJson = JSON.stringify(WORKER_RESULT_SCHEMA);
  const body = {
    schemaVersion: session.origin.type === "REPO_RUN" ? PROPOSAL_WORKER_PACKET_SCHEMA : LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA,
    ...packetIdentity,
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
  LEGACY_PROPOSAL_WORKER_PACKET_DOMAIN,
  LEGACY_PROPOSAL_WORKER_PACKET_SCHEMA,
  PROPOSAL_WORKER_PACKET_DOMAIN,
  PROPOSAL_WORKER_PACKET_SCHEMA,
  compileProposalWorkerPacket,
  delegatedCodeProposeProjection,
  runCodeProposeProjection,
  validateProposalWorkerPacket,
};
