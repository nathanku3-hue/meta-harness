"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { appendRunEvent, readRunJournal } = require("./run-journal");

const INPUT_DOMAIN = "meta-harness-means-input/v1";
const FINGERPRINT_DOMAIN = "meta-harness-means-fingerprint/v1";
const DEFAULT_FAILURE_LIMIT = 2;

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
  DEFAULT_FAILURE_LIMIT,
  descriptor,
  recordMeansFailure,
  state,
};
