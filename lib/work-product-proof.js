"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { productProofContract, validateProductProofSpec } = require("./work-product-proof-spec");

const PRODUCT_PROOF_SCHEMA = "product-proof/v2";
const PRODUCT_PROOF_DOMAIN = "meta-harness-product-proof/v2";
const PROOF_STATES = new Set(["PROVEN", "FAILED", "GAP"]);
const CLAIM_STATES = new Set(["PASSED", "FAILED", "UNRESOLVED"]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MH_WORK_PRODUCT_PROOF", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail("MH_WORK_PRODUCT_PROOF", `${label} has missing or unexpected fields`, { actual, expected: wanted });
}

function productProofBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.productProofDigest;
  return body;
}

function computeProductProofDigest(value) {
  return domainDigest(PRODUCT_PROOF_DOMAIN, productProofBody(value));
}

function validateCommand(value, label) {
  exactKeys(value, ["argv", "cwd", "passed", "exitCode", "durationMs", "output"], label);
  if (!Array.isArray(value.argv) || value.argv.length < 2 || value.argv.some((arg) => typeof arg !== "string" || arg === "")
      || value.cwd !== "/proof-spec"
      || typeof value.passed !== "boolean"
      || !(value.exitCode === null || Number.isInteger(value.exitCode))
      || !Number.isInteger(value.durationMs) || value.durationMs < 0
      || typeof value.output !== "string") {
    fail("MH_WORK_PRODUCT_PROOF", `${label} is invalid`);
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function derivedState(claims) {
  if (claims.some((claim) => claim.state === "FAILED")) return "FAILED";
  if (claims.some((claim) => claim.state === "UNRESOLVED")) return "GAP";
  return "PROVEN";
}

function validateProductProof(value) {
  exactKeys(value, [
    "schemaVersion",
    "state",
    "sessionDigest",
    "workspaceId",
    "generation",
    "candidateSealDigest",
    "candidateTreeOid",
    "baseCommit",
    "specDigest",
    "isolation",
    "claims",
    "productProofDigest",
  ], "product proof");
  if (value.schemaVersion !== PRODUCT_PROOF_SCHEMA
      || !PROOF_STATES.has(value.state)
      || !isDigest(value.sessionDigest)
      || typeof value.workspaceId !== "string" || value.workspaceId.trim() === ""
      || !Number.isInteger(value.generation) || value.generation < 1
      || !isDigest(value.candidateSealDigest)
      || !/^[a-f0-9]{40,64}$/u.test(String(value.candidateTreeOid || ""))
      || !/^[a-f0-9]{40,64}$/u.test(String(value.baseCommit || ""))
      || !isDigest(value.specDigest)
      || !(value.isolation === null || (typeof value.isolation === "string" && value.isolation.trim() !== ""))
      || !Array.isArray(value.claims) || value.claims.length === 0
      || !isDigest(value.productProofDigest)
      || value.productProofDigest !== computeProductProofDigest(value)) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof is invalid");
  }
  const claims = value.claims.map((claim, index) => {
    exactKeys(claim, ["id", "disposition", "state", "reason", "command"], `product proof claims[${index}]`);
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(String(claim.id || ""))
        || !new Set(["EXECUTABLE", "UNVERIFIABLE", "TASTE", "EXTERNAL"]).has(claim.disposition)
        || !CLAIM_STATES.has(claim.state)
        || typeof claim.reason !== "string" || claim.reason.trim() === "") {
      fail("MH_WORK_PRODUCT_PROOF", `product proof claims[${index}] is invalid`);
    }
    if (claim.disposition === "EXECUTABLE") {
      if (!new Set(["PASSED", "FAILED"]).has(claim.state) || !claim.command) fail("MH_WORK_PRODUCT_PROOF", `executable product proof claim ${claim.id} requires command evidence`);
      const command = validateCommand(claim.command, `product proof claim ${claim.id} command`);
      if ((claim.state === "PASSED") !== command.passed) fail("MH_WORK_PRODUCT_PROOF", `product proof claim ${claim.id} state disagrees with command result`);
      return Object.freeze({ ...claim, command });
    }
    if (claim.state !== "UNRESOLVED" || claim.command !== null) fail("MH_WORK_PRODUCT_PROOF", `non-executable product proof claim ${claim.id} must remain unresolved`);
    return Object.freeze({ ...claim });
  });
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length || value.state !== derivedState(claims)) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof overall state does not derive from unique claim results");
  }
  if (claims.some((claim) => claim.disposition === "EXECUTABLE") && value.isolation === null) {
    fail("MH_WORK_PRODUCT_PROOF", "executed product proof claims require verifier isolation evidence");
  }
  return Object.freeze({ ...JSON.parse(JSON.stringify(value)), claims });
}

function executedProductProof({ session, candidateSeal, spec, isolation, claimResults }) {
  if (!session || !candidateSeal
      || session.sessionDigest !== candidateSeal.sessionDigest
      || session.base?.commit !== candidateSeal.baseHead) {
    fail("MH_WORK_PRODUCT_PROOF", "product proof requires the exact sealed session and candidate");
  }
  const contract = productProofContract(session);
  const validatedSpec = validateProductProofSpec(spec, contract);
  if (session.productProofSpec?.specDigest !== validatedSpec.specDigest) fail("MH_WORK_PRODUCT_PROOF", "executed product proof spec is not the one sealed into the work session");
  const resultById = new Map((claimResults || []).map((result) => [result.id, result]));
  const claims = validatedSpec.claims.map((claim) => {
    if (claim.disposition !== "EXECUTABLE") {
      return {
        id: claim.id,
        disposition: claim.disposition,
        state: "UNRESOLVED",
        reason: claim.reason,
        command: null,
      };
    }
    const result = resultById.get(claim.id);
    if (!result || typeof result.passed !== "boolean" || !result.command) fail("MH_WORK_PRODUCT_PROOF", `missing execution result for product proof claim ${claim.id}`);
    return {
      id: claim.id,
      disposition: claim.disposition,
      state: result.passed ? "PASSED" : "FAILED",
      reason: result.passed
        ? "The sealed candidate satisfied this precommitted executable product claim."
        : `The sealed candidate failed this precommitted executable product claim${result.command.output ? `: ${result.command.output}` : "."}`,
      command: JSON.parse(JSON.stringify(result.command)),
    };
  });
  const body = {
    schemaVersion: PRODUCT_PROOF_SCHEMA,
    state: derivedState(claims),
    sessionDigest: session.sessionDigest,
    workspaceId: candidateSeal.workspaceId,
    generation: candidateSeal.generation,
    candidateSealDigest: candidateSeal.sealDigest,
    candidateTreeOid: candidateSeal.candidateTreeOid,
    baseCommit: session.base.commit,
    specDigest: validatedSpec.specDigest,
    isolation,
    claims,
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
    if (error?.code === "EEXIST") fail("MH_WORK_PRODUCT_PROOF_EXISTS", `product proof already exists for generation ${validated.generation}`);
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
  return proof.claims
    .filter((claim) => claim.state === "FAILED")
    .map((claim) => `Product proof claim ${claim.id} failed: ${claim.command?.output || claim.reason}`)
    .join("\n");
}

module.exports = {
  PRODUCT_PROOF_SCHEMA,
  computeProductProofDigest,
  executedProductProof,
  persistProductProof,
  productProofFailureText,
  readProductProof,
  validateProductProof,
};
