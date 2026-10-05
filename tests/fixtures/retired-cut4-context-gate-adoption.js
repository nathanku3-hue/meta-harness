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
const { contextGateGovernance } = require("./context-gate-utils");

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

function expectedTransitionFromStatus(targetRoot, { governance } = {}) {
  const phase = readCurrentPhase(targetRoot);
  const rules = contextGateGovernance(governance, {
    phaseToExpectedTransition: PHASE_TO_EXPECTED_TRANSITION,
  });
  if (!phase || !Object.prototype.hasOwnProperty.call(rules.phaseToExpectedTransition, phase)) {
    return { phase, transition: null };
  }
  return { phase, transition: rules.phaseToExpectedTransition[phase] };
}

function isGateRequired(transition, { governance } = {}) {
  const rules = contextGateGovernance(governance, {
    requiredGateTransitions: REQUIRED_GATE_TRANSITIONS,
  });
  return rules.requiredGateTransitionSet.has(transition);
}

function isGateOptional(transition, { governance } = {}) {
  const rules = contextGateGovernance(governance, {
    optionalGateTransitions: OPTIONAL_GATE_TRANSITIONS,
  });
  return rules.optionalGateTransitionSet.has(transition);
}

function validateBypass(input = {}, { governance } = {}) {
  const rules = contextGateGovernance(governance, {
    bypassReasonCodes: BYPASS_REASON_CODES,
  });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "human";
  const errors = [];

  if (!reason) {
    errors.push("override reason is required");
  }
  if (!rules.bypassReasonCodes.includes(code)) {
    errors.push(`override code must be one of: ${rules.bypassReasonCodes.join(", ")}`);
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

function findMatchingBypassEvent({ targetRoot, artifact, artifactPath, governance }) {
  const detailed = evaluateOverrideStatus({ targetRoot, artifact, artifactPath, governance });
  return detailed.ok ? detailed.event : null;
}

function invalidOverrideStatus(reason, validation) {
  return {
    ok: false,
    status: `invalid_override:${reason}`,
    reason,
    validation,
  };
}

function latestEvent(events) {
  return [...events].sort((left, right) => eventTimeMs(right) - eventTimeMs(left))[0] || null;
}

function evaluateOverrideStatus({ targetRoot, artifact, artifactPath, governance }) {
  if (!artifact || !artifact.override) {
    return {
      ok: false,
      status: "no_override",
      reason: "no override recorded",
    };
  }

  const validation = validateBypass(artifact.override, { governance });
  if (!validation.ok) {
    return invalidOverrideStatus(validation.reason || "invalid override", validation);
  }

  const artifactGeneratedAtMs = Date.parse(artifact.generated_at || "");
  if (!Number.isFinite(artifactGeneratedAtMs)) {
    return {
      ok: false,
      status: "invalid_generated_at",
      reason: "artifact generated_at must be a valid ISO date-time before an override can be matched",
      override: validation.override,
    };
  }

  if (!artifactPath) {
    return {
      ok: false,
      status: "wrong_artifact_path",
      reason: "artifact path is required to match context-gate override evidence",
      override: validation.override,
    };
  }

  const relativeArtifactPath = repoRelative(targetRoot, artifactPath);
  const events = readBypassEvents(targetRoot)
    .filter((event) => event.action === "context-gate-override");

  if (events.length === 0) {
    return {
      ok: false,
      status: "missing_event",
      reason: "no context-gate-override event recorded",
      override: validation.override,
    };
  }

  const matchesIdentity = (event) =>
    event.round_id === artifact.round_id &&
    event.transition === artifact.transition &&
    event.code === validation.override.code &&
    event.evidence === relativeArtifactPath;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!matchesIdentity(event)) continue;
    if (eventTimeMs(event) < artifactGeneratedAtMs) continue;
    return {
      ok: true,
      status: "valid_bypass",
      reason: "matching context-gate override event found",
      event,
      override: validation.override,
    };
  }

  const stale = events.filter(matchesIdentity);
  if (stale.length > 0) {
    return {
      ok: false,
      status: "stale_event",
      reason: "context-gate-override event is older than artifact generation",
      event: latestEvent(stale),
      override: validation.override,
    };
  }

  const wrongPath = events.filter((event) =>
    event.round_id === artifact.round_id &&
    event.transition === artifact.transition &&
    event.code === validation.override.code &&
    event.evidence !== relativeArtifactPath &&
    eventTimeMs(event) >= artifactGeneratedAtMs
  );
  if (wrongPath.length > 0) {
    return {
      ok: false,
      status: "wrong_artifact_path",
      reason: `context-gate-override event evidence does not match ${relativeArtifactPath}`,
      event: latestEvent(wrongPath),
      override: validation.override,
    };
  }

  const wrongRoundOrTransition = events.filter((event) =>
    event.code === validation.override.code &&
    event.evidence === relativeArtifactPath &&
    eventTimeMs(event) >= artifactGeneratedAtMs &&
    (event.round_id !== artifact.round_id || event.transition !== artifact.transition)
  );
  if (wrongRoundOrTransition.length > 0) {
    return {
      ok: false,
      status: "wrong_round_or_transition",
      reason: "context-gate-override event round_id or transition does not match artifact",
      event: latestEvent(wrongRoundOrTransition),
      override: validation.override,
    };
  }

  return {
    ok: false,
    status: "missing_event",
    reason: "no matching context-gate-override event recorded",
    override: validation.override,
  };
}

function detailedOverrideStatus(options) {
  return evaluateOverrideStatus(options);
}

function overrideStatus({ targetRoot, artifact, artifactPath, governance }) {
  const detailed = evaluateOverrideStatus({ targetRoot, artifact, artifactPath, governance });
  if (detailed.ok) {
    return {
      ok: true,
      status: detailed.status,
      event: detailed.event,
      override: detailed.override,
    };
  }

  if (detailed.status === "no_override") {
    return {
      ok: false,
      status: detailed.status,
      reason: detailed.reason,
    };
  }
  if (detailed.status && detailed.status.startsWith("invalid_override:")) {
    return {
      ok: false,
      status: detailed.status,
      reason: detailed.reason,
    };
  }

  return {
    ok: false,
    status: detailed.status,
    reason: "no matching context-gate-override event at or after artifact generation",
    detail: detailed.reason,
    event: detailed.event,
    override: detailed.override,
  };
}

module.exports = {
  ADOPTION_CONTRACT_RELATIVE_PATH,
  PHASE_TO_EXPECTED_TRANSITION,
  adoptionContractPath,
  createBypassEvent,
  detailedOverrideStatus,
  evaluateOverrideStatus,
  expectedTransitionFromStatus,
  findMatchingBypassEvent,
  hasAdoptionContract,
  isGateOptional,
  isGateRequired,
  overrideStatus,
  readCurrentPhase,
  validateBypass,
};
