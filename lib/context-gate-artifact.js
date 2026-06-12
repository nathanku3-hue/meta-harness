"use strict";

const { DIMENSIONS } = require("./context-gate-constants");
const { clampScore, uniqueStrings } = require("./context-gate-utils");

function verdictFor(scores, structuralHardBlockers, evidenceGapDimensions, unknownDimensions) {
  if (structuralHardBlockers.length > 0 || unknownDimensions.length > 0 || evidenceGapDimensions.length > 0) {
    return { overall: 1, verdict: "blocked" };
  }
  const scoreValues = DIMENSIONS.map((dimension) => scores[dimension]);
  if (scoreValues.some((score) => score < 4)) {
    return {
      overall: clampScore(scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length),
      verdict: "blocked",
    };
  }
  const overall = clampScore(scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length);
  if (overall < 6) return { overall, verdict: "blocked" };
  if (overall <= 7) return { overall, verdict: "narrowed" };
  if (overall <= 9) return { overall, verdict: "proceed" };
  if (!scoreValues.every((score) => score === 10)) {
    return { overall: 9, verdict: "proceed" };
  }
  return { overall, verdict: "excellent" };
}

function correctNextStep(artifact) {
  if (artifact.verdict === "blocked") {
    return "Answer the blocker-clearing questions before proceeding.";
  }
  if (artifact.verdict === "narrowed") {
    return `Proceed through ${artifact.transition} only with the narrowed scope recorded in the packet.`;
  }
  if (artifact.verdict === "excellent") {
    return `Proceed through ${artifact.transition}; context is complete enough for a fresh worker.`;
  }
  return `Proceed through ${artifact.transition} with the recorded evidence plan and stop rules.`;
}

function artifactFromEvaluations({ roundId, generatedAt, transition, evaluations, state }) {
  const scores = {};
  const structuralHardBlockers = [];
  const structuralDimensions = [];
  const evidenceGapDimensions = [];
  const unknownDimensions = [];
  const questions = [];
  const evidence = {};
  const dimensionSummaries = {};

  for (const evaluation of evaluations) {
    scores[evaluation.dimension] = evaluation.unknown ? 1 : evaluation.score;
    evidence[evaluation.dimension] = evaluation.evidence;
    dimensionSummaries[evaluation.dimension] = evaluation.summary || "";
    if (evaluation.unknown) {
      unknownDimensions.push(evaluation.dimension);
    }
    if (evaluation.structuralBlocker) {
      structuralHardBlockers.push(evaluation.structuralBlocker);
      structuralDimensions.push(evaluation.dimension);
    } else if (evaluation.evidenceGap) {
      evidenceGapDimensions.push(evaluation.dimension);
    }
    if (evaluation.question) {
      questions.push(evaluation.question);
    }
  }

  const artifact = {
    round_id: roundId,
    generated_at: generatedAt,
    transition,
    overall_score: 1,
    verdict: "blocked",
    structural_hard_blockers: uniqueStrings(structuralHardBlockers),
    evidence_gap_dimensions: uniqueStrings(evidenceGapDimensions),
    unknown_dimensions: uniqueStrings(unknownDimensions),
    scores,
    correct_next_step: "",
    questions: uniqueStrings(questions).slice(0, 3),
    hints_applied: [],
    hint_warnings: [],
    context_summary: {
      goal: dimensionSummaries.product_outcome,
      scope: dimensionSummaries.scope_boundary,
      stack: dimensionSummaries.repo_and_stack,
      owned_surface: dimensionSummaries.owned_surface,
      evidence_required: dimensionSummaries.evidence_plan,
      stop_rules: dimensionSummaries.risk_and_stop_rules,
      freshness: dimensionSummaries.freshness,
      handoff: dimensionSummaries.handoff_completeness,
      decisions: uniqueStrings(`${state.statusText}\n${state.decisionLogText}`.match(/\bD[0-9]{3}\b/g) || []).slice(-8),
    },
    evidence,
  };

  return { artifact, structuralDimensions };
}

function finalizeArtifact(artifact) {
  const final = {
    ...artifact,
    structural_hard_blockers: uniqueStrings(artifact.structural_hard_blockers || []),
    evidence_gap_dimensions: uniqueStrings(artifact.evidence_gap_dimensions || []),
    unknown_dimensions: uniqueStrings(artifact.unknown_dimensions || []),
    questions: uniqueStrings(artifact.questions || []).slice(0, 3),
  };
  const verdict = verdictFor(
    final.scores,
    final.structural_hard_blockers,
    final.evidence_gap_dimensions,
    final.unknown_dimensions
  );
  final.overall_score = verdict.overall;
  final.verdict = verdict.verdict;
  final.correct_next_step = correctNextStep(final);
  return final;
}

function markdownList(items) {
  return items && items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function renderContextGateMarkdown(artifact) {
  const scoreLines = DIMENSIONS.map((dimension) => `- ${dimension}: ${artifact.scores[dimension]}`);
  const hintLines = (artifact.hints_applied || []).map((hint) =>
    `- ${hint.dimension}: ${hint.from} -> ${hint.to} (${hint.author}, expires ${hint.expires_at})`
  );
  const overrideLines = artifact.override
    ? [
        `- reason: ${artifact.override.reason}`,
        `- code: ${artifact.override.code}`,
        `- actor: ${artifact.override.actor}`,
      ].join("\n")
    : "- none";

  return [
    `# Context Gate ${artifact.round_id}`,
    "",
    `Generated: ${artifact.generated_at}`,
    `Transition: ${artifact.transition}`,
    `Verdict: ${artifact.verdict}`,
    `Overall score: ${artifact.overall_score}/10`,
    "",
    "## Scores",
    "",
    scoreLines.join("\n"),
    "",
    "## Blockers",
    "",
    "Structural hard blockers:",
    markdownList(artifact.structural_hard_blockers),
    "",
    "Evidence gaps:",
    markdownList(artifact.evidence_gap_dimensions),
    "",
    "Unknown dimensions:",
    markdownList(artifact.unknown_dimensions),
    "",
    "## Questions",
    "",
    markdownList(artifact.questions),
    "",
    "## Correct Next Step",
    "",
    artifact.correct_next_step,
    "",
    "## Context Summary",
    "",
    `Goal: ${artifact.context_summary?.goal || "unknown"}`,
    `Scope: ${artifact.context_summary?.scope || "unknown"}`,
    `Stack: ${artifact.context_summary?.stack || "unknown"}`,
    `Owned surface: ${artifact.context_summary?.owned_surface || "unknown"}`,
    `Evidence required: ${artifact.context_summary?.evidence_required || "unknown"}`,
    `Stop rules: ${artifact.context_summary?.stop_rules || "unknown"}`,
    `Freshness: ${artifact.context_summary?.freshness || "unknown"}`,
    `Handoff: ${artifact.context_summary?.handoff || "unknown"}`,
    "",
    "## Hints Applied",
    "",
    hintLines.length > 0 ? hintLines.join("\n") : "- none",
    "",
    "## Hint Warnings",
    "",
    markdownList(artifact.hint_warnings || []),
    "",
    "## Override",
    "",
    overrideLines,
  ].join("\n");
}

module.exports = {
  artifactFromEvaluations,
  finalizeArtifact,
  renderContextGateMarkdown,
};
