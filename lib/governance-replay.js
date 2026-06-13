"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { checkContextQuality } = require("./context-gate");
const {
  buildLiveGovernance,
  governanceFromSnapshot,
  governanceHash,
  readGovernanceSnapshot,
  validateGovernance,
} = require("./context-gate-governance");
const {
  attachContextGateFingerprint,
  canonicalReplayEvidenceState,
} = require("./context-gate-fingerprint");
const { validateContextGateArtifact } = require("./context-gate-validation");
const { stateHash } = require("./state-hash");

function readArtifact(artifactPath) {
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function identityForArtifact(artifact) {
  return {
    round_id: artifact.round_id,
    transition: artifact.transition,
    verdict: artifact.verdict,
    evaluation_hash: artifact.fingerprint?.evaluation_hash || null,
  };
}

function replayBase({ status, snapshot, artifact, governanceHashValue, extra = {} }) {
  return {
    schema_version: "1",
    ok: status === "match",
    status,
    replayable: status === "match",
    matches_original: status === "match",
    governance_hash: governanceHashValue,
    governance_engine_hash: snapshot.governance_engine_hash,
    original: artifact ? identityForArtifact(artifact) : null,
    diff: [],
    ...extra,
  };
}

function comparableOverride(artifact) {
  return artifact.override
    ? { code: artifact.override.code, actor: artifact.override.actor }
    : null;
}

function comparableEvaluation(artifact) {
  return {
    verdict: artifact.verdict,
    evaluation_hash: artifact.fingerprint?.evaluation_hash || null,
    scores: artifact.scores || {},
    structural_hard_blockers: artifact.structural_hard_blockers || [],
    evidence_gap_dimensions: artifact.evidence_gap_dimensions || [],
    unknown_dimensions: artifact.unknown_dimensions || [],
    override: comparableOverride(artifact),
  };
}

function sameValue(left, right) {
  return stateHash(left) === stateHash(right);
}

function diffEvaluations(original, replayed) {
  const diff = [];
  const left = comparableEvaluation(original);
  const right = comparableEvaluation(replayed);
  for (const field of Object.keys(left)) {
    if (!sameValue(left[field], right[field])) {
      diff.push({ field, original: left[field], replayed: right[field] });
    }
  }
  return diff;
}

function statusWithReason(status, reason, input) {
  return replayBase({
    ...input,
    status,
    extra: {
      ...(input.extra || {}),
      reason,
      replayable: false,
      matches_original: false,
    },
  });
}

async function replayFromSnapshot({ snapshotPath, artifactPath, targetRoot } = {}) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedArtifactPath = path.resolve(artifactPath);
  const resolvedTargetRoot = path.resolve(targetRoot || process.cwd());
  const snapshot = governanceFromSnapshot(readGovernanceSnapshot(resolvedSnapshotPath));
  const governanceHashValue = governanceHash(snapshot);
  const governanceValidation = validateGovernance(snapshot);
  if (!governanceValidation.ok) {
    return replayBase({
      status: "invalid_snapshot",
      snapshot,
      artifact: null,
      governanceHashValue,
      extra: {
        replayable: false,
        matches_original: false,
        reason: governanceValidation.issues.map((issue) => issue.code).join(", "),
      },
    });
  }

  const artifact = readArtifact(resolvedArtifactPath);
  const artifactValidation = validateContextGateArtifact(artifact, {
    governance: snapshot,
    now: artifact.generated_at ? new Date(artifact.generated_at) : new Date(),
    maxAgeDays: null,
  });
  if (!artifactValidation.ok) {
    return statusWithReason("invalid_artifact", artifactValidation.errors.join("; "), {
      snapshot,
      artifact,
      governanceHashValue,
    });
  }

  if (!artifact.fingerprint) {
    return statusWithReason("fingerprint_missing", "artifact predates Phase 13E fingerprinting", {
      snapshot,
      artifact,
      governanceHashValue,
    });
  }
  if (artifact.fingerprint.governance_hash !== governanceHashValue) {
    return statusWithReason("governance_drift", "artifact governance hash does not match snapshot governance hash", {
      snapshot,
      artifact,
      governanceHashValue,
      extra: {
        artifact_governance_hash: artifact.fingerprint.governance_hash,
      },
    });
  }

  const liveGovernance = buildLiveGovernance();
  if (liveGovernance.governance_engine_hash !== snapshot.governance_engine_hash) {
    return statusWithReason("engine_drift", "current governance replay engine differs from snapshot", {
      snapshot,
      artifact,
      governanceHashValue,
      extra: {
        current_governance_engine_hash: liveGovernance.governance_engine_hash,
      },
    });
  }

  const replayEvidence = canonicalReplayEvidenceState({
    targetRoot: resolvedTargetRoot,
    artifact,
    artifactPath: resolvedArtifactPath,
    now: artifact.generated_at,
  });
  const evidenceHash = stateHash(replayEvidence.evidenceState);
  if (evidenceHash !== artifact.fingerprint.evidence_hash) {
    return statusWithReason("evidence_drift", "current target evidence hash does not match artifact evidence hash", {
      snapshot,
      artifact,
      governanceHashValue,
      extra: {
        evidence_hash: evidenceHash,
        original_evidence_hash: artifact.fingerprint.evidence_hash,
      },
    });
  }

  const replayResult = checkContextQuality({
    targetRoot: resolvedTargetRoot,
    transition: artifact.transition,
    roundId: artifact.round_id,
    now: artifact.generated_at,
    governance: snapshot,
    write: false,
    state: replayEvidence.state,
    hintsResult: replayEvidence.hintsResult,
    evidenceState: replayEvidence.evidenceState,
  });
  let replayedArtifact = replayResult.artifact;
  if (artifact.override) {
    replayedArtifact = attachContextGateFingerprint({
      artifact: {
        ...replayedArtifact,
        override: artifact.override,
      },
      governance: snapshot,
      evidenceState: replayEvidence.evidenceState,
    });
  }

  const diff = diffEvaluations(artifact, replayedArtifact);
  const status = diff.length === 0 ? "match" : "mismatch";
  return replayBase({
    status,
    snapshot,
    artifact,
    governanceHashValue,
    extra: {
      replayable: true,
      matches_original: status === "match",
      evidence_hash: evidenceHash,
      replayed: {
        verdict: replayedArtifact.verdict,
        evaluation_hash: replayedArtifact.fingerprint.evaluation_hash,
      },
      diff,
    },
  });
}

module.exports = { replayFromSnapshot };
