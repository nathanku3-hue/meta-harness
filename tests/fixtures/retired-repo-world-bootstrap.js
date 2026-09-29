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
const { persistImmutableJson, readImmutableJson } = require("./world-authority");
const { runGit } = require("./work-git");

const DECLARED_STARTUP_PROJECTOR_DOMAIN = "meta-harness-declared-startup-projector/v1";
const DECLARED_STARTUP_PROJECTOR_SCHEMA = "declared-startup-projector/v1";
const REFRESHABLE_ATTESTATION_ERRORS = new Set([
  "MH_WORLD_ATTESTATION_DRIFT",
  "MH_WORLD_ATTESTATION_EXPIRED",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function declarationBytes(repositoryPath) {
  const filePath = path.join(repositoryPath, PROJECT_DECLARATION_RELATIVE_PATH);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail("MH_WORLD_BOOTSTRAP_CONTEXT", `${PROJECT_DECLARATION_RELATIVE_PATH} is required for declared startup World bootstrap: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_WORLD_BOOTSTRAP_CONTEXT", `${PROJECT_DECLARATION_RELATIVE_PATH} must be a regular non-symlink file`);
  }
  return fs.readFileSync(filePath);
}

function declaredStartupProjectorDigest(repositoryPath) {
  return domainDigest(DECLARED_STARTUP_PROJECTOR_DOMAIN, {
    schemaVersion: DECLARED_STARTUP_PROJECTOR_SCHEMA,
    declarationDigest: rawDigest(declarationBytes(repositoryPath)),
  });
}

function sourceFile(repositoryPath, relativePath) {
  return path.join(repositoryPath, ...relativePath.split("/"));
}

function fileObservedAt(repositoryPath, relativePath) {
  return fs.statSync(sourceFile(repositoryPath, relativePath)).mtime.toISOString();
}

function localSourceObservation(repositoryPath, sourceId, relativePath, observedAt, validUntil) {
  const filePath = sourceFile(repositoryPath, relativePath);
  return Object.freeze({
    type: "LOCAL_FILE",
    sourceId,
    path: relativePath,
    digest: rawDigest(fs.readFileSync(filePath)),
    observedAt,
    validUntil,
  });
}

function opaqueSourceObservation(repositoryPath, sourceId, relativePath, observedAt, validUntil) {
  const filePath = sourceFile(repositoryPath, relativePath);
  return Object.freeze({
    type: "OPAQUE",
    sourceId,
    identity: `repo-startup:${relativePath}`,
    observationDigest: rawDigest(fs.readFileSync(filePath)),
    observedAt,
    validUntil,
  });
}

function currentProductCommit(repositoryPath) {
  const result = runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const commit = String(result.stdout || "").trim();
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    fail("MH_WORLD_BOOTSTRAP_PRODUCT", "cannot resolve an exact Git commit for the initial World product snapshot");
  }
  return commit;
}

function buildDeclaredStartupProjection(repositoryPath, now) {
  const startup = inspectProjectStartup(repositoryPath, { nowMs: now.getTime() });
  if (!startup) {
    fail("MH_WORLD_BOOTSTRAP_CONTEXT", "repo planning has no declared startup context to seed the semantic World projection");
  }
  if (startup.status !== "READY") {
    fail("MH_WORLD_BOOTSTRAP_CONTEXT", "declared startup context is not READY", {
      blockers: [...startup.blockers],
    });
  }

  const declaration = readProjectDeclaration(repositoryPath);
  const productDirection = pinProductDirection(repositoryPath);
  const sourceSummaries = new Map(startup.sources.map((source) => [source.id, source]));
  const sources = [
    localSourceObservation(
      repositoryPath,
      "product-direction",
      "PRODUCT.md",
      fileObservedAt(repositoryPath, "PRODUCT.md"),
      null,
    ),
    localSourceObservation(
      repositoryPath,
      "project-declaration",
      PROJECT_DECLARATION_RELATIVE_PATH,
      fileObservedAt(repositoryPath, PROJECT_DECLARATION_RELATIVE_PATH),
      null,
    ),
  ];

  for (const declared of declaration.sources) {
    const summary = sourceSummaries.get(declared.id);
    if (!summary || !["present", "fresh"].includes(summary.status)) continue;
    const observedAt = summary.observedAt || fileObservedAt(repositoryPath, declared.path);
    const validUntil = declared.freshness && summary.observedAt
      ? new Date(Date.parse(summary.observedAt) + declared.freshness.maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    sources.push(opaqueSourceObservation(
      repositoryPath,
      `startup:${declared.id}`,
      declared.path,
      observedAt,
      validUntil,
    ));
  }

  const world = validateRepoWorld({
    schemaVersion: "repo-world/v2",
    productDirectionDigest: productDirection.digest,
    payload: {
      declaredStartup: {
        schemaVersion: startup.schemaVersion,
        lines: [...startup.lines],
        sources: startup.sources.map((source) => ({ ...source })),
      },
    },
  });
  const worldDigest = computeRepoWorldDigest(world);
  const generatedAt = new Date(Math.max(...sources.map((source) => Date.parse(source.observedAt)))).toISOString();
  const attestationBody = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: declaredStartupProjectorDigest(repositoryPath),
    sources,
    generatedAt,
  };
  const attestation = validateWorldAttestation({
    ...attestationBody,
    attestationDigest: computeWorldAttestationDigest(attestationBody),
  }, {
    repositoryPath,
    worldDigest,
    now,
  });

  return Object.freeze({
    startup,
    world,
    worldDigest,
    attestation,
  });
}

function transitionForProjection(repositoryPath, predecessorHead, projection) {
  const worldTransition = require("./world-transition");
  const body = {
    schemaVersion: worldTransition.WORLD_TRANSITION_SCHEMA,
    predecessorHeadDigest: predecessorHead?.headDigest || null,
    cause: {
      type: "REALITY_REFRESH",
      projectionDigest: worldTransition.computeWorldProjectionDigest(
        projection.worldDigest,
        projection.attestation.attestationDigest,
      ),
    },
    successorWorldDigest: projection.worldDigest,
    successorAttestationDigest: projection.attestation.attestationDigest,
    successorProductCommit: predecessorHead?.productCommit || currentProductCommit(repositoryPath),
  };
  return worldTransition.validateWorldTransition({
    ...body,
    transitionDigest: worldTransition.computeWorldTransitionDigest(body),
  });
}

function commitDeclaredStartupProjection(repositoryPath, predecessorHead, projection) {
  const worldTransition = require("./world-transition");
  persistImmutableJson(
    repositoryPath,
    "worlds",
    projection.worldDigest,
    projection.world,
    "MH_WORLD_BOOTSTRAP_WORLD",
  );
  persistImmutableJson(
    repositoryPath,
    "attestations",
    projection.attestation.attestationDigest,
    projection.attestation,
    "MH_WORLD_BOOTSTRAP_ATTESTATION",
  );
  return worldTransition.commitTransition(
    repositoryPath,
    transitionForProjection(repositoryPath, predecessorHead, projection),
  );
}

function ensureDeclaredStartupWorld(repositoryPath, { now = () => new Date() } = {}) {
  const worldTransition = require("./world-transition");
  let current;
  try {
    current = worldTransition.readCurrentWorldState(repositoryPath, {
      now: now(),
      optional: true,
    });
  } catch (error) {
    if (!REFRESHABLE_ATTESTATION_ERRORS.has(error?.code)) throw error;
    const head = worldTransition.readCurrentWorldHead(repositoryPath);
    const attestation = readImmutableJson(repositoryPath, "attestations", head.head.attestationDigest);
    if (attestation?.projectorDigest !== declaredStartupProjectorDigest(repositoryPath)) {
      throw error;
    }
    current = null;
  }
  const head = worldTransition.readCurrentWorldHead(repositoryPath, { optional: true })?.head || null;
  if (current) {
    if (current.attestation.projectorDigest !== declaredStartupProjectorDigest(repositoryPath)) return current;
    const projection = buildDeclaredStartupProjection(repositoryPath, now());
    if (projection.worldDigest === current.head.worldDigest
        && projection.attestation.attestationDigest === current.head.attestationDigest) {
      return current;
    }
    try {
      commitDeclaredStartupProjection(repositoryPath, current.head, projection);
    } catch (error) {
      if (error?.code !== "MH_WORLD_CONFLICT") throw error;
    }
    return worldTransition.readCurrentWorldState(repositoryPath, { now: now() });
  }

  if (head && head.schemaVersion !== worldTransition.WORLD_HEAD_SCHEMA) {
    return worldTransition.readCurrentWorldState(repositoryPath, { now: now() });
  }

  const projection = buildDeclaredStartupProjection(repositoryPath, now());
  try {
    commitDeclaredStartupProjection(repositoryPath, head, projection);
  } catch (error) {
    if (error?.code !== "MH_WORLD_CONFLICT") throw error;
  }
  return worldTransition.readCurrentWorldState(repositoryPath, { now: now() });
}

module.exports = {
  DECLARED_STARTUP_PROJECTOR_DOMAIN,
  DECLARED_STARTUP_PROJECTOR_SCHEMA,
  buildDeclaredStartupProjection,
  declaredStartupProjectorDigest,
  ensureDeclaredStartupWorld,
};
