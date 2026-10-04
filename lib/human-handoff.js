"use strict";

const PM_CLOSURE = "PM_CLOSURE";
const AUDIT = "AUDIT";
const EGRESS_SOURCES = new Set([
  "NORMAL_COMPLETION",
  "RESUME_COMPLETION",
  "SUBAGENT_AGGREGATION",
]);
const PRESENTATION_KINDS = new Set(["AUTO", "TEXT", "DIAGRAM", "APP"]);
const PRESENTATION_SHAPES = new Set(["LINEAR", "CAUSAL", "COMPARISON", "STATE", "EVIDENCE"]);
const TEXT_PRESENTATION_MODES = new Set([
  "AUTO",
  "COMPLETION",
  "QUIESCENT",
  "CONTINUATION",
  "BLOCKER",
  "OWNER_REQUIRED",
  "AGGREGATE",
  "SAFE_STOP",
]);

const FORBIDDEN_PM_PATTERNS = [
  [/^\s*\*{0,2}Outcome:\*{0,2}/imu, "Outcome metadata"],
  [/^\s*\*{0,2}Round:\*{0,2}/imu, "Round metadata"],
  [/^\s*\*{0,2}Progress:\*{0,2}/imu, "Progress metadata"],
  [/^\s*\*{0,2}Confidence:\*{0,2}/imu, "Confidence metadata"],
  [/^\s*\*{0,2}(?:Validation\s*\/\s*evidence|Worker accountability):\*{0,2}/imu, "audit section"],
  [/\bSAW Verdict\s*:/iu, "SAW verdict"],
  [/\bClosurePacket\s*:/iu, "closure packet"],
  [/\bOWNER_DECISION\b/iu, "owner lifecycle token"],
  [/\bNO_AUTO_OPEN\b/iu, "no-auto-open lifecycle token"],
  [/\bauto_open\s*=\s*false\b/iu, "auto-open lifecycle token"],
  [/\bwait for owner\b/iu, "bureaucratic owner wait"],
  [/\bawait(?:ing)? owner\b/iu, "bureaucratic owner wait"],
  [/\bif you want to proceed\b/iu, "optional-proceed escape hatch"],
  [/\bon resume i detected\b/iu, "resume narration"],
  [/\bduring the interruption\b/iu, "interruption narration"],
  [/\bi did not rerun\b/iu, "retry bookkeeping"],
  [/\bno commit or push was performed\b/iu, "commit/push bookkeeping"],
  [/\breviewer\s+a\/b\/c\s+(?:is|are|was|were)?\s*unavailable\b/iu, "reviewer availability"],
  [/\btask attestation\s+(?:is|was)?\s*unavailable\b/iu, "attestation-tool leakage"],
  [/\b(?:provider calls|source acquisition|outcome\/tbt|ranking|portfolio|target book)\s*=\s*0\b/iu, "raw zero-counter"],
  [/\b(?:tradeintent|broker)\s*=\s*(?:false|none)\b/iu, "raw false/none flag"],
  [/\breal capital\s*=\s*(?:false|none)\b/iu, "raw capital flag"],
  [/\b(?:Outcome|Round|Progress|Confidence|Worker|Stream|Task|Phase):/iu, "embedded lifecycle metadata"],
  [/\b(?:What I did|PM-facing status|Key decisions made|What is still blocked|Next round recommendation|Validation\s*\/\s*evidence|Worker accountability):/iu, "embedded audit section"],
];

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireStringArray(value, label, { min = 1, max = 8 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must contain ${min}-${max} strings`);
  }
  return value.map((entry, index) => requireText(entry, `${label}[${index}]`));
}

function normalizePresentation(value) {
  if (value == null) {
    return Object.freeze({
      kind: "AUTO",
      shape: "LINEAR",
      itemCount: 0,
      hasBranches: false,
      hasEvidence: false,
      textMode: "AUTO",
    });
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("presentation must be an object");
  }
  const kind = String(value.kind || "AUTO").trim().toUpperCase();
  const shape = String(value.shape || "LINEAR").trim().toUpperCase();
  const itemCount = value.itemCount == null ? 0 : Number(value.itemCount);
  const textMode = String(value.textMode || "AUTO").trim().toUpperCase();
  if (!PRESENTATION_KINDS.has(kind)) throw new TypeError("presentation.kind is invalid");
  if (!PRESENTATION_SHAPES.has(shape)) throw new TypeError("presentation.shape is invalid");
  if (!TEXT_PRESENTATION_MODES.has(textMode)) throw new TypeError("presentation.textMode is invalid");
  if (!Number.isInteger(itemCount) || itemCount < 0 || itemCount > 1000) {
    throw new TypeError("presentation.itemCount must be an integer from 0 to 1000");
  }
  if (value.hasBranches != null && typeof value.hasBranches !== "boolean") {
    throw new TypeError("presentation.hasBranches must be boolean");
  }
  if (value.hasEvidence != null && typeof value.hasEvidence !== "boolean") {
    throw new TypeError("presentation.hasEvidence must be boolean");
  }
  return Object.freeze({
    kind,
    shape,
    itemCount,
    hasBranches: value.hasBranches === true,
    hasEvidence: value.hasEvidence === true,
    textMode,
  });
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("human handoff envelope must be an object");
  }
  const next = value.next;
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new TypeError("human handoff next must be an object");
  }
  if (typeof value.humanStopRequired !== "boolean") {
    throw new TypeError("humanStopRequired must be boolean");
  }
  const source = value.egressSource;
  if (!EGRESS_SOURCES.has(source)) {
    throw new TypeError("egressSource is invalid");
  }

  const normalized = {
    status: requireText(value.status, "status"),
    why: requireText(value.why, "why"),
    next: {
      action: requireText(next.action, "next.action"),
      where: requireText(next.where, "next.where"),
      whyNow: requireText(next.whyNow, "next.whyNow"),
      locks: requireStringArray(next.locks, "next.locks"),
      doneWhen: requireText(next.doneWhen, "next.doneWhen"),
      unlocks: requireText(next.unlocks, "next.unlocks"),
      whyNotOthers: requireStringArray(next.whyNotOthers, "next.whyNotOthers", { min: 1, max: 3 }),
    },
    humanStopRequired: value.humanStopRequired,
    humanStopReason: value.humanStopReason == null ? null : requireText(value.humanStopReason, "humanStopReason"),
    decisionQuestion: value.decisionQuestion == null ? null : requireText(value.decisionQuestion, "decisionQuestion"),
    egressSource: source,
    presentation: normalizePresentation(value.presentation),
  };

  if (normalized.humanStopRequired) {
    if (!normalized.humanStopReason || !normalized.decisionQuestion) {
      throw new TypeError("human stop requires humanStopReason and decisionQuestion");
    }
  } else if (normalized.humanStopReason !== null || normalized.decisionQuestion !== null) {
    throw new TypeError("human stop payload is forbidden when humanStopRequired=false");
  }

  return Object.freeze({
    ...normalized,
    next: Object.freeze({
      ...normalized.next,
      locks: Object.freeze(normalized.next.locks),
      whyNotOthers: Object.freeze(normalized.next.whyNotOthers),
    }),
  });
}

function renderHumanHandoff(envelope) {
  const value = normalizeEnvelope(envelope);
  const lines = [
    `Status: ${value.status}`,
    "",
    `Why: ${value.why}`,
    "",
    `Next: ${value.next.action}`,
    `- Where: ${value.next.where}`,
    `- Why now: ${value.next.whyNow}`,
    `- Lock: ${value.next.locks.join("; ")}`,
    `- Done when: ${value.next.doneWhen} After that: ${value.next.unlocks}`,
    `- Why not other candidates: ${value.next.whyNotOthers.join("; ")}`,
  ];
  if (value.humanStopRequired) {
    lines.push("", `Decision needed: ${value.decisionQuestion}`);
  }
  return `${lines.join("\n")}\n`;
}

function validatePmLeakage(text) {
  const value = String(text || "");
  const errors = [];
  for (const [pattern, label] of FORBIDDEN_PM_PATTERNS) {
    if (pattern.test(value)) errors.push(`forbidden PM leakage: ${label}`);
  }
  return errors;
}

function validateHumanHandoffText(text, {
  mode = PM_CLOSURE,
  humanStopRequired = null,
} = {}) {
  if (mode === AUDIT) return [];
  if (mode !== PM_CLOSURE) return [`unknown handoff mode: ${mode}`];

  const value = String(text || "");
  const errors = validatePmLeakage(value);

  for (const section of ["Status:", "Why:", "Next:"]) {
    if (!new RegExp(`^\\s*${section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "imu").test(value)) {
      errors.push(`missing ${section}`);
    }
  }
  for (const field of ["Where", "Why now", "Lock", "Done when", "Why not other candidates"]) {
    if (!new RegExp(`^\\s*-\\s*${field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:`, "imu").test(value)) {
      errors.push(`missing Next field: ${field}`);
    }
  }

  const hasDecision = /^\s*Decision needed:/imu.test(value);
  if (humanStopRequired === false && hasDecision) {
    errors.push("Decision needed is forbidden when humanStopRequired=false");
  }
  if (humanStopRequired === true && !hasDecision) {
    errors.push("Decision needed is required when humanStopRequired=true");
  }
  return errors;
}

function renderValidatedHumanHandoff(envelope) {
  const normalized = normalizeEnvelope(envelope);
  const text = renderHumanHandoff(normalized);
  const errors = validateHumanHandoffText(text, {
    mode: PM_CLOSURE,
    humanStopRequired: normalized.humanStopRequired,
  });
  if (errors.length > 0) {
    const error = new Error(`human handoff egress validation failed: ${errors.join(" | ")}`);
    error.code = "MH_HUMAN_HANDOFF_EGRESS";
    throw error;
  }
  return text;
}

module.exports = {
  AUDIT,
  EGRESS_SOURCES,
  PM_CLOSURE,
  PRESENTATION_KINDS,
  PRESENTATION_SHAPES,
  TEXT_PRESENTATION_MODES,
  normalizeEnvelope,
  normalizePresentation,
  renderHumanHandoff,
  renderValidatedHumanHandoff,
  validateHumanHandoffText,
  validatePmLeakage,
};
