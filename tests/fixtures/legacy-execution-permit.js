"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("../../lib/contracts/digest");
const { ConfigError } = require("../../lib/errors");
const {
  ATTEMPT_ENTRY_SCHEMA,
  LEGACY_ATTEMPT_ENTRY_SCHEMA,
  attemptEntryOrigin,
  computeAttemptEntryDigest,
  dirtyManifestDigest,
  readAttemptEntry,
  validateAttemptEntry,
} = require("../../lib/execution-attempt");
const { findExecutionClosureForDecision, findExecutionClosureForOrigin } = require("../../lib/execution-closure");
const { assertOutcomeClaimSessionExecution, withOutcomeClaimLock } = require("../../lib/outcome-claim");
const { assertProductDirectionUnchanged } = require("../../lib/product-direction");
const {
  admissionForHead,
  attemptEntryPath,
  readCurrentWorldPointer,
  readImmutableJson,
  writeCreateOnlyJson: writeAuthorityCreateOnlyJson,
} = require("../../lib/world-authority");
const { validateWorkspaceCustody } = require("../../lib/workspace-custody");
const { assertWorkspaceExecutionLease } = require("../helpers/legacy-workspace-lease");

const EXECUTION_PERMIT_SCHEMA = "execution-permit/v1";
const EXECUTION_PERMIT_DOMAIN = "meta-harness-execution-permit/v1";
const OWNED_PATH_SET_DOMAIN = "meta-harness-execution-owned-path-set/v1";
const RUN_CAPABILITY_GRANT_SCHEMA = "run-capability-grant/v1";
const RUN_CAPABILITY_GRANT_DOMAIN = "meta-harness-run-capability-grant/v1";
const VALIDATION_SPEC_DOMAIN = "meta-harness-validation-spec/v1";
function withLegacyAdmissionCheck(_repositoryPath, operation) { return operation(); }
const RUN_CAPABILITY_OPERATIONS = Object.freeze([
  "repo.write",
  "repo.delete",
  "repo.move",
  "validation.run",
  "git.localBank",
  "git.localIntegrate",
  "git.remotePush",
]);
const RUN_CAPABILITY_OPERATION_SET = new Set(RUN_CAPABILITY_OPERATIONS);

const MATERIAL_CAPABILITIES = Object.freeze([
  "CODE_PROPOSE",
  "SOURCE_ACQUIRE",
  "MATERIALIZE_INPUT",
  "LABEL_JOIN",
  "OUTCOME_READ",
  "EVALUATE",
  "TRIAL_DEBIT",
  "STATE_TRANSITION",
  "ROUTE_REOPEN",
  "PUBLISH",
  "CAPITAL_ACTION",
  "CONTROLLER_MATERIALIZE",
  "CONTROLLER_VALIDATE",
  "CONTROLLER_COMMIT",
  "CONTROLLER_PUSH",
]);
const MATERIAL_CAPABILITY_SET = new Set(MATERIAL_CAPABILITIES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "permitId",
  "attemptId",
  "sliceId",
  "generation",
  "issuedAt",
  "state",
  "authority",
  "capabilities",
  "permitDigest",
]);

const AUTHORITY_KEYS = Object.freeze([
  "repositoryRoot",
  "workspaceId",
  "workspacePath",
  "workspaceCustodyDigest",
  "workspaceLeaseDigest",
  "branch",
  "baseHead",
  "baselineHead",
  "productDirectionDigest",
  "sessionDigest",
  "ownedPathSetDigest",
  "initialDirtyManifestDigest",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_EXECUTION_PERMIT_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_EXECUTION_PERMIT_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_EXECUTION_PERMIT_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function pathIdentity(value) {
  const resolved = path.resolve(nonEmptyString(value, "path"));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function normalizedOwnedPaths(allowedPaths) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    fail("MH_EXECUTION_PERMIT_PATHS", "execution permit requires at least one owned path");
  }
  return [...new Set(allowedPaths.map((entry) => nonEmptyString(entry, "owned path")))].sort();
}

function ownedPathSetDigest(allowedPaths) {
  return domainDigest(OWNED_PATH_SET_DOMAIN, normalizedOwnedPaths(allowedPaths));
}

function runCapabilityOperations(session) {
  const operations = [
    "repo.write",
    "repo.delete",
    "repo.move",
    "validation.run",
    "git.localBank",
    "git.localIntegrate",
  ];
  if (session?.delivery?.push) operations.push("git.remotePush");
  return operations;
}

function runCapabilityResourceScope(session, operation) {
  if (["repo.write", "repo.delete", "repo.move"].includes(operation)) {
    return {
      kind: "REPOSITORY_PATH_SET",
      allowedPaths: normalizedOwnedPaths(session.allowedPaths),
      ownedPathSetDigest: ownedPathSetDigest(session.allowedPaths),
    };
  }
  if (operation === "validation.run") {
    return {
      kind: "VALIDATION_SPEC",
      validationSpecDigest: domainDigest(VALIDATION_SPEC_DOMAIN, session.validation),
    };
  }
  if (operation === "git.remotePush") {
    return {
      kind: "GIT_REMOTE",
      remote: "origin",
    };
  }
  return {
    kind: operation === "git.localIntegrate" ? "PRODUCT_HEAD_CAS" : "CURRENT_CANDIDATE",
    baseHead: session.base.commit,
  };
}

function runCapabilityGrant({ session, attemptEntry, operation }) {
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.schemaVersion !== ATTEMPT_ENTRY_SCHEMA || entry.mechanism !== "RUN_CAPABILITY") {
    fail("MH_RUN_CAPABILITY_GRANT", "concrete run grants require a RUN_CAPABILITY AttemptEntry");
  }
  if (!session || session.sessionDigest !== entry.sessionDigest || !isDigest(session.productDirection?.digest)) {
    fail("MH_RUN_CAPABILITY_GRANT", "concrete run grant requires the exact sealed work session");
  }
  if (!RUN_CAPABILITY_OPERATION_SET.has(operation)) {
    fail("MH_RUN_CAPABILITY_GRANT", `unknown concrete run operation: ${operation}`);
  }
  if (!runCapabilityOperations(session).includes(operation)) {
    fail("MH_RUN_CAPABILITY_DENIED", `concrete run operation is not granted: ${operation}`);
  }
  const body = {
    schemaVersion: RUN_CAPABILITY_GRANT_SCHEMA,
    operation,
    resourceScope: runCapabilityResourceScope(session, operation),
    runIdentity: {
      attemptInputKey: entry.attemptInputKey,
      attemptEntryDigest: entry.entryDigest,
      sessionDigest: entry.sessionDigest,
      workspaceId: entry.workspaceId,
      generation: entry.generation,
    },
    grantSource: {
      kind: "SEALED_WORK_SESSION",
      sessionDigest: session.sessionDigest,
      productDirectionDigest: session.productDirection.digest,
    },
    replaySemantics: operation === "git.remotePush" ? "EFFECT_ADAPTER_REQUIRED" : "ATTEMPT_SCOPED",
  };
  return deepFreeze({
    ...body,
    grantDigest: domainDigest(RUN_CAPABILITY_GRANT_DOMAIN, body),
  });
}

function assertRunCapabilityGrant(input) {
  return runCapabilityGrant(input);
}

function grantedCapabilities(session) {
  const capabilities = [
    "CODE_PROPOSE",
    "CONTROLLER_MATERIALIZE",
    "CONTROLLER_VALIDATE",
    "CONTROLLER_COMMIT",
  ];
  if (session?.delivery?.push) capabilities.push("CONTROLLER_PUSH");
  return capabilities;
}

function permitBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.permitDigest;
  return body;
}

function computeExecutionPermitDigest(value) {
  return domainDigest(EXECUTION_PERMIT_DOMAIN, permitBody(value));
}

function validateExecutionPermit(value) {
  exactKeys(value, TOP_KEYS, "executionPermit");
  if (value.schemaVersion !== EXECUTION_PERMIT_SCHEMA) {
    fail("MH_EXECUTION_PERMIT_SCHEMA", `executionPermit.schemaVersion must be ${EXECUTION_PERMIT_SCHEMA}`);
  }
  if (!UUID_RE.test(value.permitId)) {
    fail("MH_EXECUTION_PERMIT_ID", "executionPermit.permitId must be a canonical random UUID");
  }
  if (!UUID_RE.test(value.attemptId)) {
    fail("MH_EXECUTION_PERMIT_ID", "executionPermit.attemptId must be a canonical random UUID");
  }
  nonEmptyString(value.sliceId, "executionPermit.sliceId");
  if (!Number.isInteger(value.generation) || value.generation < 1) {
    fail("MH_EXECUTION_PERMIT_GENERATION", "executionPermit.generation must be a positive integer");
  }
  if (!Number.isFinite(Date.parse(value.issuedAt))) {
    fail("MH_EXECUTION_PERMIT_TIME", "executionPermit.issuedAt must be an ISO timestamp");
  }
  if (value.state !== "ISSUED") {
    fail("MH_EXECUTION_PERMIT_STATE", "executionPermit state must be ISSUED");
  }
  exactKeys(value.authority, AUTHORITY_KEYS, "executionPermit.authority");
  nonEmptyString(value.authority.repositoryRoot, "executionPermit.authority.repositoryRoot");
  if (!UUID_RE.test(value.authority.workspaceId)) {
    fail("MH_EXECUTION_PERMIT_ID", "executionPermit.authority.workspaceId must be a canonical random UUID");
  }
  nonEmptyString(value.authority.workspacePath, "executionPermit.authority.workspacePath");
  if (!isDigest(value.authority.workspaceCustodyDigest)) {
    fail("MH_EXECUTION_PERMIT_DIGEST", "executionPermit.authority.workspaceCustodyDigest must be a sha256 digest");
  }
  if (!isDigest(value.authority.workspaceLeaseDigest)) {
    fail("MH_EXECUTION_PERMIT_DIGEST", "executionPermit.authority.workspaceLeaseDigest must be a sha256 digest");
  }
  if (value.authority.branch !== null && (typeof value.authority.branch !== "string" || value.authority.branch.trim() === "")) {
    fail("MH_EXECUTION_PERMIT_BRANCH", "executionPermit.authority.branch must be null or a non-empty string");
  }
  nonEmptyString(value.authority.baseHead, "executionPermit.authority.baseHead");
  nonEmptyString(value.authority.baselineHead, "executionPermit.authority.baselineHead");
  for (const field of ["productDirectionDigest", "sessionDigest", "ownedPathSetDigest", "initialDirtyManifestDigest"]) {
    if (!isDigest(value.authority[field])) {
      fail("MH_EXECUTION_PERMIT_DIGEST", `executionPermit.authority.${field} must be a sha256 digest`);
    }
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    fail("MH_EXECUTION_PERMIT_CAPABILITY", "executionPermit.capabilities must be a non-empty array");
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    fail("MH_EXECUTION_PERMIT_CAPABILITY", "executionPermit.capabilities must not contain duplicates");
  }
  for (const capability of value.capabilities) {
    if (!MATERIAL_CAPABILITY_SET.has(capability)) {
      fail("MH_EXECUTION_PERMIT_CAPABILITY", `unknown execution capability: ${capability}`);
    }
  }
  if (!isDigest(value.permitDigest) || value.permitDigest !== computeExecutionPermitDigest(value)) {
    fail("MH_EXECUTION_PERMIT_DIGEST", "executionPermit.permitDigest does not match its body");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function permitDirectory(stateDirectory) {
  const directory = path.join(path.resolve(nonEmptyString(stateDirectory, "stateDirectory")), "permits");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function permitPath(stateDirectory, permitId) {
  return path.join(permitDirectory(stateDirectory), `${permitId}.json`);
}

function writeCreateOnlyJson(filePath, value, code) {
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(code, `create-only execution authority object already exists: ${path.basename(filePath)}`);
    }
    fail(code, `cannot persist execution authority object: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function issueExecutionPermit({ repositoryRoot, workspacePath, session, attempt, boundary, workspaceCustody, workspaceLease, workspaceRegistryDir, stateDirectory, now = new Date() }) {
  if (!session || typeof session !== "object") {
    fail("MH_EXECUTION_PERMIT_SESSION", "execution permit requires a sealed work session");
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    fail("MH_EXECUTION_PERMIT_GENERATION", "execution permit attempt must be a positive integer");
  }
  assertProductDirectionUnchanged(session.productDirection, repositoryRoot);
  const custody = validateWorkspaceCustody(workspaceCustody);
  const lease = assertWorkspaceExecutionLease({
    registryDir: workspaceRegistryDir,
    lease: workspaceLease,
    workspaceId: custody.workspaceId,
  });
  if (custody.state !== "ACTIVE"
      || custody.sessionDigest !== session.sessionDigest
      || !samePath(custody.repositoryRoot, repositoryRoot)
      || !samePath(custody.workspacePath, workspacePath)
      || custody.branch !== boundary.branch
      || custody.baseHead !== session.base.commit
      || custody.baseHead !== boundary.head
      || custody.expectedDirtyManifestDigest !== dirtyManifestDigest(boundary)) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "execution permit compiler requires exact ACTIVE workspace custody");
  }
  const body = {
    schemaVersion: EXECUTION_PERMIT_SCHEMA,
    permitId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    sliceId: session.sessionDigest,
    generation: custody.generation,
    issuedAt: now.toISOString(),
    state: "ISSUED",
    authority: {
      repositoryRoot: path.resolve(repositoryRoot),
      workspaceId: custody.workspaceId,
      workspacePath: path.resolve(workspacePath),
      workspaceCustodyDigest: custody.recordDigest,
      workspaceLeaseDigest: lease.leaseDigest,
      branch: boundary.branch,
      baseHead: custody.baseHead,
      baselineHead: boundary.head,
      productDirectionDigest: session.productDirection.digest,
      sessionDigest: session.sessionDigest,
      ownedPathSetDigest: ownedPathSetDigest(session.allowedPaths),
      initialDirtyManifestDigest: dirtyManifestDigest(boundary),
    },
    capabilities: grantedCapabilities(session),
  };
  const permit = validateExecutionPermit({ ...body, permitDigest: computeExecutionPermitDigest(body) });
  writeCreateOnlyJson(permitPath(stateDirectory, permit.permitId), permit, "MH_EXECUTION_PERMIT_ISSUE");
  return permit;
}

function readPersistedPermit(stateDirectory, permit) {
  const filePath = permitPath(stateDirectory, permit.permitId);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("MH_EXECUTION_PERMIT_MISSING", `persisted execution permit is unreadable: ${error.message}`);
  }
  const persisted = validateExecutionPermit(parsed);
  if (persisted.permitDigest !== permit.permitDigest) {
    fail("MH_EXECUTION_PERMIT_SUBSTITUTION", "persisted execution permit does not match the issued permit");
  }
  return persisted;
}

function assertPermitCapability(permit, capability) {
  const validated = validateExecutionPermit(permit);
  if (!MATERIAL_CAPABILITY_SET.has(capability)) {
    fail("MH_EXECUTION_PERMIT_CAPABILITY", `unknown execution capability: ${capability}`);
  }
  if (!validated.capabilities.includes(capability)) {
    fail("MH_EXECUTION_CAPABILITY_DENIED", `execution capability is not granted: ${capability}`);
  }
  return validated;
}

function readEnteredAttemptPermit(stateDirectory, attemptEntry) {
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.schemaVersion === ATTEMPT_ENTRY_SCHEMA) {
    fail("MH_ATTEMPT_ENTRY_CAPABILITY", "claimless RUN_CAPABILITY attempts do not have an ExecutionPermit");
  }
  const parsed = readPersistedPermit(stateDirectory, { permitId: entry.permitId, permitDigest: entry.permitDigest });
  if (parsed.permitId !== entry.permitId
      || parsed.permitDigest !== entry.permitDigest
      || parsed.attemptId !== entry.attemptId
      || parsed.generation !== entry.generation
      || parsed.authority.sessionDigest !== entry.sessionDigest
      || parsed.authority.workspaceId !== entry.workspaceId) {
    fail("MH_ATTEMPT_ENTRY_MISMATCH", "persisted execution permit does not match its entered AttemptEntry");
  }
  return parsed;
}

function createAttemptEntry(validatedPermit, session, now) {
  const body = {
    schemaVersion: LEGACY_ATTEMPT_ENTRY_SCHEMA,
    permitId: validatedPermit.permitId,
    permitDigest: validatedPermit.permitDigest,
    sessionDigest: validatedPermit.authority.sessionDigest,
    attemptId: validatedPermit.attemptId,
    generation: validatedPermit.generation,
    ordinal: validatedPermit.generation,
    workspaceId: validatedPermit.authority.workspaceId,
    origin: JSON.parse(JSON.stringify(session.origin)),
    enteredAt: now.toISOString(),
  };
  return validateAttemptEntry({ ...body, entryDigest: computeAttemptEntryDigest(body) });
}

function enterExecutionAttempt({ stateDirectory, permit, session, entryCapability = "CODE_PROPOSE", now = new Date() }) {
  const validated = assertPermitCapability(readPersistedPermit(stateDirectory, permit), entryCapability);
  if (!session || session.sessionDigest !== validated.authority.sessionDigest || !session.origin) {
    fail("MH_ATTEMPT_ENTRY_SESSION", "AttemptEntry requires the exact sealed work session bound to the permit");
  }
  const entry = createAttemptEntry(validated, session, now);
  const repositoryPath = validated.authority.repositoryRoot;
  const originPath = attemptEntryOrigin(session, validated.authority.workspaceId);
  const filePath = attemptEntryPath(repositoryPath, originPath, entry.ordinal);

  if (session.origin.type === "OWNER_GOAL") {
    writeAuthorityCreateOnlyJson(filePath, entry, "MH_EXECUTION_PERMIT_REPLAY");
    return entry;
  }

  if (session.origin.type === "REPO_RUN") {
    if (findExecutionClosureForOrigin(repositoryPath, session.origin)) {
      fail("MH_ATTEMPT_ENTRY_CONTINUATION", "repo run execution is already closed");
    }
    if (entry.ordinal > 1) {
      const first = readAttemptEntry({
        repositoryPath,
        session,
        workspaceId: entry.workspaceId,
        generation: 1,
      });
      if (first.sessionDigest !== entry.sessionDigest || first.workspaceId !== entry.workspaceId) {
        fail("MH_ATTEMPT_ENTRY_CONTINUATION", "repair must retain the same sealed run inside this workspace child");
      }
    }
    writeAuthorityCreateOnlyJson(filePath, entry, "MH_EXECUTION_PERMIT_REPLAY");
    return entry;
  }

  if (session.origin.type === "REPO_OUTCOME") {
    return withOutcomeClaimLock(repositoryPath, session.origin.outcomeDigest, () => {
      assertOutcomeClaimSessionExecution({
        repositoryPath,
        claimDigest: session.origin.claimDigest,
        outcomeDigest: session.origin.outcomeDigest,
        sessionDigest: session.sessionDigest,
      });
      if (findExecutionClosureForOrigin(repositoryPath, session.origin)) {
        fail("MH_ATTEMPT_ENTRY_CONTINUATION", "Outcome execution is already closed");
      }
      if (entry.ordinal > 1) {
        const first = readAttemptEntry({
          repositoryPath,
          session,
          workspaceId: entry.workspaceId,
          generation: 1,
        });
        if (first.sessionDigest !== entry.sessionDigest || first.workspaceId !== entry.workspaceId) {
          fail("MH_ATTEMPT_ENTRY_CONTINUATION", "repair must retain the same sealed session inside this workspace child");
        }
      }
      writeAuthorityCreateOnlyJson(filePath, entry, "MH_EXECUTION_PERMIT_REPLAY");
      return entry;
    });
  }

  return withLegacyAdmissionCheck(repositoryPath, () => {
    const decision = readImmutableJson(repositoryPath, "decisions", session.origin.decisionDigest);
    const current = readCurrentWorldPointer(repositoryPath, { optional: true });
    if (!current || decision.worldHeadDigest !== current.headDigest) {
      fail("MH_REPO_DECISION_STALE", "Repo Decision WorldHead changed before durable AttemptEntry admission");
    }
    const admission = admissionForHead(repositoryPath, current.headDigest);
    if (entry.ordinal === 1) {
      if (admission) fail("MH_REPO_DECISION_CONSUMED", "the current WorldHead already has an admitted Repo Decision");
    } else {
      if (!admission || admission.decisionDigest !== session.origin.decisionDigest) {
        fail("MH_ATTEMPT_ENTRY_CONTINUATION", "bounded repair must continue the exact Repo Decision admitted by generation 1");
      }
      const first = validateAttemptEntry(admission.entry);
      if (first.sessionDigest !== entry.sessionDigest || first.workspaceId !== entry.workspaceId) {
        fail("MH_ATTEMPT_ENTRY_CONTINUATION", "bounded repair must retain the admitted session and workspace authority");
      }
      if (findExecutionClosureForDecision(repositoryPath, session.origin.decisionDigest)) {
        fail("MH_ATTEMPT_ENTRY_CONTINUATION", "bounded repair cannot enter after aggregate execution closure");
      }
    }
    writeAuthorityCreateOnlyJson(filePath, entry, "MH_EXECUTION_PERMIT_REPLAY");
    return entry;
  });
}

function assertEnteredPermitCapability({ stateDirectory, permit, attemptEntry, capability }) {
  const entry = validateAttemptEntry(attemptEntry);
  if (entry.schemaVersion === ATTEMPT_ENTRY_SCHEMA) {
    fail("MH_ATTEMPT_ENTRY_CAPABILITY", "RUN_CAPABILITY attempts are enforced by scoped tools and controller boundary checks, not ExecutionPermit capability assertions");
  }
  const validated = assertPermitCapability(readPersistedPermit(stateDirectory, permit), capability);
  if (entry.permitId !== validated.permitId
      || entry.permitDigest !== validated.permitDigest
      || entry.attemptId !== validated.attemptId
      || entry.generation !== validated.generation
      || entry.sessionDigest !== validated.authority.sessionDigest) {
    fail("MH_ATTEMPT_ENTRY_MISMATCH", "AttemptEntry does not match the execution permit");
  }
  return validated;
}

function assertExecutionPermitCurrent({
  permit,
  session,
  repositoryRoot,
  workspacePath,
  workspaceCustody,
  workspaceLease,
  workspaceRegistryDir,
  boundary,
  requireInitialDirtyManifest = false,
}) {
  const validated = validateExecutionPermit(permit);
  const custody = validateWorkspaceCustody(workspaceCustody);
  const lease = assertWorkspaceExecutionLease({
    registryDir: workspaceRegistryDir,
    lease: workspaceLease,
    workspaceId: custody.workspaceId,
  });
  assertProductDirectionUnchanged(session.productDirection, repositoryRoot);
  if (validated.authority.sessionDigest !== session.sessionDigest
      || validated.sliceId !== session.sessionDigest
      || validated.authority.productDirectionDigest !== session.productDirection.digest) {
    fail("MH_EXECUTION_PERMIT_STALE", "execution permit is not bound to the current sealed work session");
  }
  if (!samePath(validated.authority.repositoryRoot, repositoryRoot)
      || !samePath(validated.authority.workspacePath, workspacePath)
      || validated.authority.workspaceId !== custody.workspaceId
      || validated.authority.workspaceCustodyDigest !== custody.recordDigest
      || validated.authority.workspaceLeaseDigest !== lease.leaseDigest
      || validated.generation !== custody.generation
      || validated.authority.baseHead !== session.base.commit
      || validated.authority.baseHead !== custody.baseHead
      || custody.state !== "ACTIVE") {
    fail("MH_EXECUTION_PERMIT_STALE", "execution permit repository/workspace custody no longer matches");
  }
  if (validated.authority.baselineHead !== boundary.head || validated.authority.branch !== boundary.branch) {
    fail("MH_EXECUTION_PERMIT_STALE", "execution permit Git authority baseline no longer matches");
  }
  if (validated.authority.ownedPathSetDigest !== ownedPathSetDigest(session.allowedPaths)) {
    fail("MH_EXECUTION_PERMIT_STALE", "execution permit owned path set no longer matches");
  }
  if (requireInitialDirtyManifest
      && validated.authority.initialDirtyManifestDigest !== dirtyManifestDigest(boundary)) {
    fail("MH_EXECUTION_PERMIT_STALE", "execution permit generation baseline changed before execution");
  }
  return validated;
}

function executionPermitProjection(permit) {
  const validated = validateExecutionPermit(permit);
  return [
    `PERMIT       ${validated.permitId}`,
    `ATTEMPT      ${validated.attemptId}`,
    `GENERATION   ${validated.generation}`,
    `AUTHORITY    ${validated.authority.baselineHead} @ ${validated.authority.branch || "DETACHED"}`,
    `SESSION      ${validated.authority.sessionDigest}`,
    `CAPABILITIES ${validated.capabilities.join(", ")}`,
    "FORBIDDEN    every material capability not listed above",
    "REPLAY       forbidden; this permit is single-use",
  ].join("\n");
}

module.exports = {
  EXECUTION_PERMIT_DOMAIN,
  EXECUTION_PERMIT_SCHEMA,
  MATERIAL_CAPABILITIES,
  RUN_CAPABILITY_GRANT_DOMAIN,
  RUN_CAPABILITY_GRANT_SCHEMA,
  RUN_CAPABILITY_OPERATIONS,
  assertEnteredPermitCapability,
  assertRunCapabilityGrant,
  assertExecutionPermitCurrent,
  assertPermitCapability,
  computeExecutionPermitDigest,
  enterExecutionAttempt,
  executionPermitProjection,
  grantedCapabilities,
  issueExecutionPermit,
  ownedPathSetDigest,
  readEnteredAttemptPermit,
  runCapabilityGrant,
  runCapabilityOperations,
  validateExecutionPermit,
};
