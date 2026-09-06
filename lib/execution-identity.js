"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const TOOL_SURFACE_SCHEMA = "tool-surface/v1";
const TOOL_SURFACE_DOMAIN = "meta-harness-tool-surface/v1";
const ATTEMPT_INPUT_DOMAIN = "meta-harness-attempt-input/v1";
const VALIDATION_ENVIRONMENT_SCHEMA = "validation-environment/v1";
const VALIDATION_ENVIRONMENT_DOMAIN = "meta-harness-validation-environment/v1";
const VALIDATION_KEY_DOMAIN = "meta-harness-validation-key/v1";
const VALIDATION_ISOLATION = "linux-user-mount-net-pid-chroot/v1";
const OID_RE = /^[a-f0-9]{40,64}$/u;

function fail(code, message) {
  throw new ConfigError(message, { code });
}

function requireDigest(value, label) {
  if (!isDigest(value)) fail("MH_EXECUTION_IDENTITY_DIGEST", `${label} must be a sha256 digest`);
  return value;
}

function requireOid(value, label) {
  const oid = String(value || "").trim();
  if (!OID_RE.test(oid)) fail("MH_EXECUTION_IDENTITY_OID", `${label} must be a Git object id`);
  return oid;
}

function toolSurfaceDescriptor(session, workspaceMode = "isolated") {
  if (!session || typeof session !== "object") fail("MH_EXECUTION_IDENTITY_SESSION", "tool surface requires a sealed work session");
  if (!Array.isArray(session.allowedPaths) || session.allowedPaths.length === 0) {
    fail("MH_EXECUTION_IDENTITY_SESSION", "tool surface requires non-empty allowedPaths");
  }
  return Object.freeze({
    schemaVersion: TOOL_SURFACE_SCHEMA,
    workspaceMode: String(workspaceMode || "isolated"),
    modelOperations: Object.freeze([
      "READ_REPOSITORY",
      "PROPOSE_WRITE",
      "PROPOSE_DELETE",
      "PROPOSE_MOVE",
    ]),
    controllerOperations: Object.freeze([
      "MATERIALIZE_SCOPED_CHANGE",
      "SNAPSHOT_IMMUTABLE_GIT_STATE",
      "VALIDATE_CANDIDATE",
      "BANK_LOCAL_RESULT",
    ]),
    allowedPaths: Object.freeze([...session.allowedPaths]),
  });
}

function toolSurfaceDigest(session, workspaceMode = "isolated") {
  return domainDigest(TOOL_SURFACE_DOMAIN, toolSurfaceDescriptor(session, workspaceMode));
}

function outcomeInput(session) {
  if (!session?.productDirection?.digest || !isDigest(session.productDirection.digest)) {
    fail("MH_EXECUTION_IDENTITY_SESSION", "attempt identity requires a pinned product-direction digest");
  }
  return {
    productDirectionDigest: session.productDirection.digest,
    origin: session.origin,
    productResult: session.productResult,
    journeyState: session.journeyState,
    doNow: session.doNow,
    newlyTrueBehavior: session.newlyTrueBehavior,
    doneWhen: session.doneWhen,
    stopOnlyIf: session.stopOnlyIf,
    allowedPaths: session.allowedPaths,
    productProofSpecDigest: session.productProofSpec?.specDigest || null,
  };
}

function attemptInputKey({
  session,
  snapshotTreeOid,
  runtimeCapabilityDigest,
  workspaceMode = "isolated",
}) {
  const runtimeDigest = requireDigest(runtimeCapabilityDigest, "runtimeCapabilityDigest");
  const snapshot = requireOid(snapshotTreeOid, "snapshotTreeOid");
  const surfaceDigest = toolSurfaceDigest(session, workspaceMode);
  return domainDigest(ATTEMPT_INPUT_DOMAIN, {
    outcome: outcomeInput(session),
    snapshotTreeOid: snapshot,
    toolSurfaceDigest: surfaceDigest,
    runtimeCapabilityDigest: runtimeDigest,
  });
}

function validationEnvironmentDescriptor(runtimeCapabilityDigest) {
  return Object.freeze({
    schemaVersion: VALIDATION_ENVIRONMENT_SCHEMA,
    verifier: "candidate-verification/v1",
    isolation: VALIDATION_ISOLATION,
    runtimeCapabilityDigest: requireDigest(runtimeCapabilityDigest, "runtimeCapabilityDigest"),
  });
}

function validationEnvironmentDigest(runtimeCapabilityDigest) {
  return domainDigest(
    VALIDATION_ENVIRONMENT_DOMAIN,
    validationEnvironmentDescriptor(runtimeCapabilityDigest),
  );
}

function validationKey({ candidateTreeOid, validation, validationEnvironmentDigest: environmentDigest }) {
  if (!Array.isArray(validation)) fail("MH_EXECUTION_IDENTITY_VALIDATION", "validation must be an array");
  return domainDigest(VALIDATION_KEY_DOMAIN, {
    candidateTreeOid: requireOid(candidateTreeOid, "candidateTreeOid"),
    validation: JSON.parse(JSON.stringify(validation)),
    validationEnvironmentDigest: requireDigest(environmentDigest, "validationEnvironmentDigest"),
  });
}

module.exports = {
  ATTEMPT_INPUT_DOMAIN,
  TOOL_SURFACE_DOMAIN,
  TOOL_SURFACE_SCHEMA,
  VALIDATION_ENVIRONMENT_DOMAIN,
  VALIDATION_ENVIRONMENT_SCHEMA,
  VALIDATION_ISOLATION,
  VALIDATION_KEY_DOMAIN,
  attemptInputKey,
  toolSurfaceDescriptor,
  toolSurfaceDigest,
  validationEnvironmentDescriptor,
  validationEnvironmentDigest,
  validationKey,
};
