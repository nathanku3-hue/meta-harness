"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError } = require("./errors");
const { assertContainedPath } = require("./truth-paths");

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
  /AIza[0-9A-Za-z-_]{35}/,
  /xox[bapr]-[0-9a-zA-Z]{10,}/,
  /bearer\s+[a-zA-Z0-9_\-\.\~+\/]{15,}/i,
  /aws_access_key_id/i,
  /aws_secret_access_key/i,
  /amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /da2-[a-z0-9]{26}/,
  /EAACEdEose0cBA[0-9A-Za-z]+/
];

function validateRedaction(event) {
  const text = JSON.stringify(event);
  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error("Security validation failure: potential secret or credential leakage detected");
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

function withEventLock(eventsPath, operation, { targetRoot } = {}) {
  const lockPath = path.join(path.dirname(eventsPath), "local", "locks", "events.lock");
  if (targetRoot) {
    assertContainedPath(targetRoot, eventsPath, {
      leafType: "file",
      label: "canonical event ledger",
    });
    assertContainedPath(targetRoot, path.dirname(lockPath), {
      allowMissingTail: true,
      leafType: "directory",
      label: "canonical event lock directory",
    });
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (targetRoot) {
    assertContainedPath(targetRoot, path.dirname(lockPath), {
      leafType: "directory",
      label: "canonical event lock directory",
    });
    assertContainedPath(targetRoot, lockPath, {
      allowMissingLeaf: true,
      leafType: "file",
      label: "canonical event lock",
    });
  }

  let acquired = false;
  const maxRetries = 40;
  const retryDelayMs = 50;

  for (let index = 0; index < maxRetries; index += 1) {
    try {
      fs.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
      if (targetRoot) {
        assertContainedPath(targetRoot, lockPath, {
          leafType: "file",
          label: "canonical event lock",
        });
      }
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

function encodeLedger(events) {
  if (events.length === 0) return "";
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function writeCompleteLedgerAtomic(eventsPath, events, { targetRoot } = {}) {
  const content = encodeLedger(events);
  const directory = path.dirname(eventsPath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.tmp.events.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.jsonl`,
  );

  const fd = fs.openSync(tempPath, "wx");
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    if (targetRoot) {
      assertContainedPath(targetRoot, tempPath, {
        leafType: "file",
        label: "canonical event ledger temporary",
      });
      assertContainedPath(targetRoot, eventsPath, {
        allowMissingLeaf: true,
        leafType: "file",
        label: "canonical event ledger",
      });
    }

    try {
      fs.renameSync(tempPath, eventsPath);
    } catch (error) {
      // Windows cannot rename over an existing path; replace the directory entry via move-aside.
      if (!error || (error.code !== "EEXIST" && error.code !== "EPERM" && error.code !== "EACCES")) {
        throw error;
      }
      const backupPath = path.join(
        directory,
        `.bak.events.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.jsonl`,
      );
      fs.renameSync(eventsPath, backupPath);
      try {
        fs.renameSync(tempPath, eventsPath);
      } catch (replaceError) {
        try {
          fs.renameSync(backupPath, eventsPath);
        } catch (_) {}
        throw replaceError;
      }
      try {
        fs.unlinkSync(backupPath);
      } catch (_) {}
    }

    if (targetRoot) {
      assertContainedPath(targetRoot, eventsPath, {
        leafType: "file",
        label: "canonical event ledger",
      });
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

function appendEventAtomic(eventsPath, event, nowIso, validateCurrentState, options = {}) {
  const payload = prepareEvent(event, nowIso);
  return withEventLock(eventsPath, () => {
    const currentEvents = readEvents(eventsPath);
    if (typeof validateCurrentState === "function") {
      validateCurrentState({ events: currentEvents, payload });
    }
    if (options.targetRoot) {
      assertContainedPath(options.targetRoot, eventsPath, {
        leafType: "file",
        label: "canonical event ledger",
      });
    }
    // Logical append is a complete-ledger atomic replace. Never mutate the prior inode in place.
    writeCompleteLedgerAtomic(eventsPath, [...currentEvents, payload], options);
    return payload;
  }, options);
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
    if (line.trim().length === 0) return;
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
