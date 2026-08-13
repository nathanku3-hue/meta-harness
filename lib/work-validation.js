"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");

const DEFAULT_TIMEOUT_SECONDS = 300;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

function unsupported(reason) {
  return Object.freeze({
    supported: false,
    reason,
    validation: Object.freeze([]),
  });
}

function git(repositoryPath, args, { allowFailure = false } = {}) {
  const root = path.resolve(repositoryPath);
  const executable = gitExecutableForWorkspace({ cwd: root, fs });
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new ConfigError(
      `git ${args.join(" ")} failed while reading sealed validation tree: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { code: "MH_WORK_VALIDATION_GIT", details: { status: result.status, causeCode: result.error?.code } },
    );
  }
  return result;
}

function placeholderTestScript(script) {
  const normalized = String(script).replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("error: no test specified") && /(?:^|[;&|]\s*)exit\s+1(?:\s|$)/.test(normalized);
}

function normalizedRelative(value) {
  return String(value || ".").replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, "") || ".";
}

function parentRelative(value) {
  const normalized = normalizedRelative(value);
  if (normalized === ".") return null;
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index);
}

function parseTreeEntry(output, expectedPath) {
  const text = String(output || "");
  if (!text) return null;
  const record = text.split("\0").find(Boolean);
  if (!record) return null;
  const tab = record.indexOf("\t");
  if (tab === -1) return null;
  const header = record.slice(0, tab).split(/\s+/u);
  const itemPath = normalizedRelative(record.slice(tab + 1));
  if (header.length !== 3 || itemPath !== normalizedRelative(expectedPath)) return null;
  return { mode: header[0], type: header[1], oid: header[2], path: itemPath };
}

function treeEntry(repositoryPath, commit, relativePath) {
  const normalized = normalizedRelative(relativePath);
  if (normalized === ".") return { mode: "040000", type: "tree", oid: null, path: "." };
  const result = git(repositoryPath, ["ls-tree", "-z", commit, "--", normalized], { allowFailure: true });
  if (result.status !== 0) return null;
  return parseTreeEntry(result.stdout, normalized);
}

function startingDirectory(repositoryPath, commit, allowedPath) {
  let current = normalizedRelative(allowedPath);
  while (current !== null) {
    const entry = treeEntry(repositoryPath, commit, current);
    if (entry) {
      if (entry.type === "tree" && entry.mode === "040000") return current;
      if (entry.type === "blob" && REGULAR_BLOB_MODES.has(entry.mode)) return parentRelative(current) || ".";
      return null;
    }
    current = parentRelative(current);
  }
  return null;
}

function packageEntryAt(repositoryPath, commit, directory) {
  const packagePath = directory === "." ? "package.json" : `${directory}/package.json`;
  const entry = treeEntry(repositoryPath, commit, packagePath);
  if (!entry) return null;
  return { ...entry, packagePath };
}

function nearestPackageEntry(repositoryPath, commit, allowedPath) {
  let current = startingDirectory(repositoryPath, commit, allowedPath);
  if (current === null) return null;
  while (current !== null) {
    const entry = packageEntryAt(repositoryPath, commit, current);
    if (entry) return entry;
    current = parentRelative(current);
  }
  return null;
}

function readPackageManifest(repositoryPath, entry) {
  if (entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode)) {
    return { error: "Selected package.json must be a regular non-symlink file in the sealed base tree." };
  }
  const result = git(repositoryPath, ["cat-file", "blob", entry.oid], { allowFailure: true });
  if (result.status !== 0) return { error: "Selected package.json blob is unavailable from the sealed base commit." };
  let manifest;
  try {
    manifest = JSON.parse(String(result.stdout || ""));
  } catch {
    return { error: "Selected package.json is not valid JSON in the sealed base commit." };
  }
  const script = manifest?.scripts?.test;
  if (typeof script !== "string" || script.trim() === "") {
    return { error: "Selected package.json has no non-empty scripts.test command in the sealed base commit." };
  }
  if (placeholderTestScript(script)) {
    return { error: "Selected package.json scripts.test is the npm placeholder failure." };
  }
  return { script };
}

function validationCwd(packagePath) {
  const index = packagePath.lastIndexOf("/");
  return index === -1 ? "." : packagePath.slice(0, index);
}

function resolveGoalValidation(repositoryPath, baseCommit, allowedPaths = ["."]) {
  const scope = Array.isArray(allowedPaths) && allowedPaths.length > 0 ? allowedPaths : ["."];
  const packageEntries = scope.map((allowedPath) => nearestPackageEntry(repositoryPath, baseCommit, allowedPath));
  if (packageEntries.some((entry) => !entry)) {
    return unsupported("No package.json was found between every allowed path and the repository root in the sealed base commit.");
  }

  const uniquePackages = [...new Set(packageEntries.map((entry) => entry.packagePath))];
  if (uniquePackages.length !== 1) {
    return unsupported("Allowed paths resolve to multiple package.json files in the sealed base commit; validation is ambiguous.");
  }

  const selected = readPackageManifest(repositoryPath, packageEntries[0]);
  if (selected.error) return unsupported(selected.error);

  const cwd = validationCwd(uniquePackages[0]);
  return Object.freeze({
    supported: true,
    reason: cwd === "."
      ? "Resolved repository package.json scripts.test from the sealed base commit through npm test."
      : `Resolved scope-nearest ${cwd}/package.json scripts.test from the sealed base commit through npm test.`,
    validation: Object.freeze([Object.freeze({
      argv: Object.freeze(["npm", "test"]),
      cwd,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    })]),
  });
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  placeholderTestScript,
  resolveGoalValidation,
};
