"use strict";

/**
 * Schema-bound single-file change artifact: parse, extract, validate, materialize.
 * Content is not sealed by RunSpec; path is constrained by one literal scope.allow entry.
 */

const fs = require("node:fs");
const path = require("node:path");

const { codedError, isPlainObject, isNonEmptyString } = require("./support");
const {
  ARTIFACT_CONTENT_MAX_BYTES,
} = require("./constants");

const GLOB_CHARS_RE = /[*?\[\{]/;

/**
 * Runtime scope: exactly one literal allow path, empty deny, no globs.
 * @returns {string} the single allowed relative path
 */
function requireSingleLiteralScopePath(scope) {
  if (!isPlainObject(scope)) {
    throw codedError("CUSTODY_SCOPE_REQUIRED", "runSpec.scope is required");
  }
  if (!Array.isArray(scope.allow) || scope.allow.length !== 1) {
    throw codedError(
      "CUSTODY_SCOPE_ALLOW",
      "A1 requires runSpec.scope.allow to be exactly one literal path",
    );
  }
  if (!Array.isArray(scope.deny) || scope.deny.length !== 0) {
    throw codedError(
      "CUSTODY_SCOPE_DENY",
      "A1 requires runSpec.scope.deny to be empty",
    );
  }
  const allowed = scope.allow[0];
  if (!isNonEmptyString(allowed)) {
    throw codedError("CUSTODY_SCOPE_PATH", "scope.allow[0] must be a non-empty string");
  }
  if (path.isAbsolute(allowed) || allowed.includes("\0")) {
    throw codedError("CUSTODY_SCOPE_PATH", "scope.allow[0] must be a relative non-NUL path");
  }
  if (allowed.includes("\\")) {
    throw codedError(
      "CUSTODY_SCOPE_PATH",
      "scope.allow[0] must use forward-slash relative form",
    );
  }
  if (GLOB_CHARS_RE.test(allowed)) {
    throw codedError("CUSTODY_SCOPE_GLOB", "bounded changes reject glob characters in scope.allow");
  }
  const parts = allowed.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw codedError(
      "CUSTODY_SCOPE_PATH",
      "scope.allow[0] must not contain empty, '.', or '..' segments",
    );
  }
  return allowed;
}

/**
 * Deterministic schema for one allowed path. Content is a bounded string, not const.
 */
function buildChangeArtifactSchema(allowedPath) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", const: allowedPath },
      content: {
        type: "string",
        minLength: 1,
        maxLength: ARTIFACT_CONTENT_MAX_BYTES,
      },
    },
  };
}

function parseAgentJsonl(stdoutText) {
  const text = String(stdoutText || "");
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "") {
      // trailing final newline is fine; blank interior lines are not
      if (i === lines.length - 1) continue;
      throw codedError("CUSTODY_JSONL_BLANK", `blank stdout line at index ${i}`);
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch (err) {
      throw codedError(
        "CUSTODY_JSONL_PARSE",
        `stdout line ${i} is not JSON: ${err.message}`,
      );
    }
    if (!isPlainObject(event)) {
      throw codedError("CUSTODY_JSONL_EVENT", `stdout line ${i} is not a JSON object`);
    }
    events.push(event);
  }
  if (events.length === 0) {
    throw codedError("CUSTODY_JSONL_EMPTY", "stdout produced no JSONL events");
  }
  return events;
}

function eventType(event) {
  return typeof event.type === "string" ? event.type : "";
}

/**
 * Terminal protocol:
 * - every non-empty line already parsed
 * - require successful terminal turn.completed
 * - reject error/failed terminal events
 * - final completed agent_message is exactly one JSON object artifact
 * - reject multiple candidate artifacts
 */
function extractChangeArtifact(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw codedError("CUSTODY_EVENTS_REQUIRED", "events array required");
  }

  const types = events.map(eventType);
  for (const event of events) {
    const t = eventType(event);
    if (t === "turn.failed" || t === "error" || t === "thread.failed" || t.endsWith(".failed")) {
      throw codedError("CUSTODY_TERMINAL_ERROR", `failed event type: ${t}`);
    }
    if (t === "item.completed" && event.item && event.item.type === "error") {
      throw codedError("CUSTODY_TERMINAL_ERROR", "item.completed error item");
    }
  }

  let lastCompletedIdx = -1;
  for (let i = 0; i < events.length; i += 1) {
    if (eventType(events[i]) === "turn.completed") lastCompletedIdx = i;
  }
  if (lastCompletedIdx < 0) {
    throw codedError(
      "CUSTODY_TERMINAL_MISSING",
      "successful turn.completed event is required",
    );
  }
  // Terminal event must be the final event
  if (lastCompletedIdx !== events.length - 1) {
    throw codedError(
      "CUSTODY_TERMINAL_NOT_LAST",
      "turn.completed must be the final JSONL event",
    );
  }

  const agentMessages = [];
  for (let i = 0; i < lastCompletedIdx; i += 1) {
    const event = events[i];
    if (eventType(event) !== "item.completed") continue;
    if (!isPlainObject(event.item) || event.item.type !== "agent_message") continue;
    if (typeof event.item.text !== "string") {
      throw codedError("CUSTODY_AGENT_MESSAGE", "agent_message.text must be a string");
    }
    agentMessages.push(event.item.text);
  }
  if (agentMessages.length === 0) {
    throw codedError(
      "CUSTODY_AGENT_MESSAGE_MISSING",
      "no completed agent_message before turn.completed",
    );
  }

  const candidates = [];
  for (const text of agentMessages) {
    const parsed = tryParseExactJsonObject(text);
    if (parsed && isPlainObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, "path")
      && Object.prototype.hasOwnProperty.call(parsed, "content")) {
      candidates.push(parsed);
    }
  }
  if (candidates.length > 1) {
    throw codedError(
      "CUSTODY_ARTIFACT_MULTIPLE",
      `multiple candidate artifacts in agent messages: ${candidates.length}`,
    );
  }

  const finalText = agentMessages[agentMessages.length - 1];
  const artifact = parseExactJsonObject(finalText);
  return {
    artifact,
    agentMessageCount: agentMessages.length,
    eventTypes: types,
    terminalType: "turn.completed",
  };
}

function tryParseExactJsonObject(text) {
  try {
    return parseExactJsonObject(text);
  } catch {
    return null;
  }
}

/** Entire string must be exactly one JSON value (no trailing prose). */
function parseExactJsonObject(text) {
  if (typeof text !== "string") {
    throw codedError("CUSTODY_ARTIFACT_TEXT", "artifact message must be a string");
  }
  // Reject leading/trailing whitespace as trailing prose discipline
  if (text !== text.trim() || text.length === 0) {
    // allow pure JSON without outer padding only; trim inequality means padding
    if (text.trim() !== text) {
      throw codedError(
        "CUSTODY_ARTIFACT_PROSE",
        "artifact message must be exact JSON with no surrounding whitespace/prose",
      );
    }
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw codedError(
      "CUSTODY_ARTIFACT_JSON",
      `final agent_message is not JSON: ${err.message}`,
    );
  }
  // Ensure no multi-value / trailing junk: JSON.parse already consumes full string
  // Re-serialize check is unnecessary if parse used full text; Node JSON.parse rejects trailing.
  if (!isPlainObject(value) || Array.isArray(value)) {
    throw codedError("CUSTODY_ARTIFACT_OBJECT", "artifact must be a JSON object");
  }
  return value;
}

/**
 * Validate keys/path/content bounds against single allowed path.
 * Does NOT compare content to a RunSpec-sealed expected body.
 */
function validateChangeArtifact(artifact, allowedPath) {
  if (!isPlainObject(artifact)) {
    throw codedError("CUSTODY_ARTIFACT_OBJECT", "artifact must be a plain object");
  }
  const keys = Object.keys(artifact).sort();
  if (keys.length !== 2 || keys[0] !== "content" || keys[1] !== "path") {
    throw codedError(
      "CUSTODY_ARTIFACT_KEYS",
      `artifact keys must be exactly path,content; got ${keys.join(",")}`,
    );
  }
  if (typeof artifact.path !== "string" || typeof artifact.content !== "string") {
    throw codedError("CUSTODY_ARTIFACT_TYPES", "path and content must be strings");
  }
  if (artifact.path !== allowedPath) {
    throw codedError(
      "CUSTODY_ARTIFACT_PATH",
      `artifact.path ${JSON.stringify(artifact.path)} !== allowed ${JSON.stringify(allowedPath)}`,
    );
  }
  if (artifact.content.length === 0) {
    throw codedError("CUSTODY_ARTIFACT_EMPTY", "content must be non-empty");
  }
  if (artifact.content.includes("\0")) {
    throw codedError("CUSTODY_ARTIFACT_NUL", "content must not contain NUL");
  }
  const byteLen = Buffer.byteLength(artifact.content, "utf8");
  if (byteLen > ARTIFACT_CONTENT_MAX_BYTES) {
    throw codedError(
      "CUSTODY_ARTIFACT_SIZE",
      `content ${byteLen} bytes exceeds ceiling ${ARTIFACT_CONTENT_MAX_BYTES}`,
    );
  }
  return {
    path: artifact.path,
    content: artifact.content,
    contentBytes: byteLen,
  };
}

function rejectSymlinkComponents(absPath, label) {
  let cur = absPath;
  const root = path.parse(cur).root;
  // Check the full path and every ancestor
  const chain = [];
  while (true) {
    chain.push(cur);
    if (cur === root) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const p of chain) {
    let st;
    try {
      st = fs.lstatSync(p);
    } catch (err) {
      // Missing ancestors for the target file are rejected at target open;
      // intermediate missing is fail-closed for materialize (target must exist).
      if (p === absPath) {
        throw codedError(
          "CUSTODY_TARGET_MISSING",
          `${label} missing: ${err.message}`,
        );
      }
      continue;
    }
    if (st.isSymbolicLink()) {
      throw codedError(
        "CUSTODY_SYMLINK",
        `${label} path component is a symlink: ${p}`,
      );
    }
  }
}

/**
 * Write exact content bytes. No mkdir, no git, no path escape.
 * Target must already be a regular non-symlink file.
 */
function materializeChangeArtifact(worktreePath, artifact) {
  if (!isNonEmptyString(worktreePath)) {
    throw codedError("CUSTODY_WORKTREE", "worktreePath required");
  }
  const rel = artifact.path;
  if (!isNonEmptyString(rel) || path.isAbsolute(rel) || rel.includes("\0")) {
    throw codedError("CUSTODY_MATERIALIZE_PATH", "artifact.path invalid");
  }
  const normalizedRel = rel.split("/").join(path.sep);
  const target = path.resolve(worktreePath, normalizedRel);
  const worktreeResolved = path.resolve(worktreePath);
  const relToRoot = path.relative(worktreeResolved, target);
  if (
    relToRoot === ""
    || relToRoot.startsWith("..")
    || path.isAbsolute(relToRoot)
  ) {
    throw codedError(
      "CUSTODY_PATH_ESCAPE",
      `materialize path escapes worktree: ${rel}`,
    );
  }

  rejectSymlinkComponents(target, "materialize target");
  rejectSymlinkComponents(worktreeResolved, "worktree");

  let st;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    throw codedError("CUSTODY_TARGET_MISSING", `target missing: ${err.message}`);
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw codedError(
      "CUSTODY_TARGET_NOT_REGULAR",
      "target must be an existing regular non-symlink file",
    );
  }

  // No directory creation: dirname must already exist (implied by file existing).
  fs.writeFileSync(target, artifact.content, { encoding: "utf8", flag: "w" });
  return { targetPath: target, bytesWritten: Buffer.byteLength(artifact.content, "utf8") };
}

function summarizeEvents(events) {
  const counts = Object.create(null);
  for (const event of events) {
    const t = eventType(event) || "unknown";
    counts[t] = (counts[t] || 0) + 1;
  }
  return {
    eventCount: events.length,
    eventTypes: events.map(eventType),
    eventTypeCounts: counts,
    terminalType: events.length ? eventType(events[events.length - 1]) : null,
  };
}

module.exports = {
  requireSingleLiteralScopePath,
  buildChangeArtifactSchema,
  parseAgentJsonl,
  extractChangeArtifact,
  validateChangeArtifact,
  materializeChangeArtifact,
  parseExactJsonObject,
  summarizeEvents,
  ARTIFACT_CONTENT_MAX_BYTES,
};
