"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateImplementationFacts } = require("../lib/contracts");
const { domainDigest } = require("../lib/contracts/digest");
const { sealImplementationFacts } = require("../lib/contracts/implementation-facts");
const {
  verifyFixture,
  startFixture,
  buildTrustedFacts,
  BASE_SHA,
  HEAD_SHA,
} = require("./helpers/contracts-fixtures");

test("happy path IMPLEMENTATION_VERIFIED binds factsDigest", () => {
  const { impl, facts } = verifyFixture();
  assert.equal(impl.ok, true, JSON.stringify(impl.reasons));
  assert.equal(impl.verdict, "IMPLEMENTATION_VERIFIED");
  assert.ok(facts.factsDigest);
  assert.equal(impl.implementationAssessment.factsDigest, facts.factsDigest);
  assert.equal(impl.implementationAssessment.verifiedHeadRevision, HEAD_SHA);
});

test("expired start-check timestamp rejected by implementation evaluation", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  assert.equal(start.ok, true);
  // Fabricate start check with checkedAt after receipt expiry but consistent digest
  const body = {
    schemaVersion: "workspace-start-check/v1",
    verdict: "START_ALLOWED",
    runSpecDigest: start.startCheck.runSpecDigest,
    authorizationReceiptDigest: start.startCheck.authorizationReceiptDigest,
    workspaceAttestationDigest: start.startCheck.workspaceAttestationDigest,
    workspacePolicyDigest: start.startCheck.workspacePolicyDigest,
    attemptId: start.startCheck.attemptId,
    workspaceRef: start.startCheck.workspaceRef,
    checkedAt: "2026-07-11T14:30:00.000Z",
  };
  const startCheckDigest = domainDigest("workspace-start-check/v1", body);
  const badStart = { ...body, startCheckDigest };
  const facts = buildTrustedFacts(runSpec, receipt, attestation, badStart, {
    commandStartedAt: "2026-07-11T14:31:00.000Z",
    commandEndedAt: "2026-07-11T14:31:05.000Z",
    gitCollectedAt: "2026-07-11T14:32:00.000Z",
    factsCollectedAt: "2026-07-11T14:32:30.000Z",
  });
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: badStart,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.notEqual(impl.verdict, "IMPLEMENTATION_VERIFIED");
});

test("start-check workspaceRef mismatch rejected", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  const body = {
    schemaVersion: "workspace-start-check/v1",
    verdict: "START_ALLOWED",
    runSpecDigest: start.startCheck.runSpecDigest,
    authorizationReceiptDigest: start.startCheck.authorizationReceiptDigest,
    workspaceAttestationDigest: start.startCheck.workspaceAttestationDigest,
    workspacePolicyDigest: start.startCheck.workspacePolicyDigest,
    attemptId: start.startCheck.attemptId,
    workspaceRef: "other-workspace",
    checkedAt: start.startCheck.checkedAt,
  };
  const startCheckDigest = domainDigest("workspace-start-check/v1", body);
  const badStart = { ...body, startCheckDigest };
  const facts = buildTrustedFacts(runSpec, receipt, attestation, badStart);
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: badStart,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.ok(impl.reasons.some((x) => x.code === "START_CHECK_BINDING_MISMATCH"));
});

test("missing factsDigest is rejected", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  const sealed = buildTrustedFacts(runSpec, receipt, attestation, start.startCheck);
  const { factsDigest: _d, ...rest } = sealed;
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: rest,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.ok(impl.reasons.some((x) => x.code === "FACTS_DIGEST_REQUIRED"));
});

test("command duration exceeding timeout rejected", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  const facts = buildTrustedFacts(runSpec, receipt, attestation, start.startCheck, {
    commandStartedAt: "2026-07-11T12:15:00.000Z",
    commandEndedAt: "2026-07-11T12:30:00.000Z", // 900s > 600 timeout
    gitCollectedAt: "2026-07-11T12:31:00.000Z",
    factsCollectedAt: "2026-07-11T12:31:30.000Z",
  });
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.ok(impl.reasons.some((x) => x.code === "COMMAND_DURATION_EXCEEDS_TIMEOUT"));
});

test("head==base with nonempty changes rejected", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  const facts = buildTrustedFacts(runSpec, receipt, attestation, start.startCheck, {
    headRevision: BASE_SHA,
  });
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.ok(impl.reasons.some((x) => x.code === "GIT_HEAD_BASE_CONTRADICTION"));
});

test("scope violation blocks verification", () => {
  const { runSpec, receipt, attestation, start, policy } = startFixture();
  const baseFacts = buildTrustedFacts(runSpec, receipt, attestation, start.startCheck);
  const { factsDigest: _d, ...rest } = baseFacts;
  rest.git = {
    ...rest.git,
    changedFiles: [{ status: "M", path: "migrations/001.sql" }],
  };
  const facts = sealImplementationFacts(rest);
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  assert.equal(impl.ok, false);
  assert.equal(impl.verdict, "POLICY_VIOLATION");
});

test("workspacePolicy required for implementation evaluation", () => {
  const { runSpec, receipt, attestation, start, facts } = verifyFixture();
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
  });
  assert.equal(impl.ok, false);
  assert.ok(impl.reasons.some((x) => x.code === "WORKSPACE_POLICY_REQUIRED"));
});
