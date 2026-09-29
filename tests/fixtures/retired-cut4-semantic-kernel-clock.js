"use strict";

const crypto = require("node:crypto");

const FORBIDDEN_CLOCK_KEYS = new Set([
  "clock",
  "now",
  "currentTime",
  "current_time",
  "timeProvider",
  "time_provider",
  "clockOffset",
  "clock_offset",
  "testClock",
  "test_clock",
]);

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function exactUtcNow() {
  return new Date().toISOString();
}

function monotonicTimeNs() {
  return process.hrtime.bigint().toString(10);
}

function createControllerInstanceId() {
  return `controller-${crypto.randomBytes(16).toString("hex")}`;
}

function assertNoRequestControlledClock(value, path = "request") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRequestControlledClock(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_CLOCK_KEYS.has(key)) {
      throw codedError(
        "REQUEST_CLOCK_FORBIDDEN",
        `${path}.${key} is forbidden; installed runtime time is not request-configurable`,
        { field: `${path}.${key}` },
      );
    }
    assertNoRequestControlledClock(entry, `${path}.${key}`);
  }
}

module.exports = {
  FORBIDDEN_CLOCK_KEYS,
  assertNoRequestControlledClock,
  rejectRequestClockControls: assertNoRequestControlledClock,
  createControllerInstanceId,
  exactUtcNow,
  monotonicTimeNs,
};
