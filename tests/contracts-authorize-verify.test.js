"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDraftRunManifest,
  computeManifestDigest,
  authorizeRun,
  buildFixtureEvidenceBundle,
  verifyEvidence,
  digestOf,
  validateRunManifest,
} = require("../lib/contracts");

function openGate(over = {}) {
  return {
    kind: "worker_entry_gate",
    source: "execution_readiness",
    verdict: "open",
    ok: true,
    required_inputs: {
      operator_plan_validation_ok: true,
      selected_repo_resolution_ok: true,
      execution_readiness_ok: true,
      read_only_git_inspection_ran: true,
      executes_child_commands: false,
    },
    reasons: [],
    mutates: false,
    executes_child_commands: false,
    ...over,
  };
}

function cleanRepo(manifest, over = {}) {
  return {
    head: manifest.repository.baseRevision,
    dirty: false,
    isGitRepo: true,
    ...over,
  };
}

function authorizeOk(manifestOver = {}, gateOver = {}, repoOver = {}) {
  const manifest = buildDraftRunManifest(manifestOver);
  return authorizeRun({
    manifest,
    workerEntryGate: openGate(gateOver),
    repoState: cleanRepo(manifest, repoOver),
    now: Date.parse("2026-07-11T12:00:00.000Z"),
  });
}

test("authorize fails without worker_entry_gate.open", () => {
  const manifest = buildDraftRunManifest();
  const blocked = authorizeRun({
    manifest,
    workerEntryGate: openGate({ verdict: "blocked", ok: false }),
    repoState: cleanRepo(manifest),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.verdict, "BLOCKED");
  assert.ok(blocked.reasons.some((r) => r.code === "WORKER_ENTRY_GATE_NOT_OPEN"));
  assert.equal(blocked.authorizedManifest, null);
  assert.equal(blocked.spawns_process, false);
  assert.equal(blocked.network, false);

  const missing = authorizeRun({
    manifest,
    workerEntryGate: null,
    repoState: cleanRepo(manifest),
  });
  assert.equal(missing.verdict, "BLOCKED");
  assert.ok(missing.reasons.some((r) => r.code === "WORKER_ENTRY_GATE_MISSING"));
});

test("authorize fails on expired manifest", () => {
  const manifest = buildDraftRunManifest({
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  const result = authorizeRun({
    manifest,
    workerEntryGate: openGate(),
    repoState: cleanRepo(manifest),
    now: Date.parse("2026-07-11T12:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(result.reasons.some((r) => r.code === "MANIFEST_EXPIRED"));
});

test("authorize fails on dirty tree and HEAD drift", () => {
  const manifest = buildDraftRunManifest();
  const dirty = authorizeRun({
    manifest,
    workerEntryGate: openGate(),
    repoState: cleanRepo(manifest, { dirty: true }),
  });
  assert.equal(dirty.verdict, "BLOCKED");
  assert.ok(dirty.reasons.some((r) => r.code === "DIRTY_TREE"));

  const drift = authorizeRun({
    manifest,
    workerEntryGate: openGate(),
    repoState: cleanRepo(manifest, { head: "0000000000000000000000000000000000000000" }),
  });
  assert.equal(drift.verdict, "BLOCKED");
  assert.ok(drift.reasons.some((r) => r.code === "HEAD_DRIFT"));
});

test("authorize fails on missing digests and invalid scope", () => {
  const noDigest = authorizeRun({
    manifest: buildDraftRunManifest({ operatorPlanArtifactDigest: null }),
    workerEntryGate: openGate(),
    repoState: {
      head: buildDraftRunManifest().repository.baseRevision,
      dirty: false,
      isGitRepo: true,
    },
  });
  assert.equal(noDigest.verdict, "FAILED");
  assert.ok(noDigest.reasons.some((r) => r.code === "OPERATOR_PLAN_DIGEST_MISSING"));

  const badScope = authorizeRun({
    manifest: buildDraftRunManifest({ scope: { allow: [], deny: [] } }),
    workerEntryGate: openGate(),
    repoState: {
      head: buildDraftRunManifest().repository.baseRevision,
      dirty: false,
      isGitRepo: true,
    },
  });
  assert.equal(badScope.verdict, "FAILED");
  assert.ok(badScope.reasons.some((r) => r.code === "SCOPE_ALLOW_REQUIRED"));
});

test("manifestDigest is canonical and immutable after authorize", () => {
  const result = authorizeOk();
  assert.equal(result.ok, true);
  assert.equal(result.verdict, "AUTHORIZED");
  const m = result.authorizedManifest;
  assert.match(m.manifestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(m.manifestDigest, computeManifestDigest(m));
  assert.equal(m.gate.workerEntryGateOk, true);
  assert.equal(m.gate.workerEntryGateVerdict, "open");
  assert.match(m.workerEntryGateDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(m.workerEntryGateDigest, digestOf(openGate()));

  assert.throws(() => {
    m.objective = "mutated";
  }, TypeError);

  const reauth = authorizeRun({
    manifest: { ...buildDraftRunManifest(), manifestDigest: m.manifestDigest },
    workerEntryGate: openGate(),
    repoState: cleanRepo(buildDraftRunManifest()),
  });
  assert.equal(reauth.verdict, "BLOCKED");
  assert.ok(reauth.reasons.some((r) => r.code === "ALREADY_AUTHORIZED"));
});

test("worker and delivery permissions are split and validated", () => {
  const ok = validateRunManifest(buildDraftRunManifest());
  assert.equal(ok.ok, true);

  const workerNet = validateRunManifest(buildDraftRunManifest({
    permissions: {
      worker: {
        network: "allowed",
        protectedBranchWrite: "denied",
        subagents: "denied",
        hostCheckoutWrite: "denied",
      },
      delivery: {
        network: "allowlisted_push_and_draft_pr_only",
        createDraftPr: true,
        pushBranch: true,
        protectedBranchWrite: "denied",
        merge: "denied",
      },
    },
  }));
  assert.equal(workerNet.ok, false);
  assert.ok(workerNet.reasons.some((r) => r.code === "WORKER_PERMISSION_INVALID"));

  const deliveryMerge = validateRunManifest(buildDraftRunManifest({
    permissions: {
      worker: {
        network: "denied",
        protectedBranchWrite: "denied",
        subagents: "denied",
        hostCheckoutWrite: "denied",
      },
      delivery: {
        network: "allowlisted_push_and_draft_pr_only",
        createDraftPr: true,
        pushBranch: true,
        protectedBranchWrite: "denied",
        merge: "allowed",
      },
    },
  }));
  assert.equal(deliveryMerge.ok, false);
  assert.ok(deliveryMerge.reasons.some((r) => r.code === "DELIVERY_PERMISSION_INVALID"));
});

test("verify READY only from required facts", () => {
  const auth = authorizeOk();
  const evidence = buildFixtureEvidenceBundle(auth.authorizedManifest);
  const result = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, "READY");
  assert.equal(result.reasons.length, 0);
  assert.equal(result.spawns_process, false);
  assert.equal(result.network, false);
  assert.equal(result.mutates, false);
});

test("scope violation returns BLOCKED", () => {
  const auth = authorizeOk();
  const evidence = buildFixtureEvidenceBundle(auth.authorizedManifest, {
    diff: {
      patchHash: digestOf({ patch: "scope-bad" }),
      changedFiles: [
        { path: "migrations/001.sql", status: "added" },
      ],
    },
  });
  const result = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence,
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.scope_violation, true);
  assert.ok(result.reasons.some((r) => String(r.code).startsWith("SCOPE_")));
});

test("missing provider facts returns FAILED; failed command returns BLOCKED", () => {
  const auth = authorizeOk();
  const missingCmd = buildFixtureEvidenceBundle(auth.authorizedManifest, {
    commands: [],
  });
  const failedMissing = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence: missingCmd,
  });
  assert.equal(failedMissing.verdict, "FAILED");
  assert.ok(failedMissing.reasons.some((r) => r.code === "VALIDATION_COMMAND_MISSING"));

  const badExit = buildFixtureEvidenceBundle(auth.authorizedManifest, {
    commands: [{
      command: auth.authorizedManifest.validation.commands[0],
      cwd: "/abs/worktree/path",
      exitCode: 1,
      outputHash: digestOf({ fail: true }),
    }],
  });
  const blockedCmd = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence: badExit,
  });
  assert.equal(blockedCmd.verdict, "BLOCKED");
  assert.ok(blockedCmd.reasons.some((r) => r.code === "VALIDATION_COMMAND_FAILED"));

  const noHead = buildFixtureEvidenceBundle(auth.authorizedManifest, {
    workspace: {
      baseRevision: auth.authorizedManifest.repository.baseRevision,
      headRevision: "",
      branch: "mh/run",
    },
  });
  const failedHead = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence: noHead,
  });
  assert.equal(failedHead.verdict, "FAILED");
  assert.ok(failedHead.reasons.some((r) => r.code === "HEAD_REVISION_REQUIRED"));
});

test("digest mismatch blocks; contract layer never spawns", () => {
  const auth = authorizeOk();
  const evidence = buildFixtureEvidenceBundle(auth.authorizedManifest, {
    manifestDigest: digestOf({ tampered: true }),
  });
  const result = verifyEvidence({
    authorizedManifest: auth.authorizedManifest,
    evidence,
  });
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(result.reasons.some((r) => r.code === "MANIFEST_DIGEST_MISMATCH"));
  assert.equal(result.spawns_process, false);
  assert.equal(result.network, false);
  assert.equal(result.executes_child_commands, false);
});
