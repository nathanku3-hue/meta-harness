"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { validRelativePath } = require("./work-session");

const CONFIG_SCHEMA = "repository-contract-bindings/v1";
const CONFIG_RELATIVE_PATH = ".meta-harness/repository-contract-bindings.json";
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_CONTRACT_BYTES = 1024 * 1024;
const MAX_BINDINGS = 8;
const VISIBILITIES = new Set(["MODEL", "CONTROL_ONLY"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_REPOSITORY_CONTRACT_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_REPOSITORY_CONTRACT_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_REPOSITORY_CONTRACT_VALUE", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeRelative(value, label) {
  const normalized = nonEmpty(value, label).replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!validRelativePath(normalized)
      || normalized === "."
      || normalized.toLowerCase() === "product.md"
      || normalized.toLowerCase() === ".meta-harness"
      || normalized.toLowerCase().startsWith(".meta-harness/")
      || normalized.toLowerCase() === ".git"
      || normalized.toLowerCase().startsWith(".git/")) {
    fail("MH_REPOSITORY_CONTRACT_PATH", `${label} must be a safe repository-relative semantic artifact path`);
  }
  return normalized;
}

function rawDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readRegular(root, relativePath, maxBytes, { optional = false } = {}) {
  const target = path.resolve(root, ...String(relativePath).split("/"));
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_REPOSITORY_CONTRACT_READ", `${relativePath} is missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    fail("MH_REPOSITORY_CONTRACT_READ", `${relativePath} must be a regular non-symlink file <= ${maxBytes} bytes`);
  }
  return fs.readFileSync(target);
}

function gitShow(repositoryPath, commit, relativePath, { optional = false } = {}) {
  if (!/^[a-f0-9]{40,64}$/u.test(String(commit || ""))) {
    fail("MH_REPOSITORY_CONTRACT_BASE", "repository contract binding requires an exact Git commit");
  }
  const executable = gitExecutableForWorkspace({ cwd: repositoryPath, fs });
  const result = spawnSync(executable, ["show", `${commit}:${relativePath}`], {
    cwd: repositoryPath,
    encoding: null,
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: MAX_CONTRACT_BYTES + MAX_CONFIG_BYTES + 64 * 1024,
  });
  if (result.error) {
    fail("MH_REPOSITORY_CONTRACT_BASE", `cannot inspect sealed base for ${relativePath}: ${result.error.message}`, {
      causeCode: result.error.code,
    });
  }
  if (result.status !== 0) {
    if (optional) return null;
    fail(
      "MH_REPOSITORY_CONTRACT_BASE",
      `repository contract path is not present at the sealed base: ${relativePath}`,
      { status: result.status },
    );
  }
  return Buffer.from(result.stdout || []);
}

function validateCommand(value, label) {
  if (value === null) return null;
  exactKeys(value, ["argv", "cwd", "timeoutSeconds"], label);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > 64) {
    fail("MH_REPOSITORY_CONTRACT_VALIDATOR", `${label}.argv must contain 1-64 arguments`);
  }
  const argv = value.argv.map((item, index) => nonEmpty(item, `${label}.argv[${index}]`));
  const cwd = value.cwd === "." ? "." : normalizeRelative(value.cwd, `${label}.cwd`);
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 300) {
    fail("MH_REPOSITORY_CONTRACT_VALIDATOR", `${label}.timeoutSeconds must be 1-300`);
  }
  return Object.freeze({ argv, cwd, timeoutSeconds: value.timeoutSeconds });
}

function validateConfig(value) {
  exactKeys(value, ["schemaVersion", "bindings"], "repository contract binding config");
  if (value.schemaVersion !== CONFIG_SCHEMA) {
    fail("MH_REPOSITORY_CONTRACT_SCHEMA", `repository contract binding config schema must be ${CONFIG_SCHEMA}`);
  }
  if (!Array.isArray(value.bindings) || value.bindings.length > MAX_BINDINGS) {
    fail("MH_REPOSITORY_CONTRACT_VALUE", `bindings must contain at most ${MAX_BINDINGS} entries`);
  }
  const bindings = value.bindings.map((entry, index) => {
    exactKeys(entry, ["id", "path", "validator", "visibility"], `repository contract binding config bindings[${index}]`);
    if (!VISIBILITIES.has(entry.visibility)) {
      fail("MH_REPOSITORY_CONTRACT_VALUE", `bindings[${index}].visibility must be MODEL or CONTROL_ONLY`);
    }
    return Object.freeze({
      id: nonEmpty(entry.id, `bindings[${index}].id`),
      path: normalizeRelative(entry.path, `bindings[${index}].path`),
      validator: validateCommand(entry.validator, `bindings[${index}].validator`),
      visibility: entry.visibility,
    });
  });
  const ids = bindings.map((entry) => entry.id);
  const paths = bindings.map((entry) => process.platform === "win32" ? entry.path.toLowerCase() : entry.path);
  if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) {
    fail("MH_REPOSITORY_CONTRACT_VALUE", "repository contract binding ids and paths must be unique");
  }
  return Object.freeze({ schemaVersion: CONFIG_SCHEMA, bindings: Object.freeze(bindings) });
}

function readConfigFromBase(repositoryPath, baseCommit) {
  const base = gitShow(repositoryPath, baseCommit, CONFIG_RELATIVE_PATH, { optional: true });
  if (base === null) return null;
  const live = readRegular(repositoryPath, CONFIG_RELATIVE_PATH, MAX_CONFIG_BYTES);
  if (!live.equals(base)) {
    fail("MH_REPOSITORY_CONTRACT_STALE", "repository contract binding config differs from the sealed Git base");
  }
  let parsed;
  try {
    parsed = JSON.parse(base.toString("utf8"));
  } catch (error) {
    fail("MH_REPOSITORY_CONTRACT_JSON", `repository contract binding config is invalid JSON: ${error.message}`);
  }
  return Object.freeze({ config: validateConfig(parsed), configDigest: rawDigest(base) });
}

function runValidator(repositoryPath, validator, bindingId) {
  if (!validator) return;
  const cwd = validator.cwd === "." ? repositoryPath : path.resolve(repositoryPath, ...validator.cwd.split("/"));
  const result = spawnSync(validator.argv[0], validator.argv.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: validator.timeoutSeconds * 1000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail("MH_REPOSITORY_CONTRACT_VALIDATOR", `repository contract validator failed for ${bindingId}`, {
      status: result.status,
      causeCode: result.error?.code,
      stdout: String(result.stdout || "").slice(-4000),
      stderr: String(result.stderr || "").slice(-4000),
    });
  }
}

function compileRepositoryContractBindings({ repositoryPath, baseCommit }) {
  const loaded = readConfigFromBase(repositoryPath, baseCommit);
  if (!loaded || loaded.config.bindings.length === 0) return null;
  const bindings = loaded.config.bindings.map((declared) => {
    const baseBytes = gitShow(repositoryPath, baseCommit, declared.path);
    if (baseBytes.length > MAX_CONTRACT_BYTES || baseBytes.includes(0)) {
      fail("MH_REPOSITORY_CONTRACT_READ", `repository contract ${declared.path} must be UTF-8 text <= ${MAX_CONTRACT_BYTES} bytes`);
    }
    const liveBytes = readRegular(repositoryPath, declared.path, MAX_CONTRACT_BYTES);
    if (!liveBytes.equals(baseBytes)) {
      fail("MH_REPOSITORY_CONTRACT_STALE", `repository contract differs from the sealed Git base: ${declared.path}`);
    }
    return Object.freeze({
      id: declared.id,
      path: declared.path,
      contentDigest: rawDigest(baseBytes),
      content: baseBytes.toString("utf8"),
      validator: declared.validator,
      visibility: declared.visibility,
    });
  });
  return Object.freeze({
    baseCommit,
    configDigest: loaded.configDigest,
    bindings: Object.freeze(bindings),
  });
}

function validateCompiledBindings(value) {
  exactKeys(value, ["baseCommit", "configDigest", "bindings"], "compiled repository contract bindings");
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.baseCommit || ""))
      || !/^sha256:[a-f0-9]{64}$/u.test(String(value.configDigest || ""))) {
    fail("MH_REPOSITORY_CONTRACT_COMPILED", "compiled repository contract identity is invalid");
  }
  if (!Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > MAX_BINDINGS) {
    fail("MH_REPOSITORY_CONTRACT_COMPILED", "compiled repository contracts must contain 1-8 bindings");
  }
  value.bindings.forEach((entry, index) => {
    exactKeys(entry, ["id", "path", "contentDigest", "content", "validator", "visibility"], `compiled repository contract bindings[${index}]`);
    nonEmpty(entry.id, `compiled.bindings[${index}].id`);
    normalizeRelative(entry.path, `compiled.bindings[${index}].path`);
    if (!/^sha256:[a-f0-9]{64}$/u.test(String(entry.contentDigest || ""))
        || rawDigest(Buffer.from(String(entry.content), "utf8")) !== entry.contentDigest) {
      fail("MH_REPOSITORY_CONTRACT_COMPILED", `compiled repository contract content digest mismatch at ${index}`);
    }
    validateCommand(entry.validator, `compiled.bindings[${index}].validator`);
    if (!VISIBILITIES.has(entry.visibility)) {
      fail("MH_REPOSITORY_CONTRACT_COMPILED", `compiled repository contract visibility invalid at ${index}`);
    }
  });
  return value;
}

function assertRepositoryContractBindingsCurrent({ repositoryPath, compiled, runValidators = true }) {
  const validated = validateCompiledBindings(compiled);
  for (const binding of validated.bindings) {
    const bytes = readRegular(repositoryPath, binding.path, MAX_CONTRACT_BYTES);
    if (rawDigest(bytes) !== binding.contentDigest || bytes.toString("utf8") !== binding.content) {
      fail("MH_REPOSITORY_CONTRACT_DRIFT", `bound repository contract changed: ${binding.path}`);
    }
    if (runValidators) runValidator(repositoryPath, binding.validator, binding.id);
  }
  return validated;
}

function protectedRepositoryContractPaths(compiled) {
  if (!compiled) return [];
  return validateCompiledBindings(compiled).bindings.map((entry) => entry.path);
}

function renderRepositoryContractBindings(compiled) {
  if (!compiled) return "";
  const validated = validateCompiledBindings(compiled);
  const modelVisible = validated.bindings.filter((binding) => binding.visibility === "MODEL");
  if (modelVisible.length === 0) return "";
  return [
    "Repository contracts (repo-defined meaning; immutable for this run):",
    ...modelVisible.flatMap((binding) => [
      `--- ${binding.id} | ${binding.path} | ${binding.contentDigest} ---`,
      binding.content.trimEnd(),
      `--- end ${binding.id} ---`,
    ]),
    "Choose implementation means freely, but do not alter, reinterpret, replace, or bypass these bound repository contracts.",
  ].join("\n");
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  CONFIG_SCHEMA,
  assertRepositoryContractBindingsCurrent,
  compileRepositoryContractBindings,
  protectedRepositoryContractPaths,
  renderRepositoryContractBindings,
  validateConfig,
};
