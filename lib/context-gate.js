"use strict";

const path = require("node:path");

const { ensureDir, writeTextAtomic } = require("./paths");
const { applyContextHints, readContextHints } = require("./context-hints");
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

function checkContextQuality(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || options.cwd || process.cwd());
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const transition = normalizeTransition(options);
  const roundId = options.roundId ? safeRoundId(options.roundId) : defaultRoundId(targetRoot);
  const generatedAt = now.toISOString();
  const state = readHarnessState(targetRoot);
  const evaluations = evaluateContext(state, transition, now);
  const base = artifactFromEvaluations({ roundId, generatedAt, transition, evaluations, state });
  const hintsResult = readContextHints({ cwd: targetRoot, now, hintsPath: options.hintsPath });
  const hinted = applyContextHints(base.artifact, hintsResult, {
    dimensions: DIMENSIONS,
    structuralDimensions: base.structuralDimensions,
  });
  const artifact = finalizeArtifact(hinted);

  return {
    artifact,
    markdown: renderContextGateMarkdown(artifact),
    warnings: artifact.hint_warnings || [],
    structuralDimensions: base.structuralDimensions,
  };
}

function runContextGate(options = {}) {
  const targetRoot = path.resolve(options.targetRoot || options.cwd || process.cwd());
  const result = checkContextQuality({ ...options, targetRoot });
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

  return {
    ...result,
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
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
