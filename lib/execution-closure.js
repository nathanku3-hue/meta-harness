"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  attemptEntriesRoot,
  objectPath,
  persistImmutableJson,
  readImmutableJson,
} = require("./protocol-store");

const EXECUTION_WORK_RESULT_SCHEMA = "execution-work-result/v2";
const EXECUTION_WORK_RESULT_DOMAIN = "meta-harness-execution-work-result/v2";
const EXECUTION_CLOSURE_SCHEMA = "execution-closure/v2";
const EXECUTION_CLOSURE_DOMAIN = "meta-harness-execution-closure/v2";
const DISPOSITIONS = new Set([
  "COMPLETED",
  "PARTIAL",
  "INCOMPLETE",
  "CONTROLLER_REJECTED",
  "INTERRUPTED_AFTER_ENTRY",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_EXECUTION_CLOSURE_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_EXECUTION_CLOSURE_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_EXECUTION_CLOSURE_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function requireRepoExecutionOrigin(origin, label) {
  if (origin?.type !== "REPO_RUN") {
    fail("MH_EXECUTION_CLOSURE_ORIGIN", `${label}.type must be REPO_RUN`);
  }
  exactKeys(origin, ["type", "outcomeDigest", "objectiveRevision"], label);
  requireDigest(origin.outcomeDigest, `${label}.outcomeDigest`);
  if (!Number.isInteger(origin.objectiveRevision) || origin.objectiveRevision < 0) {
    fail("MH_EXECUTION_CLOSURE_ORIGIN", `${label} REPO_RUN provenance is invalid`);
  }
  return origin;
}

function originEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function workResultBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.workResultDigest;
  return body;
}

function computeExecutionWorkResultDigest(value) {
  return domainDigest(EXECUTION_WORK_RESULT_DOMAIN, workResultBody(value));
}

function validateExecutionWorkResult(value) {
  exactKeys(value, [
    "schemaVersion",
    "sessionDigest",
    "origin",
    "result",
    "recordedAt",
    "workResultDigest",
  ], "executionWorkResult");
  if (value.schemaVersion !== EXECUTION_WORK_RESULT_SCHEMA) {
    fail("MH_EXECUTION_WORK_RESULT_SCHEMA", `executionWorkResult.schemaVersion must be ${EXECUTION_WORK_RESULT_SCHEMA}`);
  }
  requireDigest(value.sessionDigest, "executionWorkResult.sessionDigest");
  requireRepoExecutionOrigin(value.origin, "executionWorkResult.origin");
  if (!value.result || typeof value.result !== "object" || Array.isArray(value.result)) {
    fail("MH_EXECUTION_WORK_RESULT_VALUE", "executionWorkResult.result must be an object");
  }
  if (value.result.sessionDigest !== value.sessionDigest) {
    fail("MH_EXECUTION_WORK_RESULT_VALUE", "executionWorkResult result does not belong to the sealed session");
  }
  if (!Number.isFinite(Date.parse(value.recordedAt))) {
    fail("MH_EXECUTION_WORK_RESULT_VALUE", "executionWorkResult.recordedAt must be an ISO timestamp");
  }
  requireDigest(value.workResultDigest, "executionWorkResult.workResultDigest");
  if (value.workResultDigest !== computeExecutionWorkResultDigest(value)) {
    fail("MH_EXECUTION_WORK_RESULT_DIGEST", "executionWorkResult.workResultDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function repoExecutionOrigin(session) {
  if (session?.origin?.type !== "REPO_RUN") return null;
  return JSON.parse(JSON.stringify(requireRepoExecutionOrigin(session.origin, "workSession.origin")));
}

function persistExecutionWorkResult(repositoryPath, session, result, now = new Date()) {
  const origin = repoExecutionOrigin(session);
  if (!origin) return null;
  const body = {
    schemaVersion: EXECUTION_WORK_RESULT_SCHEMA,
    sessionDigest: session.sessionDigest,
    origin,
    result: JSON.parse(JSON.stringify(result)),
    recordedAt: now.toISOString(),
  };
  const record = validateExecutionWorkResult({
    ...body,
    workResultDigest: computeExecutionWorkResultDigest(body),
  });
  persistImmutableJson(repositoryPath, "work-results", record.workResultDigest, record, "MH_EXECUTION_WORK_RESULT_WRITE");
  return record;
}

function closureBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.closureDigest;
  return body;
}

function computeExecutionClosureDigest(value) {
  return domainDigest(EXECUTION_CLOSURE_DOMAIN, closureBody(value));
}

function validateExecutionClosure(value) {
  exactKeys(value, [
    "schemaVersion",
    "sessionDigest",
    "origin",
    "attemptEntries",
    "disposition",
    "workResultDigest",
    "closedAt",
    "closureDigest",
  ], "executionClosure");
  if (value.schemaVersion !== EXECUTION_CLOSURE_SCHEMA) {
    fail("MH_EXECUTION_CLOSURE_SCHEMA", `executionClosure.schemaVersion must be ${EXECUTION_CLOSURE_SCHEMA}`);
  }
  requireDigest(value.sessionDigest, "executionClosure.sessionDigest");
  requireRepoExecutionOrigin(value.origin, "executionClosure.origin");
  if (!Array.isArray(value.attemptEntries) || value.attemptEntries.length === 0 || value.attemptEntries.length > 12) {
    fail("MH_EXECUTION_CLOSURE_VALUE", "executionClosure.attemptEntries must contain 1-12 ordered AttemptEntry digests");
  }
  value.attemptEntries.forEach((entry, index) => requireDigest(entry, `executionClosure.attemptEntries[${index}]`));
  if (new Set(value.attemptEntries).size !== value.attemptEntries.length) {
    fail("MH_EXECUTION_CLOSURE_VALUE", "executionClosure.attemptEntries must not contain duplicates");
  }
  if (!DISPOSITIONS.has(value.disposition)) {
    fail("MH_EXECUTION_CLOSURE_VALUE", `invalid operational disposition: ${value.disposition}`);
  }
  if (value.workResultDigest !== null) requireDigest(value.workResultDigest, "executionClosure.workResultDigest");
  if (value.disposition === "INTERRUPTED_AFTER_ENTRY" && value.workResultDigest !== null) {
    fail("MH_EXECUTION_CLOSURE_VALUE", "INTERRUPTED_AFTER_ENTRY cannot claim a durable work result");
  }
  if (!Number.isFinite(Date.parse(value.closedAt))) {
    fail("MH_EXECUTION_CLOSURE_VALUE", "executionClosure.closedAt must be an ISO timestamp");
  }
  requireDigest(value.closureDigest, "executionClosure.closureDigest");
  if (value.closureDigest !== computeExecutionClosureDigest(value)) {
    fail("MH_EXECUTION_CLOSURE_DIGEST", "executionClosure.closureDigest does not match its body");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function dispositionFromWorkResult(result) {
  if (result?.outcome === "DONE") return "COMPLETED";
  if (result?.outcome === "PARTIAL") return "PARTIAL";
  return "INCOMPLETE";
}

function validatePersistedAttemptEntry(value) {
  const { validateAttemptEntry } = require("./execution-attempt");
  return validateAttemptEntry(value);
}

function readAttemptEntryFile(filePath, validatedOrigin) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("MH_ATTEMPT_ENTRY_READ", `AttemptEntry is unreadable: ${error.message}`);
  }
  const entry = validatePersistedAttemptEntry(parsed);
  if (!originEqual(entry.origin, validatedOrigin) || entry.ordinal !== entry.generation) {
    fail("MH_ATTEMPT_ENTRY_READ", "AttemptEntry path identity does not match its body");
  }
  return entry;
}

function readRunAttemptEntries(repositoryPath, validatedOrigin, workspaceId = null) {
  const root = path.join(
    attemptEntriesRoot(repositoryPath),
    "runs",
    validatedOrigin.sessionDigest.slice("sha256:".length),
    "workspaces",
  );
  if (!fs.existsSync(root)) return [];
  const workspaces = workspaceId === null
    ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [workspaceId];
  const entries = [];
  for (const currentWorkspaceId of workspaces) {
    const directory = path.join(root, currentWorkspaceId);
    if (!fs.existsSync(directory)) continue;
    const workspaceEntries = fs.readdirSync(directory)
      .filter((name) => /^\d+\.json$/u.test(name))
      .map((name) => readAttemptEntryFile(path.join(directory, name), validatedOrigin.origin))
      .sort((left, right) => left.ordinal - right.ordinal);
    for (let index = 0; index < workspaceEntries.length; index += 1) {
      if (workspaceEntries[index].ordinal !== index + 1 || workspaceEntries[index].workspaceId !== currentWorkspaceId) {
        fail("MH_ATTEMPT_ENTRY_READ", "run AttemptEntry generations must be contiguous from generation 1");
      }
    }
    entries.push(...workspaceEntries);
  }
  return entries.sort((left, right) => Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.workspaceId.localeCompare(right.workspaceId)
    || left.ordinal - right.ordinal);
}

function readAttemptEntriesForOrigin(repositoryPath, origin, sessionDigest = null, workspaceId = null) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  if (!isDigest(sessionDigest)) fail("MH_ATTEMPT_ENTRY_READ", "REPO_RUN attempt recovery requires sessionDigest");
  return readRunAttemptEntries(repositoryPath, { sessionDigest, origin: validatedOrigin }, workspaceId);
}

function closureWorkspaceId(repositoryPath, closure) {
  const validated = validateExecutionClosure(closure);
  if (validated.origin.type !== "REPO_RUN") return null;
  const allEntries = readAttemptEntriesForOrigin(
    repositoryPath,
    validated.origin,
    validated.sessionDigest,
  );
  const referenced = allEntries.filter((entry) => validated.attemptEntries.includes(entry.entryDigest));
  if (referenced.length !== validated.attemptEntries.length) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure AttemptEntry references do not resolve to one physical execution");
  }
  const workspaceIds = [...new Set(referenced.map((entry) => entry.workspaceId))];
  if (workspaceIds.length !== 1) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure must bind exactly one physical workspace execution");
  }
  return workspaceIds[0];
}

function readExecutionWorkResult(repositoryPath, workResultDigest) {
  const record = validateExecutionWorkResult(
    readImmutableJson(repositoryPath, "work-results", workResultDigest),
  );
  if (record.workResultDigest !== workResultDigest) {
    fail("MH_EXECUTION_WORK_RESULT_DIGEST", "immutable work-result path identity does not match its body");
  }
  return record;
}

function assertExecutionClosureReferences(repositoryPath, closure) {
  const workspaceId = closure.origin.type === "REPO_RUN"
    ? closureWorkspaceId(repositoryPath, closure)
    : null;
  const entries = readAttemptEntriesForOrigin(
    repositoryPath,
    closure.origin,
    closure.sessionDigest,
    workspaceId,
  );
  const actualDigests = entries.map((entry) => entry.entryDigest);
  if (JSON.stringify(actualDigests) !== JSON.stringify(closure.attemptEntries)) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure AttemptEntry references do not resolve exactly to the recorded execution", {
      expected: closure.attemptEntries,
      actual: actualDigests,
    });
  }
  if (entries.length === 0 || entries[0].sessionDigest !== closure.sessionDigest) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure does not bind the recorded work session");
  }
  if (closure.workResultDigest !== null) {
    const workResult = readExecutionWorkResult(repositoryPath, closure.workResultDigest);
    if (workResult.sessionDigest !== closure.sessionDigest
        || !originEqual(workResult.origin, closure.origin)
        || (workspaceId !== null && workResult.result?.workspace?.workspaceId !== workspaceId)) {
      fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure work-result reference does not resolve to the recorded physical execution");
    }
  }
  return closure;
}

function immutableKindFiles(repositoryPath, kind) {
  const directory = path.dirname(objectPath(repositoryPath, kind, `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `sha256:${name.slice(0, 64)}`);
}

function executionWorkResultsForOrigin(repositoryPath, origin) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "work-results")) {
    const raw = readImmutableJson(repositoryPath, "work-results", candidateDigest);
    if (raw?.schemaVersion !== EXECUTION_WORK_RESULT_SCHEMA) continue;
    const candidate = validateExecutionWorkResult(raw);
    if (candidate.workResultDigest !== candidateDigest) {
      fail("MH_EXECUTION_WORK_RESULT_DIGEST", "immutable work-result path identity does not match its body");
    }
    if (originEqual(candidate.origin, validatedOrigin)) matches.push(candidate);
  }
  return matches;
}

function findExecutionWorkResultForWorkspace(repositoryPath, origin, sessionDigest, workspaceId) {
  return executionWorkResultsForOrigin(repositoryPath, origin)
    .filter((candidate) => candidate.sessionDigest === sessionDigest
      && candidate.result?.workspace?.workspaceId === workspaceId)
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
      || left.workResultDigest.localeCompare(right.workResultDigest))
    .at(-1) || null;
}

function findExecutionClosuresForOrigin(repositoryPath, origin) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "execution-closures")) {
    const raw = readImmutableJson(repositoryPath, "execution-closures", candidateDigest);
    if (raw?.schemaVersion !== EXECUTION_CLOSURE_SCHEMA) continue;
    const candidate = validateExecutionClosure(raw);
    if (candidate.closureDigest !== candidateDigest) {
      fail("MH_EXECUTION_CLOSURE_DIGEST", "immutable ExecutionClosure path identity does not match its body");
    }
    if (originEqual(candidate.origin, validatedOrigin)) {
      matches.push(assertExecutionClosureReferences(repositoryPath, candidate));
    }
  }
  return matches;
}

function findExecutionClosureForWorkspace(repositoryPath, origin, sessionDigest, workspaceId) {
  const matches = findExecutionClosuresForOrigin(repositoryPath, origin)
    .filter((candidate) => candidate.sessionDigest === sessionDigest
      && closureWorkspaceId(repositoryPath, candidate) === workspaceId);
  if (matches.length > 1) {
    fail("MH_EXECUTION_CLOSURE_CONFLICT", "more than one ExecutionClosure exists for one physical workspace execution");
  }
  return matches[0] || null;
}

function closureRank(repositoryPath, closure) {
  if (closure.workResultDigest === null) return 3;
  const outcome = readExecutionWorkResult(repositoryPath, closure.workResultDigest).result?.outcome;
  if (outcome === "DONE") return 0;
  if (outcome === "PARTIAL") return 1;
  return 2;
}

function findExecutionClosureForOrigin(repositoryPath, origin) {
  const matches = findExecutionClosuresForOrigin(repositoryPath, origin);
  if (matches.length === 0) return null;
  return matches.sort((left, right) => closureRank(repositoryPath, left) - closureRank(repositoryPath, right)
    || Date.parse(left.closedAt) - Date.parse(right.closedAt)
    || left.closureDigest.localeCompare(right.closureDigest))[0];
}

function findExecutionWorkResultForOrigin(repositoryPath, origin) {
  const closure = findExecutionClosureForOrigin(repositoryPath, origin);
  if (closure?.workResultDigest) return readExecutionWorkResult(repositoryPath, closure.workResultDigest);
  const matches = executionWorkResultsForOrigin(repositoryPath, origin);
  return matches.sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
    || left.workResultDigest.localeCompare(right.workResultDigest))[0] || null;
}

function recordExecutionClosure({
  repositoryPath,
  session,
  attemptEntries,
  disposition,
  workResult = null,
  now = new Date(),
}) {
  const origin = repoExecutionOrigin(session);
  if (!origin) return null;
  const suppliedEntries = Array.isArray(attemptEntries) && attemptEntries.length > 0
    ? attemptEntries.map((entry) => validatePersistedAttemptEntry(entry))
    : [];
  const workspaceIds = [...new Set(suppliedEntries.map((entry) => entry.workspaceId))];
  const workspaceId = workspaceIds.length === 1 ? workspaceIds[0] : null;
  if (workspaceId === null) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "REPO_RUN ExecutionClosure requires AttemptEntries from exactly one physical workspace");
  }
  const existing = findExecutionClosureForWorkspace(repositoryPath, origin, session.sessionDigest, workspaceId);
  if (existing) return existing;
  const persistedEntries = readAttemptEntriesForOrigin(
    repositoryPath,
    origin,
    session.sessionDigest,
    workspaceId,
  );
  const persistedDigests = persistedEntries.map((entry) => requireDigest(entry.entryDigest, "AttemptEntry.entryDigest"));
  const persistedSet = new Set(persistedDigests);
  if (suppliedEntries.some((entry) => !persistedSet.has(entry.entryDigest))) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure supplied an AttemptEntry that is not durably persisted for this execution");
  }
  const digests = persistedDigests;
  const resultRecord = workResult
    ? persistExecutionWorkResult(repositoryPath, session, workResult, now)
    : findExecutionWorkResultForWorkspace(repositoryPath, origin, session.sessionDigest, workspaceId);
  const resolvedDisposition = resultRecord ? dispositionFromWorkResult(resultRecord.result) : disposition;
  if (!DISPOSITIONS.has(resolvedDisposition)) {
    fail("MH_EXECUTION_CLOSURE_VALUE", `invalid operational disposition: ${resolvedDisposition}`);
  }
  const body = {
    schemaVersion: EXECUTION_CLOSURE_SCHEMA,
    sessionDigest: session.sessionDigest,
    origin,
    attemptEntries: digests,
    disposition: resolvedDisposition,
    workResultDigest: resultRecord?.workResultDigest || null,
    closedAt: now.toISOString(),
  };
  const closure = validateExecutionClosure({
    ...body,
    closureDigest: computeExecutionClosureDigest(body),
  });
  persistImmutableJson(repositoryPath, "execution-closures", closure.closureDigest, closure, "MH_EXECUTION_CLOSURE_WRITE");
  return assertExecutionClosureReferences(repositoryPath, closure);
}

function recoverExecutionClosure(repositoryPath, session, now = new Date(), { workResult = null, workspaceId = null } = {}) {
  const origin = repoExecutionOrigin(session);
  if (!origin) return null;
  const executionWorkspaceId = workspaceId || workResult?.workspace?.workspaceId || null;
  if (executionWorkspaceId === null) {
    const allEntries = readAttemptEntriesForOrigin(repositoryPath, origin, session.sessionDigest);
    const workspaceIds = [...new Set(allEntries.map((entry) => entry.workspaceId))];
    if (workspaceIds.length !== 1) return null;
    workspaceId = workspaceIds[0];
  } else {
    workspaceId = executionWorkspaceId;
  }
  const existing = findExecutionClosureForWorkspace(repositoryPath, origin, session.sessionDigest, workspaceId);
  if (existing) return existing;
  const entries = readAttemptEntriesForOrigin(repositoryPath, origin, session.sessionDigest, workspaceId);
  if (entries.length === 0) return null;
  const durableResult = findExecutionWorkResultForWorkspace(
    repositoryPath,
    origin,
    session.sessionDigest,
    workspaceId,
  );
  const recoveredResult = durableResult ? null : workResult;
  return recordExecutionClosure({
    repositoryPath,
    session,
    attemptEntries: entries,
    disposition: durableResult
      ? dispositionFromWorkResult(durableResult.result)
      : recoveredResult
        ? dispositionFromWorkResult(recoveredResult)
        : "INTERRUPTED_AFTER_ENTRY",
    workResult: recoveredResult,
    now,
  });
}

module.exports = {
  DISPOSITIONS,
  EXECUTION_CLOSURE_DOMAIN,
  EXECUTION_CLOSURE_SCHEMA,
  EXECUTION_WORK_RESULT_DOMAIN,
  EXECUTION_WORK_RESULT_SCHEMA,
  computeExecutionClosureDigest,
  computeExecutionWorkResultDigest,
  assertExecutionClosureReferences,
  closureWorkspaceId,
  findExecutionClosureForOrigin,
  findExecutionClosureForWorkspace,
  findExecutionClosuresForOrigin,
  findExecutionWorkResultForOrigin,
  findExecutionWorkResultForWorkspace,
  persistExecutionWorkResult,
  readExecutionWorkResult,
  readAttemptEntriesForOrigin,
  recordExecutionClosure,
  recoverExecutionClosure,
  validateExecutionClosure,
  validateExecutionWorkResult,
};
