"use strict";

class HarnessError extends Error {
  constructor(message, options = {}) {
    const {
      code = "MH_INTERNAL",
      exitCode = 1,
      details,
      cause,
    } = options;
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

class UsageError extends HarnessError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "MH_USAGE",
      exitCode: options.exitCode ?? 2,
    });
  }
}

class ConfigError extends HarnessError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "MH_CONFIG",
      exitCode: options.exitCode ?? 2,
    });
  }
}

class QualityGateError extends HarnessError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "MH_QUALITY_GATE",
      exitCode: options.exitCode ?? 1,
    });
  }
}

class FileSystemError extends HarnessError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "MH_FILESYSTEM",
      exitCode: options.exitCode ?? 3,
    });
  }
}

class InternalError extends HarnessError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? "MH_INTERNAL",
      exitCode: options.exitCode ?? 1,
    });
  }
}

function isFileSystemError(error) {
  return Boolean(
    error
      && typeof error.code === "string"
      && /^E[A-Z]+$/.test(error.code)
      && (typeof error.syscall === "string" || Object.prototype.hasOwnProperty.call(error, "path"))
  );
}

function normalizeHarnessError(error) {
  if (error instanceof HarnessError) {
    return error;
  }
  if (isFileSystemError(error)) {
    return new FileSystemError(error.message, {
      cause: error,
      details: {
        nodeCode: error.code,
        path: error.path,
        syscall: error.syscall,
      },
    });
  }
  return new InternalError("unexpected internal error", { cause: error });
}

function handleCliError(error) {
  const harnessError = normalizeHarnessError(error);
  process.stderr.write(`meta-harness: ${harnessError.code}: ${harnessError.message}\n`);
  if (process.env.META_HARNESS_DEBUG && harnessError.stack) {
    process.stderr.write(`${harnessError.stack}\n`);
  }
  process.exitCode = harnessError.exitCode || 1;
}

module.exports = {
  ConfigError,
  FileSystemError,
  HarnessError,
  InternalError,
  QualityGateError,
  UsageError,
  handleCliError,
  normalizeHarnessError,
};
