"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { boundariesOverlap } = require("./outcome-claim");
const { readOutcome } = require("./outcome");
const { compileExecutionBoundary } = require("./repo-planner-admission");
const {
  digestStem,
  protocolRoot,
  writeCreateOnlyJson,
} = require("./world-authority");

const REPO_WORK_WAVE_TELEMETRY_SCHEMA = "repo-work-wave-telemetry/v1";
const REPO_WORK_WAVE_TELEMETRY_DOMAIN = "meta-harness-repo-work-wave-telemetry/v1";

function isoTime(ms) {
  return new Date(ms).toISOString();
}

function selectedWorkEffort(result) {
  const metrics = result?.metrics;
  if (!metrics) return null;
  const attempts = Array.isArray(metrics.attempts) ? metrics.attempts : [];
  return {
    schemaVersion: metrics.schemaVersion,
    continuation: metrics.continuation,
    elapsedMs: metrics.elapsedMs,
    firstProposalMs: metrics.firstProposalMs,
    workerMs: metrics.workerMs,
    verifierMs: metrics.verifierMs,
    validationCommandMs: metrics.validationCommandMs,
    repairAttempts: metrics.repairAttempts,
    attemptCount: attempts.length,
    operationCount: attempts.reduce((sum, attempt) => sum + Number(attempt.operationCount || 0), 0),
    writeBytes: attempts.reduce((sum, attempt) => sum + Number(attempt.writeBytes || 0), 0),
    workerJsonEvents: metrics.workerJsonEvents,
    workerOutputBytes: metrics.workerOutputBytes,
  };
}

function executionTelemetry(executions) {
  return executions.map((entry) => ({
    claimDigest: entry.item.claim.claimDigest,
    outcomeDigest: entry.item.claim.outcomeDigest,
    source: entry.item.source,
    proposalId: entry.item.proposalId || null,
    dispatchedAt: isoTime(entry.dispatchedMs),
    completedAt: isoTime(entry.completedMs),
    elapsedMs: Math.max(0, entry.completedMs - entry.dispatchedMs),
    status: entry.status,
    workOutcome: entry.status === "fulfilled" ? entry.result?.outcome || null : null,
    errorCode: entry.status === "rejected" ? String(entry.error?.code || "UNCLASSIFIED") : null,
    effort: entry.status === "fulfilled" ? selectedWorkEffort(entry.result) : null,
  }));
}

function synchronousBarrierTelemetry(executions) {
  if (executions.length === 0) {
    return {
      firstLocalCompletionAt: null,
      lastLocalCompletionAt: null,
      completionSpreadMs: 0,
      cumulativePostCompletionBarrierMs: 0,
    };
  }
  const completed = executions.map((entry) => entry.completedMs).sort((left, right) => left - right);
  const first = completed[0];
  const last = completed[completed.length - 1];
  return {
    firstLocalCompletionAt: isoTime(first),
    lastLocalCompletionAt: isoTime(last),
    completionSpreadMs: Math.max(0, last - first),
    cumulativePostCompletionBarrierMs: completed.reduce((sum, value) => sum + Math.max(0, last - value), 0),
  };
}

function candidateBoundary(candidate) {
  try {
    return compileExecutionBoundary(candidate.expectedWritePaths);
  } catch {
    return null;
  }
}

function candidateBoundaryConflictsWithClaims(candidate, claims) {
  const boundary = candidateBoundary(candidate);
  if (!boundary) return true;
  return claims.some((claim) => boundariesOverlap(claim.executionBoundary, boundary));
}

function frozenStructuralRefillTelemetry(repositoryPath, plannerCandidates, claimsAtDispatch, executions) {
  if (!Array.isArray(plannerCandidates) || executions.length === 0) return [];
  const claimedCandidateIds = new Set(claimsAtDispatch.map((claim) => readOutcome(repositoryPath, claim.outcomeDigest).id));
  const unclaimedCandidates = plannerCandidates.filter((candidate) => !claimedCandidateIds.has(candidate.id));
  const orderedExecutions = [...executions].sort((left, right) => {
    const time = left.completedMs - right.completedMs;
    return time || left.item.claim.claimDigest.localeCompare(right.item.claim.claimDigest);
  });
  const releasedClaims = new Set();
  return orderedExecutions.map((entry) => {
    releasedClaims.add(entry.item.claim.claimDigest);
    const remainingClaims = claimsAtDispatch.filter((claim) => !releasedClaims.has(claim.claimDigest));
    const candidateIds = unclaimedCandidates
      .filter((candidate) => !candidateBoundaryConflictsWithClaims(candidate, remainingClaims))
      .map((candidate) => candidate.id)
      .sort();
    return {
      observedAt: isoTime(entry.completedMs),
      completedClaimDigest: entry.item.claim.claimDigest,
      counterfactualReleasedLocalClaimCount: releasedClaims.size,
      structurallyCompatibleFrozenCandidateIds: candidateIds,
      structurallyCompatibleFrozenCandidateCount: candidateIds.length,
      counterfactualFillableSlotCount: Math.min(releasedClaims.size, candidateIds.length),
      semanticEligibilityAsserted: false,
      counterfactualOnly: true,
    };
  });
}

function telemetryDigest(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.telemetryDigest;
  return domainDigest(REPO_WORK_WAVE_TELEMETRY_DOMAIN, body);
}

function persistRepoWorkWaveTelemetry(repositoryPath, telemetry) {
  const record = Object.freeze({
    ...JSON.parse(JSON.stringify(telemetry)),
    telemetryDigest: telemetryDigest(telemetry),
  });
  try {
    const filePath = path.join(
      protocolRoot(repositoryPath),
      "telemetry",
      "repo-work-waves",
      `${digestStem(record.telemetryDigest)}.json`,
    );
    writeCreateOnlyJson(filePath, record, "MH_REPO_WORK_WAVE_TELEMETRY_WRITE");
    return { record, persistence: Object.freeze({ status: "PERSISTED", errorCode: null }) };
  } catch (error) {
    return {
      record,
      persistence: Object.freeze({
        status: "FAILED",
        errorCode: String(error?.code || "MH_REPO_WORK_WAVE_TELEMETRY_WRITE"),
      }),
    };
  }
}

module.exports = {
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  executionTelemetry,
  frozenStructuralRefillTelemetry,
  isoTime,
  persistRepoWorkWaveTelemetry,
  synchronousBarrierTelemetry,
};
