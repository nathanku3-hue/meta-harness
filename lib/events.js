"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError } = require("./errors");

const REQUIRED_EVENT_FIELDS = ["ts", "actor", "stream", "phase", "action", "result"];

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateEventRecord(event, source) {
  if (!isRecord(event)) {
    throw new ConfigError(`${source} must be a JSON object`);
  }
  for (const field of REQUIRED_EVENT_FIELDS) {
    if (typeof event[field] !== "string") {
      throw new ConfigError(`${source} field "${field}" must be a string`);
    }
  }
  return event;
}

function normalizeEventRecord(event) {
  if (isRecord(event) && typeof event.ts !== "string" && typeof event.time === "string") {
    return { ...event, ts: event.time };
  }
  return event;
}

function compactEvent(event) {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

const REDACTION_PATTERNS = [
  /AIza[0-9A-Za-z-_]{35}/, // Google API key
  /xox[bapr]-[0-9a-zA-Z]{10,}/, // Slack tokens
  /bearer\s+[a-zA-Z0-9_\-\.\~+\/]{15,}/i, // Bearer token
  /aws_access_key_id/i,
  /aws_secret_access_key/i,
  /amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /da2-[a-z0-9]{26}/, // AWS AppSync key
  /EAACEdEose0cBA[0-9A-Za-z]+/ // Facebook access token
];

function validateRedaction(event) {
  const text = JSON.stringify(event);
  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Security validation failure: potential secret or credential leakage detected`);
    }
  }
}

function waitMilliseconds(milliseconds) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  } catch (_) {
    const start = Date.now();
    while (Date.now() - start < milliseconds) {}
  }
}

function withEventLock(eventsPath, operation) {
  const lockPath = path.join(path.dirname(eventsPath), "local", "locks", "events.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  let acquired = false;
  const maxRetries = 40;
  const retryDelayMs = 50;

  for (let index = 0; index < maxRetries; index += 1) {
    try {
      fs.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
      acquired = true;
      break;
    } catch (error) {
      if (error && error.code === "EEXIST") {
        waitMilliseconds(retryDelayMs);
        continue;
      }
      throw error;
    }
  }

  if (!acquired) {
    throw new Error(`concurrency lock conflict: could not acquire lock for ${eventsPath}`);
  }

  try {
    return operation();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch (_) {}
  }
}

function prepareEvent(event, nowIso) {
  const ts = nowIso();
  const payload = compactEvent({ ...event, ts, time: event.time || ts });
  validateEventRecord(payload, "event");
  validateRedaction(payload);
  return payload;
}

function appendEventAtomic(eventsPath, event, nowIso, validateCurrentState) {
  const payload = prepareEvent(event, nowIso);
  return withEventLock(eventsPath, () => {
    const currentEvents = readEvents(eventsPath);
    if (typeof validateCurrentState === "function") {
      validateCurrentState({ events: currentEvents, payload });
    }
    fs.appendFileSync(eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  });
}

function appendEvent(eventsPath, event, nowIso) {
  return appendEventAtomic(eventsPath, event, nowIso);
}

function readEvents(eventsPath) {
  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  const events = [];
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const source = `${eventsPath} line ${index + 1}`;
    try {
      events.push(validateEventRecord(normalizeEventRecord(JSON.parse(line)), source));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigError(`invalid JSON in ${source}`, { cause: error });
      }
      throw error;
    }
  });
  return events;
}

module.exports = { appendEvent, appendEventAtomic, readEvents, validateEventRecord };
