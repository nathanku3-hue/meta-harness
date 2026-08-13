"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { runGit } = require("./work-git");
const { validRelativePath } = require("./work-session");

const REPO_WORLD_SCHEMA = "repo-world/v2";
const REPO_WORLD_DOMAIN = "meta-harness-repo-world/v2";
const WORLD_ATTESTATION_SCHEMA = "world-attestation/v1";
const WORLD_ATTESTATION_DOMAIN = "meta-harness-world-attestation/v1";

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORLD_ATTESTATION_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORLD_ATTESTATION_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_WORLD_ATTESTATION_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_WORLD_ATTESTATION_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function computeRepoWorldDigest(value) {
  return domainDigest(REPO_WORLD_DOMAIN, value);
}

function validateRepoWorld(value) {
  exactKeys(value, ["schemaVersion", "productDirectionDigest", "payload"], "repoWorld");
  if (value.schemaVersion !== REPO_WORLD_SCHEMA) {
    fail("MH_REPO_WORLD_SCHEMA", `repoWorld.schemaVersion must be ${REPO_WORLD_SCHEMA}`);
  }
  requireDigest(value.productDirectionDigest, "repoWorld.productDirectionDigest");
  if (value.payload === undefined) fail("MH_REPO_WORLD_VALUE", "repoWorld.payload is required");
  try {
    JSON.stringify(value.payload);
  } catch (error) {
    fail("MH_REPO_WORLD_VALUE", `repoWorld.payload must be JSON-serializable: ${error.message}`);
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function attestationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.attestationDigest;
  return body;
}

function computeWorldAttestationDigest(value) {
  return domainDigest(WORLD_ATTESTATION_DOMAIN, attestationBody(value));
}

function parseTimestamp(value, label) {
  nonEmptyString(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("MH_WORLD_ATTESTATION_TIME", `${label} must be an ISO timestamp`);
  return parsed;
}

function verifyTimeWindow(source, label, nowMs) {
  const observedAt = parseTimestamp(source.observedAt, `${label}.observedAt`);
  if (source.validUntil !== null) {
    const validUntil = parseTimestamp(source.validUntil, `${label}.validUntil`);
    if (validUntil < observedAt) {
      fail("MH_WORLD_ATTESTATION_TIME", `${label}.validUntil must not precede observedAt`);
    }
    if (nowMs > validUntil) {
      fail("MH_WORLD_ATTESTATION_EXPIRED", `${label} attestation validity window has expired`, {
        validUntil: source.validUntil,
      });
    }
  }
}

function rawDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function insideRepository(repositoryPath, relativePath) {
  if (!validRelativePath(relativePath)) {
    fail("MH_WORLD_ATTESTATION_SOURCE", `invalid attested repository path: ${relativePath}`);
  }
  const root = path.resolve(repositoryPath);
  const target = path.resolve(root, ...relativePath.split("/"));
  const rootKey = process.platform === "win32" ? root.toLowerCase() : root;
  const targetKey = process.platform === "win32" ? target.toLowerCase() : target;
  if (targetKey !== rootKey && !targetKey.startsWith(`${rootKey}${path.sep}`)) {
    fail("MH_WORLD_ATTESTATION_SOURCE", `attested source escapes repository: ${relativePath}`);
  }
  return target;
}

function verifyLocalFile(repositoryPath, source, label) {
  exactKeys(source, ["type", "sourceId", "path", "digest", "observedAt", "validUntil"], label);
  nonEmptyString(source.sourceId, `${label}.sourceId`);
  const filePath = insideRepository(repositoryPath, nonEmptyString(source.path, `${label}.path`));
  requireDigest(source.digest, `${label}.digest`);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail("MH_WORLD_ATTESTATION_SOURCE", `attested local source is unreadable: ${source.path}: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("MH_WORLD_ATTESTATION_SOURCE", `attested local source must be a regular non-symlink file: ${source.path}`);
  }
  const live = rawDigest(fs.readFileSync(filePath));
  if (live !== source.digest) {
    fail("MH_WORLD_ATTESTATION_DRIFT", "attested local source digest no longer matches live bytes", {
      sourceId: source.sourceId,
      expected: source.digest,
      actual: live,
    });
  }
}

function verifyGitRef(repositoryPath, source, label) {
  exactKeys(source, ["type", "sourceId", "ref", "objectId", "observedAt", "validUntil"], label);
  nonEmptyString(source.sourceId, `${label}.sourceId`);
  nonEmptyString(source.ref, `${label}.ref`);
  if (typeof source.objectId !== "string" || !/^[a-f0-9]{40,64}$/u.test(source.objectId)) {
    fail("MH_WORLD_ATTESTATION_SOURCE", `${label}.objectId must be a Git object id`);
  }
  const resolved = runGit(repositoryPath, ["rev-parse", "--verify", `${source.ref}^{commit}`]);
  const live = String(resolved.stdout || "").trim().toLowerCase();
  if (live !== source.objectId) {
    fail("MH_WORLD_ATTESTATION_DRIFT", "attested Git ref identity no longer matches live repository", {
      sourceId: source.sourceId,
      expected: source.objectId,
      actual: live,
    });
  }
}

function verifyOpaque(source, label) {
  exactKeys(source, ["type", "sourceId", "identity", "observationDigest", "observedAt", "validUntil"], label);
  nonEmptyString(source.sourceId, `${label}.sourceId`);
  nonEmptyString(source.identity, `${label}.identity`);
  requireDigest(source.observationDigest, `${label}.observationDigest`);
}

function validateWorldAttestation(value, { repositoryPath, worldDigest, now = new Date() } = {}) {
  exactKeys(value, [
    "schemaVersion",
    "worldDigest",
    "projectorDigest",
    "sources",
    "generatedAt",
    "attestationDigest",
  ], "worldAttestation");
  if (value.schemaVersion !== WORLD_ATTESTATION_SCHEMA) {
    fail("MH_WORLD_ATTESTATION_SCHEMA", `worldAttestation.schemaVersion must be ${WORLD_ATTESTATION_SCHEMA}`);
  }
  requireDigest(value.worldDigest, "worldAttestation.worldDigest");
  requireDigest(value.projectorDigest, "worldAttestation.projectorDigest");
  parseTimestamp(value.generatedAt, "worldAttestation.generatedAt");
  if (worldDigest !== undefined && value.worldDigest !== worldDigest) {
    fail("MH_WORLD_ATTESTATION_WORLD", "WorldAttestation is not bound to the supplied World", {
      expected: worldDigest,
      actual: value.worldDigest,
    });
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    fail("MH_WORLD_ATTESTATION_SOURCE", "WorldAttestation must contain at least one source observation");
  }
  const nowMs = now.getTime();
  const ids = new Set();
  value.sources.forEach((source, index) => {
    const label = `worldAttestation.sources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      fail("MH_WORLD_ATTESTATION_SOURCE", `${label} must be an object`);
    }
    verifyTimeWindow(source, label, nowMs);
    if (source.type === "LOCAL_FILE") verifyLocalFile(repositoryPath, source, label);
    else if (source.type === "GIT_REF") verifyGitRef(repositoryPath, source, label);
    else if (source.type === "OPAQUE") verifyOpaque(source, label);
    else fail("MH_WORLD_ATTESTATION_SOURCE", `${label}.type must be LOCAL_FILE, GIT_REF, or OPAQUE`);
    if (ids.has(source.sourceId)) fail("MH_WORLD_ATTESTATION_SOURCE", `duplicate sourceId: ${source.sourceId}`);
    ids.add(source.sourceId);
  });
  requireDigest(value.attestationDigest, "worldAttestation.attestationDigest");
  const computed = computeWorldAttestationDigest(value);
  if (computed !== value.attestationDigest) {
    fail("MH_WORLD_ATTESTATION_DIGEST", "worldAttestation.attestationDigest does not match its body");
  }
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

module.exports = {
  REPO_WORLD_DOMAIN,
  REPO_WORLD_SCHEMA,
  WORLD_ATTESTATION_DOMAIN,
  WORLD_ATTESTATION_SCHEMA,
  computeRepoWorldDigest,
  computeWorldAttestationDigest,
  rawDigest,
  validateRepoWorld,
  validateWorldAttestation,
};
