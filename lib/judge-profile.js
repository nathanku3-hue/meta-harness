"use strict";

const SCHEMA_VERSION = "1.0.0";
const PROFILE_TOOL = "meta-harness-candidate-profile";
const JUDGE_TOOL = "meta-harness-judge";

const TRAIT_GUIDANCE = Object.freeze({
  "eager-broad-edits": {
    id: "JUDGE_GUIDANCE_SCOPE",
    text: "Declare owned files before editing and split unrelated cleanup into a separate round.",
  },
  "over-defensive-abstraction": {
    id: "JUDGE_GUIDANCE_DEFENSIVE",
    text: "Prefer the smallest local check; require concrete call sites before adding generic helpers or utils.",
  },
  "refactor-residue": {
    id: "JUDGE_GUIDANCE_RESIDUE",
    text: "Search for removed names and stale references before closure, then cite the residue check evidence.",
  },
  "tests-pass-therefore-done": {
    id: "JUDGE_GUIDANCE_SMOKE",
    text: "Pair test results with package or CLI smoke evidence before claiming the round is done.",
  },
});

const CANDIDATE_PROFILE_SCHEMA = Object.freeze({
  "$schema": "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["schema_version", "tool", "generated_at", "ok", "status", "source", "traits", "guidance", "errors"],
  additionalProperties: false,
  properties: {
    schema_version: { const: SCHEMA_VERSION },
    tool: { const: PROFILE_TOOL },
    generated_at: { type: "string", format: "date-time" },
    ok: { type: "boolean" },
    status: { enum: ["profiled", "no_observed_traits", "insufficient_evidence"] },
    source: { type: "object" },
    traits: { type: "array" },
    guidance: { type: "array" },
    errors: { type: "array" },
    limitations: { type: "array" },
  },
});

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function normalizeStatus(status) {
  return ["fail", "warn", "pass"].includes(status) ? status : "warn";
}

function priorityFor(events) {
  if (events.some((event) => event.status === "fail")) return "high";
  if (events.some((event) => event.status === "warn")) return "medium";
  return "low";
}

function sourceSummary(envelope) {
  return {
    tool: cleanString(envelope.tool),
    schema_version: cleanString(envelope.schema_version),
    status: cleanString(envelope.status),
    ok: envelope.ok === true,
    round: cleanString(envelope.input?.round),
    model: cleanString(envelope.input?.model),
    base_ref: cleanString(envelope.target?.base_ref),
    base_sha: cleanString(envelope.target?.base_sha),
    head_sha: cleanString(envelope.target?.head_sha),
    check_count: Array.isArray(envelope.checks) ? envelope.checks.length : 0,
  };
}

function normalizeEvent(event) {
  if (!isPlainObject(event)) return null;
  const trait = cleanString(event.trait);
  const checkId = cleanString(event.check_id);
  if (!trait || !checkId) return null;
  const files = Array.isArray(event.files) ? uniqueSorted(event.files.map(toSlash)) : [];
  return {
    trait,
    check_id: checkId,
    status: normalizeStatus(event.status),
    files,
  };
}

function checkEvidenceById(envelope) {
  const checks = Array.isArray(envelope.checks) ? envelope.checks : [];
  return new Map(checks
    .filter((check) => isPlainObject(check) && cleanString(check.check_id))
    .map((check) => [check.check_id, check]));
}

function eventEvidence(event, checksById) {
  const check = checksById.get(event.check_id);
  return {
    check_id: event.check_id,
    status: event.status,
    files: event.files,
    evidence: cleanString(check?.evidence),
  };
}

function aggregateTraits(envelope) {
  const checksById = checkEvidenceById(envelope);
  const events = (Array.isArray(envelope.candidate_profile_events) ? envelope.candidate_profile_events : [])
    .map(normalizeEvent)
    .filter(Boolean);
  const byTrait = new Map();

  for (const event of events) {
    const current = byTrait.get(event.trait) || [];
    current.push(event);
    byTrait.set(event.trait, current);
  }

  return Array.from(byTrait.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([trait, traitEvents]) => {
      const evidence = traitEvents
        .sort((left, right) => left.check_id.localeCompare(right.check_id))
        .map((event) => eventEvidence(event, checksById));
      return {
        trait,
        priority: priorityFor(traitEvents),
        check_ids: uniqueSorted(traitEvents.map((event) => event.check_id)),
        files: uniqueSorted(traitEvents.flatMap((event) => event.files)),
        evidence,
      };
    });
}

function guidanceForTrait(traitProfile) {
  const known = TRAIT_GUIDANCE[traitProfile.trait];
  return {
    id: known?.id || "JUDGE_GUIDANCE_REVIEW_EVIDENCE",
    trait: traitProfile.trait,
    priority: traitProfile.priority,
    mode: "read_only_guidance",
    authority: "advisory_only",
    text: known?.text || "Review the referenced judge evidence before changing prompts, routing, or implementation scope.",
    evidence_check_ids: traitProfile.check_ids,
    files: traitProfile.files,
  };
}

function validationErrors(envelope) {
  const errors = [];
  if (!isPlainObject(envelope)) {
    return [{ code: "PROFILE_INPUT_INVALID", message: "judge evidence must be an object" }];
  }
  if (envelope.tool !== JUDGE_TOOL) {
    errors.push({ code: "PROFILE_INPUT_TOOL_INVALID", message: `expected ${JUDGE_TOOL} evidence` });
  }
  if (envelope.schema_version !== "1.0.0") {
    errors.push({ code: "PROFILE_INPUT_SCHEMA_UNSUPPORTED", message: "judge evidence schema_version must be 1.0.0" });
  }
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    errors.push({ code: "PROFILE_INPUT_HAS_ERRORS", message: "judge evidence contains input or execution errors" });
  }
  return errors;
}

function profileFromJudgeEvidence(envelope, options = {}) {
  const input = isPlainObject(envelope) ? envelope : {};
  const errors = validationErrors(envelope);
  const traits = errors.length === 0 ? aggregateTraits(input) : [];
  const guidance = traits.map(guidanceForTrait);
  const status = errors.length > 0
    ? "insufficient_evidence"
    : (traits.length > 0 ? "profiled" : "no_observed_traits");

  return {
    schema_version: SCHEMA_VERSION,
    tool: PROFILE_TOOL,
    generated_at: options.generatedAt || new Date().toISOString(),
    ok: errors.length === 0,
    status,
    source: sourceSummary(input),
    traits,
    guidance,
    errors,
    limitations: [
      "Profile guidance is read-only and must not approve routing, delegation, merge, readiness, or policy changes.",
      "Guidance is derived only from judge evidence; it is not a global model or worker ranking.",
    ],
  };
}

function validateCandidateProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) {
    return { ok: false, errors: ["profile must be an object"] };
  }
  for (const field of CANDIDATE_PROFILE_SCHEMA.required) {
    if (!(field in profile)) errors.push(`missing required field: ${field}`);
  }
  if (profile.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (profile.tool !== PROFILE_TOOL) errors.push(`tool must be ${PROFILE_TOOL}`);
  if (!["profiled", "no_observed_traits", "insufficient_evidence"].includes(profile.status)) {
    errors.push("status must be profiled, no_observed_traits, or insufficient_evidence");
  }
  if (typeof profile.ok !== "boolean") errors.push("ok must be boolean");
  for (const field of ["traits", "guidance", "errors", "limitations"]) {
    if (!Array.isArray(profile[field])) errors.push(`${field} must be an array`);
  }
  return { ok: errors.length === 0, errors };
}

function renderProfileGuidance(profile) {
  if (!isPlainObject(profile) || !Array.isArray(profile.guidance)) return "";
  const lines = [`candidate profile: ${profile.status || "unknown"}`];
  for (const item of profile.guidance) {
    lines.push(`${String(item.priority || "low").toUpperCase()} ${item.trait}: ${item.text}`);
  }
  if (profile.guidance.length === 0) lines.push("no judge-derived guidance");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  CANDIDATE_PROFILE_SCHEMA,
  TRAIT_GUIDANCE,
  profileFromJudgeEvidence,
  renderProfileGuidance,
  validateCandidateProfile,
};
