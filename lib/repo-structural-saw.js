"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const {
  STRUCTURAL_SAW_SCHEMA,
  compareStructuralSaw,
  computeStructuralSawDigest,
  computeStructuralSnapshotDigest,
  structuralSnapshot,
  validateStructuralSaw,
} = require("./structural-saw");
const { persistImmutableJson, readImmutableJson } = require("./world-authority");

const CLEAN_CODE_CONTRACT = ".meta-harness/clean-code-contract.json";
const COMPLEXITY_POLICY = ".meta-harness/complexity-policy.json";
const OWNERS = "docs/architecture/owners.json";
const CODEOWNERS_CANDIDATES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
const POLICY_PATHS = new Set([CLEAN_CODE_CONTRACT, COMPLEXITY_POLICY, OWNERS, ...CODEOWNERS_CANDIDATES]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function toSlash(value) { return String(value).replace(/\\/gu, "/"); }

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function policyFile(rootPath, relative) {
  const filePath = path.join(rootPath, ...relative.split("/"));
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("MH_STRUCTURAL_SAW_POLICY", `structural SAW policy file must be a regular file: ${relative}`);
  return { relative, bytes: fs.readFileSync(filePath), filePath };
}

function parseJsonFile(file) {
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    fail("MH_STRUCTURAL_SAW_POLICY", `invalid structural SAW policy JSON: ${file.relative}`, { message: error.message });
  }
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail("MH_STRUCTURAL_SAW_POLICY", `${label} must be a positive integer`);
}

function validateCleanCodeContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) fail("MH_STRUCTURAL_SAW_POLICY", "clean-code contract must be an object");
  if (!Array.isArray(contract.excluded_dirs) || contract.excluded_dirs.some((item) => typeof item !== "string" || !item.trim())) {
    fail("MH_STRUCTURAL_SAW_POLICY", "clean-code contract excluded_dirs must be non-empty strings");
  }
  const approved = contract.ratchets?.direct_events_jsonl_append?.approved_helpers;
  if (approved !== undefined && (!Array.isArray(approved) || approved.some((item) => typeof item !== "string" || !item.trim()))) {
    fail("MH_STRUCTURAL_SAW_POLICY", "direct-event approved_helpers must be strings");
  }
  const escape = contract.ratchets?.worker_report_flags?.must_not_increase_without;
  if (escape !== undefined && (!Array.isArray(escape) || escape.some((item) => typeof item !== "string" || !item.trim()))) {
    fail("MH_STRUCTURAL_SAW_POLICY", "worker-report escape flags must be strings");
  }
  return contract;
}

function validateComplexityPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.schema_version !== "1.0.0") {
    fail("MH_STRUCTURAL_SAW_POLICY", "complexity policy schema_version must be 1.0.0");
  }
  if (!policy.line_budgets || typeof policy.line_budgets !== "object") fail("MH_STRUCTURAL_SAW_POLICY", "complexity policy line_budgets are required");
  for (const key of ["source", "bin_entrypoint", "command_module", "test"]) positiveInteger(policy.line_budgets[key], `complexity policy line_budgets.${key}`);
  if (!policy.import_direction || typeof policy.import_direction !== "object" || Array.isArray(policy.import_direction)) {
    fail("MH_STRUCTURAL_SAW_POLICY", "complexity policy import_direction is required");
  }
  for (const [rule, disposition] of Object.entries(policy.import_direction)) {
    if (!rule.includes(" -> ") || !["allowed", "forbidden"].includes(disposition)) fail("MH_STRUCTURAL_SAW_POLICY", `invalid import_direction rule: ${rule}`);
  }
  if (!Array.isArray(policy.duplicate_template_allowlist || [])) fail("MH_STRUCTURAL_SAW_POLICY", "duplicate_template_allowlist must be an array");
  return policy;
}

function normalizeOwnerPath(value) {
  const slash = toSlash(value).replace(/^\.\//u, "");
  const normalized = path.posix.normalize(slash);
  if (!slash || path.posix.isAbsolute(slash) || normalized === ".." || normalized.startsWith("../")) {
    fail("MH_STRUCTURAL_SAW_POLICY", `invalid owners path: ${value}`);
  }
  return slash.endsWith("/") && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function validateOwners(owners) {
  if (!owners || typeof owners !== "object" || Array.isArray(owners) || owners.schema_version !== "1.0.0" || !Array.isArray(owners.modules)) {
    fail("MH_STRUCTURAL_SAW_POLICY", "owners policy must use schema_version 1.0.0 with modules[]");
  }
  const seen = new Set();
  for (const item of owners.modules) {
    if (!item || typeof item.path !== "string" || !item.path.trim()) fail("MH_STRUCTURAL_SAW_POLICY", "owners module path must be a non-empty string");
    const normalized = normalizeOwnerPath(item.path);
    if (seen.has(normalized)) fail("MH_STRUCTURAL_SAW_POLICY", `owners policy repeats path: ${normalized}`);
    seen.add(normalized);
    if (item.budget_lines !== undefined) positiveInteger(item.budget_lines, `owners budget_lines for ${normalized}`);
  }
  return owners;
}

function inactiveBundle() {
  return Object.freeze({
    active: false,
    cleanCodeContract: null,
    complexityPolicy: null,
    owners: null,
    identity: Object.freeze({
      active: false,
      cleanCodeContractDigest: null,
      complexityPolicyDigest: null,
      ownersDigest: null,
      codeownersDigest: null,
    }),
  });
}

function loadPredecessorStructuralPolicy(rootPath) {
  const required = [
    policyFile(rootPath, CLEAN_CODE_CONTRACT),
    policyFile(rootPath, COMPLEXITY_POLICY),
    policyFile(rootPath, OWNERS),
  ];
  const codeowners = CODEOWNERS_CANDIDATES.map((relative) => policyFile(rootPath, relative)).filter(Boolean);
  const present = required.filter(Boolean).length;
  if (present === 0 && codeowners.length === 0) return inactiveBundle();
  if (present !== required.length) {
    fail("MH_STRUCTURAL_SAW_POLICY", "partial structural SAW policy bundle is not canonical authority", {
      required: [CLEAN_CODE_CONTRACT, COMPLEXITY_POLICY, OWNERS],
      present: required.filter(Boolean).map((item) => item.relative),
    });
  }
  if (codeowners.length > 1) fail("MH_STRUCTURAL_SAW_POLICY", "multiple CODEOWNERS files make structural policy identity ambiguous");
  const cleanCodeContract = validateCleanCodeContract(parseJsonFile(required[0]));
  const complexityPolicy = validateComplexityPolicy(parseJsonFile(required[1]));
  const owners = validateOwners(parseJsonFile(required[2]));
  return Object.freeze({
    active: true,
    cleanCodeContract,
    complexityPolicy,
    owners,
    identity: Object.freeze({
      active: true,
      cleanCodeContractDigest: digestBytes(required[0].bytes),
      complexityPolicyDigest: digestBytes(required[1].bytes),
      ownersDigest: digestBytes(required[2].bytes),
      codeownersDigest: codeowners.length === 1 ? digestBytes(codeowners[0].bytes) : null,
    }),
  });
}

function normalizedChangedPaths(changedPaths) {
  if (!Array.isArray(changedPaths)) fail("MH_STRUCTURAL_SAW_PATH", "changedPaths must be an array");
  const normalized = changedPaths.map((item) => toSlash(item)).sort();
  if (normalized.some((item) => !item || item.startsWith("../") || path.posix.isAbsolute(item))) fail("MH_STRUCTURAL_SAW_PATH", "changedPaths must remain repository-relative");
  if (new Set(normalized).size !== normalized.length) fail("MH_STRUCTURAL_SAW_PATH", "changedPaths must be unique");
  return normalized;
}

function preparePredecessorStructuralSaw(workspacePath) {
  const policyBundle = loadPredecessorStructuralPolicy(workspacePath);
  const snapshot = structuralSnapshot(workspacePath, policyBundle);
  return Object.freeze({
    policyBundle,
    snapshot,
    snapshotDigest: computeStructuralSnapshotDigest(snapshot),
  });
}

function selfModificationRegressions(changedPaths) {
  return changedPaths.filter((item) => POLICY_PATHS.has(item)).map((item) => ({
    rule: "policy_self_modification",
    key: `policy:${item}`,
    path: item,
  }));
}

function evaluateStructuralSaw({
  repositoryPath,
  workspacePath,
  predecessorProductCommit,
  candidateTreeOid,
  changedPaths,
  predecessor,
}) {
  const paths = normalizedChangedPaths(changedPaths);
  const candidateSnapshot = structuralSnapshot(workspacePath, predecessor.policyBundle);
  const regressions = [
    ...selfModificationRegressions(paths),
    ...compareStructuralSaw(predecessor.snapshot, candidateSnapshot, predecessor.policyBundle.cleanCodeContract),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.rule.localeCompare(b.rule));
  const body = {
    schemaVersion: STRUCTURAL_SAW_SCHEMA,
    predecessorProductCommit,
    candidateTreeOid,
    changedPaths: paths,
    policyIdentity: predecessor.policyBundle.identity,
    predecessorSnapshotDigest: predecessor.snapshotDigest,
    candidateSnapshotDigest: computeStructuralSnapshotDigest(candidateSnapshot),
    regressions,
    passed: regressions.length === 0,
  };
  const evidence = validateStructuralSaw({ ...body, sawDigest: computeStructuralSawDigest(body) });
  persistImmutableJson(repositoryPath, "structural-saws", evidence.sawDigest, evidence, "MH_STRUCTURAL_SAW_WRITE");
  return evidence;
}

function readStructuralSaw(repositoryPath, sawDigest) {
  const evidence = validateStructuralSaw(readImmutableJson(repositoryPath, "structural-saws", sawDigest));
  if (evidence.sawDigest !== sawDigest) fail("MH_STRUCTURAL_SAW_DIGEST", "structural SAW path identity does not match its body");
  return evidence;
}

module.exports = {
  CODEOWNERS_CANDIDATES,
  POLICY_PATHS,
  evaluateStructuralSaw,
  loadPredecessorStructuralPolicy,
  preparePredecessorStructuralSaw,
  readStructuralSaw,
  _test: { normalizedChangedPaths, selfModificationRegressions, validateCleanCodeContract, validateComplexityPolicy, validateOwners },
};
