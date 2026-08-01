"use strict";

const {
  assertSealedDigest,
  bodyWithout,
  contractError,
  immutable,
  requireArray,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
  requireOptionalString,
  requireSortedUniqueStrings,
  requireUniqueStrings,
  sealDigest,
  verifyEd25519Signature,
} = require("./contract-utils");

const SLICE_AUTHORIZATION_SCHEMA = "slice-authorization/v1";
const SLICE_ACCEPTANCE_DOMAIN = "meta-harness-slice-acceptance/v1";
const SLICE_AUTHORIZATION_DOMAIN = "meta-harness-slice-authorization/v1";
const SLICE_AUTHORIZATION_SIGNATURE_DOMAIN = "meta-harness-slice-authorization-signature/v1";

const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "repositoryId",
  "sliceId",
  "initialBaseRevision",
  "sliceMode",
  "authorityExecutionPlatform",
  "sliceAcceptance",
  "controllerBinding",
  "reviewPolicy",
  "executionLimits",
  "publicationPolicy",
  "ownerKeyId",
  "authorizationDigest",
  "ownerSignature",
]);

const ACCEPTANCE_KEYS = Object.freeze([
  "intent",
  "acceptanceSource",
  "acceptanceClauses",
  "quantitativeBounds",
  "productResult",
  "operatorUserFlow",
  "shippingTarget",
  "proofOracle",
]);

const REVIEW_ROLES = Object.freeze(["product", "domain", "custody"]);
const SLICE_MODES = Object.freeze(new Set(["DELIVERY", "CERTIFICATION"]));
const AUTHORITY_EXECUTION_PLATFORMS = Object.freeze(new Set(["linux"]));
const CONTROLLER_CAPABILITIES = Object.freeze(new Set([
  "SLICE_ACTIVATE",
  "RUN_SPEC_SEAL",
  "MECHANICS_ASSESS",
  "CERTIFICATION_PREPARE",
  "CERTIFICATION_ASSESS",
  "INTEGRATE",
  "PACKAGE_FREEZE",
  "PROOF_EXECUTE",
  "PUBLICATION_OBSERVE",
  "REVIEW_ORCHESTRATE",
  "TERMINAL_ASSESS",
  "SLICE_CLOSE",
  "CANONICAL_PROJECT",
]));
const EVALUATOR_KINDS = Object.freeze(new Set([
  "initial-base-artifact",
  "external-evaluator-package",
  "pre-existing-reviewer-a-artifact",
]));
const NETWORK_POLICIES = Object.freeze(new Set(["none", "registry-read-only", "explicit-allowlist"]));

function validateRevision(value, label) {
  requireNonEmptyString(value, label);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    throw contractError("SLICE_REVISION_INVALID", `${label} must be a 40- or 64-character lowercase Git object ID`);
  }
}

function validateIntent(value) {
  requireExactKeys(value, ["version", "digest"], "sliceAcceptance.intent");
  requireNonEmptyString(value.version, "sliceAcceptance.intent.version");
  requireDigest(value.digest, "sliceAcceptance.intent.digest");
}

function validateAcceptanceSource(value) {
  requireExactKeys(value, ["revision", "path", "contentDigest"], "sliceAcceptance.acceptanceSource");
  validateRevision(value.revision, "sliceAcceptance.acceptanceSource.revision");
  requireNonEmptyString(value.path, "sliceAcceptance.acceptanceSource.path");
  if (value.path.startsWith("/") || value.path.includes("\\") || value.path.split("/").includes("..")) {
    throw contractError("SLICE_ACCEPTANCE_PATH_INVALID", "acceptance source path must be repository-relative and normalized");
  }
  requireDigest(value.contentDigest, "sliceAcceptance.acceptanceSource.contentDigest");
}

function validateAcceptanceClauses(value) {
  const clauses = requireArray(value, "sliceAcceptance.acceptanceClauses", { min: 1, max: 1000 });
  const ids = new Set();
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    requireExactKeys(clause, ["clauseId", "verbatimText"], `acceptanceClauses[${index}]`);
    requireNonEmptyString(clause.clauseId, `acceptanceClauses[${index}].clauseId`);
    requireNonEmptyString(clause.verbatimText, `acceptanceClauses[${index}].verbatimText`);
    if (ids.has(clause.clauseId)) {
      throw contractError("SLICE_ACCEPTANCE_CLAUSE_DUPLICATE", `duplicate acceptance clause ID: ${clause.clauseId}`);
    }
    ids.add(clause.clauseId);
  }
  return ids;
}

function validateQuantitativeBounds(value, clauseIds) {
  const bounds = requireArray(value, "sliceAcceptance.quantitativeBounds", { min: 0, max: 1000 });
  const ids = new Set();
  for (let index = 0; index < bounds.length; index += 1) {
    const bound = bounds[index];
    requireExactKeys(bound, [
      "boundId",
      "clauseId",
      "subject",
      "measure",
      "distinctBy",
      "min",
      "max",
      "coherenceKey",
    ], `quantitativeBounds[${index}]`);
    requireNonEmptyString(bound.boundId, `quantitativeBounds[${index}].boundId`);
    requireNonEmptyString(bound.clauseId, `quantitativeBounds[${index}].clauseId`);
    if (!clauseIds.has(bound.clauseId)) {
      throw contractError("SLICE_BOUND_CLAUSE_UNKNOWN", `quantitative bound references unknown clause: ${bound.clauseId}`);
    }
    requireNonEmptyString(bound.subject, `quantitativeBounds[${index}].subject`);
    requireNonEmptyString(bound.measure, `quantitativeBounds[${index}].measure`);
    requireOptionalString(bound.distinctBy, `quantitativeBounds[${index}].distinctBy`);
    requireInteger(bound.min, `quantitativeBounds[${index}].min`);
    requireInteger(bound.max, `quantitativeBounds[${index}].max`);
    if (bound.max < bound.min) {
      throw contractError("SLICE_BOUND_RANGE_INVALID", `quantitativeBounds[${index}] max must be >= min`);
    }
    requireOptionalString(bound.coherenceKey, `quantitativeBounds[${index}].coherenceKey`);
    if (ids.has(bound.boundId)) {
      throw contractError("SLICE_BOUND_DUPLICATE", `duplicate quantitative bound ID: ${bound.boundId}`);
    }
    ids.add(bound.boundId);
  }
}

function validateProofOracle(value) {
  requireExactKeys(value, [
    "evaluatorKind",
    "evaluatorArtifactIdentity",
    "evaluatorArtifactDigest",
    "evaluatorPackageDigest",
    "predicateIds",
    "inputPolicyDigest",
    "observationSchemaDigest",
  ], "sliceAcceptance.proofOracle");
  if (!EVALUATOR_KINDS.has(value.evaluatorKind)) {
    throw contractError("SLICE_ORACLE_KIND_INVALID", `unsupported evaluator kind: ${value.evaluatorKind}`);
  }
  requireNonEmptyString(value.evaluatorArtifactIdentity, "proofOracle.evaluatorArtifactIdentity");
  requireDigest(value.evaluatorArtifactDigest, "proofOracle.evaluatorArtifactDigest");
  if (value.evaluatorKind === "external-evaluator-package") {
    requireDigest(value.evaluatorPackageDigest, "proofOracle.evaluatorPackageDigest");
  } else if (value.evaluatorPackageDigest !== null) {
    throw contractError("SLICE_ORACLE_PACKAGE_UNEXPECTED", "non-package evaluator must set evaluatorPackageDigest to null");
  }
  requireSortedUniqueStrings(value.predicateIds, "proofOracle.predicateIds", { min: 1, max: 1000 });
  requireDigest(value.inputPolicyDigest, "proofOracle.inputPolicyDigest");
  requireDigest(value.observationSchemaDigest, "proofOracle.observationSchemaDigest");
}

function computeSliceAcceptanceDigest(value) {
  return sealDigest(SLICE_ACCEPTANCE_DOMAIN, { acceptance: value, digest: "pending" }, "digest");
}

function validateSliceAcceptance(value) {
  requireExactKeys(value, ACCEPTANCE_KEYS, "sliceAcceptance");
  validateIntent(value.intent);
  validateAcceptanceSource(value.acceptanceSource);
  const clauseIds = validateAcceptanceClauses(value.acceptanceClauses);
  validateQuantitativeBounds(value.quantitativeBounds, clauseIds);
  requireNonEmptyString(value.productResult, "sliceAcceptance.productResult");
  requireUniqueStrings(value.operatorUserFlow, "sliceAcceptance.operatorUserFlow", { min: 1, max: 1000 });
  requireNonEmptyString(value.shippingTarget, "sliceAcceptance.shippingTarget");
  validateProofOracle(value.proofOracle);
  return immutable(value);
}

function validateControllerBinding(value) {
  requireExactKeys(value, [
    "controllerProgramDigest",
    "controllerPolicyDigest",
    "launcherDigest",
    "custodyRootPolicyDigest",
    "clockPolicyDigest",
    "allowedCapabilities",
  ], "controllerBinding");
  for (const field of [
    "controllerProgramDigest",
    "controllerPolicyDigest",
    "launcherDigest",
    "custodyRootPolicyDigest",
    "clockPolicyDigest",
  ]) requireDigest(value[field], `controllerBinding.${field}`);
  const capabilities = requireSortedUniqueStrings(value.allowedCapabilities, "controllerBinding.allowedCapabilities", { min: 1 });
  for (const capability of capabilities) {
    if (!CONTROLLER_CAPABILITIES.has(capability)) {
      throw contractError("SLICE_CONTROLLER_CAPABILITY_INVALID", `unsupported controller capability: ${capability}`);
    }
  }
}

function validateReviewerRole(value, role) {
  requireExactKeys(value, [
    "executableIdentity",
    "executableDigest",
    "policyDigest",
    "environmentPolicyDigest",
    "networkPolicy",
  ], `reviewPolicy.${role}`);
  requireNonEmptyString(value.executableIdentity, `reviewPolicy.${role}.executableIdentity`);
  if (value.executableIdentity.startsWith("/") || value.executableIdentity.includes("\\") || value.executableIdentity.split("/").includes("..")) {
    throw contractError("SLICE_REVIEW_EXECUTABLE_IDENTITY_INVALID", `${role} executable identity must be repository-relative and normalized`);
  }
  requireDigest(value.executableDigest, `reviewPolicy.${role}.executableDigest`);
  requireDigest(value.policyDigest, `reviewPolicy.${role}.policyDigest`);
  requireDigest(value.environmentPolicyDigest, `reviewPolicy.${role}.environmentPolicyDigest`);
  if (!NETWORK_POLICIES.has(value.networkPolicy)) {
    throw contractError("SLICE_REVIEW_NETWORK_POLICY_INVALID", `unsupported ${role} network policy: ${value.networkPolicy}`);
  }
}

function validateReviewPolicy(value) {
  requireExactKeys(value, REVIEW_ROLES, "reviewPolicy");
  for (const role of REVIEW_ROLES) validateReviewerRole(value[role], role);
  const executables = REVIEW_ROLES.map((role) => value[role].executableDigest);
  if (new Set(executables).size !== executables.length) {
    throw contractError("SLICE_REVIEW_EXECUTABLE_REUSE", "Reviewer A/B/C executable digests must be distinct");
  }
}

function validatePathBoundary(paths) {
  const values = requireSortedUniqueStrings(paths, "executionLimits.aggregatePathBoundary", { min: 1, max: 10000 });
  for (const value of values) {
    if (value.startsWith("/") || value.includes("\\") || value.split("/").includes("..") || value === ".git" || value.startsWith(".git/")) {
      throw contractError("SLICE_PATH_BOUNDARY_INVALID", `invalid aggregate path boundary: ${value}`);
    }
  }
}

function validateExecutionLimits(value) {
  requireExactKeys(value, [
    "issuedAt",
    "expiresAt",
    "mustCompleteBy",
    "maxAttempts",
    "maxRunSpecs",
    "aggregatePathBoundary",
    "allowedWorkerProfiles",
  ], "executionLimits");
  requireExactUtc(value.issuedAt, "executionLimits.issuedAt");
  requireExactUtc(value.expiresAt, "executionLimits.expiresAt");
  requireExactUtc(value.mustCompleteBy, "executionLimits.mustCompleteBy");
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    throw contractError("SLICE_ACTIVATION_WINDOW_INVALID", "expiresAt must follow issuedAt");
  }
  if (Date.parse(value.mustCompleteBy) <= Date.parse(value.expiresAt)) {
    throw contractError("SLICE_COMPLETION_WINDOW_INVALID", "mustCompleteBy must follow expiresAt");
  }
  requireInteger(value.maxAttempts, "executionLimits.maxAttempts", { min: 1, max: 100000 });
  requireInteger(value.maxRunSpecs, "executionLimits.maxRunSpecs", { min: 1, max: 100000 });
  validatePathBoundary(value.aggregatePathBoundary);
  requireSortedUniqueStrings(value.allowedWorkerProfiles, "executionLimits.allowedWorkerProfiles", { min: 1, max: 1000 });
}

function validatePublicationPolicy(value) {
  requireExactKeys(value, [
    "packageName",
    "version",
    "registry",
    "access",
    "distTag",
    "gitTag",
    "provenanceRequired",
    "publishExactTerminalTarballOnly",
    "maxPublicationAttempts",
    "publishBy",
    "canonicalUpdatePolicyDigest",
  ], "publicationPolicy");
  for (const field of ["packageName", "version", "registry", "access", "distTag", "gitTag"]) {
    requireNonEmptyString(value[field], `publicationPolicy.${field}`);
  }
  requireBoolean(value.provenanceRequired, "publicationPolicy.provenanceRequired");
  if (requireBoolean(value.publishExactTerminalTarballOnly, "publicationPolicy.publishExactTerminalTarballOnly") !== true) {
    throw contractError("SLICE_PUBLICATION_TARBALL_POLICY", "publishExactTerminalTarballOnly must be true");
  }
  if (requireInteger(value.maxPublicationAttempts, "publicationPolicy.maxPublicationAttempts", { min: 1, max: 1 }) !== 1) {
    throw contractError("SLICE_PUBLICATION_ATTEMPTS", "0.4 permits exactly one publish attempt per authorization");
  }
  requireExactUtc(value.publishBy, "publicationPolicy.publishBy");
  requireDigest(value.canonicalUpdatePolicyDigest, "publicationPolicy.canonicalUpdatePolicyDigest");
}

function authorizationBody(value) {
  return bodyWithout(value, ["authorizationDigest", "ownerSignature"]);
}

function authorizationSigningBody(value) {
  return bodyWithout(value, ["ownerSignature"]);
}

function computeSliceAuthorizationDigest(value) {
  return sealDigest(SLICE_AUTHORIZATION_DOMAIN, value, "authorizationDigest", ["ownerSignature"]);
}

function validateSliceAuthorization(value, ownerPin, options = {}) {
  requireExactKeys(value, TOP_KEYS, "SliceAuthorization");
  if (value.schemaVersion !== SLICE_AUTHORIZATION_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `SliceAuthorization schema must be ${SLICE_AUTHORIZATION_SCHEMA}`);
  }
  requireDigest(value.repositoryId, "SliceAuthorization.repositoryId");
  requireNonEmptyString(value.sliceId, "SliceAuthorization.sliceId");
  validateRevision(value.initialBaseRevision, "SliceAuthorization.initialBaseRevision");
  validateSliceAcceptance(value.sliceAcceptance);
  validateControllerBinding(value.controllerBinding);
  validateReviewPolicy(value.reviewPolicy);
  validateExecutionLimits(value.executionLimits);
  requireDigest(value.ownerKeyId, "SliceAuthorization.ownerKeyId");
  if (!SLICE_MODES.has(value.sliceMode)) {
    throw contractError("SLICE_MODE_INVALID", "SliceAuthorization.sliceMode must be DELIVERY or CERTIFICATION");
  }
  if (!AUTHORITY_EXECUTION_PLATFORMS.has(value.authorityExecutionPlatform)) {
    throw contractError(
      "SLICE_AUTHORITY_EXECUTION_PLATFORM_INVALID",
      "SliceAuthorization.authorityExecutionPlatform must be linux for Meta-Harness 0.4",
    );
  }
  if (value.sliceMode === "DELIVERY") {
    if (value.sliceAcceptance.shippingTarget !== "installed-package") {
      throw contractError("SLICE_DELIVERY_TARGET_INVALID", "DELIVERY requires shippingTarget installed-package");
    }
    validatePublicationPolicy(value.publicationPolicy);
  } else {
    if (value.sliceAcceptance.shippingTarget !== "repository-application") {
      throw contractError("SLICE_CERTIFICATION_TARGET_INVALID", "CERTIFICATION requires shippingTarget repository-application");
    }
    if (value.publicationPolicy !== null) {
      throw contractError("SLICE_CERTIFICATION_PUBLICATION_FORBIDDEN", "CERTIFICATION must set publicationPolicy to null");
    }
  }
  requireNonEmptyString(value.ownerSignature, "SliceAuthorization.ownerSignature");
  assertSealedDigest(
    SLICE_AUTHORIZATION_DOMAIN,
    value,
    "authorizationDigest",
    ["ownerSignature"],
    "SliceAuthorization",
  );

  if (!ownerPin || value.repositoryId !== ownerPin.repositoryId) {
    throw contractError("SLICE_AUTHORIZATION_REPOSITORY_MISMATCH", "SliceAuthorization repository does not match external owner pin");
  }
  if (value.ownerKeyId !== ownerPin.ownerKeyId) {
    throw contractError("SLICE_AUTHORIZATION_OWNER_MISMATCH", "SliceAuthorization owner key does not match external owner pin");
  }
  verifyEd25519Signature({
    domain: SLICE_AUTHORIZATION_SIGNATURE_DOMAIN,
    body: authorizationSigningBody(value),
    signature: value.ownerSignature,
    publicKeyJwk: ownerPin.ownerPublicKey,
    label: "SliceAuthorization",
  });

  if (options.repositoryId && value.repositoryId !== options.repositoryId) {
    throw contractError("SLICE_AUTHORIZATION_REPOSITORY_MISMATCH", "SliceAuthorization does not match resolved repository identity");
  }
  if (options.initialBaseRevision && value.initialBaseRevision !== options.initialBaseRevision) {
    throw contractError("SLICE_AUTHORIZATION_BASE_MISMATCH", "SliceAuthorization does not match the exact initial base");
  }
  return immutable(value);
}

module.exports = {
  ACCEPTANCE_KEYS,
  AUTHORITY_EXECUTION_PLATFORMS,
  CONTROLLER_CAPABILITIES,
  EVALUATOR_KINDS,
  NETWORK_POLICIES,
  REVIEW_ROLES,
  SLICE_MODES,
  SLICE_ACCEPTANCE_DOMAIN,
  SLICE_AUTHORIZATION_DOMAIN,
  SLICE_AUTHORIZATION_SCHEMA,
  SLICE_AUTHORIZATION_SIGNATURE_DOMAIN,
  authorizationBody,
  authorizationSigningBody,
  computeSliceAcceptanceDigest,
  computeSliceAuthorizationDigest,
  validateSliceAcceptance,
  validateSliceAuthorization,
};
