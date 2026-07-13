"use strict";

/**
 * D072 private lazy execution-tool binding.
 * Construction validates configuration shape only. Filesystem identity,
 * hashing, realpath, and version probes occur only for a genuinely new attempt.
 */

const {
  codedError,
  isPlainObject,
  isNonEmptyString,
  isAbsoluteNormalizedFsPath,
  validateProgramIdentity,
} = require("./support");
const { bindCodexProgram } = require("./ao-process");

function requireDigestHex(value, label) {
  if (!isNonEmptyString(value) || !/^[a-f0-9]{64}$/.test(value)) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", `${label} must be 64 lowercase hex chars`);
  }
}

function requireAbsolutePath(value, label) {
  if (!isAbsoluteNormalizedFsPath(value)) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", `${label} must be an absolute normalized path`);
  }
}

function validateExecutionConfigShape(codexProgram, validationProgram, expectedWorkerProfile) {
  if (!isPlainObject(codexProgram)) {
    throw codedError("D070_CODEX_PROGRAM", "codexProgram object required");
  }
  if (codexProgram.workerProfile !== expectedWorkerProfile) {
    throw codedError(
      "D070_CODEX_PROFILE_MISMATCH",
      "codexProgram.workerProfile must equal authorizationPolicy.provider.workerProfile",
    );
  }
  requireAbsolutePath(codexProgram.nodeExecutablePath, "codexProgram.nodeExecutablePath");
  requireAbsolutePath(codexProgram.launcherScriptPath, "codexProgram.launcherScriptPath");
  requireAbsolutePath(codexProgram.nativeExecutablePath, "codexProgram.nativeExecutablePath");
  requireAbsolutePath(codexProgram.codexHome, "codexProgram.codexHome");
  requireDigestHex(codexProgram.expectedLauncherSha256, "codexProgram.expectedLauncherSha256");
  requireDigestHex(codexProgram.expectedNativeSha256, "codexProgram.expectedNativeSha256");
  if (!isNonEmptyString(codexProgram.expectedVersion)) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", "codexProgram.expectedVersion required");
  }
  if (!isPlainObject(codexProgram.hostEnv || {})) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", "codexProgram.hostEnv must be a plain object");
  }

  if (!isPlainObject(validationProgram)) {
    throw codedError("D069_PROGRAM_REQUIRED", "validationProgram object required");
  }
  requireAbsolutePath(validationProgram.executablePath, "validationProgram.executablePath");
  requireAbsolutePath(validationProgram.scriptPath, "validationProgram.scriptPath");
  requireDigestHex(validationProgram.expectedExecutableSha256, "validationProgram.expectedExecutableSha256");
  requireDigestHex(validationProgram.expectedScriptSha256, "validationProgram.expectedScriptSha256");
  if (!isPlainObject(validationProgram.hostEnv || {})) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", "validationProgram.hostEnv must be a plain object");
  }
  if (!isPlainObject(validationProgram.expectedCommand)) {
    throw codedError("D072_EXECUTION_CONFIG_SHAPE", "validationProgram.expectedCommand object required");
  }
}

function createLazyExecutionBindings({
  codexProgram,
  validationProgram,
  expectedWorkerProfile,
  fixedTimeoutSeconds,
}) {
  validateExecutionConfigShape(codexProgram, validationProgram, expectedWorkerProfile);

  let cached = null;
  function bindForNewAttempt() {
    if (cached) return cached;

    const boundCodex = bindCodexProgram(codexProgram, {
      sourceEnv: codexProgram.hostEnv || {},
    });
    const boundValidation = validateProgramIdentity("validationProgram", validationProgram, {
      requireExpectedCommand: true,
    });
    if (boundValidation.expectedCommand.timeoutSeconds !== fixedTimeoutSeconds) {
      throw codedError(
        "D070_VALIDATION_TIMEOUT",
        `validation timeout must remain ${fixedTimeoutSeconds}s`,
      );
    }
    cached = Object.freeze({ boundCodex, boundValidation });
    return cached;
  }

  return Object.freeze({ bindForNewAttempt });
}

module.exports = {
  createLazyExecutionBindings,
  validateExecutionConfigShape,
};
