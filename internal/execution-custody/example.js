"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { computeRunSpecDigest } = require("../../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const { codedError, isPlainObject, isNonEmptyString } = require("./support");

const EXAMPLE_SCHEMA = "bounded-repository-change-example/v1";

function exactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateCommand(command, commandName) {
  if (!exactKeys(command, [
    "argv", "cwdRelative", "timeoutSeconds", "networkPolicy", "environmentPolicy",
  ])) {
    throw codedError("CUSTODY_EXAMPLE_COMMAND", "validation command shape invalid");
  }
  if (!Array.isArray(command.argv)
    || command.argv.length < 2
    || command.argv[0] !== commandName
    || !command.argv.every(isNonEmptyString)) {
    throw codedError("CUSTODY_EXAMPLE_COMMAND", "validation argv must use the capsule commandName");
  }
  if (!isNonEmptyString(command.cwdRelative)
    || !Number.isInteger(command.timeoutSeconds)
    || command.timeoutSeconds < 1
    || command.networkPolicy !== "denied"
    || !exactKeys(command.environmentPolicy, ["allow"])
    || !Array.isArray(command.environmentPolicy.allow)
    || !command.environmentPolicy.allow.every(isNonEmptyString)
    || new Set(command.environmentPolicy.allow).size !== command.environmentPolicy.allow.length) {
    throw codedError("CUSTODY_EXAMPLE_COMMAND", "validation command policy invalid");
  }
}

function validateExample(example) {
  if (!exactKeys(example, [
    "schemaVersion", "exampleId", "repository", "allowedPath", "objective", "validationCapsule",
  ])) {
    throw codedError("CUSTODY_EXAMPLE_SHAPE", "example top-level shape invalid");
  }
  if (example.schemaVersion !== EXAMPLE_SCHEMA || !isNonEmptyString(example.exampleId)) {
    throw codedError("CUSTODY_EXAMPLE_SHAPE", "example schemaVersion/exampleId invalid");
  }
  if (!exactKeys(example.repository, [
    "repositoryId", "objectFormat", "expectedBaseRevision", "expectedBaseTree",
  ])) {
    throw codedError("CUSTODY_EXAMPLE_REPOSITORY", "example repository shape invalid");
  }
  const revisionLength = example.repository.objectFormat === "sha256" ? 64 : 40;
  if (!isNonEmptyString(example.repository.repositoryId)
    || !["sha1", "sha256"].includes(example.repository.objectFormat)
    || !new RegExp(`^[a-f0-9]{${revisionLength}}$`).test(example.repository.expectedBaseRevision)
    || !new RegExp(`^[a-f0-9]{${revisionLength}}$`).test(example.repository.expectedBaseTree)) {
    throw codedError("CUSTODY_EXAMPLE_REPOSITORY", "example repository identity invalid");
  }
  if (!isNonEmptyString(example.allowedPath)
    || example.allowedPath.includes("\\")
    || path.isAbsolute(example.allowedPath)
    || example.allowedPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw codedError("CUSTODY_EXAMPLE_PATH", "allowedPath must be one normalized repository-relative path");
  }
  if (!isNonEmptyString(example.objective)) {
    throw codedError("CUSTODY_EXAMPLE_OBJECTIVE", "objective required");
  }
  if (!exactKeys(example.validationCapsule, ["commandName", "commands"])
    || !isNonEmptyString(example.validationCapsule.commandName)
    || !Array.isArray(example.validationCapsule.commands)
    || example.validationCapsule.commands.length === 0) {
    throw codedError("CUSTODY_EXAMPLE_CAPSULE", "validation capsule invalid");
  }
  for (const command of example.validationCapsule.commands) {
    validateCommand(command, example.validationCapsule.commandName);
  }
  return Object.freeze(JSON.parse(JSON.stringify(example)));
}

function loadExample(examplePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  } catch (err) {
    throw codedError("CUSTODY_EXAMPLE_READ", `example read failed: ${err.message}`);
  }
  return validateExample(parsed);
}

function buildRunRequest(example, {
  runId,
  approvalId,
  authorizationId,
  attemptId,
  approvedAt,
  approvedBy = "custody@meta-harness.local",
}) {
  for (const [key, value] of Object.entries({
    runId, approvalId, authorizationId, attemptId, approvedAt, approvedBy,
  })) {
    if (!isNonEmptyString(value)) throw codedError("CUSTODY_REQUEST_ID", `${key} required`);
  }
  const runSpec = {
    schemaVersion: "run-spec/v1",
    runId,
    repository: {
      repositoryId: example.repository.repositoryId,
      objectFormat: example.repository.objectFormat,
      expectedBaseRevision: example.repository.expectedBaseRevision,
    },
    objective: example.objective,
    scope: { allow: [example.allowedPath], deny: [] },
    validation: {
      commands: example.validationCapsule.commands.map((command) => ({
        argv: command.argv.slice(),
        cwdRelative: command.cwdRelative,
        timeoutSeconds: command.timeoutSeconds,
        networkPolicy: command.networkPolicy,
        environmentPolicy: { allow: command.environmentPolicy.allow.slice() },
      })),
    },
    changePolicy: "forbid-noop",
  };
  const runSpecDigest = computeRunSpecDigest(runSpec);
  return {
    runSpecDigest,
    request: {
      runSpecApproval: sealRunSpecApproval({
        schemaVersion: "run-spec-approval/v1",
        approvalId,
        approvedBy,
        approvedAt,
        runSpec,
        runSpecDigest,
      }),
      authorizationRequest: { authorizationId, attemptId },
    },
  };
}

module.exports = {
  EXAMPLE_SCHEMA,
  validateExample,
  loadExample,
  buildRunRequest,
};
