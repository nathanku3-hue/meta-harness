"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { HARNESS_DIR } = require("./paths");
const { governanceHash } = require("./context-gate-governance");
const { readHarnessState } = require("./context-gate-state");
const { readContextHints } = require("./context-hints");
const { repoRelative, slashPath } = require("./context-gate-utils");
const { stateHash } = require("./state-hash");
const { renderCanonicalStatus } = require("./truth-reconciler");

const FINGERPRINT_SCHEMA_VERSION = "1";
const CANONICAL_JSON_ENGINE = "state-hash/stableJson";
const RECENT_EVENT_LIMIT = 5;

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, normalizeJson(value[key])])
    );
  }
  if (typeof value === "string") {
    return normalizeLineEndings(value);
  }
  return value;
}

function normalizePathList(values) {
  return (values || []).map((item) => slashPath(item)).sort((left, right) => left.localeCompare(right));
}

function normalizeEvent(event) {
  return normalizeJson({
    ...event,
    evidence: event && event.evidence ? slashPath(event.evidence) : event && event.evidence,
  });
}

function normalizedHintsResult(hintsResult = {}, targetRoot) {
  return normalizeJson({
    exists: Boolean(hintsResult.exists),
    path: hintsResult.path ? slashPath(path.relative(targetRoot, hintsResult.path) || hintsResult.path) : null,
    hints: hintsResult.hints || [],
    warnings: hintsResult.warnings || [],
    error: hintsResult.error || null,
  });
}

function canonicalEvidenceState({ state, hintsResult, targetRoot }) {
  return normalizeJson({
    schema_version: FINGERPRINT_SCHEMA_VERSION,
    statusText: state.statusText,
    phaseMapText: state.phaseMapText,
    decisionLogText: state.decisionLogText,
    readmeText: state.readmeText,
    pyprojectText: state.pyprojectText,
    packageJson: state.packageJson || null,
    securityPolicy: state.securityPolicy || null,
    events: (state.events || []).map(normalizeEvent),
    workerFiles: normalizePathList(state.workerFiles || []),
    expertPacketFiles: normalizePathList(state.expertPacketFiles || []),
    files: state.files || {},
    hints: normalizedHintsResult(hintsResult, targetRoot),
  });
}

function readFullEventLog(targetRoot) {
  const eventsPath = path.join(targetRoot, HARNESS_DIR, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    return [];
  }
  return fs.readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return undefined;
      }
    })
    .filter(Boolean);
}

function eventTimeMs(event) {
  const parsed = Date.parse(event && (event.ts || event.time || event.generated_at || ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function artifactGeneratedAtMs(artifact) {
  const parsed = Date.parse(artifact && artifact.generated_at || "");
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sameArtifactIdentity(event, artifact, evidencePath) {
  if (!event || !artifact) return false;
  if (event.round_id !== artifact.round_id) return false;
  if (event.transition !== artifact.transition) return false;
  if (slashPath(event.evidence || "") !== evidencePath) return false;
  if (event.verdict !== undefined && event.verdict !== artifact.verdict) return false;
  return eventTimeMs(event) >= artifactGeneratedAtMs(artifact);
}

function isMatchingSelfGeneratedArtifactEvent(event, { artifact, evidencePath }) {
  if (!sameArtifactIdentity(event, artifact, evidencePath)) {
    return false;
  }
  if (event.action === "context-gate-satisfied") {
    return true;
  }
  if (event.action === "context-gate-override") {
    return Boolean(artifact.override && event.code === artifact.override.code);
  }
  return false;
}

function replayEventLog({ targetRoot, artifact, artifactPath }) {
  const evidencePath = repoRelative(targetRoot, artifactPath);
  return readFullEventLog(targetRoot)
    .filter((event) => !isMatchingSelfGeneratedArtifactEvent(event, { artifact, evidencePath }));
}

function replayEvents(options) {
  return replayEventLog(options).slice(-RECENT_EVENT_LIMIT);
}

function canonicalReplayEvidenceState({ targetRoot, artifact, artifactPath, now }) {
  const replayNow = now instanceof Date ? now : new Date(now || artifact.generated_at);
  const events = replayEventLog({ targetRoot, artifact, artifactPath });
  const liveState = readHarnessState(targetRoot);
  let statusText = liveState.statusText;
  try {
    statusText = renderCanonicalStatus({ events, targetRoot });
  } catch (_) {
    // Legacy replay fixtures without canonical snapshots retain their stored status.
  }
  const state = {
    ...liveState,
    statusText,
    events: events.slice(-RECENT_EVENT_LIMIT),
  };
  const hintsResult = readContextHints({ cwd: targetRoot, now: replayNow });
  return {
    evidenceState: canonicalEvidenceState({ state, hintsResult, targetRoot }),
    state,
    hintsResult,
  };
}

function evaluationFingerprintInput(artifact) {
  return normalizeJson({
    schema_version: FINGERPRINT_SCHEMA_VERSION,
    round_id: artifact.round_id,
    transition: artifact.transition,
    generated_at: artifact.generated_at,
    scores: artifact.scores || {},
    structural_hard_blockers: artifact.structural_hard_blockers || [],
    evidence_gap_dimensions: artifact.evidence_gap_dimensions || [],
    unknown_dimensions: artifact.unknown_dimensions || [],
    verdict: artifact.verdict,
    ...(artifact.override ? {
      override: {
        code: artifact.override.code,
        actor: artifact.override.actor,
      },
    } : {}),
  });
}

function attachContextGateFingerprint({ artifact, governance, evidenceState }) {
  return {
    ...artifact,
    fingerprint: {
      schema_version: FINGERPRINT_SCHEMA_VERSION,
      governance_hash: governanceHash(governance),
      evaluation_hash: stateHash(evaluationFingerprintInput(artifact)),
      evidence_hash: stateHash(evidenceState),
      canonical_json: CANONICAL_JSON_ENGINE,
    },
  };
}

module.exports = {
  CANONICAL_JSON_ENGINE,
  FINGERPRINT_SCHEMA_VERSION,
  RECENT_EVENT_LIMIT,
  attachContextGateFingerprint,
  canonicalEvidenceState,
  canonicalReplayEvidenceState,
  evaluationFingerprintInput,
  isMatchingSelfGeneratedArtifactEvent,
  readFullEventLog,
  replayEvents,
};
