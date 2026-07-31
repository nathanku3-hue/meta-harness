"use strict";

/**
 * D068-final adversarial cases: prior identity, absolute paths, outer envelopes, dup commands.
 * Kept separate to stay under the 300-line test file budget.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  authorizeAttempt,
  validateRunSpec,
  evaluateWorkspaceStart,
  evaluateImplementationFacts,
  validateAttemptAuthorization,
} = require("../lib/contracts");
const {
  sealAuthorizationReceipt,
  addSecondsExactUtc,
  computeAuthorizationRequestDigestFromReceipt,
} = require("../lib/contracts/attempt-authorization");
const {
  validateWorkspacePolicyObject,
  isAbsoluteNormalizedFsPath,
  isPathUnderRoot,
} = require("../lib/contracts/workspace-attestation");
const {
  authorizeFixture,
  authRequest,
  buildApprovalFixture,
  buildReadinessFacts,
  buildRunSpecFixture,
  startFixture,
  verifyFixture,
  NOW,
  POLICY,
  APPROVED_ROOT,
  FIXTURE_REPO_ROOT,
} = require("./helpers/contracts-fixtures");

function getterBaged(base, key) {
  const o = { ...base };
  Object.defineProperty(o, key, {
    enumerable: true,
    get() {
      throw new Error(`getter ran on ${key}`);
    },
  });
  return o;
}

function resealMutated(receipt, mutator) {
  const body = { ...receipt };
  delete body.receiptDigest;
  mutator(body);
  // Keep request digest self-consistent with body fields unless mutator sets it explicitly.
  if (!Object.prototype.hasOwnProperty.call(body, "_skipRequestRecompute")) {
    body.authorizationRequestDigest = computeAuthorizationRequestDigestFromReceipt(body);
  } else {
    delete body._skipRequestRecompute;
  }
  return sealAuthorizationReceipt(body);
}

test("prior-receipt mutation matrix rejects every bound field", () => {
  const { receipt, approval, readiness } = authorizeFixture();
  assert.equal(validateAttemptAuthorization(receipt).ok, true);

  const cases = [
    ["authorizationId", (b) => { b.authorizationId = "AUTH-EVIL"; }],
    ["attemptId", (b) => { b.attemptId = "ATTEMPT-EVIL"; }],
    ["approvalDigest", (b) => { b.approvalDigest = `sha256:${"1".repeat(64)}`; }],
    ["runSpecDigest", (b) => { b.runSpecDigest = `sha256:${"2".repeat(64)}`; }],
    ["executionReadinessDigest", (b) => { b.executionReadinessDigest = `sha256:${"3".repeat(64)}`; }],
    ["authorizationPolicyDigest", (b) => { b.authorizationPolicyDigest = `sha256:${"4".repeat(64)}`; }],
    ["workspacePolicyDigest", (b) => { b.workspacePolicyDigest = `sha256:${"5".repeat(64)}`; }],
    ["provider.id", (b) => { b.provider = { ...b.provider, id: "evil-provider" }; }],
    ["provider.workerProfile", (b) => { b.provider = { ...b.provider, workerProfile: "evil-profile" }; }],
    ["capability", (b) => { b.capability = "evil-capability"; }],
    ["authorizationRequestDigest", (b) => {
      b._skipRequestRecompute = true;
      b.authorizationRequestDigest = `sha256:${"a".repeat(64)}`;
    }],
    ["ttl", (b) => {
      b.expiresAt = addSecondsExactUtc(b.issuedAt, 1);
    }],
  ];

  for (const [label, mutator] of cases) {
    const evil = resealMutated(receipt, mutator);
    const r = authorizeAttempt(approval, readiness, authRequest(), {
      now: NOW,
      policy: POLICY,
      priorReceipt: evil,
    });
    assert.equal(r.ok, false, label);
    assert.notEqual(r.verdict, "AUTHORIZED", label);
    if (r.authorizationReceipt) {
      assert.notEqual(r.authorizationReceipt.attemptId, "ATTEMPT-EVIL", label);
      assert.notEqual(r.authorizationReceipt.provider?.workerProfile, "evil-profile", label);
    }
  }
});

test("mismatched prior authorizationId is CONFLICT not fresh issue", () => {
  const { receipt, approval, readiness } = authorizeFixture();
  const prior = resealMutated(receipt, (b) => { b.authorizationId = "AUTH-OTHER"; });
  const r = authorizeAttempt(approval, readiness, authRequest(), {
    now: NOW,
    policy: POLICY,
    priorReceipt: prior,
  });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "CONFLICT");
  assert.ok(r.reasons.some((x) => x.code === "PRIOR_AUTHORIZATION_ID_MISMATCH"));
});

test("request-digest self-consistency is a receipt invariant", () => {
  const { receipt } = authorizeFixture();
  const forged = resealMutated(receipt, (b) => {
    b.attemptId = "ATTEMPT-EVIL";
    b._skipRequestRecompute = true;
    // copy original request digest string
    b.authorizationRequestDigest = receipt.authorizationRequestDigest;
  });
  assert.equal(validateAttemptAuthorization(forged).ok, false);
  assert.ok(
    validateAttemptAuthorization(forged).reasons.some(
      (x) => x.code === "AUTHORIZATION_REQUEST_DIGEST_MISMATCH",
    ),
  );
});

test("host-native absolute path rules", () => {
  assert.equal(isAbsoluteNormalizedFsPath(APPROVED_ROOT), true);
  assert.equal(isAbsoluteNormalizedFsPath(FIXTURE_REPO_ROOT), true);
  assert.equal(isAbsoluteNormalizedFsPath("."), false);
  assert.equal(isAbsoluteNormalizedFsPath(".."), false);
  assert.equal(isAbsoluteNormalizedFsPath(`rel${path.sep}path`), false);
  assert.equal(isAbsoluteNormalizedFsPath(`${APPROVED_ROOT}${path.sep}..${path.sep}x`), false);
  assert.equal(isAbsoluteNormalizedFsPath(`${APPROVED_ROOT}${path.sep}`), false);
  assert.equal(isAbsoluteNormalizedFsPath(`unnormalized${path.sep}.${path.sep}x`), false);
  assert.equal(isAbsoluteNormalizedFsPath(`${APPROVED_ROOT}\0evil`), false);

  const unnorm = `${APPROVED_ROOT}${path.sep}.${path.sep}nested`;
  assert.equal(isAbsoluteNormalizedFsPath(unnorm), false);

  assert.equal(isPathUnderRoot(APPROVED_ROOT, APPROVED_ROOT), true);
  assert.equal(isPathUnderRoot(FIXTURE_REPO_ROOT, APPROVED_ROOT), true);
  const sibling = path.resolve(path.dirname(APPROVED_ROOT), "sibling-root");
  assert.equal(isPathUnderRoot(sibling, APPROVED_ROOT), false);

  assert.equal(validateWorkspacePolicyObject({
    schemaVersion: "workspace-policy/v1",
    approvedRoot: ".",
  }).ok, false);
  assert.equal(validateWorkspacePolicyObject({
    schemaVersion: "workspace-policy/v1",
    approvedRoot: APPROVED_ROOT,
  }).ok, true);

  const { start } = startFixture({}, { repositoryRoot: "." });
  assert.equal(start.ok, false);
});

test("outer transition envelopes fail closed on getters", () => {
  const approval = buildApprovalFixture();
  const readiness = buildReadinessFacts(approval);

  const badRequest = getterBaged(authRequest(), "authorizationId");
  const r1 = authorizeAttempt(approval, readiness, badRequest, { now: NOW, policy: POLICY });
  assert.equal(r1.ok, false);
  assert.ok(r1.reasons.some((x) => x.code === "ACCESSOR_PROPERTY" || x.code === "STRICT_JSON"));

  const badOptions = getterBaged({ now: NOW, policy: POLICY }, "policy");
  const r2 = authorizeAttempt(approval, readiness, authRequest(), badOptions);
  assert.equal(r2.ok, false);
  assert.ok(r2.reasons.some((x) => x.code === "ACCESSOR_PROPERTY" || x.code === "STRICT_JSON"));

  const { runSpec, receipt, attestation, policy } = startFixture();
  const badStart = getterBaged({
    runSpec,
    authorizationReceipt: receipt,
    attestation,
    workspacePolicy: policy.workspacePolicy,
    now: "2026-07-11T12:10:00.000Z",
  }, "workspacePolicy");
  const s = evaluateWorkspaceStart(badStart);
  assert.equal(s.ok, false);
  assert.doesNotThrow(() => evaluateWorkspaceStart(badStart));

  const { runSpec: rs, receipt: rc, attestation: at, start, facts, policy: pol } = verifyFixture();
  assert.equal(start.ok, true);
  const badImpl = getterBaged({
    runSpec: rs,
    authorizationReceipt: rc,
    workspaceAttestation: at,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
    workspacePolicy: pol.workspacePolicy,
  }, "startCheck");
  const impl = evaluateImplementationFacts(badImpl);
  assert.equal(impl.ok, false);
  assert.doesNotThrow(() => evaluateImplementationFacts(badImpl));

  const badWp = getterBaged({ schemaVersion: "workspace-policy/v1", approvedRoot: APPROVED_ROOT }, "approvedRoot");
  const wp = validateWorkspacePolicyObject(badWp);
  assert.equal(wp.ok, false);
});

test("duplicate command IDs rejected at RunSpec validation", () => {
  const cmd = {
    argv: ["npm", "test"],
    cwdRelative: ".",
    timeoutSeconds: 60,
    networkPolicy: "denied",
    environmentPolicy: { allow: ["CI", "NODE_ENV"] },
  };
  const dup = buildRunSpecFixture({
    validation: { commands: [cmd, { ...cmd, environmentPolicy: { allow: [...cmd.environmentPolicy.allow] } }] },
  });
  const r = validateRunSpec(dup);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === "DUPLICATE_REQUIRED_COMMAND"));

  // same commandId after env allowlist sort
  const orderA = { ...cmd, environmentPolicy: { allow: ["CI", "NODE_ENV"] } };
  const orderB = { ...cmd, environmentPolicy: { allow: ["NODE_ENV", "CI"] } };
  const sortedDup = buildRunSpecFixture({ validation: { commands: [orderA, orderB] } });
  // env allowlists must be unique entries; different order is still two commands with same normalized ID
  // validateValidationCommand requires unique env entries but not sorted — IDs normalize sorted
  const r2 = validateRunSpec(sortedDup);
  assert.equal(r2.ok, false);
  assert.ok(r2.reasons.some((x) => x.code === "DUPLICATE_REQUIRED_COMMAND"));

  const other = {
    argv: ["npm", "run", "lint"],
    cwdRelative: ".",
    timeoutSeconds: 60,
    networkPolicy: "denied",
    environmentPolicy: { allow: ["CI"] },
  };
  const ok = validateRunSpec(buildRunSpecFixture({ validation: { commands: [cmd, other] } }));
  assert.equal(ok.ok, true, JSON.stringify(ok.reasons));
});
