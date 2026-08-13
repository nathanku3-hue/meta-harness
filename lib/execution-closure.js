"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  attemptEntryPath,
  objectPath,
  persistImmutableJson,
  protocolRoot,
  readImmutableJson,
} = require("./world-authority");

const EXECUTION_WORK_RESULT_SCHEMA = "execution-work-result/v1";
const EXECUTION_WORK_RESULT_DOMAIN = "meta-harness-execution-work-result/v1";
const EXECUTION_CLOSURE_SCHEMA = "execution-closure/v1";
const EXECUTION_CLOSURE_DOMAIN = "meta-harness-execution-closure/v1";
const DISPOSITIONS = new Set([
  "COMPLETED",
  "PARTIAL",
  "BLOCKED",
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

function requireRepoDecisionOrigin(origin, label) {
  exactKeys(origin, ["type", "decisionDigest"], label);
  if (origin.type !== "REPO_DECISION") {
    fail("MH_EXECUTION_CLOSURE_ORIGIN", `${label}.type must be REPO_DECISION`);
  }
  requireDigest(origin.decisionDigest, `${label}.decisionDigest`);
  return origin;
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
  requireRepoDecisionOrigin(value.origin, "executionWorkResult.origin");
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

function persistExecutionWorkResult(repositoryPath, session, result, now = new Date()) {
  if (session?.origin?.type !== "REPO_DECISION") return null;
  const body = {
    schemaVersion: EXECUTION_WORK_RESULT_SCHEMA,
    sessionDigest: session.sessionDigest,
    origin: {
      type: "REPO_DECISION",
      decisionDigest: session.origin.decisionDigest,
    },
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
  requireRepoDecisionOrigin(value.origin, "executionClosure.origin");
  if (!Array.isArray(value.attemptEntries) || value.attemptEntries.length === 0 || value.attemptEntries.length > 3) {
    fail("MH_EXECUTION_CLOSURE_VALUE", "executionClosure.attemptEntries must contain 1-3 ordered AttemptEntry digests");
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
  return "BLOCKED";
}

function readAttemptEntriesForDecision(repositoryPath, decisionDigest) {
  const entries = [];
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const filePath = attemptEntryPath(repositoryPath, { type: "REPO_DECISION", decisionDigest }, ordinal);
    if (!fs.existsSync(filePath)) continue;
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      fail("MH_ATTEMPT_ENTRY_READ", `AttemptEntry is unreadable: ${error.message}`);
    }
    requireDigest(entry.entryDigest, `attemptEntry[${ordinal}].entryDigest`);
    if (entry.origin?.decisionDigest !== decisionDigest || entry.ordinal !== ordinal) {
      fail("MH_ATTEMPT_ENTRY_READ", "AttemptEntry path identity does not match its body");
    }
    entries.push(entry);
  }
  return entries;
}

function immutableKindFiles(repositoryPath, kind) {
  const directory = path.dirname(objectPath(repositoryPath, kind, `sha256:${"0".repeat(64)}`));
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `sha256:${name.slice(0, 64)}`);
}

function findExecutionWorkResultForDecision(repositoryPath, decisionDigest) {
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "work-results")) {
    const candidate = validateExecutionWorkResult(readImmutableJson(repositoryPath, "work-results", candidateDigest));
    if (candidate.origin.decisionDigest === decisionDigest) matches.push(candidate);
  }
  if (matches.length > 1) {
    fail("MH_EXECUTION_WORK_RESULT_CONFLICT", "more than one durable work result exists for one Repo Decision");
  }
  return matches[0] || null;
}

function findExecutionClosureForDecision(repositoryPath, decisionDigest) {
  const matches = [];
  for (const candidateDigest of immutableKindFiles(repositoryPath, "execution-closures")) {
    const candidate = validateExecutionClosure(readImmutableJson(repositoryPath, "execution-closures", candidateDigest));
    if (candidate.origin.decisionDigest === decisionDigest) matches.push(candidate);
  }
  if (matches.length > 1) {
    fail("MH_EXECUTION_CLOSURE_CONFLICT", "more than one ExecutionClosure exists for one Repo Decision");
  }
  return matches[0] || null;
}

function recordExecutionClosure({
  repositoryPath,
  session,
  attemptEntries,
  disposition,
  workResult = null,
  now = new Date(),
}) {
  if (session?.origin?.type !== "REPO_DECISION") return null;
  const existing = findExecutionClosureForDecision(repositoryPath, session.origin.decisionDigest);
  if (existing) return existing;
  const entries = Array.isArray(attemptEntries) && attemptEntries.length > 0
    ? attemptEntries
    : readAttemptEntriesForDecision(repositoryPath, session.origin.decisionDigest);
  const digests = entries.map((entry) => requireDigest(entry.entryDigest, "AttemptEntry.entryDigest"));
  const resultRecord = workResult
    ? persistExecutionWorkResult(repositoryPath, session, workResult, now)
    : findExecutionWorkResultForDecision(repositoryPath, session.origin.decisionDigest);
  const resolvedDisposition = resultRecord ? dispositionFromWorkResult(resultRecord.result) : disposition;
  if (!DISPOSITIONS.has(resolvedDisposition)) {
    fail("MH_EXECUTION_CLOSURE_VALUE", `invalid operational disposition: ${resolvedDisposition}`);
  }
  const body = {
    schemaVersion: EXECUTION_CLOSURE_SCHEMA,
    sessionDigest: session.sessionDigest,
    origin: {
      type: "REPO_DECISION",
      decisionDigest: session.origin.decisionDigest,
    },
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
  return closure;
}

function recoverExecutionClosure(repositoryPath, session, now = new Date()) {
  if (session?.origin?.type !== "REPO_DECISION") return null;
  const existing = findExecutionClosureForDecision(repositoryPath, session.origin.decisionDigest);
  if (existing) return existing;
  const entries = readAttemptEntriesForDecision(repositoryPath, session.origin.decisionDigest);
  if (entries.length === 0) return null;
  const durableResult = findExecutionWorkResultForDecision(repositoryPath, session.origin.decisionDigest);
  return recordExecutionClosure({
    repositoryPath,
    session,
    attemptEntries: entries,
    disposition: durableResult ? dispositionFromWorkResult(durableResult.result) : "INTERRUPTED_AFTER_ENTRY",
    workResult: null,
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
  findExecutionWorkResultForDecision,
  persistExecutionWorkResult,
  readAttemptEntriesForDecision,
  recordExecutionClosure,
  recoverExecutionClosure,
  validateExecutionClosure,
  validateExecutionWorkResult,
};
