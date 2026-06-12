"use strict";

const {
  ALLOWED_TRANSITIONS,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  ROUND_PATTERN,
  VALID_VERDICTS,
} = require("./context-gate-constants");
const { nonEmpty, parseIsoDate } = require("./context-gate-utils");

function validateIntegerField(value, field, errors, min = 1, max = 10) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${field} must be an integer from ${min} to ${max}`);
  }
}

function validateStringArray(value, field, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateHint(hint, index, errors) {
  if (!hint || typeof hint !== "object") {
    errors.push(`hints_applied[${index}] must be an object`);
    return;
  }
  for (const field of ["dimension", "reason", "author", "expires_at"]) {
    if (!nonEmpty(hint[field])) {
      errors.push(`hints_applied[${index}].${field} is required`);
    }
  }
  validateIntegerField(hint.from, `hints_applied[${index}].from`, errors);
  validateIntegerField(hint.to, `hints_applied[${index}].to`, errors);
  if (hint.to > 9) {
    errors.push(`hints_applied[${index}].to must not exceed 9`);
  }
  if (!parseIsoDate(hint.expires_at)) {
    errors.push(`hints_applied[${index}].expires_at must be a date-time string`);
  }
}

function validateContextGateArtifact(artifact, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeDays = options.maxAgeDays === undefined ? DEFAULT_MAX_ARTIFACT_AGE_DAYS : options.maxAgeDays;

  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return { ok: false, errors: ["artifact must be an object"] };
  }
  if (!ROUND_PATTERN.test(String(artifact.round_id || ""))) {
    errors.push("round_id must match ROUND-NNN");
  }
  const generatedAt = parseIsoDate(artifact.generated_at);
  if (!generatedAt) {
    errors.push("generated_at must be a date-time string");
  } else if (maxAgeDays !== null) {
    const ageMs = now.getTime() - generatedAt.getTime();
    if (ageMs < -5 * 60 * 1000) {
      errors.push("generated_at must not be in the future");
    }
    if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
      errors.push(`generated_at must not be older than ${maxAgeDays} days`);
    }
  }
  if (!ALLOWED_TRANSITIONS.includes(artifact.transition)) {
    errors.push("transition must be a supported phase transition");
  }
  validateIntegerField(artifact.overall_score, "overall_score", errors);
  if (!VALID_VERDICTS.has(artifact.verdict)) {
    errors.push("verdict must be blocked, narrowed, proceed, or excellent");
  }
  if (!artifact.scores || typeof artifact.scores !== "object" || Array.isArray(artifact.scores)) {
    errors.push("scores must be an object");
  } else {
    const keys = Object.keys(artifact.scores).sort();
    const expected = [...DIMENSIONS].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      errors.push("scores must contain exactly the context gate dimensions");
    }
    for (const dimension of DIMENSIONS) {
      validateIntegerField(artifact.scores[dimension], `scores.${dimension}`, errors);
    }
  }
  if (!nonEmpty(artifact.correct_next_step)) {
    errors.push("correct_next_step is required");
  }
  validateStringArray(artifact.structural_hard_blockers || [], "structural_hard_blockers", errors);
  validateStringArray(artifact.evidence_gap_dimensions || [], "evidence_gap_dimensions", errors);
  validateStringArray(artifact.unknown_dimensions || [], "unknown_dimensions", errors);
  validateStringArray(artifact.questions || [], "questions", errors);
  if (Array.isArray(artifact.questions) && artifact.questions.length > 3) {
    errors.push("questions must contain at most 3 items");
  }
  if (!Array.isArray(artifact.hints_applied || [])) {
    errors.push("hints_applied must be an array");
  } else {
    for (const [index, hint] of (artifact.hints_applied || []).entries()) {
      validateHint(hint, index, errors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateContextGateArtifact,
};
