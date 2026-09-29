"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const {
  PROJECT_DECLARATION_RELATIVE_PATH,
  inspectProjectStartup,
  readProjectDeclaration,
} = require("./project-init");
const { pinProductDirection } = require("./product-direction");
const {
  computeRepoWorldDigest,
  computeWorldAttestationDigest,
  rawDigest,
  validateRepoWorld,
  validateWorldAttestation,
} = require("./world-attestation");
const { persistImmutableJson } = require("./world-authority");
const {
  WORLD_HEAD_SCHEMA,
  WORLD_TRANSITION_SCHEMA,
  commitTransition,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldHead,
  readCurrentWorldState,
  validateWorldTransition,
} = require("./world-transition");
const { runGit } = require("./work-git");

const DECLARED_PROJECTOR_SCHEMA = "declared-project-startup-projector/v1";
const DECLARED_PROJECTOR_DOMAIN = "meta-harness-declared-project-startup-projector/v1";
const DECLARED_WORLD_PAYLOAD_SCHEMA = "declared-project-startup-world/v1";
const REPAIRABLE_ATTESTATION_CODES = new Set([
  "MH_WORLD_ATTESTATION_DRIFT",
  "MH_WORLD_ATTESTATION_EXPIRED",
  "MH_WORLD_ATTESTATION_SOURCE",
  "MH_WORLD_ATTESTATION_TIME",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function sourceSummaryById(startup) {
  return new Map(startup.sources.map((source) => [source.id, source]));
}

function sourceObservation(repositoryPath, sourceId, relativePath, observedAt, validUntil) {
  const filePath = path.join(repositoryPath, ...relativePath.split("/"));
  return Object.freeze({
    type: "LOCAL_FILE",
    sourceId,
    path: relativePath,
    digest: rawDigest(fs.readFileSync(filePath)),
    observedAt,
    validUntil,
  });
}

function addDays(isoTimestamp, days) {
  return new Date(Date.parse(isoTimestamp) + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildDeclaredProjectProjection(repositoryPath, { now = new Date() } = {}) {
  const declaration = readProjectDeclaration(repositoryPath);
  if (!declaration) return null;
  const startup = inspectProjectStartup(repositoryPath, { nowMs: now.getTime() });
  if (!startup || startup.status !== "READY") {
    fail(
      "MH_PROJECT_WORLD_STARTUP",
      "declared startup context is not ready for semantic projection: "
        + ((startup && startup.blockers) || []).join("; "),
      { startup },
    );
  }

  const direction = pinProductDirection(repositoryPath);
  const payload = Object.freeze({
    declaredStartup: Object.freeze({
      schemaVersion: startup.schemaVersion,
      projectionSchemaVersion: DECLARED_WORLD_PAYLOAD_SCHEMA,
      lines: Object.freeze([...startup.lines]),
      sources: Object.freeze(startup.sources.map((source) => Object.freeze({ ...source }))),
    }),
  });
  const world = validateRepoWorld({
    schemaVersion: "repo-world/v2",
    productDirectionDigest: direction.digest,
    payload,
  });
  const worldDigest = computeRepoWorldDigest(world);

  const generatedAt = now.toISOString();
  const summaries = sourceSummaryById(startup);
  const observations = [
    sourceObservation(repositoryPath, "product-direction", "PRODUCT.md", generatedAt, null),
    sourceObservation(
      repositoryPath,
      "project-declaration",
      PROJECT_DECLARATION_RELATIVE_PATH,
      generatedAt,
      null,
    ),
  ];
  for (const source of declaration.sources) {
    const summary = summaries.get(source.id);
    if (!summary || !["present", "fresh"].includes(summary.status)) continue;
    const observedAt = summary.observedAt || generatedAt;
    const validUntil = source.freshness ? addDays(observedAt, source.freshness.maxAgeDays) : null;
    observations.push(sourceObservation(
      repositoryPath,
      "startup:" + source.id,
      source.path,
      observedAt,
      validUntil,
    ));
  }

  const declarationDigest = rawDigest(
    fs.readFileSync(path.join(repositoryPath, PROJECT_DECLARATION_RELATIVE_PATH)),
  );
  const projectorDigest = domainDigest(DECLARED_PROJECTOR_DOMAIN, {
    schemaVersion: DECLARED_PROJECTOR_SCHEMA,
    declarationDigest,
  });
  const attestationBody = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest,
    sources: observations,
    generatedAt,
  };
  const attestation = {
    ...attestationBody,
    attestationDigest: computeWorldAttestationDigest(attestationBody),
  };
  validateWorldAttestation(attestation, { repositoryPath, worldDigest, now });
  return Object.freeze({
    startup,
    world,
    worldDigest,
    attestation: Object.freeze(attestation),
    projectorDigest,
  });
}

function initialProductCommit(repositoryPath) {
  return String(
    runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout || "",
  ).trim();
}

function transitionForProjection(repositoryPath, current, projection) {
  const predecessorHeadDigest = current && current.head ? current.head.headDigest : null;
  const successorProductCommit = current && current.head
    ? current.head.productCommit
    : initialProductCommit(repositoryPath);
  const body = {
    schemaVersion: WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest,
    cause: {
      type: "REALITY_REFRESH",
      projectionDigest: computeWorldProjectionDigest(
        projection.worldDigest,
        projection.attestation.attestationDigest,
      ),
    },
    successorWorldDigest: projection.worldDigest,
    successorAttestationDigest: projection.attestation.attestationDigest,
    successorProductCommit,
  };
  return validateWorldTransition({
    ...body,
    transitionDigest: computeWorldTransitionDigest(body),
  });
}

function currentStateIfProjectionStillValid(repositoryPath, currentHead, projection, now) {
  if (!currentHead || currentHead.head.schemaVersion !== WORLD_HEAD_SCHEMA) return null;
  if (currentHead.head.worldDigest !== projection.worldDigest) return null;
  try {
    const state = readCurrentWorldState(repositoryPath, { now });
    return state.attestation.projectorDigest === projection.projectorDigest ? state : null;
  } catch (error) {
    if (!REPAIRABLE_ATTESTATION_CODES.has(error && error.code)) throw error;
    return null;
  }
}

function ensureDeclaredProjectWorld(repositoryPath, { now = () => new Date() } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observedAt = now();
    const projection = buildDeclaredProjectProjection(repositoryPath, { now: observedAt });
    if (!projection) return null;
    const currentHead = readCurrentWorldHead(repositoryPath, { optional: true });
    if (currentHead && currentHead.head.schemaVersion !== WORLD_HEAD_SCHEMA) {
      return null;
    }
    const current = currentStateIfProjectionStillValid(
      repositoryPath,
      currentHead,
      projection,
      observedAt,
    );
    if (current) return current;

    persistImmutableJson(
      repositoryPath,
      "worlds",
      projection.worldDigest,
      projection.world,
      "MH_PROJECT_WORLD_WRITE",
    );
    persistImmutableJson(
      repositoryPath,
      "attestations",
      projection.attestation.attestationDigest,
      projection.attestation,
      "MH_PROJECT_WORLD_WRITE",
    );
    try {
      commitTransition(
        repositoryPath,
        transitionForProjection(repositoryPath, currentHead, projection),
      );
      return readCurrentWorldState(repositoryPath, { now: observedAt });
    } catch (error) {
      if (!error || error.code !== "MH_WORLD_CONFLICT" || attempt === 1) throw error;
    }
  }
  fail("MH_PROJECT_WORLD_CONFLICT", "declared project World refresh did not converge");
}

module.exports = {
  DECLARED_PROJECTOR_DOMAIN,
  DECLARED_PROJECTOR_SCHEMA,
  DECLARED_WORLD_PAYLOAD_SCHEMA,
  buildDeclaredProjectProjection,
  ensureDeclaredProjectWorld,
};
