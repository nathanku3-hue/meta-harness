"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { appendRunEvent, readRunJournal } = require("./run-journal");

const INPUT_DOMAIN = "meta-harness-means-input/v1";
const FINGERPRINT_DOMAIN = "meta-harness-means-fingerprint/v1";
const BASIN_VALIDATOR_DOMAIN = "meta-harness-failure-basin-validator/v1";
const BASIN_FINGERPRINT_DOMAIN = "meta-harness-failure-basin-fingerprint/v1";
const DEFAULT_FAILURE_LIMIT = 2;
const DEFAULT_BASIN_LIMIT = 3;

function fail(message) {
  throw new ConfigError(message, { code: "MH_MEANS_CIRCUIT" });
}

function descriptor({ meansKind, exactInput, runtimeCapabilityDigest, failureClass }) {
  if (typeof meansKind !== "string" || !meansKind.trim()) fail("meansKind is required");
  if (typeof failureClass !== "string" || !failureClass.trim()) fail("failureClass is required");
  if (!isDigest(runtimeCapabilityDigest)) fail("runtimeCapabilityDigest must be a digest");
  if (exactInput === undefined) fail("exactInput is required");
  const exactInputDigest = domainDigest(INPUT_DOMAIN, exactInput);
  const body = {
    meansKind: meansKind.trim(),
    exactInputDigest,
    runtimeCapabilityDigest,
    failureClass: failureClass.trim(),
  };
  return Object.freeze({ ...body, fingerprint: domainDigest(FINGERPRINT_DOMAIN, body) });
}

function state({ gitCommonDirectory, runId, value, failureLimit = DEFAULT_FAILURE_LIMIT }) {
  if (!Number.isInteger(failureLimit) || failureLimit < 1) fail("failureLimit must be positive");
  const events = readRunJournal({ gitCommonDirectory, runId });
  const failures = events.filter((event) => event.type === "means/failure" && event.data?.fingerprint === value.fingerprint);
  const opened = events.find((event) => event.type === "means/circuit-open" && event.data?.fingerprint === value.fingerprint) || null;
  return Object.freeze({
    fingerprint: value.fingerprint,
    failureCount: failures.length,
    failureLimit,
    open: Boolean(opened) || failures.length >= failureLimit,
    circuitEventDigest: opened?.eventDigest || null,
  });
}

function primaryFailedValidation(results) {
  if (!Array.isArray(results)) fail("validation results must be an array");
  const failed = results.find((entry) => entry && entry.passed === false);
  if (!failed || !Array.isArray(failed.argv)) fail("failure basin requires at least one failed validator result");
  return failed;
}

function normalizedErrorClass(output, exitCode) {
  const text = String(output || "");
  const tokenPatterns = [
    /\bTS\d{4}\b/iu,
    /\b(?:EACCES|EPERM|ENOENT|ECONNREFUSED|ETIMEDOUT|MODULE_NOT_FOUND)\b/iu,
    /\b(?:TypeError|ReferenceError|SyntaxError|AssertionError|RangeError)\b/iu,
  ];
  for (const pattern of tokenPatterns) {
    const match = text.match(pattern);
    if (match) return match[0].toUpperCase();
  }
  if (/\b(?:permission denied|operation not permitted|access denied|unauthorized|forbidden|http\s*40[13]|\b40[13]\b)/iu.test(text)) {
    return "CAPABILITY_BOUNDARY";
  }
  return `EXIT_${Number.isInteger(exitCode) ? exitCode : "UNKNOWN"}`;
}

function normalizedFailureLocus(output) {
  const text = String(output || "").replace(/\\/gu, "/");
  const pathMatch = text.match(/([A-Za-z]:\/[^\s():]+|\/?(?:[^\s():]+\/)+[^\s():]+\.(?:cjs|js|jsx|mjs|ts|tsx|py|go|rs|java|rb|php))(?::\d+){1,2}/iu);
  const symbolMatch = text.match(/\bat\s+([A-Za-z_$][\w$.[\]<>:-]*)\s*(?:\(|$)/u);
  if (pathMatch) {
    const shortPath = pathMatch[1].split("/").filter(Boolean).slice(-2).join("/");
    return symbolMatch ? `${symbolMatch[1]}@${shortPath}` : shortPath;
  }
  if (symbolMatch) return symbolMatch[1];
  return "validator-root";
}

function failureBasinDescriptor({
  meansKind,
  validationResults,
  runtimeCapabilityDigest,
  validationEnvironmentDigest,
}) {
  if (typeof meansKind !== "string" || !meansKind.trim()) fail("meansKind is required");
  if (!isDigest(runtimeCapabilityDigest)) fail("runtimeCapabilityDigest must be a digest");
  if (!isDigest(validationEnvironmentDigest)) fail("validationEnvironmentDigest must be a digest");
  const failed = primaryFailedValidation(validationResults);
  const validator = {
    argv: failed.argv.map((entry) => String(entry)),
    cwd: String(failed.cwd || "."),
  };
  const body = {
    meansKind: meansKind.trim(),
    validatorDigest: domainDigest(BASIN_VALIDATOR_DOMAIN, validator),
    errorClass: normalizedErrorClass(failed.output, failed.exitCode),
    locus: normalizedFailureLocus(failed.output),
    runtimeCapabilityDigest,
    validationEnvironmentDigest,
  };
  return Object.freeze({ ...body, basinFingerprint: domainDigest(BASIN_FINGERPRINT_DOMAIN, body) });
}

function failureBasinState({ gitCommonDirectory, runId, value, failureLimit = DEFAULT_BASIN_LIMIT }) {
  if (!Number.isInteger(failureLimit) || failureLimit < 1) fail("failure basin limit must be positive");
  const events = readRunJournal({ gitCommonDirectory, runId });
  const failures = events.filter((event) => event.type === "means/basin-failure"
    && event.data?.basinFingerprint === value.basinFingerprint);
  const opened = events.find((event) => event.type === "means/basin-open"
    && event.data?.basinFingerprint === value.basinFingerprint) || null;
  return Object.freeze({
    basinFingerprint: value.basinFingerprint,
    validatorDigest: value.validatorDigest,
    errorClass: value.errorClass,
    locus: value.locus,
    failureCount: failures.length,
    failureLimit,
    open: Boolean(opened) || failures.length >= failureLimit,
    circuitEventDigest: opened?.eventDigest || null,
  });
}

function recordFailureBasin({
  gitCommonDirectory,
  runId,
  meansKind,
  validationResults,
  runtimeCapabilityDigest,
  validationEnvironmentDigest,
  failureLimit = DEFAULT_BASIN_LIMIT,
}) {
  const value = failureBasinDescriptor({
    meansKind,
    validationResults,
    runtimeCapabilityDigest,
    validationEnvironmentDigest,
  });
  const before = failureBasinState({ gitCommonDirectory, runId, value, failureLimit });
  if (before.open) return before;
  appendRunEvent({ gitCommonDirectory, runId, type: "means/basin-failure", data: value });
  const after = failureBasinState({ gitCommonDirectory, runId, value, failureLimit });
  if (after.open && !after.circuitEventDigest) {
    appendRunEvent({
      gitCommonDirectory,
      runId,
      type: "means/basin-open",
      data: { ...value, failureCount: after.failureCount, failureLimit },
    });
  }
  return failureBasinState({ gitCommonDirectory, runId, value, failureLimit });
}

function recordMeansFailure({
  gitCommonDirectory,
  runId,
  meansKind,
  exactInput,
  runtimeCapabilityDigest,
  failureClass,
  failureLimit = DEFAULT_FAILURE_LIMIT,
}) {
  const value = descriptor({ meansKind, exactInput, runtimeCapabilityDigest, failureClass });
  const before = state({ gitCommonDirectory, runId, value, failureLimit });
  if (before.open) return before;
  appendRunEvent({ gitCommonDirectory, runId, type: "means/failure", data: value });
  const after = state({ gitCommonDirectory, runId, value, failureLimit });
  if (after.open && !after.circuitEventDigest) {
    appendRunEvent({
      gitCommonDirectory,
      runId,
      type: "means/circuit-open",
      data: { ...value, failureCount: after.failureCount, failureLimit },
    });
  }
  return state({ gitCommonDirectory, runId, value, failureLimit });
}

module.exports = {
  BASIN_FINGERPRINT_DOMAIN,
  BASIN_VALIDATOR_DOMAIN,
  DEFAULT_BASIN_LIMIT,
  DEFAULT_FAILURE_LIMIT,
  descriptor,
  failureBasinDescriptor,
  failureBasinState,
  normalizedErrorClass,
  normalizedFailureLocus,
  recordFailureBasin,
  recordMeansFailure,
  state,
};
