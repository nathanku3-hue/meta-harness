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
const VALIDATION_POLICY_PATH = ".meta-harness/validation.json";
const VALIDATION_POLICY_SCHEMA = "meta-harness-validation/v1";

function unsupported(reason, adapter = null) {
  return Object.freeze({
    supported: false,
    adapter,
    reason,
    validation: Object.freeze([]),
  });
}

function supported(adapter, reason, validation) {
  return Object.freeze({
    supported: true,
    adapter,
    reason,
    validation: Object.freeze(validation.map((command) => Object.freeze({
      argv: Object.freeze([...command.argv]),
      cwd: command.cwd,
      timeoutSeconds: command.timeoutSeconds,
    }))),
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

function regularBlobEntry(repositoryPath, commit, relativePath) {
  const entry = treeEntry(repositoryPath, commit, relativePath);
  return entry && entry.type === "blob" && REGULAR_BLOB_MODES.has(entry.mode) ? entry : null;
}

function readBlob(repositoryPath, entry) {
  if (!entry || entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode)) return null;
  const result = git(repositoryPath, ["cat-file", "blob", entry.oid], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || "") : null;
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

function childPath(directory, name) {
  return directory === "." ? name : `${directory}/${name}`;
}

function nearestNamedEntry(repositoryPath, commit, allowedPath, names) {
  let current = startingDirectory(repositoryPath, commit, allowedPath);
  if (current === null) return null;
  while (current !== null) {
    for (const name of names) {
      const entry = regularBlobEntry(repositoryPath, commit, childPath(current, name));
      if (entry) return { ...entry, directory: current, name };
    }
    current = parentRelative(current);
  }
  return null;
}

function sameSelectedEntry(entries) {
  if (entries.some((entry) => !entry)) return null;
  const identities = [...new Set(entries.map((entry) => entry.path))];
  return identities.length === 1 ? entries[0] : false;
}

function packageEntryAt(repositoryPath, commit, directory) {
  const packagePath = childPath(directory, "package.json");
  const entry = treeEntry(repositoryPath, commit, packagePath);
  if (!entry) return null;
  return { ...entry, packagePath, directory };
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
  const text = readBlob(repositoryPath, entry);
  if (text === null) return { error: "Selected package.json blob is unavailable from the sealed base commit." };
  let manifest;
  try {
    manifest = JSON.parse(text);
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

function packageManager(repositoryPath, commit, directory) {
  if (regularBlobEntry(repositoryPath, commit, childPath(directory, "pnpm-lock.yaml"))) return "pnpm";
  if (regularBlobEntry(repositoryPath, commit, childPath(directory, "yarn.lock"))) return "yarn";
  return "npm";
}

function resolvePackageValidation(repositoryPath, commit, scope) {
  const entries = scope.map((allowedPath) => nearestPackageEntry(repositoryPath, commit, allowedPath));
  if (entries.every((entry) => !entry)) return { matched: false };
  if (entries.some((entry) => !entry)) {
    return { matched: true, result: unsupported("No package.json was found between every allowed path and the repository root in the sealed base commit.", "node") };
  }
  const selectedEntry = sameSelectedEntry(entries);
  if (selectedEntry === false) {
    return { matched: true, result: unsupported("Allowed paths resolve to multiple package.json files in the sealed base commit; validation is ambiguous.", "node") };
  }
  const selected = readPackageManifest(repositoryPath, selectedEntry);
  if (selected.error) return { matched: true, result: unsupported(selected.error, "node") };
  const cwd = selectedEntry.directory;
  const manager = packageManager(repositoryPath, commit, cwd);
  return {
    matched: true,
    result: supported(
      "node",
      cwd === "."
        ? `Resolved repository package.json scripts.test from the sealed base commit through ${manager} test.`
        : `Resolved scope-nearest ${cwd}/package.json scripts.test from the sealed base commit through ${manager} test.`,
      [{ argv: [manager, "test"], cwd, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }],
    ),
  };
}

function validationPolicy(repositoryPath, commit) {
  const entry = treeEntry(repositoryPath, commit, VALIDATION_POLICY_PATH);
  if (!entry) return { matched: false };
  if (entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode)) {
    return { matched: true, result: unsupported(`${VALIDATION_POLICY_PATH} must be a regular non-symlink file in the sealed base tree.`, "policy") };
  }
  const text = readBlob(repositoryPath, entry);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { matched: true, result: unsupported(`${VALIDATION_POLICY_PATH} is not valid JSON in the sealed base commit.`, "policy") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).sort().join("\0") !== "commands\0schemaVersion"
      || parsed.schemaVersion !== VALIDATION_POLICY_SCHEMA
      || !Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    return { matched: true, result: unsupported(`${VALIDATION_POLICY_PATH} must use ${VALIDATION_POLICY_SCHEMA} with at least one command.`, "policy") };
  }
  const commands = [];
  for (const [index, command] of parsed.commands.entries()) {
    if (!command || typeof command !== "object" || Array.isArray(command)
        || Object.keys(command).sort().join("\0") !== "argv\0cwd\0timeoutSeconds"
        || !Array.isArray(command.argv) || command.argv.length === 0
        || command.argv.some((arg) => typeof arg !== "string" || arg.trim() === "")
        || typeof command.cwd !== "string" || command.cwd.trim() === "" || path.isAbsolute(command.cwd)
        || command.cwd.split(/[\\/]/u).some((part) => part === "..")
        || !Number.isInteger(command.timeoutSeconds) || command.timeoutSeconds < 1 || command.timeoutSeconds > 3600) {
      return { matched: true, result: unsupported(`${VALIDATION_POLICY_PATH} command ${index} is invalid.`, "policy") };
    }
    commands.push({ argv: command.argv.map(String), cwd: normalizedRelative(command.cwd), timeoutSeconds: command.timeoutSeconds });
  }
  return { matched: true, result: supported("policy", `Resolved exact validation from sealed ${VALIDATION_POLICY_PATH}.`, commands) };
}

function resolveNamedMarkerValidation(repositoryPath, commit, scope, adapter, markerNames, argv) {
  const entries = scope.map((allowedPath) => nearestNamedEntry(repositoryPath, commit, allowedPath, markerNames));
  if (entries.every((entry) => !entry)) return { matched: false };
  if (entries.some((entry) => !entry)) {
    return { matched: true, result: unsupported(`Not every allowed path resolves to the same ${adapter} project in the sealed base commit.`, adapter) };
  }
  const selected = sameSelectedEntry(entries);
  if (selected === false) {
    return { matched: true, result: unsupported(`Allowed paths resolve to multiple ${adapter} projects in the sealed base commit; validation is ambiguous.`, adapter) };
  }
  return {
    matched: true,
    result: supported(adapter, `Resolved ${adapter} validation from sealed ${selected.path}.`, [{
      argv: typeof argv === "function" ? argv(selected) : argv,
      cwd: selected.directory,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    }]),
  };
}

function allTreeEntries(repositoryPath, commit) {
  const result = git(repositoryPath, ["ls-tree", "-r", "-z", commit], { allowFailure: true });
  if (result.status !== 0) return [];
  return String(result.stdout || "").split("\0").filter(Boolean).map((record) => {
    const tab = record.indexOf("\t");
    if (tab === -1) return null;
    const [mode, type, oid] = record.slice(0, tab).split(/\s+/u);
    return { mode, type, oid, path: normalizedRelative(record.slice(tab + 1)) };
  }).filter(Boolean);
}

function nearestDotnetEntry(repositoryPath, commit, allowedPath, entries) {
  let current = startingDirectory(repositoryPath, commit, allowedPath);
  while (current !== null) {
    const prefix = current === "." ? "" : `${current}/`;
    const direct = entries.filter((entry) => {
      if (entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode) || !entry.path.startsWith(prefix)) return false;
      const tail = entry.path.slice(prefix.length);
      return !tail.includes("/") && /\.(?:sln|csproj)$/iu.test(tail);
    });
    const solutions = direct.filter((entry) => /\.sln$/iu.test(entry.path));
    if (solutions.length === 1) return { ...solutions[0], directory: current };
    if (solutions.length > 1) return false;
    const projects = direct.filter((entry) => /\.csproj$/iu.test(entry.path));
    if (projects.length === 1) return { ...projects[0], directory: current };
    if (projects.length > 1) return false;
    current = parentRelative(current);
  }
  return null;
}

function resolveDotnetValidation(repositoryPath, commit, scope) {
  const entries = allTreeEntries(repositoryPath, commit);
  const selectedEntries = scope.map((allowedPath) => nearestDotnetEntry(repositoryPath, commit, allowedPath, entries));
  if (selectedEntries.every((entry) => entry === null)) return { matched: false };
  if (selectedEntries.some((entry) => entry === false || entry === null)) {
    return { matched: true, result: unsupported(".NET validation is ambiguous for the allowed paths in the sealed base commit.", "dotnet") };
  }
  const selected = sameSelectedEntry(selectedEntries);
  if (selected === false) return { matched: true, result: unsupported("Allowed paths resolve to multiple .NET projects in the sealed base commit.", "dotnet") };
  const target = selected.directory === "." ? selected.path : selected.path.slice(selected.directory.length + 1);
  return {
    matched: true,
    result: supported("dotnet", `Resolved .NET validation from sealed ${selected.path}.`, [{
      argv: ["dotnet", "test", target],
      cwd: selected.directory,
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    }]),
  };
}

function resolveGoalValidation(repositoryPath, baseCommit, allowedPaths = ["."]) {
  const scope = Array.isArray(allowedPaths) && allowedPaths.length > 0 ? allowedPaths : ["."];
  const resolvers = [
    () => validationPolicy(repositoryPath, baseCommit),
    () => resolvePackageValidation(repositoryPath, baseCommit, scope),
    () => resolveNamedMarkerValidation(repositoryPath, baseCommit, scope, "python", ["pytest.ini", "pyproject.toml"], ["python", "-m", "pytest"]),
    () => resolveNamedMarkerValidation(repositoryPath, baseCommit, scope, "cargo", ["Cargo.toml"], ["cargo", "test"]),
    () => resolveNamedMarkerValidation(repositoryPath, baseCommit, scope, "go", ["go.mod"], ["go", "test", "./..."]),
    () => resolveDotnetValidation(repositoryPath, baseCommit, scope),
  ];
  for (const resolve of resolvers) {
    const candidate = resolve();
    if (candidate.matched) return candidate.result;
  }
  return unsupported(
    "No deterministic validation adapter matched the sealed base tree. Add a supported project manifest or sealed .meta-harness/validation.json policy.",
  );
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  VALIDATION_POLICY_PATH,
  VALIDATION_POLICY_SCHEMA,
  placeholderTestScript,
  resolveGoalValidation,
};
