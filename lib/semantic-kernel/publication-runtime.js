"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../contracts/digest");
const { contractError, immutable } = require("./contract-utils");
const { exactUtcNow } = require("./clock");
const {
  computePublicationObservationDigest,
  validatePublicationObservation,
} = require("./publication");

const PUBLISH_COMMAND_DOMAIN = "meta-harness-publish-command/v1";
const REGISTRY_OBSERVATION_COMMAND_DOMAIN = "meta-harness-registry-observation-command/v1";

function defaultRunner(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 180000,
    env: options.env || process.env,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error || null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    timedOut: Boolean(result.error && ["ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(result.error.code)),
  };
}

function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function publishArgs(releaseCandidate, tarballPath) {
  const args = [
    "publish",
    tarballPath,
    "--ignore-scripts",
    "--registry",
    releaseCandidate.registry,
    "--access",
    releaseCandidate.access,
    "--tag",
    releaseCandidate.distTag,
  ];
  if (releaseCandidate.provenanceRequired) args.push("--provenance");
  return args;
}

function registryObservationArgs(releaseCandidate) {
  return [
    "view",
    `${releaseCandidate.packageName}@${releaseCandidate.version}`,
    "version",
    "dist.integrity",
    "--registry",
    releaseCandidate.registry,
    "--json",
  ];
}

function parseRegistryObservation(result) {
  if (result.error || result.timedOut) {
    return { version: null, integrity: null, available: false, notFound: false };
  }
  if (result.status !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    const notFound = /\bE404\b|404 Not Found|is not in this registry/i.test(text);
    return { version: null, integrity: null, available: true, notFound };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { version: null, integrity: null, available: false, notFound: false };
  }
  if (typeof parsed === "string") {
    return { version: parsed, integrity: null, available: true, notFound: false };
  }
  const version = typeof parsed?.version === "string" ? parsed.version : null;
  const integrity = typeof parsed?.["dist.integrity"] === "string"
    ? parsed["dist.integrity"]
    : typeof parsed?.dist?.integrity === "string"
      ? parsed.dist.integrity
      : null;
  return { version, integrity, available: true, notFound: false };
}

function dispositionFromObservation(observation, releaseCandidate) {
  if (!observation.available) return "PUBLICATION_OUTCOME_UNKNOWN";
  if (observation.notFound) return "NOT_PUBLISHED";
  if (observation.version === releaseCandidate.version
    && observation.integrity === releaseCandidate.tarballIntegrity) {
    return "PUBLISHED_EXACT";
  }
  if (observation.version !== null || observation.integrity !== null) {
    return "PUBLISHED_DIFFERENT";
  }
  return "PUBLICATION_OUTCOME_UNKNOWN";
}

function publishAndReconcile({
  targetRoot,
  tarballPath,
  sliceAuthorization,
  releaseCandidate,
  publicationVerification,
  runner = defaultRunner,
  requestStartedAt = exactUtcNow(),
  observedAt = null,
}) {
  if (!publicationVerification
    || publicationVerification.schemaVersion !== "release-publication-verification/v1"
    || publicationVerification.releaseCandidateDigest !== releaseCandidate.releaseCandidateDigest
    || publicationVerification.tarballDigest !== releaseCandidate.tarballDigest
    || publicationVerification.tarballIntegrity !== releaseCandidate.tarballIntegrity
    || publicationVerification.npmPackInvocationCount !== 0) {
    throw contractError(
      "PUBLICATION_VERIFICATION_REQUIRED",
      "publish requires exact zero-rebuild release-publication-verification/v1",
    );
  }
  if (Date.parse(requestStartedAt) > Date.parse(sliceAuthorization.publicationPolicy.publishBy)) {
    throw contractError("PUBLICATION_DEADLINE", "publish request may not begin after publishBy");
  }
  if (sliceAuthorization.publicationPolicy.maxPublicationAttempts !== 1) {
    throw contractError("PUBLICATION_ATTEMPT_POLICY", "0.4 requires exactly one owner-authorized publication attempt");
  }

  const args = publishArgs(releaseCandidate, tarballPath);
  const commandIdentityDigest = domainDigest(PUBLISH_COMMAND_DOMAIN, {
    command: "npm",
    args,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    tarballDigest: releaseCandidate.tarballDigest,
  });
  const publishResult = runner("npm", args, { cwd: targetRoot, timeout: 180000 });

  const observationArgs = registryObservationArgs(releaseCandidate);
  const registryCommandDigest = domainDigest(REGISTRY_OBSERVATION_COMMAND_DOMAIN, {
    command: "npm",
    args: observationArgs,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
  });
  const registryResult = runner("npm", observationArgs, { cwd: targetRoot, timeout: 60000 });
  const registryObservation = parseRegistryObservation(registryResult);
  const disposition = dispositionFromObservation(registryObservation, releaseCandidate);
  const finalObservedAt = observedAt || exactUtcNow();

  const observation = {
    schemaVersion: "publication-observation/v1",
    sliceId: releaseCandidate.sliceId,
    generation: releaseCandidate.generation,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    registry: releaseCandidate.registry,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    requestedTarballDigest: releaseCandidate.tarballDigest,
    requestedTarballIntegrity: releaseCandidate.tarballIntegrity,
    commandIdentityDigest,
    requestStartedAt,
    processExitCode: Number.isInteger(publishResult.status) ? publishResult.status : null,
    processTimedOut: Boolean(publishResult.timedOut),
    processStdoutDigest: sha256Text(publishResult.stdout),
    processStderrDigest: sha256Text(publishResult.stderr),
    registryVersionObserved: registryObservation.version,
    registryIntegrityObserved: registryObservation.integrity,
    observedAt: finalObservedAt,
    disposition,
    observationDigest: "pending",
  };
  observation.observationDigest = computePublicationObservationDigest(observation);
  const validated = validatePublicationObservation(observation, releaseCandidate, sliceAuthorization);
  return Object.freeze({
    observation: validated,
    publishCommandIdentityDigest: commandIdentityDigest,
    registryObservationCommandIdentityDigest: registryCommandDigest,
    publishInvocationCount: 1,
    registryObservationCount: 1,
    localPublishExitCode: observation.processExitCode,
    localPublishTimedOut: observation.processTimedOut,
  });
}

module.exports = {
  PUBLISH_COMMAND_DOMAIN,
  REGISTRY_OBSERVATION_COMMAND_DOMAIN,
  defaultRunner,
  dispositionFromObservation,
  parseRegistryObservation,
  publishAndReconcile,
  publishArgs,
  registryObservationArgs,
};
