"use strict";

function splitTransition(transition) {
  const [from, to] = String(transition || "").split("->");
  return { from, to };
}

function contextCheckCommand(transition) {
  const { from, to } = splitTransition(transition);
  if (!from || !to) return "meta-harness context check --from <phase> --to <phase>";
  return `meta-harness context check --from ${from} --to ${to}`;
}

function remediationForEvaluation(evaluation = {}) {
  const transition = evaluation.expectedTransition ||
    evaluation.artifact?.transition ||
    evaluation.selectedArtifact?.transition;
  const baseCommand = contextCheckCommand(transition);
  const selected = evaluation.selected || evaluation.selectedArtifact;
  const result = evaluation.result || {};
  const overrideStatus = evaluation.overrideEvaluation?.status ||
    evaluation.overrideEvaluation?.path ||
    evaluation.override?.status;

  if (!transition) {
    return "Update .meta-harness/status.md with a valid Phase before running context check";
  }

  if (!selected) {
    return baseCommand;
  }

  if (selected.missingExpected) {
    return baseCommand;
  }

  if (evaluation.validationFailure) {
    if (String(evaluation.validationFailure.reason || "").includes("older than 7 days")) {
      return `${baseCommand} (regenerate stale artifact)`;
    }
    return `${baseCommand} (regenerate invalid artifact)`;
  }

  if (result.status === "fail" && overrideStatus && overrideStatus !== "valid_bypass") {
    return `${baseCommand} --override-context-gate "reason" --override-context-gate-code human_override`;
  }

  if (result.status === "fail") {
    return baseCommand;
  }

  return result.next_action || "";
}

module.exports = {
  buildContextGateRemediation: remediationForEvaluation,
  remediationForEvaluation,
};
