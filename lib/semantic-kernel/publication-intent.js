"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireArray,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");

const PUBLICATION_INTENT_SCHEMA = "publication-intent/v1";
const PUBLICATION_INTENT_DOMAIN = "meta-harness-publication-intent/v1";
const PUBLICATION_ASSET_MANIFEST_DOMAIN = "meta-harness-publication-asset-manifest/v1";
const GITHUB_ACTIONS_PROVIDER = "github-actions";

const REQUIRED_SINGLETON_ROLES = Object.freeze(new Set([
  "owner-pin",
  "slice-authorization",
  "integrated-candidate",
  "package-candidate",
  "release-candidate",
  "tarball",
  "black-box-proof",
  "terminal-assessment",
]));
const REQUIRED_REPEATED_ROLES = Object.freeze({
  "run-spec": Object.freeze({ min: 1, max: 1000 }),
  "mechanics-assessment": Object.freeze({ min: 1, max: 1000 }),
  "reviewer-assessment": Object.freeze({ min: 3, max: 3 }),
});
const OPTIONAL_ROLES = Object.freeze(new Set(["supplemental-evidence"]));
const ALLOWED_ROLES = Object.freeze(new Set([
  ...REQUIRED_SINGLETON_ROLES,
  ...Object.keys(REQUIRED_REPEATED_ROLES),
  ...OPTIONAL_ROLES,
]));

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function intentBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.intentDigest;
  return body;
}

function computePublicationIntentDigest(value) {
  return domainDigest(PUBLICATION_INTENT_DOMAIN, intentBody(value));
}

function computePublicationAssetManifestDigest(assets) {
  return domainDigest(PUBLICATION_ASSET_MANIFEST_DOMAIN, assets);
}

function validateFilename(value, label) {
  requireNonEmptyString(value, label);
  if (path.basename(value) !== value
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")) {
    throw contractError("PUBLICATION_ASSET_FILENAME_INVALID", `${label} must be one portable basename`);
  }
}

function validateTransport(value) {
  requireExactKeys(value, ["provider", "repository", "workflowFilename"], "PublicationIntent.transport");
  if (value.provider !== GITHUB_ACTIONS_PROVIDER) {
    throw contractError("PUBLICATION_TRANSPORT_PROVIDER", `transport provider must be ${GITHUB_ACTIONS_PROVIDER}`);
  }
  requireNonEmptyString(value.repository, "PublicationIntent.transport.repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) {
    throw contractError("PUBLICATION_TRANSPORT_REPOSITORY", "transport repository must be owner/name");
  }
  validateFilename(value.workflowFilename, "PublicationIntent.transport.workflowFilename");
  if (!/\.ya?ml$/i.test(value.workflowFilename)) {
    throw contractError("PUBLICATION_TRANSPORT_WORKFLOW", "trusted publisher workflow filename must end in .yml or .yaml");
  }
}

function validatePublicationAssets(value) {
  const assets = requireArray(value, "PublicationIntent.assets", { min: 13, max: 3000 });
  const filenames = new Set();
  const roleCounts = new Map();
  let priorKey = null;
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    requireExactKeys(asset, ["role", "filename", "sha256", "bytes"], `PublicationIntent.assets[${index}]`);
    requireNonEmptyString(asset.role, `PublicationIntent.assets[${index}].role`);
    if (!ALLOWED_ROLES.has(asset.role)) {
      throw contractError("PUBLICATION_ASSET_ROLE_INVALID", `unsupported publication asset role: ${asset.role}`);
    }
    validateFilename(asset.filename, `PublicationIntent.assets[${index}].filename`);
    requireDigest(asset.sha256, `PublicationIntent.assets[${index}].sha256`);
    requireInteger(asset.bytes, `PublicationIntent.assets[${index}].bytes`, { min: 1 });
    if (filenames.has(asset.filename)) {
      throw contractError("PUBLICATION_ASSET_FILENAME_DUPLICATE", `duplicate publication asset filename: ${asset.filename}`);
    }
    filenames.add(asset.filename);
    roleCounts.set(asset.role, (roleCounts.get(asset.role) || 0) + 1);
    const key = `${asset.role}\u0000${asset.filename}`;
    if (priorKey !== null && key <= priorKey) {
      throw contractError("PUBLICATION_ASSET_ORDER", "publication assets must be strictly sorted by role then filename");
    }
    priorKey = key;
  }
  for (const role of REQUIRED_SINGLETON_ROLES) {
    if (roleCounts.get(role) !== 1) {
      throw contractError("PUBLICATION_ASSET_ROLE_COUNT", `publication asset role ${role} must occur exactly once`);
    }
  }
  for (const [role, bounds] of Object.entries(REQUIRED_REPEATED_ROLES)) {
    const count = roleCounts.get(role) || 0;
    if (count < bounds.min || count > bounds.max) {
      throw contractError(
        "PUBLICATION_ASSET_ROLE_COUNT",
        `publication asset role ${role} must occur between ${bounds.min} and ${bounds.max} times`,
      );
    }
  }
  return assets;
}

function createPublicationAssetManifest(entries) {
  const assets = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw contractError("PUBLICATION_ASSET_INPUT", `publication asset input ${index} must be an object`);
    }
    requireNonEmptyString(entry.role, `publication asset input ${index}.role`);
    requireNonEmptyString(entry.filePath, `publication asset input ${index}.filePath`);
    const absolute = path.resolve(entry.filePath);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      throw contractError("PUBLICATION_ASSET_UNREADABLE", `publication asset is unreadable: ${absolute}: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw contractError("PUBLICATION_ASSET_NOT_FILE", `publication asset must be a regular non-symlink file: ${absolute}`);
    }
    const bytes = fs.readFileSync(absolute);
    return {
      role: entry.role,
      filename: path.basename(absolute),
      sha256: sha256Bytes(bytes),
      bytes: bytes.length,
    };
  }).sort((left, right) => (
    `${left.role}\u0000${left.filename}`.localeCompare(`${right.role}\u0000${right.filename}`)
  ));
  validatePublicationAssets(assets);
  return immutable({
    assets,
    assetManifestDigest: computePublicationAssetManifestDigest(assets),
  });
}

function verifyPublicationAssetFiles({ assetRoot, publicationIntent }) {
  requireNonEmptyString(assetRoot, "assetRoot");
  const root = path.resolve(assetRoot);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    throw contractError("PUBLICATION_ASSET_ROOT", `publication asset root is unavailable: ${error.message}`);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw contractError("PUBLICATION_ASSET_ROOT", "publication asset root must be a non-symlink directory");
  }
  const observed = [];
  for (const asset of publicationIntent.assets) {
    const filePath = path.join(root, asset.filename);
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      throw contractError("PUBLICATION_ASSET_MISSING", `publication asset is missing: ${asset.filename}: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw contractError("PUBLICATION_ASSET_NOT_FILE", `publication asset must be a regular non-symlink file: ${asset.filename}`);
    }
    const bytes = fs.readFileSync(filePath);
    const digest = sha256Bytes(bytes);
    if (bytes.length !== asset.bytes || digest !== asset.sha256) {
      throw contractError("PUBLICATION_ASSET_MISMATCH", `publication asset bytes differ from intent: ${asset.filename}`);
    }
    observed.push(Object.freeze({ ...asset, filePath }));
  }
  return Object.freeze(observed);
}

function createPublicationIntent({
  sliceAuthorization,
  packageCandidate,
  releaseCandidate,
  terminalAssessment,
  terminalStateDigest,
  terminalOperationEventHead,
  publicationAttemptOrdinal,
  assetManifest,
  issuedAt,
}) {
  const policy = sliceAuthorization.publicationPolicy;
  const draft = {
    schemaVersion: PUBLICATION_INTENT_SCHEMA,
    repositoryId: sliceAuthorization.repositoryId,
    sliceId: sliceAuthorization.sliceId,
    generation: releaseCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    terminalAssessmentDigest: terminalAssessment.terminalAssessmentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    terminalStateDigest,
    terminalOperationEventHead,
    publicationAttemptOrdinal,
    transport: policy.trustedPublisher,
    gitTag: releaseCandidate.gitTag,
    gitTagTargetRevision: releaseCandidate.gitTagTargetRevision,
    tarballDigest: releaseCandidate.tarballDigest,
    tarballIntegrity: releaseCandidate.tarballIntegrity,
    tarballByteLength: packageCandidate.tarballByteLength,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    registry: releaseCandidate.registry,
    access: releaseCandidate.access,
    distTag: releaseCandidate.distTag,
    provenanceRequired: releaseCandidate.provenanceRequired,
    assets: assetManifest.assets,
    assetManifestDigest: assetManifest.assetManifestDigest,
    issuedAt,
    publishBy: policy.publishBy,
    intentDigest: "pending",
  };
  draft.intentDigest = computePublicationIntentDigest(draft);
  return validatePublicationIntent(draft, {
    sliceAuthorization,
    packageCandidate,
    releaseCandidate,
    terminalAssessment,
  });
}

function validatePublicationIntent(value, {
  sliceAuthorization,
  packageCandidate,
  releaseCandidate,
  terminalAssessment,
}) {
  requireExactKeys(value, [
    "schemaVersion",
    "repositoryId",
    "sliceId",
    "generation",
    "sliceAuthorizationDigest",
    "terminalAssessmentDigest",
    "releaseCandidateDigest",
    "terminalStateDigest",
    "terminalOperationEventHead",
    "publicationAttemptOrdinal",
    "transport",
    "gitTag",
    "gitTagTargetRevision",
    "tarballDigest",
    "tarballIntegrity",
    "tarballByteLength",
    "packageName",
    "version",
    "registry",
    "access",
    "distTag",
    "provenanceRequired",
    "assets",
    "assetManifestDigest",
    "issuedAt",
    "publishBy",
    "intentDigest",
  ], "PublicationIntent");
  if (value.schemaVersion !== PUBLICATION_INTENT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `PublicationIntent schema must be ${PUBLICATION_INTENT_SCHEMA}`);
  }
  for (const field of [
    "repositoryId",
    "sliceAuthorizationDigest",
    "terminalAssessmentDigest",
    "releaseCandidateDigest",
    "terminalStateDigest",
    "terminalOperationEventHead",
    "tarballDigest",
    "assetManifestDigest",
    "intentDigest",
  ]) requireDigest(value[field], `PublicationIntent.${field}`);
  requireNonEmptyString(value.sliceId, "PublicationIntent.sliceId");
  requireInteger(value.generation, "PublicationIntent.generation", { min: 1 });
  if (requireInteger(value.publicationAttemptOrdinal, "PublicationIntent.publicationAttemptOrdinal", { min: 1, max: 1 }) !== 1) {
    throw contractError("PUBLICATION_INTENT_ATTEMPT", "PublicationIntent must authorize exactly publication attempt 1");
  }
  validateTransport(value.transport);
  for (const field of [
    "gitTag",
    "gitTagTargetRevision",
    "tarballIntegrity",
    "packageName",
    "version",
    "registry",
    "access",
    "distTag",
  ]) requireNonEmptyString(value[field], `PublicationIntent.${field}`);
  requireInteger(value.tarballByteLength, "PublicationIntent.tarballByteLength", { min: 1 });
  requireBoolean(value.provenanceRequired, "PublicationIntent.provenanceRequired");
  const assets = validatePublicationAssets(value.assets);
  if (value.assetManifestDigest !== computePublicationAssetManifestDigest(assets)) {
    throw contractError("PUBLICATION_ASSET_MANIFEST_DIGEST", "PublicationIntent asset manifest digest does not match assets");
  }
  requireExactUtc(value.issuedAt, "PublicationIntent.issuedAt");
  requireExactUtc(value.publishBy, "PublicationIntent.publishBy");
  if (Date.parse(value.issuedAt) > Date.parse(value.publishBy)) {
    throw contractError("PUBLICATION_INTENT_DEADLINE", "PublicationIntent cannot be issued after publishBy");
  }
  const policy = sliceAuthorization.publicationPolicy;
  const expected = {
    repositoryId: sliceAuthorization.repositoryId,
    sliceId: sliceAuthorization.sliceId,
    generation: releaseCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    terminalAssessmentDigest: terminalAssessment.terminalAssessmentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    transport: policy.trustedPublisher,
    gitTag: releaseCandidate.gitTag,
    gitTagTargetRevision: releaseCandidate.gitTagTargetRevision,
    tarballDigest: releaseCandidate.tarballDigest,
    tarballIntegrity: releaseCandidate.tarballIntegrity,
    tarballByteLength: packageCandidate.tarballByteLength,
    packageName: releaseCandidate.packageName,
    version: releaseCandidate.version,
    registry: releaseCandidate.registry,
    access: releaseCandidate.access,
    distTag: releaseCandidate.distTag,
    provenanceRequired: releaseCandidate.provenanceRequired,
    publishBy: policy.publishBy,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actual = typeof expectedValue === "object" ? JSON.stringify(value[field]) : value[field];
    const normalizedExpected = typeof expectedValue === "object" ? JSON.stringify(expectedValue) : expectedValue;
    if (actual !== normalizedExpected) {
      throw contractError("PUBLICATION_INTENT_BINDING", `PublicationIntent.${field} differs from terminal release authority`);
    }
  }
  const tarballAsset = assets.find((asset) => asset.role === "tarball");
  if (tarballAsset.sha256 !== releaseCandidate.tarballDigest || tarballAsset.bytes !== packageCandidate.tarballByteLength) {
    throw contractError("PUBLICATION_INTENT_TARBALL", "PublicationIntent tarball asset differs from PackageCandidate");
  }
  if (value.intentDigest !== computePublicationIntentDigest(value)) {
    throw contractError("PUBLICATION_INTENT_DIGEST", "PublicationIntent digest does not match its body");
  }
  return immutable(value);
}

module.exports = {
  ALLOWED_ROLES,
  GITHUB_ACTIONS_PROVIDER,
  PUBLICATION_ASSET_MANIFEST_DOMAIN,
  PUBLICATION_INTENT_DOMAIN,
  PUBLICATION_INTENT_SCHEMA,
  computePublicationAssetManifestDigest,
  computePublicationIntentDigest,
  createPublicationAssetManifest,
  createPublicationIntent,
  validatePublicationAssets,
  validatePublicationIntent,
  verifyPublicationAssetFiles,
};
