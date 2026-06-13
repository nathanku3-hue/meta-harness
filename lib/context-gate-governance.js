"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { PHASES, STREAMS } = require("./harness-state");
const { writeJsonFile } = require("./json");
const { ensureDir } = require("./paths");
const { stateHash } = require("./state-hash");
const {
  ALLOWED_TRANSITIONS,
  BYPASS_REASON_CODES,
  DEFAULT_MAX_ARTIFACT_AGE_DAYS,
  DIMENSIONS,
  EXECUTION_TRANSITIONS,
  OPTIONAL_GATE_TRANSITIONS,
  REQUIRED_GATE_TRANSITIONS,
  VALID_VERDICTS,
} = require("./context-gate-constants");
const { PHASE_TO_EXPECTED_TRANSITION } = require("./context-gate-adoption");
const { validateTransitionGraph } = require("./context-gate-graph");

const DEFAULT_SNAPSHOT_RELATIVE_PATH = ".meta-harness/governance/snapshots/governance-snapshot.json";
const CONTRACT_TEMPLATE_PATH = "templates/contracts/context-adoption-contract.md";
const SOURCE_ROOT = path.resolve(__dirname, "..");

const GOVERNANCE_ENGINE_RELATIVE_FILES = Object.freeze([
  "lib/context-gate.js",
  "lib/context-gate-utils.js",
  "lib/context-gate-scoring.js",
  "lib/context-gate-artifact.js",
  "lib/context-gate-validation.js",
  "lib/context-gate-adoption.js",
  "lib/context-gate-graph.js",
  "lib/context-hints.js",
  "lib/context-gate-state.js",
  "lib/context-gate-fingerprint.js",
  "lib/context-gate-governance.js",
  "lib/ready-context-gate.js",
  "lib/ready-context-gate-evaluation.js",
  "lib/state-hash.js",
]);

function toSlash(value) {
  return String(value || "").split(path.sep).join("/");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function sortedUnique(value) {
  return Array.from(new Set(asArray(value).map((item) => String(item))))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeLineEndings(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readPackageVersion(sourceRoot) {
  const packagePath = path.join(sourceRoot, "package.json");
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8")).version || "0.0.0";
  } catch (error) {
    throw new ConfigError(`unable to read package version from ${packagePath}`, { cause: error });
  }
}

function fileHash(sourceRoot, relativePath) {
  const absolutePath = path.join(sourceRoot, ...relativePath.split("/"));
  try {
    const content = normalizeLineEndings(fs.readFileSync(absolutePath, "utf8"));
    return {
      path: relativePath,
      sha256: sha256(content),
      status: "present",
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        path: relativePath,
        sha256: null,
        status: "missing",
      };
    }
    throw error;
  }
}

function governanceEngineSnapshot(sourceRoot = SOURCE_ROOT) {
  const files = GOVERNANCE_ENGINE_RELATIVE_FILES
    .map((relativePath) => fileHash(sourceRoot, relativePath))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    hash: stateHash({ files }),
  };
}

function contractTemplateHash(sourceRoot = SOURCE_ROOT) {
  const contractPath = path.join(sourceRoot, ...CONTRACT_TEMPLATE_PATH.split("/"));
  try {
    return sha256(normalizeLineEndings(fs.readFileSync(contractPath, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizePhaseMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.keys(source)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, source[key] === undefined ? null : source[key]])
  );
}

function normalizeEngineFiles(value) {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string") {
        return { path: toSlash(entry), sha256: null, status: "unknown" };
      }
      const status = entry && entry.status ? String(entry.status) : (entry && entry.sha256 ? "present" : "unknown");
      return {
        path: toSlash(entry && entry.path),
        sha256: entry && entry.sha256 === null ? null : String(entry && entry.sha256 || ""),
        status,
      };
    })
    .filter((entry) => entry.path)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeGovernance(input = {}) {
  return {
    schema_version: String(input.schema_version || "1"),
    generated_at: input.generated_at || null,
    version: String(input.version || ""),
    phases: asArray(input.phases).map((item) => String(item)),
    streams: sortedUnique(input.streams),
    allowed_transitions: sortedUnique(input.allowed_transitions),
    required_gate_transitions: sortedUnique(input.required_gate_transitions),
    optional_gate_transitions: sortedUnique(input.optional_gate_transitions),
    phase_to_expected_transition: normalizePhaseMap(input.phase_to_expected_transition),
    dimensions: sortedUnique(input.dimensions),
    valid_verdicts: sortedUnique(input.valid_verdicts),
    bypass_reason_codes: sortedUnique(input.bypass_reason_codes),
    execution_transitions: sortedUnique(input.execution_transitions),
    default_max_artifact_age_days: Number(input.default_max_artifact_age_days),
    contract_template_path: toSlash(input.contract_template_path || CONTRACT_TEMPLATE_PATH),
    contract_template_hash: input.contract_template_hash === null ? null : String(input.contract_template_hash || ""),
    governance_engine_files: normalizeEngineFiles(input.governance_engine_files),
    governance_engine_hash: String(input.governance_engine_hash || ""),
  };
}

function buildLiveGovernance({ sourceRoot = SOURCE_ROOT, generatedAt = new Date().toISOString() } = {}) {
  const engine = governanceEngineSnapshot(sourceRoot);
  return normalizeGovernance({
    schema_version: "1",
    generated_at: generatedAt,
    version: readPackageVersion(sourceRoot),
    phases: PHASES,
    streams: STREAMS,
    allowed_transitions: ALLOWED_TRANSITIONS,
    required_gate_transitions: REQUIRED_GATE_TRANSITIONS,
    optional_gate_transitions: OPTIONAL_GATE_TRANSITIONS,
    phase_to_expected_transition: PHASE_TO_EXPECTED_TRANSITION,
    dimensions: DIMENSIONS,
    valid_verdicts: VALID_VERDICTS,
    bypass_reason_codes: BYPASS_REASON_CODES,
    execution_transitions: EXECUTION_TRANSITIONS,
    default_max_artifact_age_days: DEFAULT_MAX_ARTIFACT_AGE_DAYS,
    contract_template_path: CONTRACT_TEMPLATE_PATH,
    contract_template_hash: contractTemplateHash(sourceRoot),
    governance_engine_files: engine.files,
    governance_engine_hash: engine.hash,
  });
}

function governanceFromSnapshot(snapshot) {
  return normalizeGovernance(snapshot);
}

function governanceHash(governanceOrSnapshot) {
  const normalized = normalizeGovernance(governanceOrSnapshot);
  const { generated_at: _generatedAt, governance_hash: _governanceHash, ...canonical } = normalized;
  return stateHash(canonical);
}

function validateGovernance(governance) {
  const normalized = normalizeGovernance(governance);
  const issues = [];

  if (normalized.schema_version !== "1") {
    issues.push({ severity: "fail", code: "schema_version", message: "governance schema_version must be 1" });
  }
  if (!normalized.generated_at || Number.isNaN(Date.parse(normalized.generated_at))) {
    issues.push({ severity: "fail", code: "generated_at", message: "governance generated_at must be an ISO timestamp" });
  }
  if (!normalized.version) {
    issues.push({ severity: "fail", code: "version", message: "governance version is required" });
  }
  if (!Number.isFinite(normalized.default_max_artifact_age_days)) {
    issues.push({ severity: "fail", code: "artifact_age_policy", message: "default_max_artifact_age_days must be a number" });
  }
  if (!normalized.contract_template_hash) {
    issues.push({ severity: "fail", code: "contract_template_hash", message: "contract_template_hash is required" });
  }
  if (!normalized.governance_engine_hash) {
    issues.push({ severity: "fail", code: "governance_engine_hash", message: "governance_engine_hash is required" });
  }

  const graph = validateTransitionGraph({
    phases: normalized.phases,
    allowedTransitions: normalized.allowed_transitions,
    requiredTransitions: normalized.required_gate_transitions,
    optionalTransitions: normalized.optional_gate_transitions,
    phaseToExpectedTransition: normalized.phase_to_expected_transition,
    checkContract: false,
  });
  issues.push(...graph.issues);

  const failed = issues.filter((item) => item.severity === "fail");
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "pass" : "fail",
    governance_hash: governanceHash(normalized),
    graph,
    issues,
  };
}

function readGovernanceSnapshot(snapshotPath) {
  try {
    return governanceFromSnapshot(JSON.parse(fs.readFileSync(snapshotPath, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new ConfigError(`governance snapshot not found: ${snapshotPath}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`invalid governance snapshot JSON: ${snapshotPath}`, { cause: error });
    }
    throw error;
  }
}

function defaultGovernanceSnapshotPath(targetRoot) {
  return path.join(targetRoot, ...DEFAULT_SNAPSHOT_RELATIVE_PATH.split("/"));
}

function resolveGovernanceSnapshotPath(targetRoot, out) {
  if (!out) return defaultGovernanceSnapshotPath(targetRoot);
  return path.resolve(targetRoot, String(out));
}

function writeGovernanceSnapshot({ targetRoot, out, sourceRoot = SOURCE_ROOT, generatedAt } = {}) {
  const snapshot = buildLiveGovernance({ sourceRoot, generatedAt });
  const validation = validateGovernance(snapshot);
  if (!validation.ok) {
    throw new ConfigError(`live governance snapshot is invalid: ${validation.issues.map((item) => item.code).join(", ")}`);
  }
  const snapshotPath = resolveGovernanceSnapshotPath(targetRoot || sourceRoot, out);
  ensureDir(path.dirname(snapshotPath));
  writeJsonFile(snapshotPath, snapshot);
  return {
    path: snapshotPath,
    snapshot,
    validation,
    governance_hash: validation.governance_hash,
  };
}

module.exports = {
  CONTRACT_TEMPLATE_PATH,
  DEFAULT_SNAPSHOT_RELATIVE_PATH,
  GOVERNANCE_ENGINE_RELATIVE_FILES,
  buildLiveGovernance,
  defaultGovernanceSnapshotPath,
  governanceFromSnapshot,
  governanceHash,
  normalizeGovernance,
  readGovernanceSnapshot,
  validateGovernance,
  writeGovernanceSnapshot,
};
