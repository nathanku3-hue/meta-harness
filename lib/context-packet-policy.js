"use strict";

const { UsageError } = require("./errors");
const { DEFAULT_MAX_ARTIFACT_AGE_DAYS } = require("./context-gate-constants");
const {
  hasAdoptionContract,
  isGateRequired,
  overrideStatus,
} = require("./context-gate-adoption");

const PACKET_TARGETS = new Set(["worker", "review", "planning"]);

function fail(message) {
  throw new UsageError(message);
}

function artifactGeneratedAtMs(artifact) {
  const parsed = typeof artifact.generated_at === "string" ? Date.parse(artifact.generated_at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isArtifactStale(artifact, now = new Date()) {
  return now.getTime() - artifactGeneratedAtMs(artifact) > DEFAULT_MAX_ARTIFACT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function validatePacketAudience(target) {
  if (!PACKET_TARGETS.has(target)) {
    fail("context packet target must be worker, review, or planning");
  }
}

function validationOptionsForPacketAudience(target, validation = {}) {
  validatePacketAudience(target);
  return target === "worker" ? validation : { ...validation, maxAgeDays: null };
}

function validatePacketInputs({ cwd, artifact, artifactPath, target, now = new Date() }) {
  validatePacketAudience(target);
  const warnings = [];

  if (!artifact.scores || artifact.scores.freshness < 6) {
    if (target === "worker") {
      fail("context packet requires gate freshness score >= 6");
    }
    warnings.push("Gate freshness is below the worker threshold; packet is for inspection only.");
  }

  if (target !== "worker" && isArtifactStale(artifact, now)) {
    warnings.push(`Gate artifact is older than ${DEFAULT_MAX_ARTIFACT_AGE_DAYS} days; packet is for inspection only.`);
  }

  if (hasAdoptionContract(cwd) && isGateRequired(artifact.transition) && artifact.verdict === "blocked") {
    const override = overrideStatus({ targetRoot: cwd, artifact, artifactPath });
    if (target === "worker" && !override.ok) {
      fail(`context packet for worker blocked by required context gate ${artifact.transition}: ${override.reason}`);
    }
    if (target !== "worker") {
      warnings.push("Required context gate is blocked; packet is for review/planning inspection only.");
    }
  }

  return warnings;
}

module.exports = {
  PACKET_TARGETS,
  validatePacketAudience,
  validatePacketInputs,
  validationOptionsForPacketAudience,
};
