"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  attemptEntryPath,
  writeCreateOnlyJson,
} = require("./protocol-store");

const DIRTY_MANIFEST_DOMAIN = "meta-harness-execution-dirty-manifest/v1";
const ATTEMPT_ENTRY_SCHEMA = "attempt-entry/v3";
const ATTEMPT_ENTRY_DOMAIN = "meta-harness-attempt-entry/v3";
const RUN_ATTEMPT_CAPABILITY_DOMAIN = "meta-harness-run-attempt-capability/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_ATTEMPT_ENTRY_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_ATTEMPT_ENTRY_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function dirtyManifestEntries(boundary) {
  const entries = boundary?.inspected?.entries;
  if (!Array.isArray(entries)) {
    fail("MH_EXECUTION_ATTEMPT_BOUNDARY", "execution attempt identity requires an inspected workspace boundary");
  }
  return entries.map((entry) => ({
    xy: String(entry.xy || ""),
    path: String(entry.path || ""),
    originalPath: entry.originalPath === null || entry.originalPath === undefined ? null : String(entry.originalPath),
  })).sort((left, right) => {
    const a = `${left.path}\u0000${left.originalPath || ""}\u0000${left.xy}`;
    const b = `${right.path}\u0000${right.originalPath || ""}\u0000${right.xy}`;
    return a.localeCompare(b);
  });
}

function dirtyManifestDigest(boundary) {
  return domainDigest(DIRTY_MANIFEST_DOMAIN, dirtyManifestEntries(boundary));
}

function attemptEntryBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.entryDigest;
  return body;
}

function computeAttemptEntryDigest(value) {
  if (value?.schemaVersion !== ATTEMPT_ENTRY_SCHEMA) {
    fail("MH_ATTEMPT_ENTRY_SCHEMA", `attemptEntry.schemaVersion must be ${ATTEMPT_ENTRY_SCHEMA}`);
  }
  return domainDigest(ATTEMPT_ENTRY_DOMAIN, attemptEntryBody(value));
}

function validateAttemptOrigin(origin) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    fail("MH_ATTEMPT_ENTRY_ORIGIN", "AttemptEntry origin must be an object");
  }
  if (origin.type === "OWNER_GOAL") {
    exactKeys(origin, ["type"], "attemptEntry.origin");
    return;
  }
  if (origin.type === "REPO_RUN") {
    exactKeys(origin, ["type", "outcomeDigest", "objectiveRevision"], "attemptEntry.origin");
    if (!isDigest(origin.outcomeDigest)
        || !Number.isInteger(origin.objectiveRevision)
        || origin.objectiveRevision < 0) {
      fail("MH_ATTEMPT_ENTRY_ORIGIN", "AttemptEntry REPO_RUN origin is invalid");
    }
    return;
  }
  fail("MH_ATTEMPT_ENTRY_ORIGIN", "AttemptEntry origin.type must be OWNER_GOAL or REPO_RUN");
}

function validateAttemptEntry(value) {
  if (value?.schemaVersion !== ATTEMPT_ENTRY_SCHEMA) {
    fail("MH_ATTEMPT_ENTRY_SCHEMA", `attemptEntry.schemaVersion must be ${ATTEMPT_ENTRY_SCHEMA}`);
  }
  exactKeys(value, [
    "schemaVersion", "mechanism", "attemptInputKey", "sessionDigest", "attemptId",
    "generation", "ordinal", "workspaceId", "origin", "enteredAt", "entryDigest",
  ], "attemptEntry");
  if (!UUID_RE.test(value.attemptId) || !UUID_RE.test(value.workspaceId)) {
    fail("MH_ATTEMPT_ENTRY_ID", "AttemptEntry attemptId and workspaceId must be canonical UUIDs");
  }
  if (value.mechanism !== "RUN_CAPABILITY" || !isDigest(value.attemptInputKey)) {
    fail("MH_ATTEMPT_ENTRY_CAPABILITY", "AttemptEntry must bind the content-derived run capability");
  }
  for (const field of ["sessionDigest", "entryDigest"]) {
    if (!isDigest(value[field])) fail("MH_ATTEMPT_ENTRY_DIGEST", `attemptEntry.${field} must be a sha256 digest`);
  }
  if (!Number.isInteger(value.generation) || value.generation < 1 || value.ordinal !== value.generation) {
    fail("MH_ATTEMPT_ENTRY_VALUE", "AttemptEntry ordinal must equal the positive execution generation");
  }
  validateAttemptOrigin(value.origin);
  if (!Number.isFinite(Date.parse(value.enteredAt))) fail("MH_ATTEMPT_ENTRY_VALUE", "AttemptEntry enteredAt must be an ISO timestamp");
  if (value.entryDigest !== computeAttemptEntryDigest(value)) fail("MH_ATTEMPT_ENTRY_DIGEST", "AttemptEntry entryDigest does not match its body");
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function attemptEntryOrigin(session, workspaceId) {
  if (!session?.origin) {
    fail("MH_ATTEMPT_ENTRY_SESSION", "AttemptEntry requires a sealed work-session origin");
  }
  if (session.origin.type === "REPO_RUN") {
    return {
      type: "REPO_RUN_WORKSPACE",
      sessionDigest: session.sessionDigest,
      workspaceId,
    };
  }
  if (session.origin.type === "OWNER_GOAL") return { type: "OWNER_GOAL", workspaceId };
  fail("MH_ATTEMPT_ENTRY_SESSION", "AttemptEntry requires OWNER_GOAL or REPO_RUN");
}

function readAttemptEntry({ repositoryPath, session, workspaceId, generation, optional = false }) {
  const filePath = attemptEntryPath(repositoryPath, attemptEntryOrigin(session, workspaceId), generation);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_ATTEMPT_ENTRY_READ", `AttemptEntry is unreadable: ${error.message}`);
  }
  const entry = validateAttemptEntry(parsed);
  if (entry.sessionDigest !== session.sessionDigest
      || entry.workspaceId !== workspaceId
      || entry.generation !== generation
      || entry.ordinal !== generation
      || JSON.stringify(entry.origin) !== JSON.stringify(session.origin)) {
    fail("MH_ATTEMPT_ENTRY_READ", "AttemptEntry path identity does not match the active work session");
  }
  return entry;
}

function readAttemptEntriesForSession({ repositoryPath, session, workspaceId }) {
  const entries = [];
  let sawGap = false;
  for (let generation = 1; generation <= session.maxAttempts; generation += 1) {
    const entry = readAttemptEntry({ repositoryPath, session, workspaceId, generation, optional: true });
    if (!entry) {
      sawGap = true;
      continue;
    }
    if (sawGap) {
      fail("MH_ATTEMPT_ENTRY_READ", "AttemptEntry generations must be contiguous from generation 1");
    }
    entries.push(entry);
  }
  return Object.freeze(entries);
}

function enterRunAttempt({ repositoryPath, session, workspaceId, generation, attemptInputKey, now = new Date() }) {
  if (!session || !["REPO_RUN", "OWNER_GOAL"].includes(session.origin?.type) || !isDigest(session.sessionDigest)) {
    fail("MH_ATTEMPT_ENTRY_SESSION", "RUN_CAPABILITY attempt requires the exact scoped REPO_RUN or OWNER_GOAL session");
  }
  if (!UUID_RE.test(String(workspaceId || "")) || !Number.isInteger(generation) || generation < 1) {
    fail("MH_ATTEMPT_ENTRY_ID", "RUN_CAPABILITY attempt requires a canonical workspaceId and positive generation");
  }
  if (!isDigest(attemptInputKey)) {
    fail("MH_ATTEMPT_ENTRY_CAPABILITY", "RUN_CAPABILITY attempt requires a content-derived attemptInputKey");
  }
  if (session.origin.type === "REPO_RUN") {
    const { findExecutionClosureForWorkspace } = require("./execution-closure");
    if (findExecutionClosureForWorkspace(repositoryPath, session.origin, session.sessionDigest, workspaceId)) {
      fail("MH_ATTEMPT_ENTRY_CONTINUATION", "this physical repo-run execution is already closed");
    }
  }
  if (generation > 1) {
    const first = readAttemptEntry({ repositoryPath, session, workspaceId, generation: 1 });
    if (first.sessionDigest !== session.sessionDigest || first.workspaceId !== workspaceId) {
      fail("MH_ATTEMPT_ENTRY_CONTINUATION", "repair must retain the same sealed run inside this workspace child");
    }
  }
  const body = {
    schemaVersion: ATTEMPT_ENTRY_SCHEMA,
    mechanism: "RUN_CAPABILITY",
    attemptInputKey,
    sessionDigest: session.sessionDigest,
    attemptId: crypto.randomUUID(),
    generation,
    ordinal: generation,
    workspaceId,
    origin: JSON.parse(JSON.stringify(session.origin)),
    enteredAt: now.toISOString(),
  };
  const entry = validateAttemptEntry({ ...body, entryDigest: computeAttemptEntryDigest(body) });
  const filePath = attemptEntryPath(repositoryPath, attemptEntryOrigin(session, workspaceId), generation);
  writeCreateOnlyJson(filePath, entry, "MH_ATTEMPT_ENTRY_REPLAY");
  return entry;
}

module.exports = {
  ATTEMPT_ENTRY_DOMAIN,
  ATTEMPT_ENTRY_SCHEMA,
  RUN_ATTEMPT_CAPABILITY_DOMAIN,
  attemptEntryOrigin,
  computeAttemptEntryDigest,
  dirtyManifestDigest,
  enterRunAttempt,
  readAttemptEntriesForSession,
  readAttemptEntry,
  validateAttemptEntry,
};
