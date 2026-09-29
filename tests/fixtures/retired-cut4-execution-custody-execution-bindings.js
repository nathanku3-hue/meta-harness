"use strict";

/** Lazy local execution-tool binding for genuinely new attempts only. */

const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  validateProgramIdentity,
} = require("./support");
const { bindAgentProgram } = require("./agent-process");

function requireDigestHex(value, label) {
  if (!isNonEmptyString(value) || !/^[a-f0-9]{64}$/.test(value)) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", `${label} must be 64 lowercase hex chars`);
  }
}

function requireAbsolutePath(value, label) {
  if (!isAbsoluteNormalizedFsPath(value)) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", `${label} must be an absolute normalized path`);
  }
}

function validateExecutionConfigShape(
  agentProgram,
  validationProgram,
  expectedWorkerProfile,
  maxValidationTimeoutSeconds,
) {
  if (!isPlainObject(agentProgram)) {
    throw codedError("CUSTODY_AGENT_PROGRAM", "agentProgram object required");
  }
  if (agentProgram.workerProfile !== expectedWorkerProfile) {
    throw codedError(
      "CUSTODY_AGENT_PROFILE",
      "agentProgram.workerProfile must equal authorizationPolicy.provider.workerProfile",
    );
  }
  requireAbsolutePath(agentProgram.nodeExecutablePath, "agentProgram.nodeExecutablePath");
  requireAbsolutePath(agentProgram.launcherScriptPath, "agentProgram.launcherScriptPath");
  requireAbsolutePath(agentProgram.nativeExecutablePath, "agentProgram.nativeExecutablePath");
  requireAbsolutePath(agentProgram.codexHome, "agentProgram.codexHome");
  requireDigestHex(agentProgram.expectedNodeSha256, "agentProgram.expectedNodeSha256");
  requireDigestHex(agentProgram.expectedLauncherSha256, "agentProgram.expectedLauncherSha256");
  requireDigestHex(agentProgram.expectedNativeSha256, "agentProgram.expectedNativeSha256");
  if (!isNonEmptyString(agentProgram.expectedVersion)) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", "agentProgram.expectedVersion required");
  }
  if (!isPlainObject(agentProgram.hostEnv || {})) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", "agentProgram.hostEnv must be a plain object");
  }

  if (!isPlainObject(validationProgram)) {
    throw codedError("CUSTODY_VALIDATION_PROGRAM", "validationProgram object required");
  }
  if (!isNonEmptyString(validationProgram.commandName)) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", "validationProgram.commandName required");
  }
  requireAbsolutePath(validationProgram.executablePath, "validationProgram.executablePath");
  requireDigestHex(
    validationProgram.expectedExecutableSha256,
    "validationProgram.expectedExecutableSha256",
  );
  if (!isPlainObject(validationProgram.hostEnv || {})) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", "validationProgram.hostEnv must be a plain object");
  }
  if (!Array.isArray(validationProgram.expectedCommands)
    || validationProgram.expectedCommands.length === 0) {
    throw codedError("CUSTODY_EXECUTION_CONFIG", "validationProgram.expectedCommands required");
  }
  for (const command of validationProgram.expectedCommands) {
    if (!isPlainObject(command)
      || !Array.isArray(command.argv)
      || command.argv[0] !== validationProgram.commandName
      || !Number.isInteger(command.timeoutSeconds)
      || command.timeoutSeconds < 1
      || command.timeoutSeconds > maxValidationTimeoutSeconds) {
      throw codedError(
        "CUSTODY_EXECUTION_CONFIG",
        `validation command must use ${validationProgram.commandName} and timeout <= ${maxValidationTimeoutSeconds}`,
      );
    }
  }
}

function createLazyExecutionBindings({
  agentProgram,
  validationProgram,
  expectedWorkerProfile,
  maxValidationTimeoutSeconds,
}) {
  validateExecutionConfigShape(
    agentProgram,
    validationProgram,
    expectedWorkerProfile,
    maxValidationTimeoutSeconds,
  );

  let cached = null;
  function bindForNewAttempt() {
    if (cached) return cached;
    const boundAgent = bindAgentProgram(agentProgram, {
      sourceEnv: agentProgram.hostEnv || {},
    });
    const boundValidation = validateProgramIdentity("validationProgram", validationProgram, {
      requireExpectedCommands: true,
    });
    cached = Object.freeze({ boundAgent, boundValidation });
    return cached;
  }

  return Object.freeze({ bindForNewAttempt });
}

module.exports = {
  createLazyExecutionBindings,
  validateExecutionConfigShape,
};
