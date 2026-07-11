"use strict";

const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  freezeDeep,
} = require("./canonical-json");
const { validateRunSpec, computeRunSpecDigest, isHexRevision } = require("./run-spec");
const {
  validateAttemptAuthorization,
  isWithinAuthorizationWindow,
} = require("./attempt-authorization");
const {
  validateWorkspaceAttestation,
  isPathUnderRoot,
  validateWorkspacePolicyObject,
} = require("./workspace-attestation");

const START_CHECK_SCHEMA = "workspace-start-check/v1";
const START_CHECK_DOMAIN = "workspace-start-check/v1";

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function computeStartCheckDigest(checkBody) {
  return domainDigest(START_CHECK_DOMAIN, checkBody);
}

/**
 * Shared structural validation of a sealed start-check object.
 */
function validateStartCheckStructure(startCheck) {
  const reasons = [];
  if (!isOrdinaryPlainObject(startCheck)) {
    return { ok: false, reasons: [reason("START_CHECK_REQUIRED", "startCheck is required")] };
  }
  try {
    assertStrictJsonData(startCheck);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }
  if (!exactKeys(startCheck, [
    "schemaVersion",
    "verdict",
    "runSpecDigest",
    "authorizationReceiptDigest",
    "workspaceAttestationDigest",
    "workspacePolicyDigest",
    "attemptId",
    "workspaceRef",
    "checkedAt",
    "startCheckDigest",
  ])) {
    return { ok: false, reasons: [reason("START_CHECK_SHAPE", "startCheck has unexpected fields")] };
  }
  if (startCheck.schemaVersion !== START_CHECK_SCHEMA) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${START_CHECK_SCHEMA}`));
  }
  if (startCheck.verdict !== "START_ALLOWED") {
    reasons.push(reason("START_NOT_ALLOWED", "startCheck.verdict must be START_ALLOWED"));
  }
  if (!isDigest(startCheck.startCheckDigest)) {
    reasons.push(reason("START_CHECK_DIGEST_REQUIRED", "startCheckDigest is required"));
  } else {
    const { startCheckDigest: _omit, ...body } = startCheck;
    const expected = domainDigest(START_CHECK_DOMAIN, body);
    if (startCheck.startCheckDigest !== expected) {
      reasons.push(reason("START_CHECK_DIGEST_MISMATCH", "startCheckDigest does not match body"));
    }
  }
  for (const key of [
    "runSpecDigest",
    "authorizationReceiptDigest",
    "workspaceAttestationDigest",
    "workspacePolicyDigest",
  ]) {
    if (!isDigest(startCheck[key])) {
      reasons.push(reason("DIGEST_REQUIRED", `${key} must be digest`));
    }
  }
  if (!isNonEmptyString(startCheck.attemptId) || !isNonEmptyString(startCheck.workspaceRef)) {
    reasons.push(reason("FIELD_REQUIRED", "attemptId and workspaceRef required"));
  }
  if (!isExactUtcTimestamp(startCheck.checkedAt)) {
    reasons.push(reason("CHECKED_AT_INVALID", "checkedAt must be exact UTC timestamp"));
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Full semantic validity of start relative to sealed objects + workspace policy.
 * Used by evaluateWorkspaceStart and re-checked by evaluateImplementationFacts.
 *
 * @param {"issue"|"revalidate"} mode issue uses `now` as checkedAt; revalidate uses startCheck.checkedAt
 */
function validateStartSemantics({
  runSpec,
  authorizationReceipt,
  attestation,
  workspacePolicy,
  startCheck,
  now,
  mode = "issue",
} = {}) {
  const fail = (verdict, reasons) => ({ ok: false, verdict, reasons });

  const checkedAt = mode === "issue" ? now : (startCheck && startCheck.checkedAt);
  if (!isExactUtcTimestamp(checkedAt)) {
    return fail("FAILED", [reason("CHECKED_AT_REQUIRED", "checkedAt/now must be exact UTC timestamp")]);
  }

  const policyCheck = validateWorkspacePolicyObject(workspacePolicy);
  if (!policyCheck.ok) {
    return fail("FAILED", policyCheck.reasons);
  }
  const workspacePolicyDigest = policyCheck.digest;

  const specCheck = validateRunSpec(runSpec);
  if (!specCheck.ok) {
    return fail("FAILED", [reason("RUN_SPEC_INVALID", "runSpec invalid"), ...specCheck.reasons]);
  }
  const runSpecDigest = computeRunSpecDigest(runSpec);

  const authCheck = validateAttemptAuthorization(authorizationReceipt);
  if (!authCheck.ok) {
    return fail("FAILED", [
      reason("AUTHORIZATION_INVALID", "authorization invalid"),
      ...authCheck.reasons,
    ]);
  }

  if (authorizationReceipt.runSpecDigest !== runSpecDigest) {
    return fail("BLOCKED", [reason(
      "RUN_SPEC_DIGEST_MISMATCH",
      "authorization is not bound to the supplied RunSpec",
    )]);
  }

  if (authorizationReceipt.workspacePolicyDigest !== workspacePolicyDigest) {
    return fail("BLOCKED", [reason(
      "WORKSPACE_POLICY_MISMATCH",
      "authorization workspacePolicyDigest does not match workspacePolicy",
    )]);
  }

  if (!isWithinAuthorizationWindow(authorizationReceipt, checkedAt)) {
    return fail("STALE", [reason(
      "AUTHORIZATION_OUTSIDE_WINDOW",
      "authorization is outside the validity window at checkedAt",
    )]);
  }

  const attCheck = validateWorkspaceAttestation(attestation);
  if (!attCheck.ok) {
    return fail("FAILED", [
      reason("ATTESTATION_INVALID", "workspaceAttestation invalid"),
      ...attCheck.reasons,
    ]);
  }

  if (attestation.runSpecDigest !== runSpecDigest) {
    return fail("BLOCKED", [reason(
      "ATTESTATION_RUN_SPEC_MISMATCH",
      "attestation is not bound to the supplied RunSpec",
    )]);
  }
  if (attestation.authorizationReceiptDigest !== authorizationReceipt.receiptDigest) {
    return fail("BLOCKED", [reason(
      "ATTESTATION_AUTHORIZATION_MISMATCH",
      "attestation is not bound to the authorization receipt",
    )]);
  }
  if (attestation.workspacePolicyDigest !== workspacePolicyDigest) {
    return fail("BLOCKED", [reason(
      "ATTESTATION_WORKSPACE_POLICY_MISMATCH",
      "attestation workspacePolicyDigest must match workspacePolicy",
    )]);
  }
  if (attestation.attemptId !== authorizationReceipt.attemptId) {
    return fail("BLOCKED", [reason(
      "ATTEMPT_MISMATCH",
      "attestation.attemptId must match authorization.attemptId",
    )]);
  }
  if (attestation.runId !== runSpec.runId) {
    return fail("BLOCKED", [reason("RUN_ID_MISMATCH", "attestation.runId does not match runSpec")]);
  }
  if (attestation.provider !== authorizationReceipt.provider.id) {
    return fail("BLOCKED", [reason(
      "PROVIDER_MISMATCH",
      "attestation.provider must match authorization provider.id",
    )]);
  }
  if (attestation.repositoryId !== runSpec.repository.repositoryId
    || attestation.objectFormat !== runSpec.repository.objectFormat) {
    return fail("BLOCKED", [reason(
      "REPOSITORY_IDENTITY_MISMATCH",
      "attestation repositoryId/objectFormat must match RunSpec",
    )]);
  }

  const issued = parseExactUtcTimestamp(authorizationReceipt.issuedAt);
  const collected = parseExactUtcTimestamp(attestation.collectedAt);
  const checked = parseExactUtcTimestamp(checkedAt);
  const expires = parseExactUtcTimestamp(authorizationReceipt.expiresAt);
  if (!(issued <= collected && collected <= checked && checked < expires)) {
    return fail("BLOCKED", [reason(
      "ATTESTATION_CHRONOLOGY",
      "require authorization.issuedAt <= attestation.collectedAt <= checkedAt < expiresAt",
    )]);
  }

  if (attestation.baseRevision !== runSpec.repository.expectedBaseRevision
    || attestation.currentHead !== runSpec.repository.expectedBaseRevision) {
    return fail("BLOCKED", [reason(
      "WORKSPACE_SHA_MISMATCH",
      "workspace base/current HEAD must equal expectedBaseRevision before start",
    )]);
  }
  if (!isHexRevision(attestation.baseRevision, runSpec.repository.objectFormat)
    || !isHexRevision(attestation.currentHead, runSpec.repository.objectFormat)) {
    return fail("FAILED", [reason(
      "REVISION_FORMAT_INVALID",
      "attestation revisions must match repository.objectFormat length",
    )]);
  }

  if (attestation.clean !== true) {
    return fail("BLOCKED", [reason("WORKSPACE_DIRTY", "workspace must be clean before start")]);
  }

  if (!isPathUnderRoot(attestation.repositoryRoot, workspacePolicy.approvedRoot)) {
    return fail("BLOCKED", [reason(
      "WORKSPACE_OUTSIDE_APPROVED_ROOT",
      "workspace repositoryRoot is outside approved root",
    )]);
  }

  if (mode === "revalidate") {
    const struct = validateStartCheckStructure(startCheck);
    if (!struct.ok) return fail("FAILED", struct.reasons);
    if (startCheck.runSpecDigest !== runSpecDigest
      || startCheck.authorizationReceiptDigest !== authorizationReceipt.receiptDigest
      || startCheck.workspaceAttestationDigest !== attestation.attestationDigest
      || startCheck.workspacePolicyDigest !== workspacePolicyDigest
      || startCheck.attemptId !== authorizationReceipt.attemptId
      || startCheck.workspaceRef !== attestation.workspaceRef) {
      return fail("BLOCKED", [reason(
        "START_CHECK_BINDING_MISMATCH",
        "startCheck is not bound to sealed objects and workspace policy",
      )]);
    }
  }

  return {
    ok: true,
    verdict: "START_ALLOWED",
    reasons: [],
    runSpecDigest,
    workspacePolicyDigest,
    checkedAt,
  };
}

/**
 * Pure workspace start assessment. Does not grant effects.
 */
function evaluateWorkspaceStart({
  runSpec,
  authorizationReceipt,
  attestation,
  workspacePolicy,
  now,
} = {}) {
  const fail = (verdict, reasons) => ({
    ok: false,
    verdict,
    reasons,
    startCheck: null,
    mutates: false,
    spawns_process: false,
    network: false,
  });

  const semantic = validateStartSemantics({
    runSpec,
    authorizationReceipt,
    attestation,
    workspacePolicy,
    now,
    mode: "issue",
  });
  if (!semantic.ok) {
    return fail(semantic.verdict, semantic.reasons);
  }

  const checkBody = {
    schemaVersion: START_CHECK_SCHEMA,
    verdict: "START_ALLOWED",
    runSpecDigest: semantic.runSpecDigest,
    authorizationReceiptDigest: authorizationReceipt.receiptDigest,
    workspaceAttestationDigest: attestation.attestationDigest,
    workspacePolicyDigest: semantic.workspacePolicyDigest,
    attemptId: authorizationReceipt.attemptId,
    workspaceRef: attestation.workspaceRef,
    checkedAt: semantic.checkedAt,
  };
  const startCheckDigest = computeStartCheckDigest(checkBody);
  const startCheck = freezeDeep({ ...checkBody, startCheckDigest });

  return {
    ok: true,
    verdict: "START_ALLOWED",
    reasons: [],
    startCheck,
    mutates: false,
    spawns_process: false,
    network: false,
  };
}

module.exports = {
  START_CHECK_SCHEMA,
  evaluateWorkspaceStart,
  validateStartSemantics,
  validateStartCheckStructure,
  computeStartCheckDigest,
};
