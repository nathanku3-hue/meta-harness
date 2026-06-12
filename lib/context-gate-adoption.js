"use strict";

const fs = require("node:fs");
const path = require("node:path");

const eventStore = require("./events");
const { HARNESS_DIR } = require("./paths");
const {
  BYPASS_REASON_CODES,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
} = require("./context-gate-constants");

const ADOPTION_CONTRACT_RELATIVE_PATH = ".meta-harness/contracts/context-adoption.md";

const PHASE_TO_EXPECTED_TRANSITION = Object.freeze({
  intake: "intake->plan",
  plan: "plan->work",
  work: "work->verify",
  verify: "verify->synthesize",
  synthesize: "synthesize->handoff",
  handoff: "handoff->lookback",
  lookback: null,
});

function slashPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function repoRelative(targetRoot, filePath) {
  return slashPath(path.relative(targetRoot, filePath));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRegularFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function adoptionContractPath(targetRoot) {
  return path.join(targetRoot, ...ADOPTION_CONTRACT_RELATIVE_PATH.split("/"));
}

function hasAdoptionContract(targetRoot) {
  return isRegularFile(adoptionContractPath(targetRoot));
}

function readCurrentPhase(targetRoot) {
  const statusPath = path.join(targetRoot, HARNESS_DIR, "status.md");
  if (!fs.existsSync(statusPath)) return null;

  const lines = fs.readFileSync(statusPath, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^Phase:\s*(.*)$/);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) return inline;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (candidate) return candidate;
    }
  }
  return null;
}

function expectedTransitionFromStatus(targetRoot) {
  const phase = readCurrentPhase(targetRoot);
  if (!phase || !Object.prototype.hasOwnProperty.call(PHASE_TO_EXPECTED_TRANSITION, phase)) {
    return { phase, transition: null };
  }
  return { phase, transition: PHASE_TO_EXPECTED_TRANSITION[phase] };
}

function isGateRequired(transition) {
  return REQUIRED_GATE_TRANSITIONS.has(transition);
}

function isGateOptional(transition) {
  return OPTIONAL_GATE_TRANSITIONS.has(transition);
}

function validateBypass(input = {}) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "human";
  const errors = [];

  if (!reason) {
    errors.push("override reason is required");
  }
  if (!BYPASS_REASON_CODES.includes(code)) {
    errors.push(`override code must be one of: ${BYPASS_REASON_CODES.join(", ")}`);
  }
  if (!actor) {
    errors.push("override actor is required");
  }

  return {
    ok: errors.length === 0,
    reason: errors.join("; "),
    override: errors.length === 0 ? { reason, code, actor } : undefined,
  };
}

function createBypassEvent({
  targetRoot,
  artifactPath,
  actor = "human",
  transition,
  reason,
  code,
  roundId,
  verdict,
  correctNextStep,
}) {
  const phase = String(transition || "").split("->")[0] || "work";
  return {
    actor,
    stream: "coding",
    phase,
    action: "context-gate-override",
    result: `override accepted: ${code}`,
    transition,
    reason,
    code,
    round_id: roundId,
    verdict,
    evidence: repoRelative(targetRoot, artifactPath),
    next_action: correctNextStep,
  };
}

function eventTimeMs(event) {
  const value = event && (event.ts || event.time);
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function readBypassEvents(targetRoot) {
  const eventsPath = path.join(targetRoot, HARNESS_DIR, "events.jsonl");
  return eventStore.readEvents(eventsPath);
}

function findMatchingBypassEvent({ targetRoot, artifact, artifactPath }) {
  if (!artifact || !artifact.override || !artifactPath) {
    return null;
  }

  const validation = validateBypass(artifact.override);
  if (!validation.ok) {
    return null;
  }

  const artifactGeneratedAtMs = Date.parse(artifact.generated_at || "");
  if (!Number.isFinite(artifactGeneratedAtMs)) {
    return null;
  }

  const relativeArtifactPath = repoRelative(targetRoot, artifactPath);
  const events = readBypassEvents(targetRoot);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.action !== "context-gate-override") continue;
    if (event.round_id !== artifact.round_id) continue;
    if (event.transition !== artifact.transition) continue;
    if (event.code !== validation.override.code) continue;
    if (event.evidence !== relativeArtifactPath) continue;
    if (eventTimeMs(event) < artifactGeneratedAtMs) continue;
    return event;
  }
  return null;
}

function overrideStatus({ targetRoot, artifact, artifactPath }) {
  if (!artifact || !artifact.override) {
    return { ok: false, reason: "no override recorded" };
  }
  const validation = validateBypass(artifact.override);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  const event = findMatchingBypassEvent({ targetRoot, artifact, artifactPath });
  if (!event) {
    return { ok: false, reason: "no matching context-gate-override event at or after artifact generation" };
  }
  return { ok: true, event, override: validation.override };
}

module.exports = {
  ADOPTION_CONTRACT_RELATIVE_PATH,
  adoptionContractPath,
  createBypassEvent,
  expectedTransitionFromStatus,
  findMatchingBypassEvent,
  hasAdoptionContract,
  isGateOptional,
  isGateRequired,
  overrideStatus,
  readCurrentPhase,
  validateBypass,
};
