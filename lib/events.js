"use strict";

const fs = require("node:fs");
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

function compactEvent(event) {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function appendEvent(eventsPath, event, nowIso) {
  const ts = nowIso();
  const payload = compactEvent({ ...event, ts, time: event.time || ts });
  validateEventRecord(payload, "event");
  fs.appendFileSync(eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
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
      events.push(validateEventRecord(JSON.parse(line), source));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigError(`invalid JSON in ${source}`, { cause: error });
      }
      throw error;
    }
  });
  return events;
}

module.exports = { appendEvent, readEvents, validateEventRecord };
