"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RESULT,
  evaluateEntryAuthority,
} = require("../lib/contracts/entry-authority");
const { computeRunSpecDigest } = require("../lib/contracts/run-spec");
const { buildControllerExpectedIdentity } = require("../lib/entry-authority");
const { buildWorkerEntryGate } = require("../lib/worker-entry-gate");

const META_COMMIT = "52f0fe51e2f7a2e021952d4bc4e20ceaee98f3de";
const OLD_META_COMMIT = "8ec31913b52b12a3ebe2660a1ee1aec82695c564";

function runSpec(repository = {}) {
  return {
    schemaVersion: "run-spec/v1",
    runId: "R3-ENTRY-AUTHORITY",
    repository: {
      repositoryId: "github:nathanku3-hue/meta-harness",
      objectFormat: "sha1",
      expectedBaseRevision: META_COMMIT,
      ...repository,
    },
    objective: "Verify repository entry authority before product planning",
    scope: { allow: ["lib/contracts/entry-authority.js"], deny: ["**/*"] },
    validation: {
      commands: [{
        argv: ["node", "--test", "tests/entry-authority.test.js"],
        cwdRelative: ".",
        timeoutSeconds: 120,
        networkPolicy: "denied",
        environmentPolicy: { allow: [] },
      }],
    },
    changePolicy: "forbid-noop",
  };
}

function controllerExpected(over = {}) {
  const spec = over.runSpec || runSpec();
  return {
    source: {
      kind: "controller_authorized_run_spec",
      verified: true,
      reference: computeRunSpecDigest(spec),
      ...(over.source || {}),
    },
    repository: {
      ...spec.repository,
      ...(over.repository || {}),
    },
    authority: {
      path: "E:/Code/meta-harness-s001r5",
      ref: "refs/heads/codex/candidate-d088-thin-loop",
      commit: spec.repository.expectedBaseRevision,
      ...(over.authority || {}),
    },
    runSpec: spec,
  };
}

function observed(over = {}) {
  return {
    repositoryId: "github:nathanku3-hue/meta-harness",
    objectFormat: "sha1",
    observedHeadRevision: META_COMMIT,
    repositoryRoot: "E:/Code/meta-harness-s001r5",
    ref: "refs/heads/codex/candidate-d088-thin-loop",
    clean: true,
    productBytesPresent: true,
    productBytesReachableFromNamedAuthority: true,
    ...over,
  };
}

function evaluate(expected = controllerExpected(), actual = observed()) {
  return evaluateEntryAuthority({ expected, observed: actual });
}

function assertReadOnly(value) {
  assert.equal(value.mutates, false);
  assert.equal(value.writes_files, false);
  assert.equal(value.executes_child_commands, false);
  assert.equal(value.spawns_process, false);
  assert.equal(value.network, false);
  assert.equal(value.creates_worktree, false);
  assert.equal(value.creates_ref, false);
}

test("PASS_CURRENT only for exact trusted identity and observed authority", () => {
  const result = evaluate();
  assert.equal(result.verdict, RESULT.PASS_CURRENT);
  assert.equal(result.ok, true);
  assert.equal(result.redirect, null);
  assert.equal(result.reasons.length, 0);
  assertReadOnly(result);
});

test("Windows path aliases compare without creating a path authority rule", () => {
  const result = evaluate(
    controllerExpected({ authority: { path: "e:\\code\\META-HARNESS-S001R5" } }),
    observed({ repositoryRoot: "E:/Code/meta-harness-s001r5" }),
  );
  assert.equal(result.verdict, RESULT.PASS_CURRENT);
});

test("REDIRECT returns one exact path ref and commit for a stale obvious checkout", () => {
  const result = evaluate(controllerExpected(), observed({
    observedHeadRevision: OLD_META_COMMIT,
    repositoryRoot: "E:/Code/meta-harness",
    ref: "refs/heads/main",
    clean: false,
  }));
  assert.equal(result.verdict, RESULT.REDIRECT);
  assert.equal(result.ok, false);
  assert.deepEqual(result.redirect, {
    path: "E:/Code/meta-harness-s001r5",
    ref: "refs/heads/codex/candidate-d088-thin-loop",
    commit: META_COMMIT,
  });
  assert.match(result.next_action, /meta-harness-s001r5/);
  assertReadOnly(result);
});

test("CUSTODY_REQUIRED wins when useful product bytes lack named Git authority", () => {
  const result = evaluate(controllerExpected(), observed({
    repositoryRoot: "E:/Code/leningrad",
    observedHeadRevision: OLD_META_COMMIT,
    ref: "refs/heads/codex/system1-panic-cascade",
    clean: false,
    productBytesPresent: true,
    productBytesReachableFromNamedAuthority: false,
  }));
  assert.equal(result.verdict, RESULT.CUSTODY_REQUIRED);
  assert.equal(result.redirect, null);
  assert.ok(result.reasons.some((item) => item.code === "PRODUCT_BYTES_OUTSIDE_NAMED_AUTHORITY"));
  assertReadOnly(result);
});

test("unrelated repository never returns custody required", () => {
  const result = evaluate(controllerExpected(), observed({
    repositoryId: "github:other/repository",
    repositoryRoot: "E:/Code/other-repository",
    observedHeadRevision: OLD_META_COMMIT,
    ref: "refs/heads/main",
    clean: false,
    productBytesPresent: true,
    productBytesReachableFromNamedAuthority: false,
  }));
  assert.equal(result.verdict, RESULT.REDIRECT);
  assert.ok(result.reasons.some((item) => item.code === "READINESS_REPOSITORY_MISMATCH"));
  assert.equal(result.reasons.some((item) => item.code === "PRODUCT_BYTES_OUTSIDE_NAMED_AUTHORITY"), false);
});

test("BLOCK when trusted expected identity is absent", () => {
  const result = evaluateEntryAuthority({ expected: null, observed: observed() });
  assert.equal(result.verdict, RESULT.BLOCK);
  assert.ok(result.reasons.some((item) => item.code === "TRUSTED_EXPECTED_IDENTITY_MISSING"));
});

test("BLOCK arbitrary strings and checkout-local self-attestation", () => {
  let result = evaluateEntryAuthority({ expected: "trust me", observed: observed() });
  assert.equal(result.verdict, RESULT.BLOCK);

  const local = controllerExpected({
    source: {
      kind: "checkout_local",
      verified: true,
      reference: "local-file",
    },
  });
  result = evaluate(local);
  assert.equal(result.verdict, RESULT.BLOCK);
  assert.ok(result.reasons.some((item) => item.code === "TRUST_SOURCE_UNTRUSTED"));
});

test("BLOCK every self-asserted non-controller source even with verified true", () => {
  for (const kind of ["authenticated_operator", "signed_canonical", "immutable_evidence"]) {
    const expected = controllerExpected({ source: { kind, verified: true, reference: "self-asserted" } });
    const result = evaluate(expected);
    assert.equal(result.verdict, RESULT.BLOCK, kind);
    assert.ok(result.reasons.some((item) => item.code === "TRUST_SOURCE_UNTRUSTED"), kind);
  }
});

test("controller input derives source, repository, commit, and digest internally", () => {
  const spec = runSpec();
  const expected = buildControllerExpectedIdentity({
    authority: {
      path: "E:/Code/meta-harness-s001r5",
      ref: "refs/heads/codex/candidate-d088-thin-loop",
    },
    runSpec: spec,
  });
  assert.deepEqual(expected.source, {
    kind: "controller_authorized_run_spec",
    verified: true,
    reference: computeRunSpecDigest(spec),
  });
  assert.deepEqual(expected.repository, spec.repository);
  assert.equal(expected.authority.commit, spec.repository.expectedBaseRevision);
  assert.equal(Object.prototype.hasOwnProperty.call(expected.authority, "verified"), false);
});

test("BLOCK contradictory trusted identity before comparing checkout facts", () => {
  const spec = runSpec();
  const expected = controllerExpected({
    runSpec: spec,
    authority: { commit: OLD_META_COMMIT },
  });
  const result = evaluate(expected);
  assert.equal(result.verdict, RESULT.BLOCK);
  assert.ok(result.reasons.some((item) => item.code === "TRUSTED_IDENTITY_CONTRADICTION"));
});

test("BLOCK a dirty or divergent checkout at the named authority path", () => {
  const result = evaluate(controllerExpected(), observed({
    observedHeadRevision: OLD_META_COMMIT,
    clean: false,
  }));
  assert.equal(result.verdict, RESULT.BLOCK);
  assert.equal(result.redirect, null);
  assert.ok(result.reasons.some((item) => item.code === "NAMED_AUTHORITY_STATE_CONTRADICTORY"));
});

test("worker entry consumes PASS_CURRENT and blocks every other entry result", () => {
  const base = {
    operatorPlanArtifactValidation: { verdict: "pass", ok: true },
    selectedRepoResolution: { ok: true, name: "meta-harness", path: "E:/Code/meta-harness-s001r5" },
    executionReadiness: {
      kind: "execution_readiness",
      verdict: "ready",
      ok: true,
      runs_read_only_git_inspection: true,
      executes_child_commands: false,
      mutates: false,
    },
  };

  let gate = buildWorkerEntryGate({
    ...base,
    entryAuthorityInput: { expected: controllerExpected(), observed: observed() },
  });
  assert.equal(gate.verdict, "open");
  assert.equal(gate.required_inputs.entry_authority_verdict, RESULT.PASS_CURRENT);
  assert.equal(gate.entry_authority.verdict, RESULT.PASS_CURRENT);

  for (const entryAuthorityInput of [
    { expected: controllerExpected(), observed: observed({ repositoryRoot: "E:/Code/meta-harness" }) },
    { expected: controllerExpected(), observed: observed({ productBytesReachableFromNamedAuthority: false }) },
    { expected: null, observed: observed() },
    evaluate(),
  ]) {
    gate = buildWorkerEntryGate({ ...base, entryAuthorityInput });
    assert.equal(gate.verdict, "blocked");
    assert.ok(gate.reasons.some((item) => item.code.startsWith("ENTRY_AUTHORITY_")));
  }
});
