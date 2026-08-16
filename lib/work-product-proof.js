"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { validRelativePath } = require("./work-session");

const PRODUCT_PROOF_POLICY_PATH = ".meta-harness/product-proof.json";
const PRODUCT_PROOF_POLICY_SCHEMA = "product-proof-policy/v1";
const PRODUCT_PROOF_SCHEMA = "product-proof/v1";
const PRODUCT_PROOF_DOMAIN = "meta-harness-product-proof/v1";
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
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
      `git ${args.join(" ")} failed while reading sealed product-proof policy: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function normalizedRelative(value) {
  return String(value || "").replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, "");
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

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function validProofRuntime(value) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\\") || value.includes("..")) return false;
  if (!value.includes("/")) return /^[A-Za-z0-9._+-]+$/u.test(value);
  return value.startsWith("/usr/") || value.startsWith("/bin/") || value.startsWith("/sbin/");
}

function resolveProductProof(repositoryPath, baseCommit) {
  if (typeof baseCommit !== "string" || !/^[a-f0-9]{40,64}$/u.test(baseCommit)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof requires an exact sealed base commit");
  }
  const policyEntry = treeEntry(repositoryPath, baseCommit, PRODUCT_PROOF_POLICY_PATH);
  if (!policyEntry) {
    return Object.freeze({
      available: false,
      baseCommit,
      policyPath: PRODUCT_PROOF_POLICY_PATH,
      reason: `No sealed ${PRODUCT_PROOF_POLICY_PATH} exists at the session base commit.`,
    });
  }
  if (policyEntry.type !== "blob" || !REGULAR_BLOB_MODES.has(policyEntry.mode)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${PRODUCT_PROOF_POLICY_PATH} must be a regular non-symlink file in the sealed base tree`);
  }
  let policy;
  try {
    policy = JSON.parse(readBlob(repositoryPath, policyEntry));
  } catch (error) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `${PRODUCT_PROOF_POLICY_PATH} is not valid JSON: ${error.message}`);
  }
  exactKeys(policy, ["schemaVersion", "programPath", "runtime", "timeoutSeconds"], "product proof policy");
  if (policy.schemaVersion !== PRODUCT_PROOF_POLICY_SCHEMA) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `product proof policy schema must be ${PRODUCT_PROOF_POLICY_SCHEMA}`);
  }
  const programPath = normalizedRelative(policy.programPath);
  if (programPath === "." || !validRelativePath(programPath)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `invalid product proof program path: ${policy.programPath}`);
  }
  if (!validProofRuntime(policy.runtime)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof runtime must resolve from the safe system PATH or an absolute /usr, /bin, or /sbin path");
  }
  if (!Number.isInteger(policy.timeoutSeconds) || policy.timeoutSeconds < 1 || policy.timeoutSeconds > 3600) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", "product proof timeoutSeconds must be 1-3600");
  }
  const programEntry = treeEntry(repositoryPath, baseCommit, programPath);
  if (!programEntry || programEntry.type !== "blob" || !REGULAR_BLOB_MODES.has(programEntry.mode)) {
    fail("MH_WORK_PRODUCT_PROOF_POLICY", `product proof program must be a regular base-owned blob: ${programPath}`);
  }
  return Object.freeze({
    available: true,
    baseCommit,
    policy: Object.freeze({ path: PRODUCT_PROOF_POLICY_PATH, blobOid: policyEntry.oid }),
    program: Object.freeze({ path: programPath, blobOid: programEntry.oid }),
    runtime: policy.runtime,
    timeoutSeconds: policy.timeoutSeconds,
  });
}

function productProofBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.productProofDigest;
  return body;
}

function computeProductProofDigest(value) {
  return domainDigest(PRODUCT_PROOF_DOMAIN, productProofBody(value));
}

function validateProductProof(value) {
  const expected = [
    "schemaVersion",
    "state",
    "sessionDigest",
    "workspaceId",
    "generation",
    "candidateSealDigest",
    "candidateTreeOid",
    "baseCommit",
    "policy",
    "program",
    "isolation",
    "command",
    "reason",
    "productProofDigest",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== expected.join("\0")
      || value.schemaVersion !== PRODUCT_PROOF_SCHEMA
      || !new Set(["PROVEN", "FAILED", "UNAVAILABLE"]).has(value.state)
      || !isDigest(value.sessionDigest)
      || typeof value.workspaceId !== "string" || value.workspaceId.trim() === ""
      || !Number.isInteger(value.generation) || value.generation < 1
      || !isDigest(value.candidateSealDigest)
      || !/^[a-f0-9]{40,64}$/u.test(String(value.candidateTreeOid || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(value.baseCommit || ""))
      || typeof value.reason !== "string" || value.reason.trim() === ""
      || !isDigest(value.productProofDigest)
      || value.productProofDigest !== computeProductProofDigest(value)) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof is invalid");
  }
  if (!value.policy || typeof value.policy !== "object" || Array.isArray(value.policy)
      || Object.keys(value.policy).sort().join("\0") !== "blobOid\0path"
      || value.policy.path !== PRODUCT_PROOF_POLICY_PATH
      || !(value.policy.blobOid === null || /^[a-f0-9]{40,64}$/u.test(String(value.policy.blobOid)))) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof policy identity is invalid");
  }
  if (value.state === "UNAVAILABLE") {
    if (value.policy.blobOid !== null || value.program !== null || value.isolation !== null || value.command !== null) {
      fail("MH_WORK_PRODUCT_PROOF", "UNAVAILABLE product proof cannot claim verifier execution");
    }
  } else {
    if (!value.program || typeof value.program !== "object" || Array.isArray(value.program)
        || Object.keys(value.program).sort().join("\0") !== "blobOid\0path"
        || !validRelativePath(value.program.path) || value.program.path === "."
        || !/^[a-f0-9]{40,64}$/u.test(String(value.program.blobOid || ""))
        || typeof value.isolation !== "string" || value.isolation.trim() === ""
        || !value.command || typeof value.command !== "object" || Array.isArray(value.command)
        || Object.keys(value.command).sort().join("\0") !== "argv\0cwd\0durationMs\0exitCode\0output\0passed"
        || !Array.isArray(value.command.argv) || value.command.argv.length < 2
        || value.command.argv.some((arg) => typeof arg !== "string" || arg === "")
        || value.command.cwd !== "/base-proof"
        || typeof value.command.passed !== "boolean"
        || !(value.command.exitCode === null || Number.isInteger(value.command.exitCode))
        || !Number.isInteger(value.command.durationMs) || value.command.durationMs < 0
        || typeof value.command.output !== "string"
        || (value.state === "PROVEN") !== value.command.passed) {
      fail("MH_WORK_PRODUCT_PROOF", "executed product proof evidence is invalid");
    }
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function proofBase({ session, candidateSeal }) {
  if (!session || !candidateSeal
      || session.sessionDigest !== candidateSeal.sessionDigest
      || session.base?.commit !== candidateSeal.baseHead) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof requires the exact sealed session and candidate");
  }
  return {
    schemaVersion: PRODUCT_PROOF_SCHEMA,
    sessionDigest: session.sessionDigest,
    workspaceId: candidateSeal.workspaceId,
    generation: candidateSeal.generation,
    candidateSealDigest: candidateSeal.sealDigest,
    candidateTreeOid: candidateSeal.candidateTreeOid,
    baseCommit: session.base.commit,
  };
}

function unavailableProductProof({ session, candidateSeal, resolution }) {
  if (!resolution || resolution.available !== false || resolution.baseCommit !== session.base.commit) {
    fail("MH_WORK_PRODUCT_PROOF", "UNAVAILABLE product proof requires a sealed absent-policy resolution");
  }
  const body = {
    ...proofBase({ session, candidateSeal }),
    state: "UNAVAILABLE",
    policy: { path: PRODUCT_PROOF_POLICY_PATH, blobOid: null },
    program: null,
    isolation: null,
    command: null,
    reason: resolution.reason,
  };
  return validateProductProof({ ...body, productProofDigest: computeProductProofDigest(body) });
}

function executedProductProof({ session, candidateSeal, resolution, isolation, command }) {
  if (!resolution || resolution.available !== true || resolution.baseCommit !== session.base.commit) {
    fail("MH_WORK_PRODUCT_PROOF", "executed product proof requires the sealed base-owned proof specification");
  }
  const passed = command?.passed === true;
  const body = {
    ...proofBase({ session, candidateSeal }),
    state: passed ? "PROVEN" : "FAILED",
    policy: { ...resolution.policy },
    program: { ...resolution.program },
    isolation,
    command: JSON.parse(JSON.stringify(command)),
    reason: passed
      ? "The trusted base-owned product-proof program passed against the exact sealed candidate."
      : `The trusted base-owned product-proof program failed against the exact sealed candidate${command?.output ? `: ${command.output}` : "."}`,
  };
  return validateProductProof({ ...body, productProofDigest: computeProductProofDigest(body) });
}

function productProofPath(directory, sessionDigest, workspaceId, generation) {
  const sessionId = String(sessionDigest || "").replace(/^sha256:/u, "");
  if (!/^[a-f0-9]{64}$/u.test(sessionId) || typeof workspaceId !== "string" || !Number.isInteger(generation) || generation < 1) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof identity is invalid");
  }
  return path.join(path.resolve(directory), `${sessionId}.${workspaceId}.generation-${generation}.product-proof.json`);
}

function persistProductProof(directory, proof) {
  const validated = validateProductProof(proof);
  const filePath = productProofPath(directory, validated.sessionDigest, validated.workspaceId, validated.generation);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("MH_WORK_PRODUCT_PROOF_EXISTS", `product proof already exists for generation ${validated.generation}`);
    }
    fail("MH_WORK_PRODUCT_PROOF_WRITE", `product proof could not be persisted: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return validated;
}

function readProductProof(directory, sessionDigest, workspaceId, generation, { optional = false } = {}) {
  const filePath = productProofPath(directory, sessionDigest, workspaceId, generation);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_WORK_PRODUCT_PROOF_READ", `product proof is unreadable: ${error.message}`);
  }
  const proof = validateProductProof(parsed);
  if (proof.sessionDigest !== sessionDigest || proof.workspaceId !== workspaceId || proof.generation !== generation) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof path identity does not match its body");
  }
  return proof;
}

function productProofFailureText(proof) {
  if (!proof || proof.state !== "FAILED") return "";
  return `Product proof failed: ${proof.command?.output || proof.reason}`;
}

module.exports = {
  PRODUCT_PROOF_POLICY_PATH,
  PRODUCT_PROOF_POLICY_SCHEMA,
  PRODUCT_PROOF_SCHEMA,
  executedProductProof,
  persistProductProof,
  productProofFailureText,
  readProductProof,
  resolveProductProof,
  unavailableProductProof,
  validateProductProof,
};
