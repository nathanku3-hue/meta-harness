"use strict";

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireArray,
  requireBoolean,
  requireDigest,
  requireExactKeys,
  requireInteger,
  requireNonEmptyString,
  requireOptionalString,
  requireSortedUniqueStrings,
} = require("./contract-utils");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");

const RUN_SPEC_SCHEMA = "run-spec/v2";
const RUN_SPEC_DOMAIN = "meta-harness-run-spec/v2";
const OPERATIONS = Object.freeze(new Set(["create", "modify", "delete", "test", "document"]));
const ARTIFACT_KINDS = Object.freeze(new Set(["source", "test", "configuration", "documentation", "fixture"]));
const OBJECT_FORMATS = Object.freeze(new Set(["sha1", "sha256"]));
const TOP_KEYS = Object.freeze([
  "schemaVersion",
  "runId",
  "sliceId",
  "generation",
  "sliceAuthorizationDigest",
  "sliceAcceptanceDigest",
  "repository",
  "workerProfile",
  "mechanicalTask",
  "validation",
  "changePolicy",
  "workerGuidance",
  "runSpecDigest",
]);

function validateRevision(value, objectFormat, label) {
  requireNonEmptyString(value, label);
  const length = objectFormat === "sha256" ? 64 : 40;
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw contractError("RUN_SPEC_REVISION_INVALID", `${label} must match Git ${objectFormat}`);
  }
}

function validateRepository(value) {
  requireExactKeys(value, ["repositoryId", "expectedParentRevision", "objectFormat"], "RunSpec.repository");
  requireDigest(value.repositoryId, "RunSpec.repository.repositoryId");
  if (!OBJECT_FORMATS.has(value.objectFormat)) {
    throw contractError("RUN_SPEC_OBJECT_FORMAT_INVALID", `unsupported Git object format: ${value.objectFormat}`);
  }
  validateRevision(value.expectedParentRevision, value.objectFormat, "RunSpec.repository.expectedParentRevision");
}

function validRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..")
    && value !== ".git"
    && !value.startsWith(".git/");
}

function pathWithinBoundary(targetPath, boundary) {
  return boundary.some((allowed) => targetPath === allowed || targetPath.startsWith(`${allowed}/`));
}

function validateMechanicalTask(value, sliceAuthorization) {
  requireExactKeys(value, [
    "acceptanceClauseIds",
    "targetPaths",
    "operation",
    "expectedArtifactKind",
    "validationIds",
  ], "RunSpec.mechanicalTask");
  const clauseIds = requireSortedUniqueStrings(value.acceptanceClauseIds, "RunSpec.mechanicalTask.acceptanceClauseIds", { min: 1 });
  const knownClauses = new Set(sliceAuthorization.sliceAcceptance.acceptanceClauses.map((entry) => entry.clauseId));
  for (const clauseId of clauseIds) {
    if (!knownClauses.has(clauseId)) {
      throw contractError("RUN_SPEC_ACCEPTANCE_CLAUSE_UNKNOWN", `RunSpec references unknown acceptance clause: ${clauseId}`);
    }
  }
  const targetPaths = requireSortedUniqueStrings(value.targetPaths, "RunSpec.mechanicalTask.targetPaths", { min: 1 });
  for (const targetPath of targetPaths) {
    if (!validRelativePath(targetPath)) {
      throw contractError("RUN_SPEC_TARGET_PATH_INVALID", `invalid RunSpec target path: ${targetPath}`);
    }
    if (!pathWithinBoundary(targetPath, sliceAuthorization.executionLimits.aggregatePathBoundary)) {
      throw contractError("RUN_SPEC_TARGET_PATH_UNAUTHORIZED", `RunSpec target path exceeds aggregate authorization: ${targetPath}`);
    }
  }
  if (!OPERATIONS.has(value.operation)) {
    throw contractError("RUN_SPEC_OPERATION_INVALID", `unsupported mechanical operation: ${value.operation}`);
  }
  if (!ARTIFACT_KINDS.has(value.expectedArtifactKind)) {
    throw contractError("RUN_SPEC_ARTIFACT_KIND_INVALID", `unsupported expected artifact kind: ${value.expectedArtifactKind}`);
  }
  requireSortedUniqueStrings(value.validationIds, "RunSpec.mechanicalTask.validationIds", { min: 1 });
}

function validateCommand(command, index) {
  requireExactKeys(command, ["commandId", "argv", "cwd", "timeoutSeconds", "network"], `RunSpec.validation.commands[${index}]`);
  requireDigest(command.commandId, `RunSpec.validation.commands[${index}].commandId`);
  const argv = requireArray(command.argv, `RunSpec.validation.commands[${index}].argv`, { min: 1, max: 1000 });
  argv.forEach((entry, argIndex) => requireNonEmptyString(entry, `RunSpec.validation.commands[${index}].argv[${argIndex}]`));
  requireNonEmptyString(command.cwd, `RunSpec.validation.commands[${index}].cwd`);
  if (command.cwd !== "." && !validRelativePath(command.cwd)) {
    throw contractError("RUN_SPEC_COMMAND_CWD_INVALID", `invalid command cwd: ${command.cwd}`);
  }
  requireInteger(command.timeoutSeconds, `RunSpec.validation.commands[${index}].timeoutSeconds`, { min: 1, max: 3600 });
  if (!new Set(["none", "explicit-allowlist"]).has(command.network)) {
    throw contractError("RUN_SPEC_COMMAND_NETWORK_INVALID", `unsupported command network policy: ${command.network}`);
  }
  const expectedCommandId = domainDigest("meta-harness-run-spec-command/v2", {
    argv: command.argv,
    cwd: command.cwd,
    timeoutSeconds: command.timeoutSeconds,
    network: command.network,
  });
  if (command.commandId !== expectedCommandId) {
    throw contractError("RUN_SPEC_COMMAND_ID_MISMATCH", `RunSpec command ${index} ID does not match its body`);
  }
  return command.commandId;
}

function validateValidation(value, mechanicalTask) {
  requireExactKeys(value, ["commands"], "RunSpec.validation");
  const commands = requireArray(value.commands, "RunSpec.validation.commands", { min: 1, max: 1000 });
  const commandIds = commands.map(validateCommand);
  if (new Set(commandIds).size !== commandIds.length) {
    throw contractError("RUN_SPEC_COMMAND_DUPLICATE", "RunSpec validation command IDs must be unique");
  }
  const expected = mechanicalTask.validationIds;
  if (JSON.stringify(commandIds) !== JSON.stringify(expected)) {
    throw contractError("RUN_SPEC_VALIDATION_BINDING_MISMATCH", "mechanicalTask.validationIds must exactly match command order");
  }
}

function validateChangePolicy(value, targetPaths) {
  requireExactKeys(value, ["maxFiles", "allowDeletes", "allowRenames"], "RunSpec.changePolicy");
  requireInteger(value.maxFiles, "RunSpec.changePolicy.maxFiles", { min: 1, max: 10000 });
  if (value.maxFiles < targetPaths.length) {
    throw contractError("RUN_SPEC_FILE_BUDGET_INVALID", "maxFiles cannot be smaller than the exact target path count");
  }
  requireBoolean(value.allowDeletes, "RunSpec.changePolicy.allowDeletes");
  requireBoolean(value.allowRenames, "RunSpec.changePolicy.allowRenames");
}

function runSpecBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.runSpecDigest;
  return body;
}

function computeRunSpecDigest(value) {
  return domainDigest(RUN_SPEC_DOMAIN, runSpecBody(value));
}

function validateRunSpec(value, sliceAuthorization, options = {}) {
  requireExactKeys(value, TOP_KEYS, "RunSpec");
  if (value.schemaVersion !== RUN_SPEC_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `RunSpec schema must be ${RUN_SPEC_SCHEMA}`);
  }
  requireNonEmptyString(value.runId, "RunSpec.runId");
  requireNonEmptyString(value.sliceId, "RunSpec.sliceId");
  requireInteger(value.generation, "RunSpec.generation", { min: 1 });
  requireDigest(value.sliceAuthorizationDigest, "RunSpec.sliceAuthorizationDigest");
  requireDigest(value.sliceAcceptanceDigest, "RunSpec.sliceAcceptanceDigest");
  validateRepository(value.repository);
  requireNonEmptyString(value.workerProfile, "RunSpec.workerProfile");
  requireOptionalString(value.workerGuidance, "RunSpec.workerGuidance");
  validateMechanicalTask(value.mechanicalTask, sliceAuthorization);
  validateValidation(value.validation, value.mechanicalTask);
  validateChangePolicy(value.changePolicy, value.mechanicalTask.targetPaths);
  requireDigest(value.runSpecDigest, "RunSpec.runSpecDigest");
  if (value.runSpecDigest !== computeRunSpecDigest(value)) {
    throw contractError("RUN_SPEC_DIGEST_MISMATCH", "RunSpec digest does not match its body");
  }

  const expectedAcceptanceDigest = computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance);
  const expected = {
    sliceId: sliceAuthorization.sliceId,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: expectedAcceptanceDigest,
    repositoryId: sliceAuthorization.repositoryId,
    expectedParentRevision: options.expectedParentRevision,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue === undefined) continue;
    const observed = field === "repositoryId" || field === "expectedParentRevision"
      ? value.repository[field]
      : value[field];
    if (observed !== expectedValue) {
      throw contractError("RUN_SPEC_BINDING_MISMATCH", `RunSpec ${field} does not match active slice state`);
    }
  }
  if (!sliceAuthorization.executionLimits.allowedWorkerProfiles.includes(value.workerProfile)) {
    throw contractError("RUN_SPEC_WORKER_PROFILE_UNAUTHORIZED", `worker profile is not owner-authorized: ${value.workerProfile}`);
  }
  if (options.generation !== undefined && value.generation !== options.generation) {
    throw contractError("RUN_SPEC_GENERATION_MISMATCH", "RunSpec generation does not match active generation");
  }
  if (options.nowUtc && Date.parse(options.nowUtc) >= Date.parse(sliceAuthorization.executionLimits.mustCompleteBy)) {
    throw contractError("RUN_SPEC_SLICE_DEADLINE", "RunSpec cannot begin after mustCompleteBy");
  }
  return immutable(value);
}

module.exports = {
  ARTIFACT_KINDS,
  OBJECT_FORMATS,
  OPERATIONS,
  RUN_SPEC_DOMAIN,
  RUN_SPEC_SCHEMA,
  computeRunSpecDigest,
  runSpecBody,
  validateRunSpec,
};
