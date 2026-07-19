"use strict";

const path = require("node:path");

const { ensureDir, writeTextAtomic } = require("./paths");
const { createBypassEvent, validateBypass } = require("./context-gate-adoption");
const { buildContextGateEvaluation, checkContextGateArtifact } = require("./ready-context-gate-evaluation");
const { applyContextHints, readContextHints } = require("./context-hints");
const { buildLiveGovernance, governanceFromSnapshot } = require("./context-gate-governance");
const {
  attachContextGateFingerprint,
  canonicalEvidenceState,
} = require("./context-gate-fingerprint");
const {
  ALLOWED_TRANSITIONS,
  CONTEXT_LOCAL_DIR,
  CONTEXT_TRACKED_DIR,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
} = require("./context-gate-constants");
const {
  artifactFromEvaluations,
  finalizeArtifact,
  renderContextGateMarkdown,
} = require("./context-gate-artifact");
const { evaluateContext } = require("./context-gate-scoring");
const { readHarnessState } = require("./context-gate-state");
const {
  assertCommittedArtifactClean,
  defaultRoundId,
  outputPaths,
  selectLatestContextArtifact,
} = require("./context-gate-storage");
const {
  fail,
  normalizeTransition,
  safeRoundId,
} = require("./context-gate-utils");
const { validateContextGateArtifact } = require("./context-gate-validation");
const { appendEvent, readEvents, refreshStatus } = require("./harness-state");
const { TRUTH_CHECK_ID, reconcileTruth } = require("./truth-reconciler");

function slashPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function repoRelative(targetRoot, filePath) {
  return slashPath(path.relative(targetRoot, filePath));
}

function hasMatchingSatisfiedEvent({ targetRoot, artifactPath, artifact }) {
  const evidence = repoRelative(targetRoot, artifactPath);
  return readEvents({ cwd: targetRoot }).some((event) =>
    event.action === "context-gate-satisfied" &&
    event.evidence === evidence &&
    event.round_id === artifact.round_id &&
    event.transition === artifact.transition &&
    event.verdict === artifact.verdict
  );
}

function createSatisfiedEvent({ targetRoot, artifactPath, artifact, provenance }) {
  const phase = String(artifact.transition || "").split("->")[0] || "work";
  return {
    actor: "system",
    stream: "coding",
    phase,
    action: "context-gate-satisfied",
    result: `context gate satisfied: ${artifact.verdict}`,
    transition: artifact.transition,
    round_id: artifact.round_id,
    verdict: artifact.verdict,
    evidence: repoRelative(targetRoot, artifactPath),
    generated_at: artifact.generated_at,
    next_action: artifact.correct_next_step,
    override_event: provenance?.override_event || undefined,
  };
}

function appendSatisfiedEventIfNeeded({ targetRoot, artifactPath, artifact, evaluation }) {
  if (!evaluation || evaluation.result?.status !== "pass") return null;
  if (!evaluation.adoption?.adopted || !evaluation.adoption?.required) return null;
  if (evaluation.expectedTransition !== artifact.transition) return null;
  if (evaluation.selectedArtifact?.relativePath !== repoRelative(targetRoot, artifactPath)) return null;
  if (hasMatchingSatisfiedEvent({ targetRoot, artifactPath, artifact })) return null;

  return appendEvent({ cwd: targetRoot }, createSatisfiedEvent({
    targetRoot,
    artifactPath,
    artifact,
    provenance: evaluation.provenance,
  }));
}

function effectiveGovernance(governance) {
  return governance ? governanceFromSnapshot(governance) : buildLiveGovernance();
}

function checkContextQuality(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || options.cwd || process.cwd());
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const governance = effectiveGovernance(options.governance);
  const dimensions = governance.dimensions || DIMENSIONS;
  const transition = normalizeTransition(options, { governance });
  const roundId = options.roundId ? safeRoundId(options.roundId) : defaultRoundId(targetRoot);
  const generatedAt = now.toISOString();
  const state = options.state || readHarnessState(targetRoot);
  const evaluations = evaluateContext(state, transition, now, { governance });
  const base = artifactFromEvaluations({ roundId, generatedAt, transition, evaluations, state, governance });
  const hintsResult = options.hintsResult || readContextHints({ cwd: targetRoot, now, hintsPath: options.hintsPath });
  const hinted = applyContextHints(base.artifact, hintsResult, {
    dimensions,
    structuralDimensions: base.structuralDimensions,
  });
  const finalized = finalizeArtifact(hinted, { governance });
  const evidenceState = options.evidenceState || canonicalEvidenceState({ state, hintsResult, targetRoot });
  const artifact = attachContextGateFingerprint({ artifact: finalized, governance, evidenceState });

  return {
    artifact,
    markdown: renderContextGateMarkdown(artifact, { governance }),
    warnings: artifact.hint_warnings || [],
    structuralDimensions: base.structuralDimensions,
    governance,
    evidenceState,
    state,
    hintsResult,
  };
}

function normalizeOverrideContextGate(value, { governance } = {}) {
  if (!value) return null;
  const candidate = typeof value === "string"
    ? { reason: value, code: undefined, actor: "human" }
    : value;
  const validation = validateBypass(candidate, { governance });
  if (!validation.ok) {
    fail(`invalid context gate override: ${validation.reason}`);
  }
  return validation.override;
}

function truthBlockedContextResult({ targetRoot, options }) {
  const governance = effectiveGovernance(options.governance);
  const transition = normalizeTransition(options, { governance });
  const roundId = options.roundId ? safeRoundId(options.roundId) : defaultRoundId(targetRoot);
  const state = options.state || readHarnessState(targetRoot);
  const truth = reconcileTruth({ targetRoot, statusText: state.statusText });
  if (truth.ok) return null;

  const reason = truth.contradictions.map((item) => item.message).join("; ");
  return {
    blocked: true,
    truth_blocked: true,
    check_id: TRUTH_CHECK_ID,
    reason,
    round_id: roundId,
    transition,
    verdict: "blocked",
    score_computed: false,
    scores: null,
    overall_score: null,
    wrote: false,
    override_applied: false,
    truth,
    governance,
    state,
    markdown: [
      `# Context Gate ${roundId}`,
      "",
      `Transition: ${transition}`,
      "Verdict: blocked",
      `Pre-gate: ${TRUTH_CHECK_ID}`,
      `Reason: ${reason}`,
      "Score computed: false",
      "",
    ].join("\n"),
  };
}

function runContextGate(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || options.cwd || process.cwd());
  if (options.enforceTruthPreGate === true) {
    const blocked = truthBlockedContextResult({ targetRoot, options });
    if (blocked) return blocked;
  }
  const result = checkContextQuality({ ...options, targetRoot });
  const override = normalizeOverrideContextGate(options.overrideContextGate, { governance: result.governance });
  if (override) {
    result.artifact = attachContextGateFingerprint({
      artifact: {
        ...result.artifact,
        override,
      },
      governance: result.governance,
      evidenceState: result.evidenceState,
    });
    result.markdown = renderContextGateMarkdown(result.artifact, { governance: result.governance });
  }
  if (options.write === false) {
    return result;
  }

  const paths = outputPaths({
    cwd: targetRoot,
    roundId: result.artifact.round_id,
    out: options.out,
    commitArtifact: Boolean(options.commitArtifact),
  });
  const jsonString = `${JSON.stringify(result.artifact, null, 2)}\n`;
  const markdownString = result.markdown.endsWith("\n") ? result.markdown : `${result.markdown}\n`;
  const validation = validateContextGateArtifact(result.artifact, {
    now: new Date(result.artifact.generated_at),
    maxAgeDays: null,
    governance: result.governance,
  });

  if (!validation.ok) {
    fail(`context gate artifact failed validation: ${validation.errors.join("; ")}`);
  }
  if (options.commitArtifact) {
    assertCommittedArtifactClean(targetRoot, paths.jsonPath, jsonString, paths.markdownPath, markdownString);
  }

  ensureDir(path.dirname(paths.jsonPath));
  ensureDir(path.dirname(paths.markdownPath));
  writeTextAtomic(paths.jsonPath, jsonString);
  writeTextAtomic(paths.markdownPath, markdownString);

  let overrideEvent;
  if (override) {
    overrideEvent = appendEvent({ cwd: targetRoot }, createBypassEvent({
      targetRoot,
      artifactPath: paths.jsonPath,
      actor: override.actor,
      transition: result.artifact.transition,
      reason: override.reason,
      code: override.code,
      roundId: result.artifact.round_id,
      verdict: result.artifact.verdict,
      correctNextStep: result.artifact.correct_next_step,
    }));
  }

  const adoptionEvaluation = buildContextGateEvaluation({ targetRoot, governance: result.governance });
  const satisfiedEvent = appendSatisfiedEventIfNeeded({
    targetRoot,
    artifactPath: paths.jsonPath,
    artifact: result.artifact,
    evaluation: adoptionEvaluation,
  });
  if (overrideEvent || satisfiedEvent) {
    refreshStatus({ cwd: targetRoot });
  }

  let explanationResult = null;
  if (options.explain) {
    explanationResult = checkContextGateArtifact({
      targetRoot,
      explain: true,
      expectedTransition: result.artifact.transition,
      phase: options.from,
      governance: result.governance,
    });
  }

  return {
    ...result,
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
    overrideEvent,
    satisfiedEvent,
    ...(explanationResult ? {
      diagnostic: explanationResult.diagnostic,
      explanation: explanationResult.explanation,
      provenance: explanationResult.provenance,
      remediation: explanationResult.remediation,
    } : {}),
    wrote: true,
  };
}

module.exports = {
  ALLOWED_TRANSITIONS,
  CONTEXT_LOCAL_DIR,
  CONTEXT_TRACKED_DIR,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  checkContextQuality,
  defaultRoundId,
  normalizeTransition,
  outputPaths,
  renderContextGateMarkdown,
  runContextGate,
  safeRoundId,
  selectLatestContextArtifact,
  validateContextGateArtifact,
};
