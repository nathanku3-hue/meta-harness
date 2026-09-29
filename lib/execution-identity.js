"use strict";

const crypto = require("node:crypto");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const TOOL_SURFACE_SCHEMA = "tool-surface/v1";
const TOOL_SURFACE_DOMAIN = "meta-harness-tool-surface/v1";
const ATTEMPT_INPUT_DOMAIN = "meta-harness-attempt-input/v1";
const MODEL_COMMAND_SCHEMA = "model-command/v1";
const MODEL_COMMAND_DOMAIN = "meta-harness-model-command/v1";
const MODEL_REQUEST_DOMAIN = "meta-harness-model-request/v1";
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

function bytesDigest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function adapterDescriptor(adapter) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.identity !== "string" || adapter.identity.trim() === "") {
    fail("MH_MODEL_COMMAND_ADAPTER", "model command requires a resolved adapter identity");
  }
  return Object.freeze({
    identity: adapter.identity,
    executable: typeof adapter.executable === "string" ? adapter.executable : null,
    prefixArgs: Object.freeze(Array.isArray(adapter.prefixArgs) ? [...adapter.prefixArgs] : []),
    pathStyle: typeof adapter.pathStyle === "string" ? adapter.pathStyle : "native",
  });
}

function modelCommandDescriptor({
  prompt,
  outputSchema,
  adapter,
  invocation,
  timeoutSeconds,
  outputCapBytes,
  capabilityProjectionDigest,
  runtimeCapabilityDigest,
}) {
  if (typeof prompt !== "string") fail("MH_MODEL_COMMAND_PROMPT", "model command prompt must be a string");
  if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) {
    fail("MH_MODEL_COMMAND_SCHEMA", "model command output schema must be an object");
  }
  if (!invocation || typeof invocation !== "object" || Array.isArray(invocation)) {
    fail("MH_MODEL_COMMAND_INVOCATION", "model command invocation descriptor is required");
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    fail("MH_MODEL_COMMAND_TIMEOUT", "model command timeoutSeconds must be positive");
  }
  if (!Number.isInteger(outputCapBytes) || outputCapBytes <= 0) {
    fail("MH_MODEL_COMMAND_OUTPUT_CAP", "model command outputCapBytes must be a positive integer");
  }
  return Object.freeze({
    schemaVersion: MODEL_COMMAND_SCHEMA,
    promptDigest: bytesDigest(Buffer.from(prompt, "utf8")),
    outputSchemaDigest: bytesDigest(`${JSON.stringify(outputSchema, null, 2)}\n`),
    adapter: adapterDescriptor(adapter),
    invocation: Object.freeze(JSON.parse(JSON.stringify(invocation))),
    timeoutSeconds,
    outputCapBytes,
    capabilityProjectionDigest: requireDigest(capabilityProjectionDigest, "capabilityProjectionDigest"),
    runtimeCapabilityDigest: requireDigest(runtimeCapabilityDigest, "runtimeCapabilityDigest"),
  });
}

function modelCommandDigest(input) {
  return domainDigest(MODEL_COMMAND_DOMAIN, modelCommandDescriptor(input));
}

function modelRequestKey({ modelCommandDigest: commandDigest, snapshotTreeOid }) {
  return domainDigest(MODEL_REQUEST_DOMAIN, {
    modelCommandDigest: requireDigest(commandDigest, "modelCommandDigest"),
    snapshotTreeOid: requireOid(snapshotTreeOid, "snapshotTreeOid"),
  });
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
  MODEL_COMMAND_DOMAIN,
  MODEL_COMMAND_SCHEMA,
  MODEL_REQUEST_DOMAIN,
  TOOL_SURFACE_DOMAIN,
  TOOL_SURFACE_SCHEMA,
  VALIDATION_ENVIRONMENT_DOMAIN,
  VALIDATION_ENVIRONMENT_SCHEMA,
  VALIDATION_ISOLATION,
  VALIDATION_KEY_DOMAIN,
  attemptInputKey,
  modelCommandDescriptor,
  modelCommandDigest,
  modelRequestKey,
  toolSurfaceDescriptor,
  toolSurfaceDigest,
  validationEnvironmentDescriptor,
  validationEnvironmentDigest,
  validationKey,
};
