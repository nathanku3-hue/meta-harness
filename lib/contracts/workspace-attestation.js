"use strict";

const path = require("node:path");
const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  isExactUtcTimestamp,
  freezeDeep,
  cloneStrict,
} = require("./canonical-json");
const { isHexRevision } = require("./run-spec");
const {
  WORKSPACE_POLICY_SCHEMA,
  computeWorkspacePolicyDigest,
} = require("./attempt-authorization");

const ATTESTATION_SCHEMA = "workspace-attestation/v1";
const ATTESTATION_DOMAIN = "workspace-attestation/v1";

const ATTESTATION_BODY_KEYS = [
  "schemaVersion",
  "runId",
  "attemptId",
  "provider",
  "repositoryId",
  "objectFormat",
  "workspaceRef",
  "repositoryRoot",
  "branch",
  "baseRevision",
  "currentHead",
  "clean",
  "runSpecDigest",
  "authorizationReceiptDigest",
  "workspacePolicyDigest",
  "collectedAt",
];

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFsPath(p) {
  return path.resolve(String(p || "")).replace(/\\/g, "/");
}

function isPathUnderRoot(workspacePath, approvedRoot) {
  const root = normalizeFsPath(approvedRoot);
  const target = normalizeFsPath(workspacePath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(prefix);
}

function attestationBody(att) {
  const body = {};
  for (const k of ATTESTATION_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(att, k)) body[k] = att[k];
  }
  return body;
}

function computeAttestationDigest(attestation) {
  return domainDigest(ATTESTATION_DOMAIN, attestationBody(attestation));
}

function sealWorkspaceAttestation(body) {
  const without = { ...body };
  delete without.attestationDigest;
  const attestationDigest = domainDigest(ATTESTATION_DOMAIN, without);
  return freezeDeep({ ...without, attestationDigest });
}

function validateWorkspaceAttestationBody(attestation) {
  const reasons = [];
  if (!isOrdinaryPlainObject(attestation)) {
    return {
      ok: false,
      reasons: [reason("ATTESTATION_NOT_OBJECT", "workspaceAttestation must be a plain object")],
    };
  }
  try {
    assertStrictJsonData(attestation);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  const hasDigest = Object.prototype.hasOwnProperty.call(attestation, "attestationDigest");
  const expectedKeys = hasDigest
    ? [...ATTESTATION_BODY_KEYS, "attestationDigest"]
    : ATTESTATION_BODY_KEYS;
  if (!exactKeys(attestation, expectedKeys)) {
    return {
      ok: false,
      reasons: [reason("ATTESTATION_SHAPE", "workspaceAttestation has unexpected or missing fields")],
    };
  }

  if (attestation.schemaVersion !== ATTESTATION_SCHEMA) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${ATTESTATION_SCHEMA}`));
  }
  for (const key of [
    "runId", "attemptId", "provider", "repositoryId", "objectFormat",
    "workspaceRef", "repositoryRoot", "branch", "baseRevision", "currentHead",
  ]) {
    if (!isNonEmptyString(attestation[key])) {
      reasons.push(reason("FIELD_REQUIRED", `${key} is required`));
    }
  }
  if (attestation.objectFormat !== "sha1" && attestation.objectFormat !== "sha256") {
    reasons.push(reason("OBJECT_FORMAT_INVALID", 'objectFormat must be "sha1" or "sha256"'));
  }
  if (attestation.clean !== true && attestation.clean !== false) {
    reasons.push(reason("CLEAN_REQUIRED", "clean must be boolean"));
  }
  for (const key of ["runSpecDigest", "authorizationReceiptDigest", "workspacePolicyDigest"]) {
    if (!isDigest(attestation[key])) {
      reasons.push(reason("DIGEST_REQUIRED", `${key} must be sha256:<64 hex>`));
    }
  }
  if (!isExactUtcTimestamp(attestation.collectedAt)) {
    reasons.push(reason("COLLECTED_AT_INVALID", "collectedAt must be exact UTC timestamp"));
  }

  return { ok: reasons.length === 0, reasons };
}

function validateWorkspaceAttestation(attestation) {
  const base = validateWorkspaceAttestationBody(attestation);
  if (!base.ok) return base;
  const reasons = [...base.reasons];
  if (!isDigest(attestation.attestationDigest)) {
    reasons.push(reason(
      "ATTESTATION_DIGEST_REQUIRED",
      "attestationDigest is required on sealed workspace attestation",
    ));
  } else if (attestation.attestationDigest !== computeAttestationDigest(attestation)) {
    reasons.push(reason("ATTESTATION_DIGEST_MISMATCH", "attestationDigest does not match body"));
  }
  return { ok: reasons.length === 0, reasons };
}

function validateWorkspacePolicyObject(workspacePolicy) {
  if (!isOrdinaryPlainObject(workspacePolicy)
    || !exactKeys(workspacePolicy, ["schemaVersion", "approvedRoot"])
    || workspacePolicy.schemaVersion !== WORKSPACE_POLICY_SCHEMA
    || !isNonEmptyString(workspacePolicy.approvedRoot)) {
    return {
      ok: false,
      reasons: [reason(
        "WORKSPACE_POLICY_INVALID",
        'workspacePolicy must be { schemaVersion: "workspace-policy/v1", approvedRoot }',
      )],
    };
  }
  return {
    ok: true,
    reasons: [],
    digest: computeWorkspacePolicyDigest(workspacePolicy),
  };
}

module.exports = {
  ATTESTATION_SCHEMA,
  validateWorkspaceAttestation,
  validateWorkspaceAttestationBody,
  computeAttestationDigest,
  sealWorkspaceAttestation,
  isPathUnderRoot,
  validateWorkspacePolicyObject,
  freezeDeep,
  cloneStrict,
  isHexRevision,
};
