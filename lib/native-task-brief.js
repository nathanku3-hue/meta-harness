"use strict";

const path = require("node:path");
const { domainDigest } = require("./contracts/digest");

const NATIVE_TASK_BRIEF_DOMAIN = "meta-harness-native-task-brief/v1";

function fail(message) {
  const error = new Error(message);
  error.code = "MH_NATIVE_TASK_BRIEF";
  throw error;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be an array${allowEmpty ? "" : " with at least one item"}`);
  }
  const normalized = value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`));
  if (new Set(normalized.map((entry) => entry.toLowerCase())).size !== normalized.length) {
    fail(`${label} must not contain duplicates`);
  }
  return normalized;
}

function relativePath(value, label) {
  const normalized = nonEmpty(value, label).replaceAll("\\", "/");
  if (normalized === ".") return normalized;
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${label} must be a repository-relative path`);
  }
  return normalized;
}

function validationCommands(value) {
  if (!Array.isArray(value)) fail("nativeTaskBrief.validation must be an array");
  return value.map((command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      fail(`nativeTaskBrief.validation[${index}] must be an object`);
    }
    if (!Array.isArray(command.argv) || command.argv.length === 0) {
      fail(`nativeTaskBrief.validation[${index}].argv must contain at least one argument`);
    }
    const argv = command.argv.map((entry, argIndex) =>
      nonEmpty(entry, `nativeTaskBrief.validation[${index}].argv[${argIndex}]`),
    );
    const timeoutSeconds = command.timeoutSeconds === undefined ? 300 : command.timeoutSeconds;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
      fail(`nativeTaskBrief.validation[${index}].timeoutSeconds must be 1-3600`);
    }
    return {
      argv,
      cwd: relativePath(command.cwd === undefined ? "." : command.cwd, `nativeTaskBrief.validation[${index}].cwd`),
      timeoutSeconds,
    };
  });
}

function gitAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("nativeTaskBrief.git must be an object");
  }
  if (typeof value.commit !== "boolean" || typeof value.push !== "boolean") {
    fail("nativeTaskBrief.git.commit and nativeTaskBrief.git.push must be booleans");
  }
  if (value.push && !value.commit) {
    fail("nativeTaskBrief.git.push requires nativeTaskBrief.git.commit");
  }
  return {
    remote: nonEmpty(value.remote, "nativeTaskBrief.git.remote"),
    branch: nonEmpty(value.branch, "nativeTaskBrief.git.branch"),
    paths: stringList(value.paths, "nativeTaskBrief.git.paths").map((entry, index) =>
      relativePath(entry, `nativeTaskBrief.git.paths[${index}]`),
    ),
    commit: value.commit,
    push: value.push,
  };
}

function validateNativeTaskBrief(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("nativeTaskBrief must be an object");
  }
  const brief = {
    productResult: nonEmpty(value.productResult, "nativeTaskBrief.productResult"),
    journeyState: nonEmpty(value.journeyState, "nativeTaskBrief.journeyState"),
    doNow: nonEmpty(value.doNow, "nativeTaskBrief.doNow"),
    doneWhen: nonEmpty(value.doneWhen, "nativeTaskBrief.doneWhen"),
    stopOnlyIf: stringList(value.stopOnlyIf, "nativeTaskBrief.stopOnlyIf"),
    repository: path.resolve(nonEmpty(value.repository, "nativeTaskBrief.repository")),
    allowedPaths: stringList(value.allowedPaths, "nativeTaskBrief.allowedPaths").map((entry, index) =>
      relativePath(entry, `nativeTaskBrief.allowedPaths[${index}]`),
    ),
    validation: validationCommands(value.validation),
    git: gitAuthorization(value.git),
  };
  return Object.freeze(JSON.parse(JSON.stringify(brief)));
}

function computeNativeTaskBriefDigest(value) {
  return domainDigest(NATIVE_TASK_BRIEF_DOMAIN, validateNativeTaskBrief(value));
}

function sealNativeTaskBrief(value) {
  const brief = validateNativeTaskBrief(value);
  return Object.freeze({
    brief,
    briefDigest: domainDigest(NATIVE_TASK_BRIEF_DOMAIN, brief),
  });
}

module.exports = {
  NATIVE_TASK_BRIEF_DOMAIN,
  computeNativeTaskBriefDigest,
  sealNativeTaskBrief,
  validateNativeTaskBrief,
};
