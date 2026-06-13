"use strict";

const { buildContextGateExplanation, renderContextGateDiagnosticBlock } = require("./context-gate-explain");
const { buildContextGateRemediation } = require("./context-gate-remediation");
const { contextGateGovernance } = require("./context-gate-utils");
const {
  detailedOverrideStatus,
  expectedTransitionFromStatus,
  hasAdoptionContract,
  isGateRequired,
  overrideStatus,
} = require("./context-gate-adoption");
const {
  selectLatestContextGateArtifact,
  validateContextGateArtifactDoc,
} = require("./ready-context-gate");

function compactList(items, limit = 3) {
  return (items || []).filter((item) => typeof item === "string" && item.trim()).slice(0, limit).join("; ");
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

function freshnessForDoc(doc, nowMs, { governance } = {}) {
  const maxAgeDays = contextGateGovernance(governance).defaultMaxArtifactAgeDays;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const generatedAtMs = typeof doc?.generated_at === "string" ? Date.parse(doc.generated_at) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) {
    return { ok: false, status: "invalid_generated_at", reason: "generated_at must be an ISO date-time", max_age_days: maxAgeDays };
  }
  const ageMs = nowMs - generatedAtMs;
  const stale = ageMs > maxAgeMs;
  return { ok: !stale, status: stale ? "stale" : "fresh", generated_at_ms: generatedAtMs, age_ms: ageMs, max_age_days: maxAgeDays };
}

function selectedArtifactSummary(selected) {
  if (!selected) return { present: false };
  if (selected.missingExpected) {
    return { present: false, missingExpected: true, expectedTransition: selected.expectedTransition, artifactCount: selected.artifactCount };
  }
  return {
    present: true, path: selected.path, relativePath: selected.relativePath, roundNumber: selected.roundNumber, roundId: selected.roundId,
    transition: selected.doc && selected.doc.transition,
    verdict: selected.doc && selected.doc.verdict,
    generated_at: selected.doc && selected.doc.generated_at,
    correct_next_step: selected.doc && selected.doc.correct_next_step,
    fingerprint: selected.doc && selected.doc.fingerprint || null,
    parseError: selected.parseError ? selected.parseError.message : null,
  };
}

function validationDetailsForSelected(selected, nowMs, { governance } = {}) {
  if (!selected || selected.missingExpected) {
    return { ok: false, status: "not_selected", reason: selected && selected.missingExpected ? "no artifact for expected transition" : "no context gate surface" };
  }
  if (selected.parseError) {
    return { ok: false, status: "malformed", reason: `malformed context gate artifact ${selected.relativePath}: ${selected.parseError.message}` };
  }
  const validation = validateContextGateArtifactDoc(selected.doc, selected.roundId, nowMs, { governance });
  if (!validation.ok) {
    return { ok: false, status: validation.reason.includes("generated_at is older") ? "stale" : "invalid", reason: `invalid context gate artifact ${selected.relativePath}: ${validation.reason}` };
  }
  return { ok: true, status: "valid", reason: "" };
}

function validateSelectedArtifact(selected, nowMs, { governance } = {}) {
  if (selected.parseError) {
    return { status: "fail", reason: `malformed context gate artifact ${selected.relativePath}: ${selected.parseError.message}`, next_action: "Regenerate the context gate artifact with meta-harness context check" };
  }
  const validation = validateContextGateArtifactDoc(selected.doc, selected.roundId, nowMs, { governance });
  if (!validation.ok) {
    return { status: "fail", reason: `invalid context gate artifact ${selected.relativePath}: ${validation.reason}`, next_action: "Regenerate the context gate artifact with meta-harness context check" };
  }
  return null;
}

function adoptionResult({ targetRoot, selected, expectedTransition, governance }) {
  const required = isGateRequired(expectedTransition, { governance });
  if (selected.missingExpected) {
    if (required) {
      return { status: "fail", reason: `no context gate artifact found for required transition ${expectedTransition}`, next_action: `Run meta-harness context check --from ${expectedTransition.split("->")[0]} --to ${expectedTransition.split("->")[1]}` };
    }
    return { status: "skip", reason: `no context gate artifact found for advisory transition ${expectedTransition}`, applicable: false };
  }

  const doc = selected.doc;
  if (!required) {
    return { status: "pass", reason: `${selected.relativePath} is advisory for ${expectedTransition} (verdict: ${doc.verdict})`, next_action: doc.verdict === "blocked" ? doc.correct_next_step : "" };
  }
  if (doc.verdict === "blocked") {
    const override = overrideStatus({ targetRoot, artifact: doc, artifactPath: selected.path, governance });
    if (override.ok) {
      return { status: "pass", reason: `${selected.relativePath} blocked required transition ${expectedTransition} but was overridden with ${override.override.code}: ${override.override.reason}`, next_action: doc.correct_next_step || "" };
    }
    return { status: "fail", reason: `context gate blocked for required transition ${expectedTransition}: ${blockerSummary(doc)}.${questionSummary(doc)} override invalid: ${override.reason}`, next_action: doc.correct_next_step || "Answer blocker-clearing questions or rerun context check with an approved override" };
  }
  if (doc.verdict === "narrowed") {
    return { status: "pass", reason: `${selected.relativePath} passed with narrowed scope for ${expectedTransition}`, next_action: doc.correct_next_step || "" };
  }
  return { status: "pass", reason: `${selected.relativePath} satisfies required transition ${expectedTransition} (verdict: ${doc.verdict})`, next_action: doc.correct_next_step || "" };
}

function provenanceForEvaluation(evaluation) {
  const selected = evaluation.selectedArtifact || {};
  const overrideEvent = evaluation.override && evaluation.override.event
    ? { ts: evaluation.override.event.ts || evaluation.override.event.time || null, code: evaluation.override.event.code || null, actor: evaluation.override.event.actor || null }
    : null;
  return { artifact_path: selected.relativePath || null, round_id: selected.roundId || null, generated_at: selected.generated_at || null, transition: selected.transition || null, verdict: selected.verdict || null, override_event: overrideEvent };
}

function resultFromEvaluation(evaluation) {
  const result = evaluation.result || {};
  return { status: result.status, reason: result.reason || "", next_action: result.next_action || "", ...(result.applicable === false ? { applicable: false } : {}) };
}

function buildContextGateEvaluation({ targetRoot, nowMs = Date.now(), expectedTransition: forcedExpectedTransition, phase: forcedPhase, governance } = {}) {
  const root = targetRoot || process.cwd();
  const rules = contextGateGovernance(governance);
  const adopted = hasAdoptionContract(root);
  let expectedTransition = forcedExpectedTransition || null;
  let phase = forcedPhase || (forcedExpectedTransition ? String(forcedExpectedTransition).split("->")[0] : null);
  const evaluation = {
    targetRoot: root, nowMs, phase: null, expectedTransition: null,
    selectedArtifact: { present: false },
    validation: { ok: false, status: "not_selected", reason: "" },
    freshness: { ok: false, status: "not_selected", max_age_days: rules.defaultMaxArtifactAgeDays },
    adoption: { adopted, disposition: adopted ? "pending" : "not_adopted", required: false },
    override: { ok: false, status: "not_applicable", reason: "" },
    result: null,
  };

  if (adopted && !forcedExpectedTransition) {
    const expected = expectedTransitionFromStatus(root, { governance });
    expectedTransition = expected.transition;
    phase = expected.phase;
    evaluation.phase = phase;
    evaluation.expectedTransition = expectedTransition;
    evaluation.adoption.phase = phase;
    evaluation.adoption.expected_transition = expectedTransition;
    if (!expectedTransition) {
      evaluation.adoption.disposition = "no_expected_transition";
      evaluation.result = { status: "skip", reason: phase === "lookback" ? "context gate adoption has no next transition for current phase lookback" : "context gate adoption could not determine the expected transition from status.md", applicable: false };
      evaluation.provenance = provenanceForEvaluation(evaluation);
      return evaluation;
    }
    evaluation.adoption.required = isGateRequired(expectedTransition, { governance });
  } else if (forcedExpectedTransition) {
    evaluation.phase = phase;
    evaluation.expectedTransition = expectedTransition;
    evaluation.adoption.phase = phase;
    evaluation.adoption.expected_transition = expectedTransition;
    evaluation.adoption.required = isGateRequired(expectedTransition, { governance });
    evaluation.adoption.disposition = isGateRequired(expectedTransition, { governance }) ? "required" : "advisory";
  } else {
    evaluation.adoption.disposition = "not_adopted";
  }

  const selected = selectLatestContextGateArtifact(root, { expectedTransition });
  evaluation.selectedArtifact = selectedArtifactSummary(selected);
  if (!selected) {
    evaluation.reasonCode = "no_context_gate_surface";
    evaluation.result = { status: "skip", reason: "no context gate surface", applicable: false };
    evaluation.provenance = provenanceForEvaluation(evaluation);
    return evaluation;
  }
  if (selected.missingExpected) evaluation.reasonCode = "missing_expected_artifact";
  if (!selected.missingExpected) {
    evaluation.validation = validationDetailsForSelected(selected, nowMs, { governance });
    evaluation.freshness = selected.doc ? freshnessForDoc(selected.doc, nowMs, { governance }) : { ok: false, status: "malformed", max_age_days: rules.defaultMaxArtifactAgeDays };
    const validationFailure = validateSelectedArtifact(selected, nowMs, { governance });
    if (validationFailure) {
      evaluation.result = validationFailure;
      evaluation.provenance = provenanceForEvaluation(evaluation);
      return evaluation;
    }
  }
  if (adopted || forcedExpectedTransition) {
    evaluation.adoption.disposition = isGateRequired(expectedTransition, { governance }) ? "required" : "advisory";
    if (!selected.missingExpected && selected.doc && selected.doc.verdict === "blocked") {
      evaluation.override = detailedOverrideStatus({ targetRoot: root, artifact: selected.doc, artifactPath: selected.path, governance });
    }
    evaluation.result = adoptionResult({ targetRoot: root, selected, expectedTransition, governance });
    evaluation.provenance = provenanceForEvaluation(evaluation);
    return evaluation;
  }
  evaluation.result = { status: "pass", reason: `${selected.relativePath} is fresh and well-formed (verdict: ${selected.doc.verdict})` };
  evaluation.provenance = provenanceForEvaluation(evaluation);
  return evaluation;
}

function attachExplanation(result, evaluation) {
  const remediation = buildContextGateRemediation(evaluation);
  const explanation = buildContextGateExplanation({ ...evaluation, remediation });
  return { ...result, explanation, diagnostic: renderContextGateDiagnosticBlock(explanation), remediation, provenance: evaluation.provenance || provenanceForEvaluation(evaluation) };
}

function checkContextGateArtifact({ targetRoot, nowMs = Date.now(), explain = false, expectedTransition, phase, governance } = {}) {
  const evaluation = buildContextGateEvaluation({ targetRoot, nowMs, expectedTransition, phase, governance });
  const result = resultFromEvaluation(evaluation);
  return explain ? attachExplanation(result, evaluation) : result;
}

module.exports = {
  buildContextGateEvaluation,
  checkContextGateArtifact,
};
