"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../contracts/digest");
const { contractError } = require("./contract-utils");
const { exactUtcNow } = require("./clock");
const {
  computePublicationObservationDigest,
  validatePublicationObservation,
} = require("./publication");

const PUBLISH_COMMAND_DOMAIN = "meta-harness-publish-command/v2";
const REGISTRY_OBSERVATION_COMMAND_DOMAIN = "meta-harness-registry-observation-command/v2";

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

function githubTransportFromEnvironment(publicationIntent, env = process.env) {
  const required = [
    "GITHUB_REPOSITORY",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_EVENT_NAME",
    "GITHUB_EVENT_PATH",
    "GITHUB_SHA",
  ];
  if (env.GITHUB_ACTIONS !== "true") {
    throw contractError("PUBLICATION_GITHUB_ACTIONS_REQUIRED", "portable publication requires GitHub Actions");
  }
  for (const name of required) {
    if (typeof env[name] !== "string" || env[name].length === 0) {
      throw contractError("PUBLICATION_GITHUB_ENV_REQUIRED", `${name} is required for portable publication`);
    }
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch (error) {
    throw contractError("PUBLICATION_GITHUB_EVENT_INVALID", `GitHub release event payload is unreadable: ${error.message}`);
  }
  const releaseId = payload?.release?.id;
  const releaseTag = payload?.release?.tag_name;
  if (!Number.isSafeInteger(releaseId) || releaseId < 1 || typeof releaseTag !== "string" || releaseTag.length === 0) {
    throw contractError("PUBLICATION_GITHUB_RELEASE_INVALID", "GitHub event payload must contain release.id and release.tag_name");
  }
  const transport = {
    provider: "github-actions",
    repository: env.GITHUB_REPOSITORY,
    workflowFilename: publicationIntent.transport.workflowFilename,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    eventName: env.GITHUB_EVENT_NAME,
    releaseId,
    releaseTag,
    githubSha: env.GITHUB_SHA,
  };
  if (transport.repository !== publicationIntent.transport.repository
    || transport.eventName !== "release"
    || transport.releaseTag !== publicationIntent.gitTag
    || transport.githubSha !== publicationIntent.gitTagTargetRevision
    || transport.workflowSha !== publicationIntent.gitTagTargetRevision) {
    throw contractError("PUBLICATION_GITHUB_BINDING", "GitHub release or workflow revision differs from PublicationIntent");
  }
  const workflowNeedle = `${transport.repository}/.github/workflows/${transport.workflowFilename}@`;
  if (!transport.workflowRef.startsWith(workflowNeedle)) {
    throw contractError("PUBLICATION_GITHUB_WORKFLOW", "GitHub workflow ref differs from trusted publisher workflow");
  }
  return Object.freeze(transport);
}

function publishAndReconcile({
  targetRoot,
  tarballPath,
  sliceAuthorization,
  packageCandidate,
  releaseCandidate,
  terminalAssessment,
  publicationIntent,
  ownerPin,
  expectedOwnerKeyId,
  publicationVerification,
  transport,
  runner = defaultRunner,
  requestStartedAt = exactUtcNow(),
  observedAt = null,
}) {
  if (!publicationVerification
    || publicationVerification.schemaVersion !== "release-publication-intent-verification/v1"
    || publicationVerification.publicationIntentDigest !== publicationIntent.intentDigest
    || publicationVerification.releaseCandidateDigest !== releaseCandidate.releaseCandidateDigest
    || publicationVerification.tarballDigest !== releaseCandidate.tarballDigest
    || publicationVerification.tarballIntegrity !== releaseCandidate.tarballIntegrity
    || publicationVerification.npmPackInvocationCount !== 0) {
    throw contractError(
      "PUBLICATION_VERIFICATION_REQUIRED",
      "publish requires exact zero-rebuild release-publication-intent-verification/v1",
    );
  }
  if (Date.parse(requestStartedAt) > Date.parse(publicationIntent.publishBy)) {
    throw contractError("PUBLICATION_DEADLINE", "publish request may not begin after PublicationIntent.publishBy");
  }
  if (publicationIntent.publicationAttemptOrdinal !== 1) {
    throw contractError("PUBLICATION_ATTEMPT_POLICY", "portable publication requires the single locally reserved attempt");
  }

  const args = publishArgs(releaseCandidate, tarballPath);
  const commandIdentityDigest = domainDigest(PUBLISH_COMMAND_DOMAIN, {
    command: "npm",
    args,
    publicationIntentDigest: publicationIntent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    tarballDigest: releaseCandidate.tarballDigest,
    transport,
  });
  const publishResult = runner("npm", args, { cwd: targetRoot, timeout: 180000 });

  const observationArgs = registryObservationArgs(releaseCandidate);
  const registryCommandDigest = domainDigest(REGISTRY_OBSERVATION_COMMAND_DOMAIN, {
    command: "npm",
    args: observationArgs,
    publicationIntentDigest: publicationIntent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
  });
  const registryResult = runner("npm", observationArgs, { cwd: targetRoot, timeout: 60000 });
  const registryObservation = parseRegistryObservation(registryResult);
  const disposition = dispositionFromObservation(registryObservation, releaseCandidate);
  const finalObservedAt = observedAt || exactUtcNow();

  const observation = {
    schemaVersion: "publication-observation/v2",
    sliceId: releaseCandidate.sliceId,
    generation: releaseCandidate.generation,
    publicationIntentDigest: publicationIntent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    registry: releaseCandidate.registry,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    requestedTarballDigest: releaseCandidate.tarballDigest,
    requestedTarballIntegrity: releaseCandidate.tarballIntegrity,
    transport,
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
  const validated = validatePublicationObservation(
    observation,
    publicationIntent,
    releaseCandidate,
    sliceAuthorization,
    packageCandidate,
    terminalAssessment,
    ownerPin,
    expectedOwnerKeyId,
  );
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
  githubTransportFromEnvironment,
  parseRegistryObservation,
  publishAndReconcile,
  publishArgs,
  registryObservationArgs,
};
