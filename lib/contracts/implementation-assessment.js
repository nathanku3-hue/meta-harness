"use strict";

const { domainDigest } = require("./digest");
const { parseExactUtcTimestamp, freezeDeep } = require("./canonical-json");
const {
  validateRunSpec,
  computeRunSpecDigest,
  commandIdFromSpecCommand,
  normalizeCommandSpec,
  computeCommandId,
  isHexRevision,
} = require("./run-spec");
const { validateAttemptAuthorization } = require("./attempt-authorization");
const { validateWorkspaceAttestation } = require("./workspace-attestation");
const { validateStartSemantics } = require("./workspace-start");
const { validateImplementationFactsStructure } = require("./implementation-facts");
const { checkScope } = require("./scope");

const ASSESSMENT_DOMAIN = "implementation-assessment/v1";

function reason(code, detail) {
  return { code, detail };
}

function baseResult(extra = {}) {
  return {
    ok: false,
    verdict: "INCOMPLETE_EVIDENCE",
    reasons: [],
    implementationAssessment: null,
    deliveryIndependent: true,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
    ...extra,
  };
}

function fail(verdict, reasons, extra = {}) {
  return { ...baseResult(extra), verdict, reasons };
}

/**
 * Evaluate trusted implementation facts.
 * Precondition: caller is a trusted runtime that collected the facts.
 * Does NOT check live authorization expiry (valid-at-start via startCheck only).
 */
function evaluateImplementationFacts({
  runSpec,
  authorizationReceipt,
  workspaceAttestation,
  startCheck,
  trustedImplementationFacts,
  workspacePolicy,
} = {}) {
  const specCheck = validateRunSpec(runSpec);
  if (!specCheck.ok) {
    return fail("FAILED", [reason("RUN_SPEC_INVALID", "runSpec invalid"), ...specCheck.reasons]);
  }
  const runSpecDigest = computeRunSpecDigest(runSpec);

  const authCheck = validateAttemptAuthorization(authorizationReceipt);
  if (!authCheck.ok) {
    return fail("FAILED", [reason("AUTHORIZATION_INVALID", "authorization invalid"), ...authCheck.reasons]);
  }
  const attCheck = validateWorkspaceAttestation(workspaceAttestation);
  if (!attCheck.ok) {
    return fail("FAILED", [reason("ATTESTATION_INVALID", "attestation invalid"), ...attCheck.reasons]);
  }
  if (workspacePolicy == null) {
    return fail("FAILED", [reason("WORKSPACE_POLICY_REQUIRED", "workspacePolicy is required to revalidate start")]);
  }

  const startSemantic = validateStartSemantics({
    runSpec,
    authorizationReceipt,
    attestation: workspaceAttestation,
    workspacePolicy,
    startCheck,
    mode: "revalidate",
  });
  if (!startSemantic.ok) {
    return fail(
      startSemantic.verdict === "STALE" ? "FAILED" : "POLICY_VIOLATION",
      startSemantic.reasons,
    );
  }

  const factsCheck = validateImplementationFactsStructure(trustedImplementationFacts);
  if (!factsCheck.ok) return fail("INCOMPLETE_EVIDENCE", factsCheck.reasons);

  const facts = trustedImplementationFacts;
  const b = facts.bindings;
  if (b.runSpecDigest !== runSpecDigest
    || b.authorizationReceiptDigest !== authorizationReceipt.receiptDigest
    || b.workspaceAttestationDigest !== workspaceAttestation.attestationDigest
    || b.startCheckDigest !== startCheck.startCheckDigest
    || b.attemptId !== authorizationReceipt.attemptId
    || b.repositoryId !== runSpec.repository.repositoryId) {
    return fail("POLICY_VIOLATION", [reason(
      "FACTS_BINDING_MISMATCH",
      "trustedImplementationFacts.bindings must match sealed objects and repositoryId",
    )]);
  }

  const git = facts.git;
  if (git.repositoryId !== runSpec.repository.repositoryId
    || git.objectFormat !== runSpec.repository.objectFormat
    || git.baseRevision !== runSpec.repository.expectedBaseRevision) {
    return fail("STALE", [reason("GIT_IDENTITY_MISMATCH", "git facts do not match RunSpec repository identity")]);
  }
  if (!isHexRevision(git.headRevision, runSpec.repository.objectFormat)
    || !isHexRevision(git.baseRevision, runSpec.repository.objectFormat)) {
    return fail("FAILED", [reason("REVISION_FORMAT_INVALID", "git revisions must match objectFormat")]);
  }
  if (git.headRevision === git.baseRevision && git.changedFiles.length > 0) {
    return fail("POLICY_VIOLATION", [reason(
      "GIT_HEAD_BASE_CONTRADICTION",
      "changedFiles nonempty requires headRevision != baseRevision",
    )]);
  }

  const scopeResult = checkScope(runSpec.scope, git.changedFiles);
  if (!scopeResult.ok) {
    return fail("POLICY_VIOLATION", [reason(scopeResult.code, scopeResult.detail)], { scope_violation: true });
  }
  if (git.changedFiles.length === 0 && runSpec.changePolicy !== "allow-noop") {
    return fail("POLICY_VIOLATION", [reason("EMPTY_DIFF_FORBIDDEN", "empty change set requires changePolicy allow-noop")]);
  }

  const requiredIds = new Map();
  for (const req of runSpec.validation.commands || []) {
    const id = commandIdFromSpecCommand(req);
    if (requiredIds.has(id)) {
      return fail("FAILED", [reason("DUPLICATE_REQUIRED_COMMAND", "RunSpec has duplicate commandIds")]);
    }
    requiredIds.set(id, req);
  }

  const observedById = new Map();
  for (const cmd of facts.commands) {
    if (observedById.has(cmd.commandId)) {
      return fail("POLICY_VIOLATION", [reason("DUPLICATE_COMMAND_EVIDENCE", "duplicate evidence for same commandId")]);
    }
    let recomputed;
    try {
      recomputed = computeCommandId(normalizeCommandSpec({
        argv: cmd.argv,
        cwdRelative: cmd.cwdRelative,
        timeoutSeconds: cmd.timeoutSeconds,
        networkPolicy: cmd.networkPolicy,
        environmentPolicy: cmd.environmentPolicy,
      }));
    } catch (err) {
      return fail("FAILED", [reason("COMMAND_NORMALIZE_FAILED", err.message)]);
    }
    if (recomputed !== cmd.commandId) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_ID_MISMATCH", "observed commandId does not match fields")]);
    }
    observedById.set(cmd.commandId, cmd);
  }

  if (requiredIds.size !== observedById.size) {
    return fail("INCOMPLETE_EVIDENCE", [reason(
      "COMMAND_SET_MISMATCH",
      "required commandId set must equal observed commandId set",
    )]);
  }
  for (const id of requiredIds.keys()) {
    if (!observedById.has(id)) {
      return fail("INCOMPLETE_EVIDENCE", [reason("VALIDATION_COMMAND_MISSING", `missing commandId ${id}`)]);
    }
  }
  for (const id of observedById.keys()) {
    if (!requiredIds.has(id)) {
      return fail("POLICY_VIOLATION", [reason("UNEXPECTED_COMMAND", `unexpected commandId ${id}`)]);
    }
  }

  const startMs = parseExactUtcTimestamp(startCheck.checkedAt);
  let maxCommandEnd = startMs;
  for (const [id, req] of requiredIds) {
    const found = observedById.get(id);
    const nReq = normalizeCommandSpec(req);
    if (JSON.stringify(found.argv) !== JSON.stringify(nReq.argv)
      || found.cwdRelative !== nReq.cwdRelative
      || found.timeoutSeconds !== nReq.timeoutSeconds
      || found.networkPolicy !== nReq.networkPolicy) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_FIELD_MISMATCH", `command fields mismatch for ${id}`)]);
    }
    const obsAllow = [...(found.environmentPolicy.allow || [])].sort();
    const reqAllow = [...(nReq.environmentPolicy.allow || [])].sort();
    if (JSON.stringify(obsAllow) !== JSON.stringify(reqAllow)) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_ENV_MISMATCH", `environment policy mismatch for ${id}`)]);
    }
    if (found.exitCode !== 0) {
      return fail("REPAIRABLE", [reason("VALIDATION_COMMAND_FAILED", `command exited ${found.exitCode}`)]);
    }
    if (found.timedOut !== false) {
      return fail("REPAIRABLE", [reason("VALIDATION_COMMAND_TIMED_OUT", "command timed out")]);
    }
    if (found.networkAttempted !== false) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_NETWORK_ATTEMPTED", "validation command attempted network")]);
    }
    if (found.headBefore !== git.headRevision || found.headAfter !== git.headRevision) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_HEAD_MISMATCH", "command heads must equal final git.headRevision")]);
    }
    const started = parseExactUtcTimestamp(found.startedAt);
    const ended = parseExactUtcTimestamp(found.endedAt);
    if (started < startMs) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_BEFORE_START", "command.startedAt must be >= startCheck.checkedAt")]);
    }
    if (ended < started) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_CHRONOLOGY", "command.endedAt must be >= startedAt")]);
    }
    const durationMs = ended - started;
    const timeoutMs = found.timeoutSeconds * 1000;
    if (!Number.isSafeInteger(timeoutMs) || durationMs > timeoutMs) {
      return fail("POLICY_VIOLATION", [reason("COMMAND_DURATION_EXCEEDS_TIMEOUT", "command duration must be <= timeoutSeconds")]);
    }
    if (ended > maxCommandEnd) maxCommandEnd = ended;
  }

  const gitCollected = parseExactUtcTimestamp(git.collectedAt);
  if (gitCollected < maxCommandEnd) {
    return fail("POLICY_VIOLATION", [reason("GIT_BEFORE_COMMANDS", "git.collectedAt must be >= every command.endedAt")]);
  }
  if (parseExactUtcTimestamp(facts.collectedAt) < gitCollected) {
    return fail("POLICY_VIOLATION", [reason("FACTS_BEFORE_GIT", "facts.collectedAt must be >= git.collectedAt")]);
  }

  const assessmentBody = {
    schemaVersion: "implementation-assessment/v1",
    verdict: "IMPLEMENTATION_VERIFIED",
    runSpecDigest,
    attemptId: authorizationReceipt.attemptId,
    authorizationReceiptDigest: authorizationReceipt.receiptDigest,
    workspaceAttestationDigest: workspaceAttestation.attestationDigest,
    startCheckDigest: startCheck.startCheckDigest,
    factsDigest: facts.factsDigest,
    repositoryId: runSpec.repository.repositoryId,
    verifiedHeadRevision: git.headRevision,
  };
  const implementationAssessment = freezeDeep({
    ...assessmentBody,
    implementationAssessmentDigest: domainDigest(ASSESSMENT_DOMAIN, assessmentBody),
  });

  return {
    ok: true,
    verdict: "IMPLEMENTATION_VERIFIED",
    reasons: [],
    implementationAssessment,
    deliveryIndependent: true,
    mutates: false,
    spawns_process: false,
    network: false,
    executes_child_commands: false,
    scope_violation: false,
  };
}

module.exports = { evaluateImplementationFacts };
