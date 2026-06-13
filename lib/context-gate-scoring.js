"use strict";

const { HARNESS_DIR } = require("./paths");
const { clampScore, contextGateGovernance, uniqueStrings } = require("./context-gate-utils");
const {
  semanticMarkdownSection,
  semanticStatusField,
} = require("./context-status-fields");
const {
  eventDates,
  hasAny,
  latestDate,
  statusDate,
} = require("./context-gate-state");

function scoreResult(dimension, score, evidence, options = {}) {
  return {
    dimension,
    score: clampScore(score),
    evidence: uniqueStrings(evidence),
    summary: options.summary || "",
    unknown: Boolean(options.unknown),
    evidenceGap: Boolean(options.evidenceGap),
    structuralBlocker: options.structuralBlocker,
    question: options.question,
  };
}

function unknownResult(dimension, evidence, options = {}) {
  return scoreResult(dimension, 1, evidence, {
    ...options,
    unknown: true,
    evidenceGap: !options.structuralBlocker,
  });
}

function evaluateProductOutcome(state) {
  const goal = semanticStatusField(state.statusText, "Goal");
  const currentTruth = semanticStatusField(state.statusText, "Current truth");
  const nextAction = semanticStatusField(state.statusText, "Next action");
  const productOutcomeEvidence = semanticStatusField(state.statusText, "Product outcome evidence");
  const evidence = [];
  if (goal) evidence.push(".meta-harness/status.md Goal");
  if (currentTruth) evidence.push(".meta-harness/status.md Current truth");
  if (nextAction) evidence.push(".meta-harness/status.md Next action");
  if (productOutcomeEvidence) evidence.push(".meta-harness/status.md Product outcome evidence");
  if (state.events.length > 0) evidence.push(".meta-harness/events.jsonl last events");

  if (!goal || !currentTruth) {
    return unknownResult("product_outcome", evidence, {
      question: "What product outcome should this transition deliver, and for whom?",
      summary: goal || "",
    });
  }

  let score = 6;
  if (nextAction && !/^none\b/i.test(nextAction.trim())) score += 1;
  if (/\b(done|complete|closed|accept|exit criteria|why|for whom)\b/i.test(currentTruth)) score += 1;
  if (/\bD[0-9]{3}\b/.test(state.statusText)) score += 1;
  if (productOutcomeEvidence) score += 1;

  return scoreResult("product_outcome", score, evidence, {
    summary: goal.split(/\r?\n/).find((line) => line.trim()) || goal,
  });
}

function evaluateScopeBoundary(state, transition, rules) {
  const combined = `${state.statusText}\n${state.decisionLogText}`.toLowerCase();
  const stopCriteria = semanticStatusField(state.statusText, "Stop criteria");
  const scopeBoundaryEvidence = semanticStatusField(state.statusText, "Scope boundary evidence");
  const hasOutOfScope = hasAny(combined, [
    /\bout[- ]of[- ]scope\b/,
    /\bnon[- ]goals?\b/,
    /\bnot authorized\b/,
    /\bdoes not authorize\b/,
    /\bforbidden\b/,
    /\bmust not\b/,
  ]);
  const evidence = [];
  if (hasOutOfScope) evidence.push("scope boundary markers in status/decision log");
  if (stopCriteria) evidence.push(".meta-harness/status.md Stop criteria");
  if (scopeBoundaryEvidence) evidence.push(".meta-harness/status.md Scope boundary evidence");

  if (!hasOutOfScope && rules.executionTransitionSet.has(transition)) {
    return unknownResult("scope_boundary", evidence, {
      structuralBlocker: "Missing out-of-scope boundary for execution transition",
      question: "What is explicitly out of scope or forbidden for this execution transition?",
      summary: stopCriteria,
    });
  }
  if (!hasOutOfScope) {
    return unknownResult("scope_boundary", evidence, {
      question: "What is the smallest useful scope, and what is excluded?",
      summary: stopCriteria,
    });
  }

  let score = 6;
  if (stopCriteria) score += 1;
  if (/\b(forbidden|must not|not authorized|does not authorize)\b/i.test(combined)) score += 1;
  if (/\bsmallest|bounded|accepted roadmap scopes|scoped exceptions\b/i.test(combined)) score += 1;
  if (scopeBoundaryEvidence) score += 1;

  return scoreResult("scope_boundary", score, evidence, {
    summary: stopCriteria.split(/\r?\n/).find((line) => line.trim()) || "Scope boundaries are present in harness truth.",
  });
}

function packageStackSummary(packageJson) {
  if (!packageJson || typeof packageJson !== "object") {
    return "";
  }
  const parts = ["Node.js"];
  if (packageJson.packageManager) {
    parts.push(packageJson.packageManager);
  }
  if (packageJson.engines?.node) {
    parts.push(`node ${packageJson.engines.node}`);
  }
  return parts.join(", ");
}

function evaluateRepoAndStack(state) {
  const readmeTitle = (state.readmeText.match(/^#\s+(.+)$/m) || [])[1];
  const packageName = state.packageJson?.name;
  const repoName = packageName || readmeTitle || "";
  const stack = packageStackSummary(state.packageJson) || (state.pyprojectText ? "Python/pyproject" : "");
  const readmeStackEvidence = semanticMarkdownSection(state.readmeText, "Stack Evidence");
  const statusStackEvidence = semanticStatusField(state.statusText, "Repo stack evidence");
  const evidence = [];
  if (packageName) evidence.push("package.json name");
  if (state.files.packageJson) evidence.push("package.json stack metadata");
  if (state.files.pyproject) evidence.push("pyproject.toml");
  if (readmeTitle) evidence.push("README.md title");
  if (readmeStackEvidence) evidence.push("README.md Stack Evidence");
  if (statusStackEvidence) evidence.push(".meta-harness/status.md Repo stack evidence");

  if (!repoName) {
    return unknownResult("repo_and_stack", evidence, {
      structuralBlocker: "Missing repo target",
      question: "Which repository is the target for this transition?",
      summary: "",
    });
  }
  if (!stack) {
    return unknownResult("repo_and_stack", evidence, {
      structuralBlocker: "Missing stack/framework identity",
      question: "What stack, framework, or runtime should workers assume?",
      summary: repoName,
    });
  }

  let score = 7;
  if (state.packageJson?.scripts && Object.keys(state.packageJson.scripts).length > 0) score += 1;
  if (state.packageJson?.engines || state.packageJson?.devEngines || state.packageJson?.packageManager) score += 1;
  if (readmeStackEvidence || statusStackEvidence) score += 1;

  return scoreResult("repo_and_stack", score, evidence, {
    summary: `${repoName}; ${stack}`,
  });
}

function evaluateOwnedSurface(state) {
  const combined = `${state.statusText}\n${state.decisionLogText}`;
  const ownedSurfaceEvidence = semanticStatusField(state.statusText, "Owned surface evidence");
  const evidence = [];
  const hasOwned = hasAny(combined, [
    /\bowned (paths?|surface)\b/i,
    /\bowned files?\s*:/i,
    /\bwrite scope\b/i,
    /\ballowed (files?|paths?|directories)\s*:/i,
    /\bfiles?\/directories allowed\b/i,
  ]);
  const hasForbidden = hasAny(combined, [
    /\bforbidden (files?|paths?|surface)\b/i,
    /\bavoid editing\b/i,
    /\bdo not edit\b/i,
    /\bmust not touch\b/i,
  ]);
  if (hasOwned) evidence.push("owned surface marker in harness truth");
  if (hasForbidden) evidence.push("forbidden surface marker in harness truth");
  if (state.workerFiles.length > 0) evidence.push(".meta-harness/workers surface");
  if (ownedSurfaceEvidence) evidence.push(".meta-harness/status.md Owned surface evidence");

  if (!hasOwned) {
    return unknownResult("owned_surface", evidence, {
      question: "Which files or directories are owned, and which are forbidden?",
      summary: hasForbidden ? "Forbidden surface markers are present, but owned files are unknown." : "",
    });
  }

  let score = 5;
  if (hasOwned) score += 2;
  if (hasForbidden) score += 1;
  if (state.workerFiles.length > 0 || state.expertPacketFiles.length > 0) score += 1;
  if (ownedSurfaceEvidence) score += 1;

  return scoreResult("owned_surface", score, evidence, {
    summary: hasOwned && hasForbidden
      ? "Owned and forbidden surface markers are present."
      : "Only partial surface boundary markers are present.",
  });
}

function evaluateEvidencePlan(state) {
  const scripts = state.packageJson?.scripts || {};
  const statusEvidence = semanticStatusField(state.statusText, "Last verified");
  const combined = `${state.statusText}\n${state.readmeText}`;
  const evidence = [];
  if (scripts.test) evidence.push("package.json scripts.test");
  if (statusEvidence) evidence.push(".meta-harness/status.md Last verified");
  if (/\bready\b/i.test(combined)) evidence.push("ready check reference");
  if (/\bquality check\b/i.test(combined)) evidence.push("quality check reference");

  if (!scripts.test && !statusEvidence && !/\b(test|verify|evidence|acceptance)\b/i.test(combined)) {
    return unknownResult("evidence_plan", evidence, {
      question: "What command, demo path, or acceptance check proves this transition is done?",
      summary: "",
    });
  }

  let score = 5;
  if (scripts.test) score += 2;
  if (statusEvidence) score += 1;
  if (/\bready\b/i.test(combined)) score += 1;
  if (/\bquality check\b/i.test(combined)) score += 1;

  return scoreResult("evidence_plan", score, evidence, {
    summary: scripts.test ? `test command: ${scripts.test}` : statusEvidence.split(/\r?\n/)[0],
  });
}

function looksLikeForbiddenProviderRequest(text) {
  const risky = /(requires?|needs?|use|read|access)\s+(secrets?|credentials?|provider access|api keys?|tokens?)/i;
  const explicitDenial = /(no|not|without|does not|must not|unauthorized|forbidden|out of scope).{0,80}(secrets?|credentials?|provider access|api keys?|tokens?)/i;
  return risky.test(text) && !explicitDenial.test(text);
}

function evaluateRiskAndStopRules(state) {
  const stopCriteria = semanticStatusField(state.statusText, "Stop criteria");
  const combined = `${state.statusText}\n${state.decisionLogText}\n${JSON.stringify(state.securityPolicy || {})}`;
  const evidence = [];
  if (stopCriteria) evidence.push(".meta-harness/status.md Stop criteria");
  if (state.files.securityPolicy) evidence.push(".meta-harness/security-policy.json");
  if (/\b(redaction|secret|provider|rollback|pause|stop)\b/i.test(combined)) evidence.push("risk markers in harness truth");

  if (looksLikeForbiddenProviderRequest(combined)) {
    return unknownResult("risk_and_stop_rules", evidence, {
      structuralBlocker: "Requires secrets/provider access without permission",
      question: "Is provider, credential, or secret access authorized for this transition?",
      summary: stopCriteria,
    });
  }
  if (!stopCriteria && !state.files.securityPolicy) {
    return unknownResult("risk_and_stop_rules", evidence, {
      question: "What stop rule or rollback condition should workers follow?",
      summary: "",
    });
  }

  let score = 6;
  if (stopCriteria) score += 1;
  if (state.files.securityPolicy) score += 1;
  if (/\b(provider|secret|credential|redaction)\b/i.test(combined)) score += 1;
  if (/\brollback|pause|blocker|must not\b/i.test(combined)) score += 1;

  return scoreResult("risk_and_stop_rules", score, evidence, {
    summary: stopCriteria.split(/\r?\n/).find((line) => line.trim()) || "Security policy is present.",
  });
}

function evaluateFreshness(state, now) {
  const updated = statusDate(state);
  const latestEvent = latestDate(eventDates(state));
  const freshest = latestDate([updated, latestEvent].filter(Boolean));
  const evidence = [];
  if (updated) evidence.push(".meta-harness/status.md Updated");
  if (latestEvent) evidence.push(".meta-harness/events.jsonl recent timestamp");

  if (!freshest) {
    return unknownResult("freshness", evidence, {
      question: "When was the context last verified against current repo truth?",
      summary: "",
    });
  }

  const ageMs = now.getTime() - freshest.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageMs < -5 * 60 * 1000) {
    return unknownResult("freshness", evidence, {
      question: "Why is context evidence dated in the future?",
      summary: freshest.toISOString(),
    });
  }

  let score = 10;
  if (ageDays > 30) score = 3;
  else if (ageDays > 14) score = 4;
  else if (ageDays > 7) score = 5;
  else if (ageDays > 3) score = 7;
  else if (ageDays > 1) score = 8;

  return scoreResult("freshness", score, evidence, {
    summary: freshest.toISOString(),
  });
}

function evaluateHandoffCompleteness(state) {
  const nextAction = semanticStatusField(state.statusText, "Next action");
  const stopCriteria = semanticStatusField(state.statusText, "Stop criteria");
  const pendingDecisions = semanticStatusField(state.statusText, "Pending human decisions");
  const workerTemplate = state.workerFiles.includes(`${HARNESS_DIR}/workers/worker-report-template.md`);
  const evidence = [];
  if (nextAction) evidence.push(".meta-harness/status.md Next action");
  if (stopCriteria) evidence.push(".meta-harness/status.md Stop criteria");
  if (pendingDecisions) evidence.push(".meta-harness/status.md Pending human decisions");
  if (workerTemplate) evidence.push(".meta-harness/workers/worker-report-template.md");

  if (!nextAction || /^none\b/i.test(nextAction.trim())) {
    return unknownResult("handoff_completeness", evidence, {
      question: "What should the next worker do, and what should they report back?",
      summary: nextAction,
    });
  }

  let score = 5;
  if (nextAction) score += 2;
  if (stopCriteria) score += 1;
  if (workerTemplate) score += 1;
  if (pendingDecisions) score += 1;

  return scoreResult("handoff_completeness", score, evidence, {
    summary: nextAction.split(/\r?\n/).find((line) => line.trim()) || nextAction,
  });
}

function evaluateContext(state, transition, now, { governance } = {}) {
  const rules = contextGateGovernance(governance);
  return [
    evaluateProductOutcome(state),
    evaluateScopeBoundary(state, transition, rules),
    evaluateRepoAndStack(state),
    evaluateOwnedSurface(state),
    evaluateEvidencePlan(state),
    evaluateRiskAndStopRules(state),
    evaluateFreshness(state, now),
    evaluateHandoffCompleteness(state),
  ];
}

module.exports = {
  evaluateContext,
};
