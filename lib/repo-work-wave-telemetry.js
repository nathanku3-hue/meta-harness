"use strict";

const REPO_WORK_WAVE_TELEMETRY_SCHEMA = "repo-work-wave-telemetry/v1";

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
    runKey: entry.item.runKey || entry.item.session?.sessionDigest || null,
    outcomeDigest: entry.item.outcomeDigest || entry.item.session?.origin?.outcomeDigest || null,
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

function buildRepoWorkWaveTelemetry(telemetry) {
  return Object.freeze(JSON.parse(JSON.stringify(telemetry)));
}

module.exports = {
  REPO_WORK_WAVE_TELEMETRY_SCHEMA,
  buildRepoWorkWaveTelemetry,
  executionTelemetry,
  isoTime,
};
