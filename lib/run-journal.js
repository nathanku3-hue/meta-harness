"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { validateWorkSession } = require("./work-session");

const RUN_EVENT_SCHEMA = "run-event/v1";
const RUN_EVENT_DOMAIN = "meta-harness-run-event/v1";
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,200}$/u;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function validateRunId(runId) {
  if (!RUN_ID_RE.test(String(runId || ""))) fail("MH_RUN_JOURNAL_ID", "runId is invalid");
  return String(runId);
}

function journalDirectory(gitCommonDirectory, runId) {
  return path.join(path.resolve(String(gitCommonDirectory || "")), "meta-harness", "runs", validateRunId(runId));
}

function eventBody(value) {
  return {
    schemaVersion: RUN_EVENT_SCHEMA,
    runId: value.runId,
    sequence: value.sequence,
    type: value.type,
    at: value.at,
    previousDigest: value.previousDigest,
    data: value.data,
  };
}

function validateEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MH_RUN_JOURNAL_EVENT", "run event must be an object");
  const expected = ["schemaVersion", "runId", "sequence", "type", "at", "previousDigest", "data", "eventDigest"].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")
      || value.schemaVersion !== RUN_EVENT_SCHEMA
      || !RUN_ID_RE.test(String(value.runId || ""))
      || !Number.isInteger(value.sequence) || value.sequence < 1
      || typeof value.type !== "string" || value.type.trim() === ""
      || !Number.isFinite(Date.parse(value.at))
      || (value.previousDigest !== null && !isDigest(value.previousDigest))
      || value.data === undefined
      || !isDigest(value.eventDigest)
      || value.eventDigest !== domainDigest(RUN_EVENT_DOMAIN, eventBody(value))) {
    fail("MH_RUN_JOURNAL_EVENT", "run event is invalid");
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function eventFileName(event) {
  const sequence = String(event.sequence).padStart(12, "0");
  const digest = event.eventDigest.slice("sha256:".length);
  return `${sequence}-${digest}.json`;
}

function fsyncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    if (process.platform !== "win32") {
      fail("MH_RUN_JOURNAL_WRITE", `run journal directory could not be synchronized: ${error.message}`);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function committedEventFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{12}-[a-f0-9]{64}\.json$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readRunJournal({ gitCommonDirectory, runId }) {
  const id = validateRunId(runId);
  const directory = journalDirectory(gitCommonDirectory, id);
  const events = [];
  let previousDigest = null;
  let expectedSequence = 1;
  for (const name of committedEventFiles(directory)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    } catch (error) {
      fail("MH_RUN_JOURNAL_READ", `run journal event is unreadable: ${name}: ${error.message}`);
    }
    const event = validateEvent(parsed);
    if (event.runId !== id || event.sequence !== expectedSequence || event.previousDigest !== previousDigest || eventFileName(event) !== name) {
      fail("MH_RUN_JOURNAL_CHAIN", "run journal event chain is inconsistent", {
        runId: id,
        expectedSequence,
        observedSequence: event.sequence,
        file: name,
      });
    }
    events.push(event);
    previousDigest = event.eventDigest;
    expectedSequence += 1;
  }
  return Object.freeze(events);
}

function appendRunEvent({ gitCommonDirectory, runId, type, data, now = new Date() }) {
  const id = validateRunId(runId);
  if (typeof type !== "string" || type.trim() === "") fail("MH_RUN_JOURNAL_EVENT", "event type must be non-empty");
  const directory = journalDirectory(gitCommonDirectory, id);
  fs.mkdirSync(directory, { recursive: true });

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const existing = readRunJournal({ gitCommonDirectory, runId: id });
    const previous = existing.at(-1) || null;
    const body = {
      schemaVersion: RUN_EVENT_SCHEMA,
      runId: id,
      sequence: existing.length + 1,
      type: type.trim(),
      at: now.toISOString(),
      previousDigest: previous?.eventDigest || null,
      data: JSON.parse(JSON.stringify(data)),
    };
    const event = validateEvent({ ...body, eventDigest: domainDigest(RUN_EVENT_DOMAIN, body) });
    const finalPath = path.join(directory, eventFileName(event));
    const tempPath = path.join(directory, `.tmp-${process.pid}-${crypto.randomUUID()}.json`);
    let fd;
    try {
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      try {
        fs.renameSync(tempPath, finalPath);
        fsyncDirectory(directory);
      } catch (error) {
        if (error?.code === "EEXIST" || error?.code === "EPERM") {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          continue;
        }
        throw error;
      }
      return readRunJournal({ gitCommonDirectory, runId: id }).at(-1);
    } catch (error) {
      try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {}
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      if (error?.code?.startsWith?.("MH_RUN_JOURNAL")) throw error;
      fail("MH_RUN_JOURNAL_WRITE", `run journal event could not be persisted: ${error.message}`);
    }
  }
  fail("MH_RUN_JOURNAL_BUSY", "run journal could not append after bounded contention retry");
}

function runIdForSession(sessionDigest) {
  const sessionStem = String(sessionDigest || "").replace(/^sha256:/u, "");
  if (!/^[a-f0-9]{64}$/u.test(sessionStem)) {
    fail("MH_RUN_JOURNAL_ID", "sessionDigest cannot form a runId");
  }
  return `run-${sessionStem}`;
}

function runSessionPath(gitCommonDirectory, runId) {
  return path.join(journalDirectory(gitCommonDirectory, runId), "session.json");
}

function persistRunSession({ gitCommonDirectory, session }) {
  const validated = validateWorkSession(session);
  const runId = runIdForSession(validated.sessionDigest);
  const directory = journalDirectory(gitCommonDirectory, runId);
  const filePath = runSessionPath(gitCommonDirectory, runId);
  fs.mkdirSync(directory, { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fsyncDirectory(directory);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    if (error?.code !== "EEXIST") {
      fail("MH_RUN_SESSION_WRITE", `run session could not be persisted: ${error.message}`);
    }
    const existing = readRunSession({ gitCommonDirectory, runId });
    if (existing.sessionDigest !== validated.sessionDigest
        || JSON.stringify(existing) !== JSON.stringify(validated)) {
      fail("MH_RUN_SESSION_CONFLICT", "run session already exists with different sealed bytes");
    }
  }
  return Object.freeze({ runId, session: readRunSession({ gitCommonDirectory, runId }) });
}

function readRunSession({ gitCommonDirectory, runId }) {
  const id = validateRunId(runId);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(runSessionPath(gitCommonDirectory, id), "utf8"));
  } catch (error) {
    fail("MH_RUN_SESSION_READ", `run session is unreadable: ${error.message}`);
  }
  const session = validateWorkSession(parsed);
  if (runIdForSession(session.sessionDigest) !== id) {
    fail("MH_RUN_SESSION_ID", "run directory does not match the sealed session digest");
  }
  return session;
}

function listRunSessions({ gitCommonDirectory }) {
  const root = path.join(path.resolve(String(gitCommonDirectory || "")), "meta-harness", "runs");
  if (!fs.existsSync(root)) return Object.freeze([]);
  const sessions = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^run-[a-f0-9]{64}$/u.test(entry.name)) continue;
    if (!fs.existsSync(runSessionPath(gitCommonDirectory, entry.name))) continue;
    sessions.push(readRunSession({ gitCommonDirectory, runId: entry.name }));
  }
  sessions.sort((left, right) => left.sessionDigest.localeCompare(right.sessionDigest));
  return Object.freeze(sessions);
}

module.exports = {
  RUN_EVENT_SCHEMA,
  appendRunEvent,
  journalDirectory,
  listRunSessions,
  persistRunSession,
  readRunJournal,
  readRunSession,
  runIdForSession,
  runSessionPath,
  validateEvent,
};
