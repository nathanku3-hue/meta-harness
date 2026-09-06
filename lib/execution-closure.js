"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  attemptEntriesRoot,
  attemptEntryPath,
  objectPath,
  persistImmutableJson,
  readImmutableJson,
} = require("./world-authority");

const EXECUTION_WORK_RESULT_SCHEMA = "execution-work-result/v1";
const EXECUTION_WORK_RESULT_DOMAIN = "meta-harness-execution-work-result/v1";
const EXECUTION_CLOSURE_SCHEMA = "execution-closure/v1";
const EXECUTION_CLOSURE_DOMAIN = "meta-harness-execution-closure/v1";
const DISPOSITIONS = new Set([
  "COMPLETED",
  "PARTIAL",
  "INCOMPLETE",
  "BLOCKED", // legacy-readable only; new executions persist INCOMPLETE instead.
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
  if (origin?.type === "REPO_OUTCOME") {
    exactKeys(origin, ["type", "outcomeDigest", "claimDigest"], label);
    requireDigest(origin.outcomeDigest, `${label}.outcomeDigest`);
    requireDigest(origin.claimDigest, `${label}.claimDigest`);
    return origin;
  }
  if (origin?.type === "REPO_RUN") {
    exactKeys(origin, ["type", "outcomeDigest", "originHeadDigest", "objectiveRevision", "continuesFromTransitionDigests"], label);
    requireDigest(origin.outcomeDigest, `${label}.outcomeDigest`);
    requireDigest(origin.originHeadDigest, `${label}.originHeadDigest`);
    if (!Number.isInteger(origin.objectiveRevision) || origin.objectiveRevision < 0
        || !Array.isArray(origin.continuesFromTransitionDigests)
        || origin.continuesFromTransitionDigests.some((digest) => !isDigest(digest))) {
      fail("MH_EXECUTION_CLOSURE_ORIGIN", `${label} REPO_RUN provenance is invalid`);
    }
    return origin;
  }
  if (origin?.type === "REPO_DECISION") {
    exactKeys(origin, ["type", "decisionDigest"], label);
    requireDigest(origin.decisionDigest, `${label}.decisionDigest`);
    return origin;
  }
  fail("MH_EXECUTION_CLOSURE_ORIGIN", `${label}.type must be REPO_RUN, legacy REPO_OUTCOME, or REPO_DECISION`);
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
  if (!["REPO_RUN", "REPO_OUTCOME", "REPO_DECISION"].includes(session?.origin?.type)) return null;
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
  if (result?.outcome === "PARTIAL" || result?.outcome === "BANKED_UNPROVEN") return "PARTIAL";
  return "INCOMPLETE";
}

function validatePersistedAttemptEntry(value) {
  const { validateAttemptEntry } = require("./execution-permit");
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

function readOutcomeAttemptEntries(repositoryPath, validatedOrigin) {
  const legacyFirst = attemptEntryPath(repositoryPath, validatedOrigin, 1);
  const claimDirectory = path.dirname(legacyFirst);
  if (!fs.existsSync(claimDirectory)) return [];
  const entries = [];
  for (const name of fs.readdirSync(claimDirectory)) {
    if (/^\d+\.json$/u.test(name)) entries.push(readAttemptEntryFile(path.join(claimDirectory, name), validatedOrigin));
  }
  const workspacesDirectory = path.join(claimDirectory, "workspaces");
  if (fs.existsSync(workspacesDirectory)) {
    for (const workspace of fs.readdirSync(workspacesDirectory, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      const workspaceEntries = fs.readdirSync(path.join(workspacesDirectory, workspace.name))
        .filter((name) => /^\d+\.json$/u.test(name))
        .map((name) => readAttemptEntryFile(path.join(workspacesDirectory, workspace.name, name), validatedOrigin))
        .sort((left, right) => left.ordinal - right.ordinal);
      for (let index = 0; index < workspaceEntries.length; index += 1) {
        if (workspaceEntries[index].ordinal !== index + 1 || workspaceEntries[index].workspaceId !== workspace.name) {
          fail("MH_ATTEMPT_ENTRY_READ", "workspace-local AttemptEntry generations must be contiguous from generation 1");
        }
      }
      entries.push(...workspaceEntries);
    }
  }
  if (entries.length > 1 && entries.some((entry) => entry.sessionDigest !== entries[0].sessionDigest)) {
    fail("MH_ATTEMPT_ENTRY_READ", "Outcome AttemptEntries disagree on sealed session identity");
  }
  return entries.sort((left, right) => Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.workspaceId.localeCompare(right.workspaceId)
    || left.ordinal - right.ordinal
    || left.entryDigest.localeCompare(right.entryDigest));
}

function readRunAttemptEntries(repositoryPath, validatedOrigin) {
  const root = path.join(
    attemptEntriesRoot(repositoryPath),
    "runs",
    validatedOrigin.sessionDigest.slice("sha256:".length),
    "workspaces",
  );
  if (!fs.existsSync(root)) return [];
  const entries = [];
  for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspaceEntries = fs.readdirSync(path.join(root, workspace.name))
      .filter((name) => /^\d+\.json$/u.test(name))
      .map((name) => readAttemptEntryFile(path.join(root, workspace.name, name), validatedOrigin.origin))
      .sort((left, right) => left.ordinal - right.ordinal);
    for (let index = 0; index < workspaceEntries.length; index += 1) {
      if (workspaceEntries[index].ordinal !== index + 1 || workspaceEntries[index].workspaceId !== workspace.name) {
        fail("MH_ATTEMPT_ENTRY_READ", "run AttemptEntry generations must be contiguous from generation 1");
      }
    }
    entries.push(...workspaceEntries);
  }
  return entries.sort((left, right) => Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.workspaceId.localeCompare(right.workspaceId)
    || left.ordinal - right.ordinal);
}

function readAttemptEntriesForOrigin(repositoryPath, origin, sessionDigest = null) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  if (validatedOrigin.type === "REPO_OUTCOME") {
    return readOutcomeAttemptEntries(repositoryPath, validatedOrigin);
  }
  if (validatedOrigin.type === "REPO_RUN") {
    if (!isDigest(sessionDigest)) fail("MH_ATTEMPT_ENTRY_READ", "REPO_RUN attempt recovery requires sessionDigest");
    return readRunAttemptEntries(repositoryPath, { sessionDigest, origin: validatedOrigin });
  }
  const entries = [];
  let sawGap = false;
  for (let ordinal = 1; ordinal <= 12; ordinal += 1) {
    const filePath = attemptEntryPath(repositoryPath, validatedOrigin, ordinal);
    if (!fs.existsSync(filePath)) {
      sawGap = true;
      continue;
    }
    if (sawGap) {
      fail("MH_ATTEMPT_ENTRY_READ", "repo execution AttemptEntry ordinals must be contiguous from generation 1");
    }
    const entry = readAttemptEntryFile(filePath, validatedOrigin);
    if (entry.ordinal !== ordinal || entry.generation !== ordinal) {
      fail("MH_ATTEMPT_ENTRY_READ", "AttemptEntry path identity does not match its ordinal");
    }
    if (entries.length > 0
        && (entry.sessionDigest !== entries[0].sessionDigest || entry.workspaceId !== entries[0].workspaceId)) {
      fail("MH_ATTEMPT_ENTRY_READ", "legacy bounded repair AttemptEntries do not retain the admitted session and workspace authority");
    }
    entries.push(entry);
  }
  return entries;
}

function readAttemptEntriesForDecision(repositoryPath, decisionDigest) {
  return readAttemptEntriesForOrigin(repositoryPath, { type: "REPO_DECISION", decisionDigest });
}

function assertExecutionClosureReferences(repositoryPath, closure) {
  const entries = readAttemptEntriesForOrigin(repositoryPath, closure.origin, closure.sessionDigest);
  const actualDigests = entries.map((entry) => entry.entryDigest);
  if (JSON.stringify(actualDigests) !== JSON.stringify(closure.attemptEntries)) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure AttemptEntry references do not resolve exactly to the admitted execution", {
      expected: closure.attemptEntries,
      actual: actualDigests,
    });
  }
  if (entries.length === 0 || entries[0].sessionDigest !== closure.sessionDigest) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure does not bind the admitted work session");
  }
  if (closure.workResultDigest !== null) {
    const workResult = validateExecutionWorkResult(
      readImmutableJson(repositoryPath, "work-results", closure.workResultDigest),
    );
    if (workResult.workResultDigest !== closure.workResultDigest
        || workResult.sessionDigest !== closure.sessionDigest
        || !originEqual(workResult.origin, closure.origin)) {
      fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure work-result reference does not resolve to the admitted execution");
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

function findExecutionWorkResultForOrigin(repositoryPath, origin) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "work-results")) {
    const candidate = validateExecutionWorkResult(readImmutableJson(repositoryPath, "work-results", candidateDigest));
    if (candidate.workResultDigest !== candidateDigest) {
      fail("MH_EXECUTION_WORK_RESULT_DIGEST", "immutable work-result path identity does not match its body");
    }
    if (originEqual(candidate.origin, validatedOrigin)) matches.push(candidate);
  }
  if (matches.length > 1) {
    fail("MH_EXECUTION_WORK_RESULT_CONFLICT", "more than one durable work result exists for one repo execution origin");
  }
  return matches[0] || null;
}

function findExecutionClosureForOrigin(repositoryPath, origin) {
  const validatedOrigin = requireRepoExecutionOrigin(origin, "executionOrigin");
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "execution-closures")) {
    const candidate = validateExecutionClosure(readImmutableJson(repositoryPath, "execution-closures", candidateDigest));
    if (candidate.closureDigest !== candidateDigest) {
      fail("MH_EXECUTION_CLOSURE_DIGEST", "immutable ExecutionClosure path identity does not match its body");
    }
    if (originEqual(candidate.origin, validatedOrigin)) matches.push(candidate);
  }
  if (matches.length > 1) {
    fail("MH_EXECUTION_CLOSURE_CONFLICT", "more than one ExecutionClosure exists for one repo execution origin");
  }
  return matches[0] ? assertExecutionClosureReferences(repositoryPath, matches[0]) : null;
}

function findExecutionWorkResultForDecision(repositoryPath, decisionDigest) {
  return findExecutionWorkResultForOrigin(repositoryPath, { type: "REPO_DECISION", decisionDigest });
}

function findExecutionClosureForDecision(repositoryPath, decisionDigest) {
  return findExecutionClosureForOrigin(repositoryPath, { type: "REPO_DECISION", decisionDigest });
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
  const existing = findExecutionClosureForOrigin(repositoryPath, origin);
  if (existing) return existing;
  const persistedEntries = readAttemptEntriesForOrigin(repositoryPath, origin, session.sessionDigest);
  const persistedDigests = persistedEntries.map((entry) => requireDigest(entry.entryDigest, "AttemptEntry.entryDigest"));
  const suppliedEntries = Array.isArray(attemptEntries) && attemptEntries.length > 0
    ? attemptEntries.map((entry) => validatePersistedAttemptEntry(entry))
    : [];
  const persistedSet = new Set(persistedDigests);
  if (suppliedEntries.some((entry) => !persistedSet.has(entry.entryDigest))) {
    fail("MH_EXECUTION_CLOSURE_REFERENCE", "ExecutionClosure supplied an AttemptEntry that is not durably persisted for this execution");
  }
  const digests = persistedDigests;
  const resultRecord = workResult
    ? persistExecutionWorkResult(repositoryPath, session, workResult, now)
    : findExecutionWorkResultForOrigin(repositoryPath, origin);
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

function recoverExecutionClosure(repositoryPath, session, now = new Date(), { workResult = null } = {}) {
  const origin = repoExecutionOrigin(session);
  if (!origin) return null;
  const existing = findExecutionClosureForOrigin(repositoryPath, origin);
  if (existing) return existing;
  const entries = readAttemptEntriesForOrigin(repositoryPath, origin, session.sessionDigest);
  if (entries.length === 0) return null;
  const durableResult = findExecutionWorkResultForOrigin(repositoryPath, origin);
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
  findExecutionClosureForDecision,
  findExecutionClosureForOrigin,
  findExecutionWorkResultForDecision,
  findExecutionWorkResultForOrigin,
  persistExecutionWorkResult,
  readAttemptEntriesForDecision,
  readAttemptEntriesForOrigin,
  recordExecutionClosure,
  recoverExecutionClosure,
  validateExecutionClosure,
  validateExecutionWorkResult,
};
