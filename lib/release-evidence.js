"use strict";

const DEFAULT_FULL_RELEASE_ARTIFACTS = Object.freeze([
  "executed_test_result",
  "package_dry_run_output",
  "publish_mode_external_evidence",
]);

const DEFAULT_REQUIREMENTS = Object.freeze({
  github_security: Object.freeze({
    required: true,
    fields: Object.freeze(["status", "source", "checked_at"]),
    artifacts: Object.freeze([]),
  }),
  full_release: Object.freeze({
    required: true,
    fields: Object.freeze(["status", "source", "checked_at"]),
    artifacts: DEFAULT_FULL_RELEASE_ARTIFACTS,
  }),
});

function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(isNonEmptyString)));
}
function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}
function validDateTime(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}
function evidenceRoot(policy) {
  if (isPlainObject(policy?.external_evidence)) return policy.external_evidence;
  if (isPlainObject(policy?.evidence)) return policy.evidence;
  return {};
}
function requirementRoot(policy) {
  return isPlainObject(policy?.evidence_requirements) ? policy.evidence_requirements : {};
}
function configuredRequirement(policy, key) {
  const fromPolicy = requirementRoot(policy)[key];
  const defaults = DEFAULT_REQUIREMENTS[key];
  if (!isPlainObject(fromPolicy)) return defaults;
  return {
    required: fromPolicy.required !== false,
    fields: uniqueStrings(fromPolicy.fields).length > 0 ? uniqueStrings(fromPolicy.fields) : defaults.fields,
    artifacts: key === "full_release"
      ? (uniqueStrings(fromPolicy.artifacts).length > 0 ? uniqueStrings(fromPolicy.artifacts) : defaults.artifacts)
      : [],
  };
}
function validateReleaseEvidenceRequirements(policy) {
  const missing = [];
  const root = policy?.evidence_requirements;
  if (!isPlainObject(root)) return ["evidence_requirements"];

  for (const [key, defaults] of Object.entries(DEFAULT_REQUIREMENTS)) {
    const requirement = root[key];
    if (!isPlainObject(requirement)) {
      missing.push(`evidence_requirements.${key}`);
      continue;
    }
    if (requirement.required !== true) missing.push(`evidence_requirements.${key}.required=true`);
    const fields = uniqueStrings(requirement.fields);
    for (const field of defaults.fields) {
      if (!fields.includes(field)) missing.push(`evidence_requirements.${key}.fields includes ${field}`);
    }
    if (key === "full_release") {
      const artifacts = uniqueStrings(requirement.artifacts);
      for (const artifact of DEFAULT_FULL_RELEASE_ARTIFACTS) {
        if (!artifacts.includes(artifact)) missing.push(`evidence_requirements.${key}.artifacts includes ${artifact}`);
      }
    }
  }

  return missing;
}

function missingEvidence(key, requirement) {
  const label = key === "github_security" ? "external GitHub/security evidence" : "full release evidence";
  return {
    key,
    status: "unknown",
    state: "missing",
    reason: `${label} missing or not evaluated`,
    next_action: key === "github_security"
      ? "Record GitHub repository security evidence before release"
      : "Record full release evidence before claiming release readiness",
    details: { evidence_state: "missing", requirements: requirement },
  };
}

function invalidEvidence(key, evidence, errors, requirement) {
  const label = key === "github_security" ? "external GitHub/security" : "full release";
  return {
    key,
    status: "fail",
    state: "invalid",
    reason: `${label} evidence invalid: ${errors.join(", ")}`,
    next_action: key === "github_security"
      ? "Fix recorded GitHub repository security evidence before release"
      : "Fix recorded full release evidence before release",
    details: { evidence_state: "invalid", validation_errors: errors, evidence, requirements: requirement },
  };
}

function failingEvidence(key, evidence, requirement) {
  const label = key === "github_security" ? "external GitHub/security" : "full release";
  return {
    key,
    status: "fail",
    state: "failing",
    reason: evidence.reason || `${label} evidence is failing`,
    next_action: key === "github_security"
      ? "Resolve external GitHub/security release evidence before release"
      : "Resolve full release evidence before release",
    details: { evidence_state: "failing", evidence, requirements: requirement },
  };
}

function validEvidence(key, evidence, requirement) {
  const label = key === "github_security" ? "external GitHub/security evidence recorded" : "full release evidence recorded";
  return {
    key,
    status: "pass",
    state: "valid",
    reason: label,
    next_action: "",
    details: { evidence_state: "valid", evidence, requirements: requirement },
  };
}

function validatePassEvidence(key, evidence, requirement) {
  const errors = [];
  if (!isNonEmptyString(evidence.source)) errors.push("source");
  if (!isNonEmptyString(evidence.checked_at)) errors.push("checked_at");
  else if (!validDateTime(evidence.checked_at)) errors.push("checked_at must be a valid date-time");

  if (key === "full_release") {
    if (!isPlainObject(evidence.artifacts)) errors.push("artifacts");
    else for (const artifact of requirement.artifacts) {
      if (!isNonEmptyString(evidence.artifacts[artifact])) errors.push(`artifacts.${artifact}`);
    }
  }

  return errors;
}

function evaluateEvidenceRecord(policy, key) {
  const requirement = configuredRequirement(policy, key);
  const evidence = evidenceRoot(policy)[key];
  if (!isPlainObject(evidence)) return missingEvidence(key, requirement);

  const status = normalizeStatus(evidence.status);
  if (!status || ["missing", "not_evaluated", "not_evaluated_yet", "pending", "skip", "skipped", "unknown"].includes(status)) {
    return missingEvidence(key, requirement);
  }
  if (["fail", "failed", "block", "blocked"].includes(status)) return failingEvidence(key, evidence, requirement);
  if (!["pass", "passed", "verified"].includes(status)) {
    return invalidEvidence(key, evidence, [`unsupported status ${evidence.status}`], requirement);
  }

  const errors = validatePassEvidence(key, evidence, requirement);
  return errors.length > 0 ? invalidEvidence(key, evidence, errors, requirement) : validEvidence(key, evidence, requirement);
}

function evaluateReleaseEvidence(policy) {
  const githubSecurity = evaluateEvidenceRecord(policy, "github_security");
  const fullRelease = evaluateEvidenceRecord(policy, "full_release");
  return {
    githubSecurity,
    fullRelease,
    ok: githubSecurity.status === "pass" && fullRelease.status === "pass",
  };
}

module.exports = {
  DEFAULT_FULL_RELEASE_ARTIFACTS,
  DEFAULT_REQUIREMENTS,
  evaluateEvidenceRecord,
  evaluateReleaseEvidence,
  validateReleaseEvidenceRequirements,
  _test: { configuredRequirement, evidenceRoot, normalizeStatus, validDateTime },
};
