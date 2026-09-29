"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");

const PRODUCT_PROOF_POLICY_PATH = ".meta-harness/product-proof.json";
const PRODUCT_PROOF_POLICY_SCHEMA = "product-proof-policy/v2";
const PRODUCT_PROOF_SPEC_SCHEMA = "product-proof-spec/v1";
const PRODUCT_PROOF_SPEC_DOMAIN = "meta-harness-product-proof-spec/v1";
const PRODUCT_PROOF_PROGRAM_DOMAIN = "meta-harness-product-proof-program/v1";
const PRODUCT_PROOF_CONTRACT_DOMAIN = "meta-harness-product-proof-contract/v1";
const COVERAGE_FIELDS = Object.freeze(["productResult", "newlyTrueBehavior", "doneWhen"]);
const DISPOSITIONS = new Set(["EXECUTABLE", "UNVERIFIABLE", "TASTE", "EXTERNAL"]);
const BASELINES = new Set(["PASS", "FAIL", "NONE"]);
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label, code = "MH_WORK_PRODUCT_PROOF_SPEC") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(code, `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label, code = "MH_WORK_PRODUCT_PROOF_SPEC") {
  if (typeof value !== "string" || value.trim() === "") fail(code, `${label} must be a non-empty string`);
  return value;
}

function safeRuntime(value) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\\") || value.includes("..")) return false;
  if (!value.includes("/")) return /^[A-Za-z0-9._+-]+$/u.test(value);
  return value.startsWith("/usr/") || value.startsWith("/bin/") || value.startsWith("/sbin/");
}

function normalizedRelative(value) {
  return String(value || "").replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, "");
}

function validRelativePath(value) {
  if (value === ".") return true;
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => part === "" || part === "." || part === "..")
    && value !== ".git"
    && !value.startsWith(".git/");
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
    fail(
      "MH_WORK_PRODUCT_PROOF_GIT",
      `git ${args.join(" ")} failed while reading sealed product-proof input: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function parseTreeEntry(output, expectedPath) {
  const record = String(output || "").split("\0").find(Boolean);
  if (!record) return null;
  const tab = record.indexOf("\t");
  if (tab === -1) return null;
  const [mode, type, oid] = record.slice(0, tab).split(/\s+/u);
  const itemPath = normalizedRelative(record.slice(tab + 1));
  if (!mode || !type || !oid || itemPath !== normalizedRelative(expectedPath)) return null;
  return { mode, type, oid, path: itemPath };
}

function treeEntry(repositoryPath, commit, relativePath) {
  const result = git(repositoryPath, ["ls-tree", "-z", commit, "--", relativePath], { allowFailure: true });
  if (result.status !== 0) return null;
  return parseTreeEntry(result.stdout, relativePath);
}

function readBlob(repositoryPath, entry) {
  if (!entry || entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode)) return null;
  const result = git(repositoryPath, ["cat-file", "blob", entry.oid], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || "") : null;
}

function productProofContract(value) {
  const directionDigest = value?.productDirection?.digest || value?.productDirectionDigest;
  const baseCommit = value?.base?.commit || value?.baseCommit;
  const body = {
    productDirectionDigest: nonEmptyString(directionDigest, "product proof contract productDirectionDigest"),
    baseCommit: nonEmptyString(baseCommit, "product proof contract baseCommit"),
    productResult: nonEmptyString(value?.productResult, "product proof contract productResult"),
    newlyTrueBehavior: nonEmptyString(value?.newlyTrueBehavior, "product proof contract newlyTrueBehavior"),
    doneWhen: nonEmptyString(value?.doneWhen, "product proof contract doneWhen"),
  };
  if (!isDigest(body.productDirectionDigest) || !/^[a-f0-9]{40,64}$/u.test(body.baseCommit)) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof contract identity is invalid");
  }
  return Object.freeze({ ...body, contractDigest: domainDigest(PRODUCT_PROOF_CONTRACT_DOMAIN, body) });
}

function programDigest(content) {
  return domainDigest(PRODUCT_PROOF_PROGRAM_DOMAIN, { content: String(content) });
}

function validateClaim(value, index) {
  const label = `productProofSpec.claims[${index}]`;
  exactKeys(value, ["id", "statement", "disposition", "baselineExpectation", "covers", "reason"], label);
  if (!/^[A-Za-z0-9._-]{1,80}$/u.test(String(value.id || ""))) fail("MH_WORK_PRODUCT_PROOF_SPEC", `${label}.id is invalid`);
  nonEmptyString(value.statement, `${label}.statement`);
  nonEmptyString(value.reason, `${label}.reason`);
  if (!DISPOSITIONS.has(value.disposition)) fail("MH_WORK_PRODUCT_PROOF_SPEC", `${label}.disposition is invalid`);
  if (!BASELINES.has(value.baselineExpectation)) fail("MH_WORK_PRODUCT_PROOF_SPEC", `${label}.baselineExpectation is invalid`);
  if ((value.disposition === "EXECUTABLE") !== (value.baselineExpectation !== "NONE")) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", `${label} executable disposition and baseline expectation disagree`);
  }
  if (!Array.isArray(value.covers) || value.covers.length === 0 || new Set(value.covers).size !== value.covers.length
      || value.covers.some((field) => !COVERAGE_FIELDS.includes(field))) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", `${label}.covers must name unique product contract clauses`);
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function validateProgram(value, executableClaims) {
  if (value === null) {
    if (executableClaims.length > 0) fail("MH_WORK_PRODUCT_PROOF_SPEC", "executable proof claims require a proof program");
    return null;
  }
  if (executableClaims.length === 0) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "a product proof program is invalid when no executable claims exist");
  }
  exactKeys(value, ["runtime", "timeoutSeconds", "content", "digest"], "productProofSpec.program");
  if (!safeRuntime(value.runtime)) fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof runtime must resolve from safe system PATH or /usr, /bin, /sbin");
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 3600) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof timeoutSeconds must be 1-3600");
  }
  if (typeof value.content !== "string" || value.content.trim() === "") fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof program content must be non-empty");
  if (!isDigest(value.digest) || value.digest !== programDigest(value.content)) fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof program digest is invalid");
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function validateSource(value) {
  if (value?.type === "BASE_OWNED") {
    exactKeys(value, ["type", "policyPath", "policyBlobOid", "programPath", "programBlobOid"], "productProofSpec.source");
    if (value.policyPath !== PRODUCT_PROOF_POLICY_PATH || !validRelativePath(value.programPath) || value.programPath === "."
        || !/^[a-f0-9]{40,64}$/u.test(String(value.policyBlobOid || ""))
        || !/^[a-f0-9]{40,64}$/u.test(String(value.programBlobOid || ""))) {
      fail("MH_WORK_PRODUCT_PROOF_SPEC", "base-owned product proof source identity is invalid");
    }
    return Object.freeze({ ...value });
  }
  if (value?.type === "COMPILED") {
    exactKeys(value, ["type", "compiler"], "productProofSpec.source");
    nonEmptyString(value.compiler, "productProofSpec.source.compiler");
    return Object.freeze({ ...value });
  }
  if (value?.type === "GAP") {
    exactKeys(value, ["type", "reason"], "productProofSpec.source");
    nonEmptyString(value.reason, "productProofSpec.source.reason");
    return Object.freeze({ ...value });
  }
  fail("MH_WORK_PRODUCT_PROOF_SPEC", "productProofSpec.source.type must be BASE_OWNED, COMPILED, or GAP");
}

function specBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.specDigest;
  return body;
}

function computeProductProofSpecDigest(value) {
  return domainDigest(PRODUCT_PROOF_SPEC_DOMAIN, specBody(value));
}

function validateProductProofSpec(value, contract = null) {
  exactKeys(value, ["schemaVersion", "source", "contractDigest", "baseCommit", "claims", "program", "calibration", "specDigest"], "productProofSpec");
  if (value.schemaVersion !== PRODUCT_PROOF_SPEC_SCHEMA) fail("MH_WORK_PRODUCT_PROOF_SPEC", `product proof spec schema must be ${PRODUCT_PROOF_SPEC_SCHEMA}`);
  const source = validateSource(value.source);
  if (!isDigest(value.contractDigest) || !/^[a-f0-9]{40,64}$/u.test(String(value.baseCommit || ""))) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof spec contract/base identity is invalid");
  }
  if (contract && (value.contractDigest !== contract.contractDigest || value.baseCommit !== contract.baseCommit)) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof spec does not match the sealed product contract");
  }
  if (!Array.isArray(value.claims) || value.claims.length === 0 || value.claims.length > 64) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof spec must contain 1-64 material claims");
  }
  const claims = value.claims.map(validateClaim);
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof claim ids must be unique");
  for (const field of COVERAGE_FIELDS) {
    if (!claims.some((claim) => claim.covers.includes(field))) {
      fail("MH_WORK_PRODUCT_PROOF_SPEC", `product proof spec does not cover material contract clause ${field}`);
    }
  }
  const executable = claims.filter((claim) => claim.disposition === "EXECUTABLE");
  const program = validateProgram(value.program, executable);
  if (source.type === "BASE_OWNED" && (executable.length !== claims.length || program === null)) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "base-owned product proof must normalize entirely to executable claims");
  }
  if (source.type === "GAP" && (executable.length !== 0 || program !== null)) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "GAP product proof source cannot carry executable proof");
  }
  if (!Array.isArray(value.calibration) || value.calibration.length !== executable.length) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof calibration must contain exactly one entry per executable claim");
  }
  const executableById = new Map(executable.map((claim) => [claim.id, claim]));
  const calibration = value.calibration.map((entry, index) => {
    exactKeys(entry, ["claimId", "expected", "observed"], `productProofSpec.calibration[${index}]`);
    const claim = executableById.get(entry.claimId);
    if (!claim || entry.expected !== claim.baselineExpectation || !new Set(["PASS", "FAIL"]).has(entry.observed) || entry.observed !== entry.expected) {
      fail("MH_WORK_PRODUCT_PROOF_SPEC", `product proof calibration for ${entry.claimId} is not discriminating as declared`);
    }
    return Object.freeze({ ...entry });
  });
  if (new Set(calibration.map((entry) => entry.claimId)).size !== calibration.length) fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof calibration claim ids must be unique");
  if (!isDigest(value.specDigest) || value.specDigest !== computeProductProofSpecDigest(value)) fail("MH_WORK_PRODUCT_PROOF_SPEC", "product proof spec digest is invalid");
  return Object.freeze({ ...JSON.parse(JSON.stringify(value)), source, claims, program, calibration });
}

function sealProductProofSpec({ source, contract, claims, program, calibration }) {
  const normalizedProgram = program ? {
    runtime: program.runtime,
    timeoutSeconds: program.timeoutSeconds,
    content: program.content,
    digest: programDigest(program.content),
  } : null;
  const body = {
    schemaVersion: PRODUCT_PROOF_SPEC_SCHEMA,
    source: JSON.parse(JSON.stringify(source)),
    contractDigest: contract.contractDigest,
    baseCommit: contract.baseCommit,
    claims: JSON.parse(JSON.stringify(claims)),
    program: normalizedProgram,
    calibration: JSON.parse(JSON.stringify(calibration || [])),
  };
  return validateProductProofSpec({ ...body, specDigest: computeProductProofSpecDigest(body) }, contract);
}

function gapProductProofSpec(contract, reason) {
  const claims = COVERAGE_FIELDS.map((field) => ({
    id: `gap-${field}`,
    statement: `The material ${field} clause could not be compiled into candidate-independent executable proof.`,
    disposition: "UNVERIFIABLE",
    baselineExpectation: "NONE",
    covers: [field],
    reason: String(reason),
  }));
  return sealProductProofSpec({
    source: { type: "GAP", reason: String(reason) },
    contract,
    claims,
    program: null,
    calibration: [],
  });
}

function readBaseOwnedProductProofDraft(repositoryPath, contract) {
  const policyEntry = treeEntry(repositoryPath, contract.baseCommit, PRODUCT_PROOF_POLICY_PATH);
  if (!policyEntry) return null;
  if (policyEntry.type !== "blob" || !REGULAR_BLOB_MODES.has(policyEntry.mode)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${PRODUCT_PROOF_POLICY_PATH} must be a regular non-symlink file in the sealed base tree`);
  }
  let policy;
  try {
    policy = JSON.parse(readBlob(repositoryPath, policyEntry));
  } catch (error) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${PRODUCT_PROOF_POLICY_PATH} is not valid JSON: ${error.message}`);
  }
  exactKeys(policy, ["schemaVersion", "programPath", "runtime", "timeoutSeconds", "claims"], "product proof policy", "MH_WORK_PRODUCT_PROOF_POLICY");
  if (policy.schemaVersion !== PRODUCT_PROOF_POLICY_SCHEMA) fail("MH_WORK_PRODUCT_PROOF_POLICY", `product proof policy schema must be ${PRODUCT_PROOF_POLICY_SCHEMA}`);
  const programPath = normalizedRelative(policy.programPath);
  if (programPath === "." || !validRelativePath(programPath)) fail("MH_WORK_PRODUCT_PROOF_POLICY", `invalid product proof program path: ${policy.programPath}`);
  if (!safeRuntime(policy.runtime)) fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof runtime must resolve from the safe system PATH or an absolute /usr, /bin, or /sbin path");
  if (!Number.isInteger(policy.timeoutSeconds) || policy.timeoutSeconds < 1 || policy.timeoutSeconds > 3600) fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof timeoutSeconds must be 1-3600");
  if (!Array.isArray(policy.claims) || policy.claims.length === 0 || policy.claims.length > 64) fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof policy requires 1-64 claims");
  const claims = policy.claims.map((claim, index) => {
    exactKeys(claim, ["id", "statement", "baselineExpectation", "covers"], `product proof policy claims[${index}]`, "MH_WORK_PRODUCT_PROOF_POLICY");
    const normalized = {
      id: claim.id,
      statement: claim.statement,
      disposition: "EXECUTABLE",
      baselineExpectation: claim.baselineExpectation,
      covers: claim.covers,
      reason: "Trusted repository-owned product proof claim.",
    };
    try {
      return validateClaim(normalized, index);
    } catch (error) {
      if (error.code === "MH_WORK_PRODUCT_PROOF_SPEC") error.code = "MH_WORK_PRODUCT_PROOF_POLICY";
      throw error;
    }
  });
  for (const field of COVERAGE_FIELDS) {
    if (!claims.some((claim) => claim.covers.includes(field))) fail("MH_WORK_PRODUCT_PROOF_POLICY", `base-owned product proof policy does not cover ${field}`);
  }
  const programEntry = treeEntry(repositoryPath, contract.baseCommit, programPath);
  if (!programEntry || programEntry.type !== "blob" || !REGULAR_BLOB_MODES.has(programEntry.mode)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `product proof program must be a regular base-owned blob: ${programPath}`);
  }
  const content = readBlob(repositoryPath, programEntry);
  if (content === null || content.trim() === "") fail("MH_WORK_PRODUCT_PROOF_POLICY", "base-owned product proof program is empty or unavailable");
  return Object.freeze({
    source: Object.freeze({
      type: "BASE_OWNED",
      policyPath: PRODUCT_PROOF_POLICY_PATH,
      policyBlobOid: policyEntry.oid,
      programPath,
      programBlobOid: programEntry.oid,
    }),
    contract,
    claims: Object.freeze(claims),
    program: Object.freeze({ runtime: policy.runtime, timeoutSeconds: policy.timeoutSeconds, content }),
  });
}

module.exports = {
  BASELINES,
  COVERAGE_FIELDS,
  DISPOSITIONS,
  PRODUCT_PROOF_CONTRACT_DOMAIN,
  PRODUCT_PROOF_POLICY_PATH,
  PRODUCT_PROOF_POLICY_SCHEMA,
  PRODUCT_PROOF_SPEC_SCHEMA,
  computeProductProofSpecDigest,
  gapProductProofSpec,
  productProofContract,
  programDigest,
  readBaseOwnedProductProofDraft,
  safeRuntime,
  sealProductProofSpec,
  validateClaim,
  validateProductProofSpec,
};
