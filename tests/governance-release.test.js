"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildLiveGovernance } = require("../lib/context-gate-governance");
const { applyMigrationToSnapshot, verifyMigration } = require("../lib/governance-migration");
const { analyzeMigrationImpact } = require("../lib/governance-migration-impact");
const { classifyGovernanceChanges } = require("../lib/governance-compatibility");
const {
  buildProvenanceChain,
  createRelease,
  finalizeRelease,
  hashReleaseContent,
  hashReleaseSeal,
  promoteRelease,
  recordApproval,
  rejectRelease,
  validateReleaseEventLog,
  validateReleaseManifest,
  verifyProvenanceChain,
} = require("../lib/governance-release");

function beforeSnapshot() {
  return buildLiveGovernance({ generatedAt: "2026-06-13T00:00:00.000Z" });
}

function migrationSpec(overrides = {}) {
  return {
    schema_version: "1",
    migration_id: "release-test-migration",
    version_source: "0.1.0",
    version_target: "0.2.0",
    expected_change_level: "PATCH",
    actions: [],
    ...overrides,
  };
}

function releaseFixture(overrides = {}) {
  const before = beforeSnapshot();
  const migration = migrationSpec(overrides.migration || {});
  const after = applyMigrationToSnapshot(before, migration);
  const migrationVerification = verifyMigration(migration, before, after);
  const impact = analyzeMigrationImpact(before, migration, []);
  const compatibility = classifyGovernanceChanges(impact.changes);
  const release = createRelease({
    snapshot: after,
    migration,
    migration_verification: migrationVerification,
    impact_report: {
      ...impact,
      risk_level: "LOW",
      summary: "Version-only governance release.",
    },
    compat_result: compatibility,
    now: overrides.now || "2026-06-13T00:00:00.000Z",
    release_id: overrides.release_id || "release-test",
  });
  return { before, after, migration, migrationVerification, impact, compatibility, release };
}

test("release manifests validate snake_case fields and deterministic content hash", () => {
  const first = releaseFixture({ release_id: "release-one", now: "2026-06-13T00:00:00.000Z" }).release;
  const second = releaseFixture({ release_id: "release-two", now: "2027-01-01T00:00:00.000Z" }).release;

  assert.equal(validateReleaseManifest(first).ok, true);
  assert.equal(first.provenance.content_hash, second.provenance.content_hash);
  assert.equal(hashReleaseContent(first), first.provenance.content_hash);

  const camelCase = { ...first, changeType: first.change_type };
  const missing = { ...first };
  delete missing.version;

  assert.equal(validateReleaseManifest(camelCase).ok, false);
  assert.equal(validateReleaseManifest(camelCase).issues.some((item) => item.code === "unknown_field"), true);
  assert.equal(validateReleaseManifest(missing).ok, false);
});

test("release state machine enforces approvals, finalization, and seal hashes", () => {
  const { release } = releaseFixture();

  assert.throws(() => recordApproval(release, { identity: "reviewer" }), /CANDIDATE/);
  assert.throws(() => promoteRelease(release, "APPROVED"), /DRAFT -> CANDIDATE/);

  const candidate = promoteRelease(release, "CANDIDATE", { identity: "author" });
  assert.equal(candidate.status, "CANDIDATE");
  assert.equal(validateReleaseManifest(candidate).ok, true);

  const approved = recordApproval(candidate, {
    identity: "reviewer",
    timestamp: "2026-06-13T01:00:00.000Z",
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.provenance.seal_hash, hashReleaseSeal(approved));
  assert.equal(validateReleaseManifest(approved).ok, true);
  assert.throws(() => recordApproval(approved, { identity: "reviewer" }), /CANDIDATE/);

  const released = finalizeRelease(approved, {
    identity: "release-manager",
    timestamp: "2026-06-13T02:00:00.000Z",
  });
  assert.equal(released.status, "RELEASED");
  assert.equal(released.released_at, "2026-06-13T02:00:00.000Z");
  assert.equal(validateReleaseManifest(released).ok, true);
  assert.throws(() => rejectRelease(released, "too late"), /rejection/);
});

test("release event log rejects tampering and bypassed transitions", () => {
  const { release } = releaseFixture();
  const candidate = promoteRelease(release, "CANDIDATE", { identity: "author" });

  const missingEvent = { ...candidate, events: [] };
  const brokenStatus = { ...candidate, status: "DRAFT" };
  const brokenEventHash = {
    ...candidate,
    events: [{ ...candidate.events[0], actor: { identity: "tampered" } }],
  };
  const brokenSequence = {
    ...candidate,
    events: [{ ...candidate.events[0], sequence: 2 }],
  };

  assert.equal(validateReleaseManifest(missingEvent).issues.some((item) => item.code === "event_status"), true);
  assert.equal(validateReleaseManifest(brokenStatus).issues.some((item) => item.code === "event_status"), true);
  assert.equal(validateReleaseEventLog(brokenEventHash.events).issues.some((item) => item.code === "event_hash"), true);
  assert.equal(validateReleaseEventLog(brokenSequence.events).issues.some((item) => item.code === "event_sequence"), true);
});

test("provenance verification is source-backed", () => {
  const { before, after, migration, migrationVerification, release } = releaseFixture();
  const provenance = buildProvenanceChain(release, {
    snapshot: after,
    migration,
    migration_verification: migrationVerification,
  });

  assert.deepEqual(provenance, release.provenance);
  assert.equal(verifyProvenanceChain(release, {
    snapshot: after,
    migration,
    migration_verification: migrationVerification,
  }).ok, true);

  const tamperedAfter = { ...after, version: "9.9.9" };
  const tampered = verifyProvenanceChain(release, {
    snapshot: tamperedAfter,
    migration,
    migration_verification: verifyMigration(migration, before, after),
  });

  assert.equal(tampered.ok, false);
  assert.equal(tampered.broken_links.includes("snapshot_hash"), true);
});
