"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { HARNESS_DIR } = require("./paths");

const HINT_MAX_DAYS = 7;
const HINT_MAX_SCORE = 9;

function defaultHintsPath(cwd) {
  return path.join(cwd, HARNESS_DIR, "local", "context", "hints.json");
}

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validDate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeHint(rawHint, index, now, warnings) {
  if (!rawHint || typeof rawHint !== "object" || Array.isArray(rawHint)) {
    warnings.push(`hint ${index + 1} ignored: hint must be an object`);
    return undefined;
  }

  const dimension = nonEmptyString(rawHint.dimension) ? rawHint.dimension.trim() : "";
  if (!dimension) {
    warnings.push(`hint ${index + 1} ignored: dimension is required`);
    return undefined;
  }

  if (!nonEmptyString(rawHint.reason)) {
    warnings.push(`hint for ${dimension} ignored: reason is required`);
    return undefined;
  }
  if (!nonEmptyString(rawHint.author)) {
    warnings.push(`hint for ${dimension} ignored: author is required`);
    return undefined;
  }

  const expiresAt = validDate(rawHint.expires_at);
  if (!expiresAt) {
    warnings.push(`hint for ${dimension} ignored: expires_at must be an ISO date-time`);
    return undefined;
  }
  if (expiresAt.getTime() <= now.getTime()) {
    warnings.push(`hint for ${dimension} ignored: expired at ${rawHint.expires_at}`);
    return undefined;
  }

  const maxExpiry = now.getTime() + HINT_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() > maxExpiry) {
    warnings.push(`hint for ${dimension} ignored: expires_at must be within ${HINT_MAX_DAYS} days`);
    return undefined;
  }

  const numericValue = Number(rawHint.value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    warnings.push(`hint for ${dimension} ignored: value must be an integer from 1 to ${HINT_MAX_SCORE}`);
    return undefined;
  }

  let value = numericValue;
  if (value > HINT_MAX_SCORE) {
    warnings.push(`hint for ${dimension} capped at ${HINT_MAX_SCORE}: excellent scores require file evidence`);
    value = HINT_MAX_SCORE;
  }

  return {
    dimension,
    value,
    reason: rawHint.reason.trim(),
    author: rawHint.author.trim(),
    expires_at: expiresAt.toISOString(),
  };
}

function readContextHints(options = {}) {
  const cwd = options.cwd || options.targetRoot || process.cwd();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const hintsPath = options.hintsPath || defaultHintsPath(cwd);
  const warnings = [];

  if (!fs.existsSync(hintsPath)) {
    return {
      hints: [],
      warnings,
      path: hintsPath,
      exists: false,
    };
  }

  let parsed;
  try {
    parsed = parseJsonFile(hintsPath);
  } catch (error) {
    warnings.push(`hints ignored: could not parse ${path.relative(cwd, hintsPath) || hintsPath}`);
    return {
      hints: [],
      warnings,
      path: hintsPath,
      exists: true,
      error: error.message,
    };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.hints)) {
    warnings.push("hints ignored: root object must contain a hints array");
    return {
      hints: [],
      warnings,
      path: hintsPath,
      exists: true,
    };
  }

  const hints = parsed.hints
    .map((hint, index) => normalizeHint(hint, index, now, warnings))
    .filter(Boolean);

  return {
    hints,
    warnings,
    path: hintsPath,
    exists: true,
  };
}

function uniqueWithout(values, removals) {
  const removeSet = new Set(removals);
  return values.filter((value) => !removeSet.has(value));
}

function applyContextHints(artifact, hintsResult, options = {}) {
  const warnings = [...(hintsResult?.warnings || [])];
  const knownDimensions = new Set(options.dimensions || Object.keys(artifact.scores || {}));
  const structuralDimensions = new Set(options.structuralDimensions || []);
  const evidenceGaps = new Set(artifact.evidence_gap_dimensions || []);
  const unknownDimensions = new Set(artifact.unknown_dimensions || []);
  const applied = [];
  const satisfied = [];
  const scores = { ...(artifact.scores || {}) };

  for (const hint of hintsResult?.hints || []) {
    if (!knownDimensions.has(hint.dimension)) {
      warnings.push(`hint for ${hint.dimension} ignored: unknown scoring dimension`);
      continue;
    }
    if (structuralDimensions.has(hint.dimension)) {
      warnings.push(`hint for ${hint.dimension} retained for audit but cannot clear a structural blocker`);
      continue;
    }

    const from = scores[hint.dimension];
    if (!Number.isInteger(from)) {
      warnings.push(`hint for ${hint.dimension} ignored: score is not initialized`);
      continue;
    }

    const to = Math.max(from, Math.min(hint.value, HINT_MAX_SCORE));
    if (to === from && !evidenceGaps.has(hint.dimension)) {
      continue;
    }

    scores[hint.dimension] = to;
    if (evidenceGaps.has(hint.dimension)) {
      satisfied.push(hint.dimension);
      evidenceGaps.delete(hint.dimension);
      unknownDimensions.delete(hint.dimension);
    }
    applied.push({
      dimension: hint.dimension,
      from,
      to,
      reason: hint.reason,
      author: hint.author,
      expires_at: hint.expires_at,
    });
  }

  return {
    ...artifact,
    scores,
    evidence_gap_dimensions: uniqueWithout(artifact.evidence_gap_dimensions || [], satisfied),
    unknown_dimensions: uniqueWithout(artifact.unknown_dimensions || [], satisfied),
    hints_applied: applied,
    hint_warnings: warnings,
  };
}

module.exports = {
  HINT_MAX_DAYS,
  HINT_MAX_SCORE,
  applyContextHints,
  defaultHintsPath,
  readContextHints,
};
