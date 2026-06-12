"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { UsageError } = require("./errors");
const { ALLOWED_TRANSITIONS, ROUND_PATTERN } = require("./context-gate-constants");

function fail(message) {
  throw new UsageError(message);
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function repoRelative(cwd, targetPath) {
  const relative = path.relative(cwd, targetPath);
  return slashPath(relative || ".");
}

function isInsidePath(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRoundId(value) {
  const roundId = String(value || "").trim();
  if (!ROUND_PATTERN.test(roundId)) {
    fail("round id must match ROUND-NNN");
  }
  return roundId;
}

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(10, Math.round(value)));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return undefined;
  }
}

function parseIsoDate(value) {
  if (!nonEmpty(value)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeTransition(input = {}) {
  if (input.transition) {
    const transition = String(input.transition).trim();
    if (!ALLOWED_TRANSITIONS.includes(transition)) {
      fail(`invalid context transition: ${transition}`);
    }
    return transition;
  }

  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  if (!from || !to) {
    fail("context gate requires --from and --to phases");
  }
  const transition = `${from}->${to}`;
  if (!ALLOWED_TRANSITIONS.includes(transition)) {
    fail(`invalid context transition: ${transition}`);
  }
  return transition;
}

module.exports = {
  clampScore,
  fail,
  isInsidePath,
  nonEmpty,
  normalizeTransition,
  parseIsoDate,
  parseJsonSafe,
  repoRelative,
  safeRoundId,
  slashPath,
  uniqueStrings,
};
