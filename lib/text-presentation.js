"use strict";

const {
  normalizeEnvelope,
  validatePmLeakage,
} = require("./human-handoff");

const TEXT_PRESENTATION_SCHEMA = "human-text-presentation/v1";

const OWNER_REASON_TEXT = Object.freeze({
  MATERIAL_PRODUCT_CHOICE: "This choice changes product behavior.",
  SCOPE_EXPANSION: "This changes the requested scope.",
  CREDENTIAL_INPUT: "The next external step requires credentials.",
  PROTECTED_ACCESS: "The next step requires protected access.",
  EXTERNAL_PUBLICATION: "Publication changes external state.",
  DESTRUCTIVE_EXTERNAL_EFFECT: "The next step can irreversibly change external state.",
  ACCEPT_MATERIAL_RISK: "Continuing requires accepting material risk.",
  AMBIGUOUS_NON_REPLAYABLE_EFFECT: "The external effect cannot be safely inferred or replayed.",
});

const CONTROL_LEAK_PATTERNS = Object.freeze([
  [/\bDecision needed\b/iu, "decision-needed label"],
  [/\breversible means\b/iu, "reversible-means narration"],
  [/\bworker lifecycle\b/iu, "worker-lifecycle narration"],
  [/\bexecution fan-in\b/iu, "execution-fan-in narration"],
  [/\bowner-exclusive boundary\b/iu, "owner-boundary narration"],
  [/\bdurable truth\b/iu, "durable-truth narration"],
  [/\bworkspace(?:Id)?\b/iu, "workspace narration"],
  [/\bsessionDigest\b|\bwork-session\b/iu, "session narration"],
  [/\breviewer mechanics\b|\breviewer availability\b/iu, "reviewer narration"],
  [/\bcustody\b/iu, "custody narration"],
  [/\badmission\b|\bauthorization\b/iu, "authority narration"],
  [/\b(?:semantic|product|execution|truth) authority\b/iu, "authority-era control vocabulary"],
  [/\b(?:owner )?approval (?:gate|round)\b/iu, "approval-era control vocabulary"],
  [/\b(?:Outcome Claim|Claim authority|ExecutionPermit|WorkspaceLease|WorldHead)\b/u, "retired control primitive"],
  [/^\s*-\s*(?:Where|Why now|Lock|Done when|Why not other candidates):/imu, "expanded handoff field"],
]);

function nonEmptyLines(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ownerReason(reason) {
  const text = OWNER_REASON_TEXT[reason];
  if (!text) {
    const error = new Error(`unknown owner-stop reason for text presentation: ${String(reason || "")}`);
    error.code = "MH_TEXT_PRESENTATION_OWNER_REASON";
    throw error;
  }
  return text;
}

function compileLines(envelope) {
  const mode = envelope.presentation.textMode;
  switch (mode) {
    case "COMPLETION":
      return envelope.next
        ? [`Done — ${envelope.status}`, `Next — ${envelope.next.action}`]
        : [`Done — ${envelope.status}`];
    case "QUIESCENT":
      return envelope.next
        ? ["No current product gap.", `Next — ${envelope.next.action}`]
        : ["No current product gap."];
    case "CONTINUATION":
      return [
        `Not done — ${envelope.status}`,
        `Next — ${envelope.next.action}`,
      ];
    case "BLOCKER":
      return [
        `Blocked — ${envelope.status}`,
        `Next — ${envelope.next.action}`,
      ];
    case "OWNER_REQUIRED":
      return [
        `Need input — ${envelope.decisionQuestion}`,
        `Why — ${ownerReason(envelope.humanStopReason)}`,
        "Then — The same work continues.",
      ];
    case "AGGREGATE":
      return [
        `Update — ${envelope.status}`,
        `Next — ${envelope.next.action}`,
      ];
    case "SAFE_STOP":
      return envelope.next
        ? ["Stopped safely — current product state is preserved.", `Next — ${envelope.next.action}`]
        : ["Stopped safely — current product state is preserved."];
    case "AUTO":
      return [
        `Update — ${envelope.status}`,
        `Next — ${envelope.next.action}`,
      ];
    default: {
      const error = new Error(`unsupported text presentation mode: ${mode}`);
      error.code = "MH_TEXT_PRESENTATION_MODE";
      throw error;
    }
  }
}

function validateTextPresentation(text, envelope) {
  const errors = [...validatePmLeakage(text)];
  const lines = nonEmptyLines(text);
  if (lines.length < 1 || lines.length > 4) {
    errors.push("text presentation must contain 1-4 non-empty lines");
  }
  for (const [pattern, label] of CONTROL_LEAK_PATTERNS) {
    if (pattern.test(String(text || ""))) errors.push(`forbidden text-presentation leakage: ${label}`);
  }

  const needInputLines = lines.filter((line) => line.startsWith("Need input — "));
  if (envelope.humanStopRequired) {
    if (envelope.presentation.textMode !== "OWNER_REQUIRED") {
      errors.push("human stop must use OWNER_REQUIRED text mode");
    }
    if (needInputLines.length !== 1) {
      errors.push("owner-required text must contain exactly one Need input line");
    }
  } else if (needInputLines.length > 0) {
    errors.push("Need input is forbidden when humanStopRequired=false");
  }

  if (envelope.presentation.textMode === "COMPLETION" && lines.length > 2) {
    errors.push("completion text must contain at most two non-empty lines");
  }
  if (envelope.presentation.textMode === "OWNER_REQUIRED" && lines.length > 3) {
    errors.push("owner-required text must contain at most three non-empty lines");
  }
  return errors;
}

function compileTextPresentation(value) {
  const envelope = normalizeEnvelope(value);
  if (envelope.humanStopRequired && envelope.presentation.textMode !== "OWNER_REQUIRED") {
    const error = new Error("human stop requires OWNER_REQUIRED text presentation mode");
    error.code = "MH_TEXT_PRESENTATION_MODE";
    throw error;
  }
  if (!envelope.humanStopRequired && envelope.presentation.textMode === "OWNER_REQUIRED") {
    const error = new Error("OWNER_REQUIRED text mode requires humanStopRequired=true");
    error.code = "MH_TEXT_PRESENTATION_MODE";
    throw error;
  }

  const text = `${compileLines(envelope).join("\n")}\n`;
  const errors = validateTextPresentation(text, envelope);
  if (errors.length > 0) {
    const error = new Error(`text presentation validation failed: ${errors.join(" | ")}`);
    error.code = "MH_TEXT_PRESENTATION_EGRESS";
    throw error;
  }

  return Object.freeze({
    schemaVersion: TEXT_PRESENTATION_SCHEMA,
    mode: envelope.presentation.textMode,
    text,
  });
}

module.exports = {
  OWNER_REASON_TEXT,
  TEXT_PRESENTATION_SCHEMA,
  compileTextPresentation,
  validateTextPresentation,
};
