"use strict";

const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
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
  isoTime,
  persistRepoWorkWaveTelemetry,
};
