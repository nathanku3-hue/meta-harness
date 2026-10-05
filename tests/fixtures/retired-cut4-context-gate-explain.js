"use strict";

function formatMs(value) {
  return Number.isFinite(value) ? `${value}ms` : "unknown";
}

function buildContextGateExplanation(evaluation = {}) {
  const artifact = evaluation.artifact || evaluation.selectedArtifact || null;
  const freshness = evaluation.freshness || {};
  const overrideEvaluation = evaluation.overrideEvaluation || evaluation.override || {};
  const transition = evaluation.expectedTransition || evaluation.expected_transition || null;
  const phase = evaluation.phase || null;
  const disposition = evaluation.gateDisposition ||
    evaluation.adoption?.disposition ||
    "not_applicable";
  const freshnessAge = freshness.age_ms ?? freshness.ageMs;
  const freshnessThreshold = freshness.threshold_ms ??
    freshness.thresholdMs ??
    (Number.isFinite(freshness.max_age_days) ? freshness.max_age_days * 24 * 60 * 60 * 1000 : null);
  const freshnessVerdict = freshness.verdict || freshness.status || "unknown";
  const result = evaluation.result || null;

  return {
    status: result ? result.status : null,
    reason: result ? result.reason || "" : "",
    next_action: result ? result.next_action || "" : "",
    current_phase: phase,
    selected_artifact: artifact && artifact.present !== false ? {
      path: artifact.relativePath || artifact.path || null,
      round_id: artifact.round_id || artifact.roundId || null,
      generated_at: artifact.generated_at || null,
      transition: artifact.transition || null,
      verdict: artifact.verdict || null,
      fingerprint: artifact.fingerprint || null,
      missing_expected: artifact.missingExpected === true,
    } : null,
    validation: evaluation.validation || null,
    freshness,
    adoption: evaluation.adoption || null,
    override: overrideEvaluation,
    expected_transition: {
      phase,
      transition,
    },
    artifact_examined: artifact && artifact.present !== false ? {
      path: artifact.relativePath || artifact.path || null,
      round_id: artifact.round_id || artifact.roundId || null,
      generated_at: artifact.generated_at || null,
      transition: artifact.transition || null,
      verdict: artifact.verdict || null,
      fingerprint: artifact.fingerprint || null,
    } : null,
    freshness_determination: {
      age_ms: Number.isFinite(freshnessAge) ? freshnessAge : null,
      threshold_ms: Number.isFinite(freshnessThreshold) ? freshnessThreshold : null,
      verdict: freshnessVerdict,
    },
    events_matched: overrideEvaluation.event || null,
    override_evaluation_path: overrideEvaluation.status || overrideEvaluation.path || "not_evaluated",
    gate_disposition: disposition === "no_expected_transition" || disposition === "not_adopted"
      ? "not_applicable"
      : disposition,
    remediation: evaluation.remediation || "",
    result: result ? {
      status: result.status,
      reason: result.reason || "",
      next_action: result.next_action || "",
    } : null,
  };
}

function renderContextGateExplanation(explanation = {}) {
  const expected = explanation.expected_transition || {};
  const artifact = explanation.artifact_examined;
  const freshness = explanation.freshness_determination || {};
  const lines = [
    "Context gate explanation:",
    `Expected transition: ${expected.transition || "none"}${expected.phase ? ` (phase ${expected.phase})` : ""}`,
  ];

  if (artifact) {
    lines.push(`Artifact: ${artifact.path || "unknown"}${artifact.round_id ? ` (${artifact.round_id})` : ""}`);
    if (artifact.generated_at) lines.push(`Generated at: ${artifact.generated_at}`);
    if (artifact.verdict) lines.push(`Verdict: ${artifact.verdict}`);
    if (artifact.fingerprint) {
      lines.push(`Governance hash: ${artifact.fingerprint.governance_hash || ""}`);
      lines.push(`Evaluation hash: ${artifact.fingerprint.evaluation_hash || ""}`);
      lines.push(`Evidence hash: ${artifact.fingerprint.evidence_hash || ""}`);
    }
  } else {
    lines.push("Artifact: none");
  }

  lines.push(
    `Freshness: ${freshness.verdict || "unknown"} (${formatMs(freshness.age_ms)} / ${formatMs(freshness.threshold_ms)})`,
    `Override path: ${explanation.override_evaluation_path || "not_evaluated"}`,
    `Gate disposition: ${explanation.gate_disposition || "not_applicable"}`,
  );

  if (explanation.remediation) {
    lines.push(`Remediation: ${explanation.remediation}`);
  }

  return lines.join("\n");
}

function renderContextGateDiagnosticBlock(explanation = {}) {
  const diagnostic = explanation.result || explanation.selected_artifact
    ? explanation
    : buildContextGateExplanation(explanation);
  const selected = diagnostic.selected_artifact || {};
  const validation = diagnostic.validation || {};
  const freshness = diagnostic.freshness || {};
  const adoption = diagnostic.adoption || {};
  const override = diagnostic.override || {};
  const expected = diagnostic.expected_transition || {};
  const lines = [
    "Context gate diagnostic",
    `- status: ${diagnostic.status || diagnostic.result?.status || "unknown"}`,
    `- reason: ${diagnostic.reason || diagnostic.result?.reason || ""}`,
    `- next action: ${diagnostic.next_action || diagnostic.result?.next_action || ""}`,
    `- phase: ${diagnostic.current_phase || expected.phase || "none"}`,
    `- expected transition: ${typeof expected === "string" ? expected : expected.transition || "none"}`,
    `- artifact: ${selected.path || ""}`,
    `- artifact round: ${selected.round_id || ""}`,
    `- artifact transition: ${selected.transition || ""}`,
    `- verdict: ${selected.verdict || ""}`,
    `- generated at: ${selected.generated_at || ""}`,
    `- governance hash: ${selected.fingerprint?.governance_hash || ""}`,
    `- evaluation hash: ${selected.fingerprint?.evaluation_hash || ""}`,
    `- evidence hash: ${selected.fingerprint?.evidence_hash || ""}`,
    `- validation: ${validation.status || ""}`,
    `- freshness: ${freshness.status || freshness.verdict || ""}`,
    `- adoption: ${adoption.disposition || diagnostic.gate_disposition || ""}`,
    `- override: ${override.status || diagnostic.override_evaluation_path || ""}`,
    `- remediation: ${diagnostic.remediation || ""}`,
  ];
  return lines.filter((line) => !line.endsWith(": ")).join("\n");
}

module.exports = {
  buildContextGateExplanation,
  renderContextGateDiagnosticBlock,
  renderContextGateExplanation,
};
