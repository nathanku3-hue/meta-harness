"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateRunSpec,
  computeRunSpecDigest,
  validateRunSpecApproval,
} = require("../lib/contracts");
const { sealRunSpecApproval } = require("../lib/contracts/run-spec-approval");
const {
  buildRunSpecFixture,
  buildApprovalFixture,
  computeRunSpecDigest: digestOfSpec,
} = require("./helpers/contracts-fixtures");

test("slim RunSpec accepts required fields only", () => {
  const spec = buildRunSpecFixture();
  const r = validateRunSpec(spec);
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.ok(computeRunSpecDigest(spec).startsWith("sha256:"));
});

test("RunSpec rejects approvedWorkBinding, deliveryRequest, budgets", () => {
  for (const field of [
    { approvedWorkBinding: { sourceKind: "x", sourceDigest: "sha256:" + "a".repeat(64), packetId: "p" } },
    { deliveryRequest: { requestedMode: "none" } },
    { budgets: { attempts: 1, wallClockSeconds: 1 } },
  ]) {
    const r = validateRunSpec(buildRunSpecFixture(field));
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.code === "UNKNOWN_FIELD"));
  }
});

test("cwdRelative rejects traversal and absolute paths", () => {
  for (const cwd of ["../../outside", "/abs", "C:\\win", "foo/../bar", "foo//bar", "foo/"]) {
    const r = validateRunSpec(buildRunSpecFixture({
      validation: {
        commands: [{
          argv: ["npm", "test"],
          cwdRelative: cwd,
          timeoutSeconds: 60,
          networkPolicy: "denied",
          environmentPolicy: { allow: [] },
        }],
      },
    }));
    assert.equal(r.ok, false, cwd);
    assert.ok(r.reasons.some((x) => x.code === "VALIDATION_CWD_INVALID"), cwd);
  }
});

test("timeoutSeconds rejects values above protocol ceiling", () => {
  const r = validateRunSpec(buildRunSpecFixture({
    validation: {
      commands: [{
        argv: ["npm", "test"],
        cwdRelative: ".",
        timeoutSeconds: 999999999,
        networkPolicy: "denied",
        environmentPolicy: { allow: [] },
      }],
    },
  }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "VALIDATION_TIMEOUT_INVALID"));
});

test("RunSpecApproval seals nested RunSpec and digests", () => {
  const approval = buildApprovalFixture();
  const r = validateRunSpecApproval(approval);
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
});

test("RunSpecApproval rejects digests beside a different nested RunSpec", () => {
  const approval = buildApprovalFixture();
  const widened = buildRunSpecFixture({ objective: "unapproved objective", scope: { allow: ["**"], deny: [] } });
  const tampered = sealRunSpecApproval({
    schemaVersion: "run-spec-approval/v1",
    approvalId: approval.approvalId,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    runSpec: widened,
    runSpecDigest: approval.runSpecDigest,
  });
  // seal recomputes approvalDigest over mismatched body — structure ok but runSpecDigest mismatch
  const r = validateRunSpecApproval(tampered);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "RUN_SPEC_DIGEST_MISMATCH"));
});

test("RunSpecApproval rejects approvalDigest mismatch", () => {
  const approval = buildApprovalFixture();
  const bad = { ...approval, approvalDigest: "sha256:" + "b".repeat(64) };
  const r = validateRunSpecApproval(bad);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "APPROVAL_DIGEST_MISMATCH"));
});

test("digest of RunSpec is stable", () => {
  const a = digestOfSpec(buildRunSpecFixture());
  const b = digestOfSpec(buildRunSpecFixture());
  assert.equal(a, b);
});
