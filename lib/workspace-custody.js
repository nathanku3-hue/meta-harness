"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { writeJsonAtomic } = require("./paths");
const { pathIdentity: workspacePathIdentity } = require("./runtime-identity");

const WORKSPACE_CUSTODY_SCHEMA = "workspace-custody/v1";
const WORKSPACE_CUSTODY_DOMAIN = "meta-harness-workspace-custody/v1";
const WORKSPACE_TERMINAL_DOMAIN = "meta-harness-workspace-terminal/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const WORKSPACE_STATES = Object.freeze([
  "CREATED_CLEAN",
  "ACTIVE",
  "TERMINAL_COMMITTED",
  "TERMINAL_SEALED_DIRTY",
  "TERMINAL_BLOCKED",
  "TERMINAL_BLOCKED_DIRTY",
  "TERMINAL_ABANDONED",
]);
const WORKSPACE_STATE_SET = new Set(WORKSPACE_STATES);
const TERMINAL_STATES = new Set(WORKSPACE_STATES.filter((state) => state.startsWith("TERMINAL_")));

const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "workspaceId",
  "sessionDigest",
  "repositoryRoot",
  "workspacePath",
  "baseHead",
  "branch",
  "gitWorktreeIdentityDigest",
  "state",
  "generation",
  "expectedDirtyManifestDigest",
  "createdAt",
  "updatedAt",
  "terminal",
  "recordDigest",
]);

const TERMINAL_KEYS = Object.freeze([
  "terminalState",
  "resultDigest",
  "validationDigest",
  "finalDirtyManifestDigest",
  "changedPathHashes",
  "commitSha",
  "terminalizedAt",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORKSPACE_CUSTODY_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORKSPACE_CUSTODY_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORKSPACE_CUSTODY_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function samePath(left, right) {
  return workspacePathIdentity(left) === workspacePathIdentity(right);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function custodyBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.recordDigest;
  return body;
}

function computeWorkspaceCustodyDigest(value) {
  return domainDigest(WORKSPACE_CUSTODY_DOMAIN, custodyBody(value));
}

function validateChangedPathHashes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORKSPACE_CUSTODY_TERMINAL", "terminal.changedPathHashes must be an object");
  }
  for (const [itemPath, digest] of Object.entries(value)) {
    nonEmptyString(itemPath, "terminal changed path");
    if (!isDigest(digest)) {
      fail("MH_WORKSPACE_CUSTODY_TERMINAL", `terminal changed path hash must be a digest: ${itemPath}`);
    }
  }
}

function validateTerminal(value, state) {
  if (value === null) {
    if (TERMINAL_STATES.has(state)) {
      fail("MH_WORKSPACE_CUSTODY_TERMINAL", "terminal workspace state requires terminal evidence");
    }
    return null;
  }
  if (!TERMINAL_STATES.has(state)) {
    fail("MH_WORKSPACE_CUSTODY_TERMINAL", "non-terminal workspace state must not contain terminal evidence");
  }
  exactKeys(value, TERMINAL_KEYS, "workspaceCustody.terminal");
  if (value.terminalState !== state) {
    fail("MH_WORKSPACE_CUSTODY_TERMINAL", "terminal evidence state does not match workspace state");
  }
  for (const field of ["resultDigest", "validationDigest", "finalDirtyManifestDigest"]) {
    if (!isDigest(value[field])) {
      fail("MH_WORKSPACE_CUSTODY_TERMINAL", `terminal.${field} must be a sha256 digest`);
    }
  }
  validateChangedPathHashes(value.changedPathHashes);
  if (value.commitSha !== null && (typeof value.commitSha !== "string" || !/^[a-f0-9]{40,64}$/u.test(value.commitSha))) {
    fail("MH_WORKSPACE_CUSTODY_TERMINAL", "terminal.commitSha must be null or a Git object id");
  }
  if (!Number.isFinite(Date.parse(value.terminalizedAt))) {
    fail("MH_WORKSPACE_CUSTODY_TERMINAL", "terminal.terminalizedAt must be an ISO timestamp");
  }
  return value;
}

function validateWorkspaceCustody(value) {
  exactKeys(value, TOP_KEYS, "workspaceCustody");
  if (value.schemaVersion !== WORKSPACE_CUSTODY_SCHEMA) {
    fail("MH_WORKSPACE_CUSTODY_SCHEMA", `workspaceCustody.schemaVersion must be ${WORKSPACE_CUSTODY_SCHEMA}`);
  }
  if (!UUID_RE.test(value.workspaceId)) {
    fail("MH_WORKSPACE_CUSTODY_ID", "workspaceCustody.workspaceId must be a canonical random UUID");
  }
  if (!isDigest(value.sessionDigest)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "workspaceCustody.sessionDigest must be a sha256 digest");
  }
  nonEmptyString(value.repositoryRoot, "workspaceCustody.repositoryRoot");
  nonEmptyString(value.workspacePath, "workspaceCustody.workspacePath");
  if (typeof value.baseHead !== "string" || !/^[a-f0-9]{40,64}$/u.test(value.baseHead)) {
    fail("MH_WORKSPACE_CUSTODY_HEAD", "workspaceCustody.baseHead must be a Git object id");
  }
  nonEmptyString(value.branch, "workspaceCustody.branch");
  if (!isDigest(value.gitWorktreeIdentityDigest)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "workspaceCustody.gitWorktreeIdentityDigest must be a sha256 digest");
  }
  if (!WORKSPACE_STATE_SET.has(value.state)) {
    fail("MH_WORKSPACE_CUSTODY_STATE", `unknown workspace custody state: ${value.state}`);
  }
  if (!Number.isInteger(value.generation) || value.generation < 1) {
    fail("MH_WORKSPACE_CUSTODY_GENERATION", "workspaceCustody.generation must be a positive integer");
  }
  if (!isDigest(value.expectedDirtyManifestDigest)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "workspaceCustody.expectedDirtyManifestDigest must be a sha256 digest");
  }
  for (const field of ["createdAt", "updatedAt"]) {
    if (!Number.isFinite(Date.parse(value[field]))) {
      fail("MH_WORKSPACE_CUSTODY_TIME", `workspaceCustody.${field} must be an ISO timestamp`);
    }
  }
  validateTerminal(value.terminal, value.state);
  if (!isDigest(value.recordDigest) || value.recordDigest !== computeWorkspaceCustodyDigest(value)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "workspaceCustody.recordDigest does not match its body");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function registryDirectory(gitCommonDirectory, { create = true } = {}) {
  const directory = path.join(path.resolve(nonEmptyString(gitCommonDirectory, "gitCommonDirectory")), "meta-harness", "workspaces");
  if (create) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function recordPath(directory, workspaceId) {
  if (!UUID_RE.test(workspaceId)) {
    fail("MH_WORKSPACE_CUSTODY_ID", "workspaceId must be a canonical random UUID");
  }
  return path.join(path.resolve(directory), `${workspaceId}.json`);
}

function createOnlyJson(filePath, value) {
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("MH_WORKSPACE_CUSTODY_EXISTS", `workspace custody already exists: ${path.basename(filePath)}`);
    }
    fail("MH_WORKSPACE_CUSTODY_WRITE", `cannot create workspace custody: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sealRecord(body) {
  return validateWorkspaceCustody({ ...body, recordDigest: computeWorkspaceCustodyDigest(body) });
}

function createWorkspaceCustody({
  registryDir,
  workspaceId,
  sessionDigest,
  repositoryRoot,
  workspacePath,
  baseHead,
  branch,
  gitWorktreeIdentityDigest,
  expectedDirtyManifestDigest,
  now = new Date(),
}) {
  const timestamp = now.toISOString();
  const record = sealRecord({
    schemaVersion: WORKSPACE_CUSTODY_SCHEMA,
    workspaceId,
    sessionDigest,
    repositoryRoot: path.resolve(repositoryRoot),
    workspacePath: path.resolve(workspacePath),
    baseHead,
    branch,
    gitWorktreeIdentityDigest,
    state: "CREATED_CLEAN",
    generation: 1,
    expectedDirtyManifestDigest,
    createdAt: timestamp,
    updatedAt: timestamp,
    terminal: null,
  });
  createOnlyJson(recordPath(registryDir, workspaceId), record);
  return record;
}

function readWorkspaceCustody(registryDir, workspaceId) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(recordPath(registryDir, workspaceId), "utf8"));
  } catch (error) {
    fail("MH_WORKSPACE_CUSTODY_READ", `workspace custody is unreadable: ${error.message}`);
  }
  return validateWorkspaceCustody(parsed);
}

function listWorkspaceCustodies(registryDir) {
  const directory = path.resolve(nonEmptyString(registryDir, "registryDir"));
  if (!fs.existsSync(directory)) return Object.freeze([]);
  const records = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/u.test(entry.name))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((workspaceId) => UUID_RE.test(workspaceId))
    .map((workspaceId) => readWorkspaceCustody(directory, workspaceId))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  return Object.freeze(records);
}

function writeTransition(registryDir, expected, nextBody) {
  const current = readWorkspaceCustody(registryDir, expected.workspaceId);
  if (current.recordDigest !== expected.recordDigest) {
    fail("MH_WORKSPACE_CUSTODY_CONFLICT", "workspace custody changed before controller transition");
  }
  const next = sealRecord(nextBody);
  writeJsonAtomic(recordPath(registryDir, expected.workspaceId), next);
  return readWorkspaceCustody(registryDir, expected.workspaceId);
}

function activateWorkspaceCustody({ registryDir, custody, now = new Date() }) {
  const current = validateWorkspaceCustody(custody);
  if (current.state !== "CREATED_CLEAN") {
    fail("MH_WORKSPACE_CUSTODY_TRANSITION", "only CREATED_CLEAN workspace custody may become ACTIVE");
  }
  return writeTransition(registryDir, current, {
    ...custodyBody(current),
    state: "ACTIVE",
    updatedAt: now.toISOString(),
  });
}

function advanceWorkspaceGeneration({ registryDir, custody, expectedDirtyManifestDigest, now = new Date() }) {
  const current = validateWorkspaceCustody(custody);
  if (current.state !== "ACTIVE") {
    fail("MH_WORKSPACE_NOT_EXECUTABLE", "only ACTIVE workspace custody may advance generation");
  }
  if (!isDigest(expectedDirtyManifestDigest)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "next expected dirty manifest must be a sha256 digest");
  }
  return writeTransition(registryDir, current, {
    ...custodyBody(current),
    generation: current.generation + 1,
    expectedDirtyManifestDigest,
    updatedAt: now.toISOString(),
  });
}

function restoreWorkspaceCustodyBaseline({ registryDir, custody, expectedDirtyManifestDigest, now = new Date() }) {
  const current = validateWorkspaceCustody(custody);
  if (current.state !== "ACTIVE" || current.generation !== 1) {
    fail("MH_WORKSPACE_CUSTODY_TRANSITION", "only ACTIVE generation-1 custody may adopt a journal-restored baseline");
  }
  if (!isDigest(expectedDirtyManifestDigest)) {
    fail("MH_WORKSPACE_CUSTODY_DIGEST", "restored baseline dirty manifest must be a sha256 digest");
  }
  return writeTransition(registryDir, current, {
    ...custodyBody(current),
    expectedDirtyManifestDigest,
    updatedAt: now.toISOString(),
  });
}

function terminalEvidenceDigest(value) {
  return domainDigest(WORKSPACE_TERMINAL_DOMAIN, value);
}

function terminalizeWorkspaceCustody({
  registryDir,
  custody,
  terminalState,
  resultDigest,
  validationDigest,
  finalDirtyManifestDigest,
  changedPathHashes = {},
  commitSha = null,
  now = new Date(),
}) {
  const current = validateWorkspaceCustody(custody);
  if (current.state !== "ACTIVE") {
    fail("MH_WORKSPACE_CUSTODY_TRANSITION", "only ACTIVE workspace custody may terminalize");
  }
  if (!TERMINAL_STATES.has(terminalState)) {
    fail("MH_WORKSPACE_CUSTODY_TRANSITION", `invalid terminal workspace state: ${terminalState}`);
  }
  const terminal = {
    terminalState,
    resultDigest,
    validationDigest,
    finalDirtyManifestDigest,
    changedPathHashes,
    commitSha,
    terminalizedAt: now.toISOString(),
  };
  validateTerminal(terminal, terminalState);
  return writeTransition(registryDir, current, {
    ...custodyBody(current),
    state: terminalState,
    expectedDirtyManifestDigest: finalDirtyManifestDigest,
    updatedAt: terminal.terminalizedAt,
    terminal,
  });
}

function assertWorkspaceCustodyExecutable({
  custody,
  sessionDigest,
  repositoryRoot,
  workspacePath,
  branch,
  baseHead,
  generation,
  dirtyManifestDigest,
}) {
  const current = validateWorkspaceCustody(custody);
  if (current.sessionDigest !== sessionDigest
      || !samePath(current.repositoryRoot, repositoryRoot)
      || !samePath(current.workspacePath, workspacePath)
      || current.branch !== branch
      || current.baseHead !== baseHead
      || current.generation !== generation
      || current.expectedDirtyManifestDigest !== dirtyManifestDigest) {
    fail("MH_WORKSPACE_CUSTODY_MISMATCH", "workspace bytes or identity do not match exact recorded recovery facts");
  }
  return current;
}

module.exports = {
  TERMINAL_STATES,
  WORKSPACE_CUSTODY_DOMAIN,
  WORKSPACE_CUSTODY_SCHEMA,
  WORKSPACE_STATES,
  activateWorkspaceCustody,
  advanceWorkspaceGeneration,
  assertWorkspaceCustodyExecutable,
  computeWorkspaceCustodyDigest,
  createWorkspaceCustody,
  listWorkspaceCustodies,
  readWorkspaceCustody,
  registryDirectory,
  restoreWorkspaceCustodyBaseline,
  terminalEvidenceDigest,
  terminalizeWorkspaceCustody,
  validateWorkspaceCustody,
  workspacePathIdentity,
};
