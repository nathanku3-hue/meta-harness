"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_SECONDS = 300;

function unsupported(reason) {
  return Object.freeze({
    supported: false,
    reason,
    validation: Object.freeze([]),
  });
}

function placeholderTestScript(script) {
  const normalized = String(script).replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("error: no test specified") && /(?:^|[;&|]\s*)exit\s+1(?:\s|$)/.test(normalized);
}

function resolveGoalValidation(repositoryPath) {
  const packagePath = path.join(path.resolve(repositoryPath), "package.json");
  let stat;
  try {
    stat = fs.lstatSync(packagePath);
  } catch {
    return unsupported("No root package.json was found.");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return unsupported("Root package.json must be a regular non-symlink file.");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return unsupported("Root package.json is not valid JSON.");
  }
  const script = manifest?.scripts?.test;
  if (typeof script !== "string" || script.trim() === "") {
    return unsupported("Root package.json has no non-empty scripts.test command.");
  }
  if (placeholderTestScript(script)) {
    return unsupported("Root package.json scripts.test is the npm placeholder failure.");
  }

  return Object.freeze({
    supported: true,
    reason: "Resolved root package.json scripts.test through npm test.",
    validation: Object.freeze([Object.freeze({
      argv: Object.freeze(["npm", "test"]),
      cwd: ".",
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    })]),
  });
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  placeholderTestScript,
  resolveGoalValidation,
};
