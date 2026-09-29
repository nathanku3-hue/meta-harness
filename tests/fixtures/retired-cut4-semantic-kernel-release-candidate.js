"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const PACKAGE_CANDIDATE_SCHEMA = "package-candidate/v1";
const PACKAGE_CANDIDATE_DOMAIN = "meta-harness-package-candidate/v1";
const RELEASE_CANDIDATE_SCHEMA = "release-candidate/v1";
const RELEASE_CANDIDATE_DOMAIN = "meta-harness-release-candidate/v1";

function validateObjectId(value, label) {
  requireNonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw contractError("RELEASE_OBJECT_ID_INVALID", `${label} must be a lowercase Git object ID`);
  }
}

function packageBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.packageCandidateDigest;
  return body;
}

function releaseBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.releaseCandidateDigest;
  return body;
}

function computePackageCandidateDigest(value) {
  return domainDigest(PACKAGE_CANDIDATE_DOMAIN, packageBody(value));
}

function computeReleaseCandidateDigest(value) {
  return domainDigest(RELEASE_CANDIDATE_DOMAIN, releaseBody(value));
}

function validatePackageCandidate(value, integratedCandidate, sliceAuthorization, options = {}) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "integratedCandidateDigest",
    "candidateHead",
    "candidateTree",
    "tarballDigest",
    "tarballIntegrity",
    "tarballByteLength",
    "packlistDigest",
    "packageMetadataDigest",
    "packageName",
    "version",
    "builtAt",
    "builderProgramDigest",
    "packageCandidateDigest",
  ], "PackageCandidate");
  if (value.schemaVersion !== PACKAGE_CANDIDATE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `PackageCandidate schema must be ${PACKAGE_CANDIDATE_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "PackageCandidate.sliceId");
  requireInteger(value.generation, "PackageCandidate.generation", { min: 1 });
  for (const field of [
    "integratedCandidateDigest",
    "tarballDigest",
    "packlistDigest",
    "packageMetadataDigest",
    "builderProgramDigest",
    "packageCandidateDigest",
  ]) requireDigest(value[field], `PackageCandidate.${field}`);
  validateObjectId(value.candidateHead, "PackageCandidate.candidateHead");
  validateObjectId(value.candidateTree, "PackageCandidate.candidateTree");
  requireNonEmptyString(value.tarballIntegrity, "PackageCandidate.tarballIntegrity");
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.tarballIntegrity)) {
    throw contractError("PACKAGE_TARBALL_INTEGRITY_INVALID", "PackageCandidate tarballIntegrity must be canonical sha512 SRI");
  }
  requireInteger(value.tarballByteLength, "PackageCandidate.tarballByteLength", { min: 1 });
  requireNonEmptyString(value.packageName, "PackageCandidate.packageName");
  requireNonEmptyString(value.version, "PackageCandidate.version");
  requireExactUtc(value.builtAt, "PackageCandidate.builtAt");
  if (value.packageCandidateDigest !== computePackageCandidateDigest(value)) {
    throw contractError("PACKAGE_CANDIDATE_DIGEST_MISMATCH", "PackageCandidate digest does not match its body");
  }
  const expected = {
    sliceId: integratedCandidate.sliceId,
    generation: integratedCandidate.generation,
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    candidateHead: integratedCandidate.finalHeadRevision,
    candidateTree: integratedCandidate.finalTreeDigest,
    packageName: sliceAuthorization.publicationPolicy.packageName,
    version: sliceAuthorization.publicationPolicy.version,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("PACKAGE_CANDIDATE_BINDING_MISMATCH", `PackageCandidate.${field} does not match candidate or publication policy`);
    }
  }
  if (Date.parse(value.builtAt) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("PACKAGE_CANDIDATE_DEADLINE", "package candidate was built after mustCompleteBy");
  }
  if (options.observedTarballDigest && value.tarballDigest !== options.observedTarballDigest) {
    throw contractError("PACKAGE_TARBALL_DIGEST_MISMATCH", "existing tarball bytes differ from PackageCandidate");
  }
  if (options.observedTarballByteLength !== undefined && value.tarballByteLength !== options.observedTarballByteLength) {
    throw contractError("PACKAGE_TARBALL_LENGTH_MISMATCH", "existing tarball length differs from PackageCandidate");
  }
  return immutable(value);
}

function validateReleaseCandidate(value, packageCandidate, integratedCandidate, sliceAuthorization) {
  requireExactKeys(value, [
    "schemaVersion",
    "sliceId",
    "generation",
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "tarballDigest",
    "tarballIntegrity",
    "packageName",
    "version",
    "registry",
    "access",
    "distTag",
    "gitTag",
    "gitTagTargetRevision",
    "provenanceRequired",
    "canonicalUpdatePolicyDigest",
    "releaseCandidateDigest",
  ], "ReleaseCandidate");
  if (value.schemaVersion !== RELEASE_CANDIDATE_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `ReleaseCandidate schema must be ${RELEASE_CANDIDATE_SCHEMA}`);
  }
  requireNonEmptyString(value.sliceId, "ReleaseCandidate.sliceId");
  requireInteger(value.generation, "ReleaseCandidate.generation", { min: 1 });
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "integratedCandidateDigest",
    "packageCandidateDigest",
    "tarballDigest",
    "canonicalUpdatePolicyDigest",
    "releaseCandidateDigest",
  ]) requireDigest(value[field], `ReleaseCandidate.${field}`);
  for (const field of ["tarballIntegrity", "packageName", "version", "registry", "access", "distTag", "gitTag"]) {
    requireNonEmptyString(value[field], `ReleaseCandidate.${field}`);
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.tarballIntegrity)) {
    throw contractError("RELEASE_TARBALL_INTEGRITY_INVALID", "ReleaseCandidate tarballIntegrity must be canonical sha512 SRI");
  }
  validateObjectId(value.gitTagTargetRevision, "ReleaseCandidate.gitTagTargetRevision");
  requireBoolean(value.provenanceRequired, "ReleaseCandidate.provenanceRequired");
  if (value.releaseCandidateDigest !== computeReleaseCandidateDigest(value)) {
    throw contractError("RELEASE_CANDIDATE_DIGEST_MISMATCH", "ReleaseCandidate digest does not match its body");
  }
  const policy = sliceAuthorization.publicationPolicy;
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    tarballDigest: packageCandidate.tarballDigest,
    tarballIntegrity: packageCandidate.tarballIntegrity,
    packageName: policy.packageName,
    version: policy.version,
    registry: policy.registry,
    access: policy.access,
    distTag: policy.distTag,
    gitTag: policy.gitTag,
    gitTagTargetRevision: integratedCandidate.finalHeadRevision,
    provenanceRequired: policy.provenanceRequired,
    canonicalUpdatePolicyDigest: policy.canonicalUpdatePolicyDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("RELEASE_CANDIDATE_BINDING_MISMATCH", `ReleaseCandidate.${field} does not match the pre-authorized release`);
    }
  }
  if (sliceAuthorization.publicationPolicy.publishExactTerminalTarballOnly !== true) {
    throw contractError("RELEASE_TARBALL_POLICY", "release requires exact terminal tarball publication policy");
  }
  return immutable(value);
}

module.exports = {
  PACKAGE_CANDIDATE_DOMAIN,
  PACKAGE_CANDIDATE_SCHEMA,
  RELEASE_CANDIDATE_DOMAIN,
  RELEASE_CANDIDATE_SCHEMA,
  computePackageCandidateDigest,
  computeReleaseCandidateDigest,
  validatePackageCandidate,
  validateReleaseCandidate,
};
