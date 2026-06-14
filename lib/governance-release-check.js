"use strict";

const { validateGovernance, governanceHash } = require("./context-gate-governance");
const { validateMigrationSpec, verifyMigration } = require("./governance-migration");
const { analyzeMigrationImpact } = require("./governance-migration-impact");
const { classifyGovernanceChanges } = require("./governance-compatibility");
const {
  validateReleaseManifest,
  verifyProvenanceChain,
} = require("./governance-release");
const { stateHash } = require("./state-hash");

function issue(code, message, details = {}) {
  return { severity: "fail", code, message, ...details };
}

function check(name, passed, details = {}, issues = [], extra = {}) {
  return {
    name,
    passed: Boolean(passed),
    details,
    issues,
    ...extra,
  };
}

function sameValue(left, right) {
  return stateHash(left) === stateHash(right);
}

function releaseIdentity(release = {}) {
  return {
    release_id: release.release_id || null,
    version: release.version || null,
    status: release.status || null,
  };
}

function compatibilityIssues(release, impact, computed) {
  const issues = [];
  const releaseCompatibility = release && release.compatibility || {};
  const impactClassification = impact && impact.classification || {};
  const computedClassification = computed && computed.classification || {};

  if (release.change_type !== impactClassification.change_level) {
    issues.push(issue("change_type", "release.change_type must match impact.classification.change_level", {
      expected: impactClassification.change_level,
      actual: release.change_type,
    }));
  }
  if (release.change_type !== computedClassification.change_level) {
    issues.push(issue("change_type", "release.change_type must match classifyGovernanceChanges(impact.changes)", {
      expected: computedClassification.change_level,
      actual: release.change_type,
    }));
  }
  for (const field of ["change_level", "breaking", "migration_required"]) {
    if (releaseCompatibility[field] !== impactClassification[field]) {
      issues.push(issue("compatibility", `release.compatibility.${field} must match impact.classification.${field}`, {
        field,
        expected: impactClassification[field],
        actual: releaseCompatibility[field],
      }));
    }
    if (releaseCompatibility[field] !== computedClassification[field]) {
      issues.push(issue("compatibility", `release.compatibility.${field} must match classifyGovernanceChanges(impact.changes).classification.${field}`, {
        field,
        expected: computedClassification[field],
        actual: releaseCompatibility[field],
      }));
    }
  }
  if (releaseCompatibility.is_backward_compatible !== !releaseCompatibility.breaking) {
    issues.push(issue("compatibility", "release.compatibility.is_backward_compatible must equal !breaking"));
  }
  if (!sameValue(releaseCompatibility.reasons || [], impactClassification.reasons || [])) {
    issues.push(issue("compatibility", "release.compatibility.reasons must match impact.classification.reasons", {
      expected: impactClassification.reasons || [],
      actual: releaseCompatibility.reasons || [],
    }));
  }
  return issues;
}

function impactIssues(release, impact) {
  const issues = [];
  const releaseImpact = release && release.impact_report || {};
  if (releaseImpact.safety !== impact.safety) {
    issues.push(issue("impact_safety", "release.impact_report.safety must match analyzeMigrationImpact().safety", {
      expected: impact.safety,
      actual: releaseImpact.safety,
    }));
  }
  if (!sameValue(releaseImpact.counts || {}, impact.counts || {})) {
    issues.push(issue("impact_counts", "release.impact_report.counts must match analyzeMigrationImpact().counts", {
      expected: impact.counts || {},
      actual: releaseImpact.counts || {},
    }));
  }
  return issues;
}

async function runArtifactReplayChecks(replayInputs) {
  if (!Array.isArray(replayInputs) || replayInputs.length === 0) {
    return check("artifact-replay", true, {}, [], { skipped: true });
  }
  const { replayFromSnapshot } = require("./governance-replay");
  const results = [];
  const issues = [];
  for (const input of replayInputs) {
    const result = await replayFromSnapshot(input);
    results.push(result);
    if (result.ok === false || result.replayable === false || result.matches_original === false) {
      issues.push(issue("artifact_replay", "artifact replay failed", {
        status: result.status,
        reason: result.reason || null,
        artifact_path: input && input.artifactPath || null,
      }));
    }
  }
  return check("artifact-replay", issues.length === 0, { results }, issues);
}

async function runReleaseCheck(release, {
  before_snapshot: beforeSnapshot,
  snapshot,
  migration,
  artifacts = [],
  migration_verification: migrationVerification = null,
  artifact_replay_inputs: artifactReplayInputs = [],
} = {}) {
  const checks = [];

  const manifestValidation = validateReleaseManifest(release);
  checks.push(check("manifest", manifestValidation.ok, {
    status: manifestValidation.status,
  }, manifestValidation.issues || []));

  const snapshotValidation = validateGovernance(snapshot || {});
  const snapshotHash = snapshot ? governanceHash(snapshot) : null;
  const snapshotIssues = [...(snapshotValidation.issues || [])];
  if (!release || !release.snapshot || release.snapshot.governance_hash !== snapshotHash) {
    snapshotIssues.push(issue("governance_hash", "release.snapshot.governance_hash must match snapshot governance hash", {
      expected: snapshotHash,
      actual: release && release.snapshot && release.snapshot.governance_hash || null,
    }));
  }
  checks.push(check("snapshot-integrity", snapshotValidation.ok && snapshotIssues.length === 0, {
    governance_hash: snapshotHash,
  }, snapshotIssues));

  const migrationSpecValidation = validateMigrationSpec(migration || {});
  checks.push(check("migration-spec", migrationSpecValidation.ok, {
    status: migrationSpecValidation.status,
  }, migrationSpecValidation.issues || []));

  const migrationVerifyResult = migrationVerification || verifyMigration(migration, beforeSnapshot, snapshot);
  checks.push(check("migration-verification", migrationVerifyResult.ok, {
    migration_id: migrationVerifyResult.migration_id || null,
    expected_hash: migrationVerifyResult.expected_hash || null,
    actual_hash: migrationVerifyResult.actual_hash || null,
  }, migrationVerifyResult.issues || []));

  const impact = analyzeMigrationImpact(beforeSnapshot, migration, artifacts);
  const impactCheckIssues = impactIssues(release, impact);
  checks.push(check("impact-analysis", impact.ok && impactCheckIssues.length === 0, {
    safety: impact.safety,
    counts: impact.counts,
  }, [...(impact.issues || []), ...impactCheckIssues]));

  const computedCompatibility = classifyGovernanceChanges(impact.changes);
  const compatibilityCheckIssues = compatibilityIssues(release, impact, computedCompatibility);
  checks.push(check("compatibility", compatibilityCheckIssues.length === 0, {
    classification: computedCompatibility.classification,
    impact_classification: impact.classification,
  }, compatibilityCheckIssues));

  const provenance = verifyProvenanceChain(release, {
    snapshot,
    migration,
    migration_verification: migrationVerifyResult,
  });
  checks.push(check("provenance", provenance.ok, {
    broken_links: provenance.broken_links || [],
  }, provenance.issues || (provenance.broken_links || []).map((link) => issue("provenance", `broken provenance link: ${link}`, { link }))));

  checks.push(await runArtifactReplayChecks(artifactReplayInputs));

  const allPassed = checks.every((item) => item.passed);
  return {
    schema_version: "1",
    release: releaseIdentity(release),
    checks,
    all_passed: allPassed,
    promotable: allPassed && release && release.status === "CANDIDATE",
  };
}

module.exports = {
  runReleaseCheck,
};
