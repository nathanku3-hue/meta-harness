"use strict";

const {
  ROUND_PATTERN,
} = require("./context-gate-constants");
const { contextGateGovernance, nonEmpty, parseIsoDate } = require("./context-gate-utils");

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
  const rules = contextGateGovernance(options.governance);
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeDays = options.maxAgeDays === undefined ? rules.defaultMaxArtifactAgeDays : options.maxAgeDays;

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
  if (!rules.allowedTransitions.includes(artifact.transition)) {
    errors.push("transition must be a supported phase transition");
  }
  validateIntegerField(artifact.overall_score, "overall_score", errors);
  if (!rules.validVerdictSet.has(artifact.verdict)) {
    errors.push(`verdict must be one of: ${rules.validVerdicts.join(", ")}`);
  }
  if (!artifact.scores || typeof artifact.scores !== "object" || Array.isArray(artifact.scores)) {
    errors.push("scores must be an object");
  } else {
    const keys = Object.keys(artifact.scores).sort();
    const expected = [...rules.dimensions].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      errors.push("scores must contain exactly the context gate dimensions");
    }
    for (const dimension of rules.dimensions) {
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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateOptionalStringArray(doc, field, failures) {
  if (doc[field] === undefined) return;
  if (!Array.isArray(doc[field]) || !doc[field].every((item) => typeof item === "string")) {
    failures.push(`${field} must be an array of strings`);
  }
}

function validateContextGateArtifactDoc(doc, expectedRoundId, nowMsOrOptions = Date.now(), maybeOptions = {}) {
  const options = (
    nowMsOrOptions &&
    typeof nowMsOrOptions === "object" &&
    !(nowMsOrOptions instanceof Date)
  ) ? nowMsOrOptions : maybeOptions;
  const nowMs = nowMsOrOptions instanceof Date
    ? nowMsOrOptions.getTime()
    : (typeof nowMsOrOptions === "number"
      ? nowMsOrOptions
      : (options.now instanceof Date ? options.now.getTime() : (Number.isFinite(options.nowMs) ? options.nowMs : Date.now())));
  const rules = contextGateGovernance(options.governance);
  const maxAgeDays = options.maxAgeDays === undefined ? rules.defaultMaxArtifactAgeDays : options.maxAgeDays;
  const failures = [];
  if (!isPlainObject(doc)) return { ok: false, reason: "artifact root must be an object" };
  for (const field of ["round_id", "generated_at", "transition", "overall_score", "verdict", "scores", "correct_next_step"]) {
    if (doc[field] === undefined) failures.push(`missing ${field}`);
  }
  if (typeof doc.round_id !== "string" || !ROUND_PATTERN.test(doc.round_id)) failures.push("round_id must match ROUND-NNN");
  else if (doc.round_id !== expectedRoundId) failures.push(`round_id ${doc.round_id} does not match file ${expectedRoundId}`);

  const generatedAtMs = typeof doc.generated_at === "string" ? Date.parse(doc.generated_at) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) failures.push("generated_at must be an ISO date-time");
  else if (maxAgeDays !== null && nowMs - generatedAtMs > maxAgeDays * 24 * 60 * 60 * 1000) failures.push(`generated_at is older than ${maxAgeDays} days`);

  if (typeof doc.transition !== "string" || !rules.allowedTransitions.includes(doc.transition)) failures.push("transition must be a supported phase transition");
  if (!Number.isInteger(doc.overall_score) || doc.overall_score < 1 || doc.overall_score > 10) failures.push("overall_score must be an integer from 1 to 10");
  if (typeof doc.verdict !== "string" || !rules.validVerdictSet.has(doc.verdict)) failures.push(`verdict must be one of: ${rules.validVerdicts.join(", ")}`);
  if (!isPlainObject(doc.scores)) {
    failures.push("scores must be an object");
  } else {
    for (const dimension of rules.dimensions) validateIntegerField(doc.scores[dimension], `scores.${dimension}`, failures);
    const extraDimensions = Object.keys(doc.scores).filter((dimension) => !rules.dimensions.includes(dimension));
    if (extraDimensions.length > 0) failures.push(`scores contains unknown dimension(s): ${extraDimensions.join(", ")}`);
  }
  if (typeof doc.correct_next_step !== "string") failures.push("correct_next_step must be a string");
  validateOptionalStringArray(doc, "structural_hard_blockers", failures);
  validateOptionalStringArray(doc, "evidence_gap_dimensions", failures);
  validateOptionalStringArray(doc, "unknown_dimensions", failures);
  if (doc.questions !== undefined && (!Array.isArray(doc.questions) || doc.questions.length > 3 || !doc.questions.every((item) => typeof item === "string"))) {
    failures.push("questions must be an array of at most 3 strings");
  }
  if (doc.hints_applied !== undefined && !Array.isArray(doc.hints_applied)) failures.push("hints_applied must be an array when present");
  return { ok: failures.length === 0, reason: failures.join("; ") };
}

module.exports = {
  validateContextGateArtifact,
  validateContextGateArtifactDoc,
};
