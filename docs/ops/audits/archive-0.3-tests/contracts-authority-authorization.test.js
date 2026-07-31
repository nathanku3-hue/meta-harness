"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  authorizeAttempt,
  validateExecutionReadinessFacts,
  validateAttemptAuthorization,
} = require("../lib/contracts");
const { sealAuthorizationReceipt } = require("../lib/contracts/attempt-authorization");
const {
  buildApprovalFixture,
  buildReadinessFacts,
  authorizeFixture,
  authRequest,
  realOperatorPlanArtifact,
  realExecutionReadiness,
  NOW,
  POLICY,
  APPROVED_AT,
  INSPECTED_AT,
  workspacePolicyDigest,
} = require("./helpers/contracts-fixtures");

test("happy path authorizes with complete approval object", () => {
  const { result, receipt } = authorizeFixture();
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
  assert.equal(result.verdict, "AUTHORIZED");
  assert.equal(receipt.capability, "prepare-workspace");
  assert.equal(receipt.provider.id, POLICY.provider.id);
  assert.ok(receipt.approvalDigest);
  assert.ok(receipt.authorizationPolicyDigest);
  assert.ok(receipt.workspacePolicyDigest);
  assert.equal(receipt.workerEntryGateDigest, undefined);
  assert.equal(receipt.approvedWorkSourceDigest, undefined);
  assert.equal(validateAttemptAuthorization(receipt).ok, true);
});

test("widened RunSpec cannot ride an approval for a different objective/scope", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval);
  // Mutate only nested runSpec fields while keeping approvalDigest from original seal is impossible
  // via seal; simulate by swapping runSpec under a re-seal with wrong digest.
  const widenedApproval = buildApprovalFixture({
    objective: "unapproved objective",
    scope: { allow: ["**"], deny: [] },
  });
  // Different approval entirely — should authorize only for its own exact work
  const r = authorizeAttempt(widenedApproval, buildReadinessFacts(widenedApproval), authRequest(), {
    now: NOW,
    policy: POLICY,
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.runSpecDigest, approval.runSpecDigest);
  // Original readiness with original approval is fine; cross pair fails
  const cross = authorizeAttempt(approval, buildReadinessFacts(widenedApproval), authRequest(), {
    now: NOW,
    policy: POLICY,
  });
  assert.equal(cross.ok, false);
  assert.ok(cross.reasons.some((x) =>
    x.code === "READINESS_RUN_SPEC_MISMATCH" || x.code === "READINESS_DIGEST_MISMATCH"));
});

test("real D064/D065 objects are rejected as readiness facts", () => {
  const approval = buildApprovalFixture();
  const legacy = realExecutionReadiness();
  const r = authorizeAttempt(approval, legacy, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) =>
    x.code === "READINESS_SHAPE" || x.code === "STRICT_JSON" || x.code === "READINESS_NOT_OBJECT"));
  // operator plan is not accepted as an approval either
  const planAsApproval = authorizeAttempt(
    realOperatorPlanArtifact(),
    buildReadinessFacts(approval),
    authRequest(),
    { now: NOW, policy: POLICY },
  );
  assert.equal(planAsApproval.ok, false);
});

test("readiness repository/head mismatch is rejected", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    repositoryId: "other-repo",
  });
  // seal recomputed digest; bind check fails
  const r = authorizeAttempt(approval, readiness, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "READINESS_REPOSITORY_MISMATCH"));
});

test("readiness observedHead must equal expectedBaseRevision", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    observedHeadRevision: "ffffffffffffffffffffffffffffffffffffffff",
  });
  const r = authorizeAttempt(approval, readiness, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "READINESS_HEAD_MISMATCH"));
});

test("future readiness rejected", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    inspectedAt: "2026-07-11T13:00:00.000Z",
  });
  const r = authorizeAttempt(approval, readiness, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "READINESS_IN_FUTURE"));
});

test("readiness before approval rejected", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    inspectedAt: "2026-07-11T10:00:00.000Z",
  });
  const r = authorizeAttempt(approval, readiness, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "READINESS_BEFORE_APPROVAL"));
});

test("stale readiness rejected", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    inspectedAt: INSPECTED_AT,
  });
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: "2026-07-11T18:00:00.000Z",
    policy: POLICY,
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "READINESS_STALE"));
});

test("freshness arithmetic overflow fails closed", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval);
  const badPolicy = {
    ...POLICY,
    maxReadinessAgeSeconds: Number.MAX_SAFE_INTEGER,
  };
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: NOW,
    policy: badPolicy,
  });
  assert.equal(r.ok, false);
});

test("provider comes from policy not request", () => {
  const { receipt } = authorizeFixture();
  assert.deepEqual(receipt.provider, POLICY.provider);
  const withProvider = authorizeAttempt(
    buildApprovalFixture(),
    buildReadinessFacts(buildApprovalFixture()),
    { authorizationId: "A", attemptId: "T", provider: { id: "x", workerProfile: "y" } },
    { now: NOW, policy: POLICY },
  );
  assert.equal(withProvider.ok, false);
  assert.ok(withProvider.reasons.some((x) => x.code === "REQUEST_FIELD_FORBIDDEN"));
});

test("approval in the future is blocked", () => {
  const approval = buildApprovalFixture({}, { approvedAt: "2026-07-11T13:00:00.000Z" });
  // re-seal needed — buildApprovalFixture merges then seals
  const readiness = buildReadinessFacts(approval, { inspectedAt: "2026-07-11T13:00:00.000Z" });
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: NOW,
    policy: POLICY,
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "APPROVAL_IN_FUTURE"));
});

test("idempotent re-auth within full window returns prior", () => {
  const { receipt, approval, readiness, result } = authorizeFixture();
  assert.equal(result.ok, true);
  const again = authorizeAttempt(approval, readiness, authRequest(), {
    now: "2026-07-11T12:30:00.000Z",
    policy: POLICY,
    priorReceipt: receipt,
  });
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.equal(again.authorizationReceipt.receiptDigest, receipt.receiptDigest);
  assert.equal(again.authorizationReceipt.issuedAt, receipt.issuedAt);
});

test("future-issued prior receipt is rejected", () => {
  const { approval, readiness } = authorizeFixture();
  const futurePrior = sealAuthorizationReceipt({
    schemaVersion: "attempt-authorization/v1",
    authorizationId: "AUTH-0001",
    attemptId: "ATTEMPT-1",
    approvalDigest: approval.approvalDigest,
    runSpecDigest: approval.runSpecDigest,
    authorizationRequestDigest: "sha256:" + "c".repeat(64),
    executionReadinessDigest: readiness.readinessDigest,
    authorizationPolicyDigest: "sha256:" + "d".repeat(64),
    workspacePolicyDigest: workspacePolicyDigest(),
    provider: POLICY.provider,
    capability: "prepare-workspace",
    issuedAt: "2026-07-11T13:00:00.000Z",
    expiresAt: "2026-07-11T14:00:00.000Z",
  });
  // Even if digests mismatched we'd conflict; use a real prior and time travel
  const first = authorizeAttempt(approval, readiness, authRequest(), {
    now: "2026-07-11T13:00:00.000Z",
    policy: POLICY,
  });
  assert.equal(first.ok, true);
  const early = authorizeAttempt(approval, readiness, authRequest(), {
    now: "2026-07-11T12:30:00.000Z",
    policy: POLICY,
    priorReceipt: first.authorizationReceipt,
  });
  assert.equal(early.ok, false);
  assert.equal(early.verdict, "STALE");
  assert.ok(early.reasons.some((x) => x.code === "PRIOR_RECEIPT_OUTSIDE_WINDOW"));
  // silence unused
  assert.ok(futurePrior.receiptDigest);
});

test("same authorizationId different attempt conflicts", () => {
  const { receipt, approval, readiness } = authorizeFixture();
  const second = authorizeAttempt(approval, readiness, authRequest({ attemptId: "ATTEMPT-2" }), {
    now: NOW,
    policy: POLICY,
    priorReceipt: receipt,
  });
  assert.equal(second.ok, false);
  assert.equal(second.verdict, "CONFLICT");
});

test("policy change conflicts under same authorizationId", () => {
  const { receipt, approval, readiness } = authorizeFixture();
  const otherPolicy = {
    ...POLICY,
    authorizationTtlSeconds: 1800,
  };
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: NOW,
    policy: otherPolicy,
    priorReceipt: receipt,
  });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "CONFLICT");
});

test("excessive TTL fails closed without RangeError", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval);
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: NOW,
    policy: { ...POLICY, authorizationTtlSeconds: Number.MAX_SAFE_INTEGER },
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) =>
    x.code === "POLICY_BOUND_INVALID" || x.code === "POLICY_ARITHMETIC_OVERFLOW"));
});

test("validateExecutionReadinessFacts requires seal", () => {
  const approval = buildApprovalFixture();
  const sealed = buildReadinessFacts(approval);
  assert.equal(validateExecutionReadinessFacts(sealed).ok, true);
  const { readinessDigest: _d, ...unsealed } = sealed;
  assert.equal(validateExecutionReadinessFacts(unsealed).ok, false);
});

test("workspace policy mismatch on readiness blocks", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval, {
    workspacePolicyDigest: "sha256:" + "e".repeat(64),
  });
  const r = authorizeAttempt(approval, readiness, authRequest(), { now: NOW, policy: POLICY });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "WORKSPACE_POLICY_MISMATCH"));
});
