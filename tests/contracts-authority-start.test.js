"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateWorkspaceStart, validateWorkspaceAttestation } = require("../lib/contracts");
const { domainDigest } = require("../lib/contracts/digest");
const {
  startFixture,
  buildAttestationFixture,
  authorizeFixture,
  WORKSPACE_POLICY,
} = require("./helpers/contracts-fixtures");

test("start allowed for clean workspace under approved root", () => {
  const { start, attestation } = startFixture();
  assert.equal(start.ok, true, JSON.stringify(start.reasons));
  assert.equal(start.verdict, "START_ALLOWED");
  assert.ok(start.startCheck.startCheckDigest);
  assert.ok(start.startCheck.workspacePolicyDigest);
  assert.equal(validateWorkspaceAttestation(attestation).ok, true);
  assert.ok(attestation.repositoryId);
  assert.ok(attestation.objectFormat);
  assert.ok(attestation.workspacePolicyDigest);
});

test("dirty workspace is blocked", () => {
  const { start } = startFixture({}, { clean: false });
  assert.equal(start.ok, false);
  assert.equal(start.verdict, "BLOCKED");
});

test("workspace outside approved root is blocked", () => {
  const { start } = startFixture({}, { repositoryRoot: "/other/root/repo" });
  assert.equal(start.ok, false);
  assert.ok(start.reasons.some((x) => x.code === "WORKSPACE_OUTSIDE_APPROVED_ROOT"));
});

test("SHA mismatch blocks start", () => {
  const { start } = startFixture({}, {
    currentHead: "ffffffffffffffffffffffffffffffffffffffff",
    baseRevision: "ffffffffffffffffffffffffffffffffffffffff",
  });
  assert.equal(start.ok, false);
});

test("different workspacePolicy at start is rejected", () => {
  const { runSpec, receipt, attestation } = startFixture();
  const start = evaluateWorkspaceStart({
    runSpec,
    authorizationReceipt: receipt,
    attestation,
    workspacePolicy: { schemaVersion: "workspace-policy/v1", approvedRoot: "/" },
    now: "2026-07-11T12:10:00.000Z",
  });
  assert.equal(start.ok, false);
  assert.ok(start.reasons.some((x) => x.code === "WORKSPACE_POLICY_MISMATCH"));
});

test("attestation missing repository identity fails validation", () => {
  const { runSpec, receipt } = authorizeFixture();
  const att = buildAttestationFixture(runSpec, receipt);
  const { repositoryId: _r, objectFormat: _o, attestationDigest: _d, ...rest } = att;
  // incomplete shape
  assert.equal(validateWorkspaceAttestation(rest).ok, false);
});

test("expired authorization at start is STALE", () => {
  const { runSpec, receipt, attestation, policy } = startFixture();
  const start = evaluateWorkspaceStart({
    runSpec,
    authorizationReceipt: receipt,
    attestation,
    workspacePolicy: policy.workspacePolicy,
    now: "2026-07-11T14:00:00.000Z",
  });
  assert.equal(start.ok, false);
  assert.equal(start.verdict, "STALE");
});

test("start check binds workspace policy digest", () => {
  const { start, policy } = startFixture();
  const expected = domainDigest("workspace-policy/v1", policy.workspacePolicy);
  assert.equal(start.startCheck.workspacePolicyDigest, expected);
  assert.equal(WORKSPACE_POLICY.approvedRoot, "/approved/root");
});
