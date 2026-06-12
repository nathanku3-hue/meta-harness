"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTEXT_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CONTEXT_SCORE_DIMENSIONS = Object.freeze([
  "product_outcome",
  "scope_boundary",
  "repo_and_stack",
  "owned_surface",
  "evidence_plan",
  "risk_and_stop_rules",
  "freshness",
  "handoff_completeness",
]);
const CONTEXT_TRANSITIONS = new Set([
  "intake->plan",
  "plan->work",
  "work->verify",
  "verify->synthesize",
  "synthesize->handoff",
  "handoff->lookback",
]);
const CONTEXT_VERDICTS = new Set(["blocked", "narrowed", "proceed", "excellent"]);

function normalizeRelativePath(value) {
  return value.split(/[\\/]+/).join("/");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function listContextGateArtifacts(targetRoot) {
  const roots = [
    path.join(targetRoot, ".meta-harness", "local", "context"),
    path.join(targetRoot, ".meta-harness", "context"),
  ];
  const artifacts = [];

  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;

    for (const item of fs.readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
      const match = item.match(/^ROUND-(\d{3,})\.json$/);
      if (!match) continue;
      const artifactPath = path.join(dir, item);
      const artifactStat = fs.statSync(artifactPath);
      if (!artifactStat.isFile()) continue;
      artifacts.push({
        path: artifactPath,
        relativePath: normalizeRelativePath(path.relative(targetRoot, artifactPath)),
        roundNumber: Number.parseInt(match[1], 10),
        roundId: `ROUND-${match[1]}`,
      });
    }
  }

  return artifacts;
}

function parseContextGateCandidate(candidate) {
  try {
    const doc = JSON.parse(fs.readFileSync(candidate.path, "utf8"));
    const generatedAtMs = typeof doc?.generated_at === "string" ? Date.parse(doc.generated_at) : Number.NEGATIVE_INFINITY;
    return {
      ...candidate,
      doc,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Number.NEGATIVE_INFINITY,
      parseError: null,
    };
  } catch (error) {
    return {
      ...candidate,
      doc: null,
      generatedAtMs: Number.NEGATIVE_INFINITY,
      parseError: error,
    };
  }
}

function selectLatestContextGateArtifact(targetRoot) {
  const artifacts = listContextGateArtifacts(targetRoot);
  if (artifacts.length === 0) return null;

  const highestRound = Math.max(...artifacts.map((artifact) => artifact.roundNumber));
  return artifacts
    .filter((artifact) => artifact.roundNumber === highestRound)
    .map(parseContextGateCandidate)
    .sort((left, right) => {
      if (right.generatedAtMs !== left.generatedAtMs) {
        return right.generatedAtMs - left.generatedAtMs;
      }
      return left.relativePath.localeCompare(right.relativePath);
    })[0];
}

function validateStringArray(doc, field, failures) {
  if (doc[field] === undefined) return;
  if (!Array.isArray(doc[field]) || !doc[field].every((item) => typeof item === "string")) {
    failures.push(`${field} must be an array of strings`);
  }
}

function validateContextGateArtifactDoc(doc, expectedRoundId, nowMs = Date.now()) {
  const failures = [];

  if (!isPlainObject(doc)) {
    return { ok: false, reason: "artifact root must be an object" };
  }

  for (const field of ["round_id", "generated_at", "transition", "overall_score", "verdict", "scores", "correct_next_step"]) {
    if (doc[field] === undefined) failures.push(`missing ${field}`);
  }

  if (typeof doc.round_id !== "string" || !/^ROUND-\d{3,}$/.test(doc.round_id)) {
    failures.push("round_id must match ROUND-NNN");
  } else if (doc.round_id !== expectedRoundId) {
    failures.push(`round_id ${doc.round_id} does not match file ${expectedRoundId}`);
  }

  const generatedAtMs = typeof doc.generated_at === "string" ? Date.parse(doc.generated_at) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) {
    failures.push("generated_at must be an ISO date-time");
  } else if (nowMs - generatedAtMs > CONTEXT_ARTIFACT_MAX_AGE_MS) {
    failures.push("generated_at is older than 7 days");
  }

  if (typeof doc.transition !== "string" || !CONTEXT_TRANSITIONS.has(doc.transition)) {
    failures.push("transition must be a supported phase transition");
  }

  if (!Number.isInteger(doc.overall_score) || doc.overall_score < 1 || doc.overall_score > 10) {
    failures.push("overall_score must be an integer from 1 to 10");
  }

  if (typeof doc.verdict !== "string" || !CONTEXT_VERDICTS.has(doc.verdict)) {
    failures.push("verdict must be blocked, narrowed, proceed, or excellent");
  }

  if (!isPlainObject(doc.scores)) {
    failures.push("scores must be an object");
  } else {
    for (const dimension of CONTEXT_SCORE_DIMENSIONS) {
      const score = doc.scores[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 10) {
        failures.push(`scores.${dimension} must be an integer from 1 to 10`);
      }
    }
    const extraDimensions = Object.keys(doc.scores).filter((dimension) => !CONTEXT_SCORE_DIMENSIONS.includes(dimension));
    if (extraDimensions.length > 0) {
      failures.push(`scores contains unknown dimension(s): ${extraDimensions.join(", ")}`);
    }
  }

  if (typeof doc.correct_next_step !== "string") {
    failures.push("correct_next_step must be a string");
  }

  validateStringArray(doc, "structural_hard_blockers", failures);
  validateStringArray(doc, "evidence_gap_dimensions", failures);
  validateStringArray(doc, "unknown_dimensions", failures);

  if (doc.questions !== undefined) {
    if (!Array.isArray(doc.questions) || doc.questions.length > 3 || !doc.questions.every((item) => typeof item === "string")) {
      failures.push("questions must be an array of at most 3 strings");
    }
  }

  if (doc.hints_applied !== undefined && !Array.isArray(doc.hints_applied)) {
    failures.push("hints_applied must be an array when present");
  }

  return {
    ok: failures.length === 0,
    reason: failures.join("; "),
  };
}

function checkContextGateArtifact({ targetRoot, nowMs = Date.now() } = {}) {
  const selected = selectLatestContextGateArtifact(targetRoot);
  if (!selected) {
    return {
      status: "skip",
      reason: "no context gate surface",
      applicable: false,
    };
  }

  if (selected.parseError) {
    return {
      status: "fail",
      reason: `malformed context gate artifact ${selected.relativePath}: ${selected.parseError.message}`,
      next_action: "Regenerate the context gate artifact with meta-harness context check",
    };
  }

  const validation = validateContextGateArtifactDoc(selected.doc, selected.roundId, nowMs);
  if (!validation.ok) {
    return {
      status: "fail",
      reason: `invalid context gate artifact ${selected.relativePath}: ${validation.reason}`,
      next_action: "Regenerate the context gate artifact with meta-harness context check",
    };
  }

  return {
    status: "pass",
    reason: `${selected.relativePath} is fresh and well-formed (verdict: ${selected.doc.verdict})`,
  };
}

module.exports = {
  checkContextGateArtifact,
  validateContextGateArtifactDoc,
};
