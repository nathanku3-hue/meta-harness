"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  ALLOWED_TRANSITIONS,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  VALID_VERDICTS,
} = require("./context-gate-constants");
const {
  expectedTransitionFromStatus,
  hasAdoptionContract,
  isGateRequired,
  overrideStatus,
} = require("./context-gate-adoption");

const CONTEXT_ARTIFACT_MAX_AGE_MS = DEFAULT_MAX_ARTIFACT_AGE_DAYS * 24 * 60 * 60 * 1000;

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

function sortContextGateCandidates(candidates) {
  return candidates.sort((left, right) => {
    if (right.roundNumber !== left.roundNumber) {
      return right.roundNumber - left.roundNumber;
    }
    if (right.generatedAtMs !== left.generatedAtMs) {
      return right.generatedAtMs - left.generatedAtMs;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function selectLatestContextGateArtifact(targetRoot, options = {}) {
  const artifacts = listContextGateArtifacts(targetRoot);
  if (artifacts.length === 0) return null;

  const parsed = artifacts.map(parseContextGateCandidate);
  if (options.expectedTransition) {
    const matching = parsed.filter((artifact) =>
      !artifact.parseError &&
      artifact.doc &&
      artifact.doc.transition === options.expectedTransition
    );
    if (matching.length === 0) {
      return {
        missingExpected: true,
        expectedTransition: options.expectedTransition,
        artifactCount: artifacts.length,
      };
    }
    return sortContextGateCandidates(matching)[0];
  }

  const highestRound = Math.max(...artifacts.map((artifact) => artifact.roundNumber));
  return sortContextGateCandidates(parsed.filter((artifact) => artifact.roundNumber === highestRound))[0];
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

  if (typeof doc.transition !== "string" || !ALLOWED_TRANSITIONS.includes(doc.transition)) {
    failures.push("transition must be a supported phase transition");
  }

  if (!Number.isInteger(doc.overall_score) || doc.overall_score < 1 || doc.overall_score > 10) {
    failures.push("overall_score must be an integer from 1 to 10");
  }

  if (typeof doc.verdict !== "string" || !VALID_VERDICTS.has(doc.verdict)) {
    failures.push("verdict must be blocked, narrowed, proceed, or excellent");
  }

  if (!isPlainObject(doc.scores)) {
    failures.push("scores must be an object");
  } else {
    for (const dimension of DIMENSIONS) {
      const score = doc.scores[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 10) {
        failures.push(`scores.${dimension} must be an integer from 1 to 10`);
      }
    }
    const extraDimensions = Object.keys(doc.scores).filter((dimension) => !DIMENSIONS.includes(dimension));
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

function compactList(items, limit = 3) {
  return (items || [])
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, limit)
    .join("; ");
}

function blockerSummary(doc) {
  const blockers = [
    ...(doc.structural_hard_blockers || []),
    ...(doc.evidence_gap_dimensions || []).map((dimension) => `evidence gap: ${dimension}`),
    ...(doc.unknown_dimensions || []).map((dimension) => `unknown: ${dimension}`),
  ];
  return compactList(blockers) || "blocked verdict";
}

function questionSummary(doc) {
  const questions = compactList(doc.questions || []);
  return questions ? ` questions: ${questions}` : "";
}

function validateSelectedArtifact(selected, nowMs) {
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
  return null;
}

function adoptionResult({ targetRoot, selected, expectedTransition }) {
  const required = isGateRequired(expectedTransition);

  if (selected.missingExpected) {
    if (required) {
      return {
        status: "fail",
        reason: `no context gate artifact found for required transition ${expectedTransition}`,
        next_action: `Run meta-harness context check --from ${expectedTransition.split("->")[0]} --to ${expectedTransition.split("->")[1]}`,
      };
    }
    return {
      status: "skip",
      reason: `no context gate artifact found for advisory transition ${expectedTransition}`,
      applicable: false,
    };
  }

  const doc = selected.doc;
  if (!required) {
    return {
      status: "pass",
      reason: `${selected.relativePath} is advisory for ${expectedTransition} (verdict: ${doc.verdict})`,
      next_action: doc.verdict === "blocked" ? doc.correct_next_step : "",
    };
  }

  if (doc.verdict === "blocked") {
    const override = overrideStatus({ targetRoot, artifact: doc, artifactPath: selected.path });
    if (override.ok) {
      return {
        status: "pass",
        reason: `${selected.relativePath} blocked required transition ${expectedTransition} but was overridden with ${override.override.code}: ${override.override.reason}`,
        next_action: doc.correct_next_step || "",
      };
    }
    return {
      status: "fail",
      reason: `context gate blocked for required transition ${expectedTransition}: ${blockerSummary(doc)}.${questionSummary(doc)} override invalid: ${override.reason}`,
      next_action: doc.correct_next_step || "Answer blocker-clearing questions or rerun context check with an approved override",
    };
  }

  if (doc.verdict === "narrowed") {
    return {
      status: "pass",
      reason: `${selected.relativePath} passed with narrowed scope for ${expectedTransition}`,
      next_action: doc.correct_next_step || "",
    };
  }

  return {
    status: "pass",
    reason: `${selected.relativePath} satisfies required transition ${expectedTransition} (verdict: ${doc.verdict})`,
    next_action: doc.correct_next_step || "",
  };
}

function checkContextGateArtifact({ targetRoot, nowMs = Date.now() } = {}) {
  const adopted = hasAdoptionContract(targetRoot);
  let expectedTransition = null;
  let phase = null;

  if (adopted) {
    const expected = expectedTransitionFromStatus(targetRoot);
    expectedTransition = expected.transition;
    phase = expected.phase;
    if (!expectedTransition) {
      return {
        status: "skip",
        reason: phase === "lookback"
          ? "context gate adoption has no next transition for current phase lookback"
          : "context gate adoption could not determine the expected transition from status.md",
        applicable: false,
      };
    }
  }

  const selected = selectLatestContextGateArtifact(targetRoot, { expectedTransition });
  if (!selected) {
    return {
      status: "skip",
      reason: "no context gate surface",
      applicable: false,
    };
  }

  if (!selected.missingExpected) {
    const validationFailure = validateSelectedArtifact(selected, nowMs);
    if (validationFailure) {
      return validationFailure;
    }
  }

  if (adopted) {
    return adoptionResult({ targetRoot, selected, expectedTransition });
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
