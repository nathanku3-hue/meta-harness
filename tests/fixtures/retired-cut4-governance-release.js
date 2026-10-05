"use strict";

const crypto = require("node:crypto");

const { ConfigError } = require("./errors");
const { governanceHash } = require("./context-gate-governance");
const { stateHash } = require("./state-hash");
const {
  cloneJson,
  hashReleaseContent,
  hashReleaseEvent,
  hashReleaseSeal,
  isObject,
  normalizeCompatibility,
  normalizeImpactReport,
  normalizeReleaseManifest,
  serializeRelease,
  sourceMigrationHash,
} = require("./governance-release-core");
const {
  validateReleaseEventLog,
  validateReleaseManifest,
} = require("./governance-release-validation");

function buildProvenanceChain(release, { snapshot, migration, migration_verification: migrationVerification } = {}) {
  if (!snapshot || !migration || !migrationVerification) {
    throw new ConfigError("snapshot, migration, and migration_verification are required to build release provenance");
  }
  const snapshotHash = governanceHash(snapshot);
  const migrationHash = sourceMigrationHash(migration);
  const migrationVerificationHash = stateHash(migrationVerification);
  const withSourceHashes = normalizeReleaseManifest({
    ...release,
    provenance: {
      ...(release && release.provenance || {}),
      snapshot_hash: snapshotHash,
      migration_hash: migrationHash,
      migration_verification_hash: migrationVerificationHash,
      content_hash: null,
      seal_hash: release && release.provenance ? release.provenance.seal_hash || null : null,
    },
  });
  const contentHash = hashReleaseContent(withSourceHashes);
  const withContentHash = normalizeReleaseManifest({
    ...withSourceHashes,
    provenance: { ...withSourceHashes.provenance, content_hash: contentHash },
  });
  const requiresSeal = withContentHash.status === "APPROVED" ||
    withContentHash.status === "RELEASED" ||
    Boolean(release && release.provenance && release.provenance.seal_hash);
  return {
    snapshot_hash: snapshotHash,
    migration_hash: migrationHash,
    migration_verification_hash: migrationVerificationHash,
    content_hash: contentHash,
    seal_hash: requiresSeal ? hashReleaseSeal(withContentHash) : null,
  };
}

function verifyProvenanceChain(release, sources = {}) {
  const brokenLinks = [];
  let expected;
  try {
    expected = buildProvenanceChain(release, sources);
  } catch (error) {
    return {
      ok: false,
      broken_links: ["source_payloads"],
      issues: [{ severity: "fail", code: "source_payloads", message: error.message }],
    };
  }

  const provenance = release && release.provenance || {};
  for (const field of ["snapshot_hash", "migration_hash", "migration_verification_hash", "content_hash"]) {
    if (provenance[field] !== expected[field]) brokenLinks.push(field);
  }
  if ((release.status === "APPROVED" || release.status === "RELEASED" || provenance.seal_hash !== null) &&
    provenance.seal_hash !== expected.seal_hash) {
    brokenLinks.push("seal_hash");
  }
  if (release.snapshot && release.snapshot.governance_hash !== expected.snapshot_hash) brokenLinks.push("snapshot.governance_hash");
  if (release.migration && sources.migration) {
    if (release.migration.version_source !== sources.migration.version_source) brokenLinks.push("migration.version_source");
    if (release.migration.version_target !== sources.migration.version_target) brokenLinks.push("migration.version_target");
  }
  return { ok: brokenLinks.length === 0, broken_links: brokenLinks };
}

function sealProvenance(release) {
  const normalized = normalizeReleaseManifest(release);
  return { ...normalized, provenance: { ...normalized.provenance, seal_hash: hashReleaseSeal(normalized) } };
}

function appendReleaseEvent(release, event) {
  const normalized = normalizeReleaseManifest(release);
  const events = Array.isArray(normalized.events) ? [...normalized.events] : [];
  const timestamp = event.timestamp || new Date().toISOString();
  const next = {
    sequence: events.length + 1,
    type: event.type,
    from_status: event.from_status,
    to_status: event.to_status,
    actor: isObject(event.actor) ? cloneJson(event.actor) : {},
    reason: Object.prototype.hasOwnProperty.call(event, "reason") ? event.reason : null,
    timestamp,
    previous_event_hash: events.length === 0 ? null : events[events.length - 1].event_hash,
  };
  next.event_hash = hashReleaseEvent(next);
  return { ...normalized, status: next.to_status, events: [...events, next], updated_at: timestamp };
}

function assertTransition(condition, message) {
  if (!condition) throw new ConfigError(message);
}

function promoteRelease(release, targetStatus, actor = {}) {
  const normalized = normalizeReleaseManifest(release);
  assertTransition(normalized.status === "DRAFT" && targetStatus === "CANDIDATE", "only DRAFT -> CANDIDATE promotion is allowed");
  return appendReleaseEvent(normalized, {
    type: "RELEASE_PROMOTED",
    from_status: "DRAFT",
    to_status: "CANDIDATE",
    actor,
  });
}

function rejectRelease(release, reason, actor = {}) {
  const normalized = normalizeReleaseManifest(release);
  let targetStatus = null;
  if (normalized.status === "CANDIDATE") targetStatus = "DRAFT";
  if (normalized.status === "APPROVED") targetStatus = "CANDIDATE";
  assertTransition(targetStatus, "only CANDIDATE -> DRAFT and APPROVED -> CANDIDATE rejection is allowed");
  const next = appendReleaseEvent(normalized, {
    type: "RELEASE_REJECTED",
    from_status: normalized.status,
    to_status: targetStatus,
    actor,
    reason,
  });
  return { ...next, provenance: { ...next.provenance, seal_hash: targetStatus === "CANDIDATE" ? hashReleaseSeal(next) : null } };
}

function approvalIdentity(approver) {
  if (typeof approver === "string") return approver;
  return approver && approver.identity;
}

function recordApproval(release, approver) {
  const normalized = normalizeReleaseManifest(release);
  assertTransition(normalized.status === "CANDIDATE", "release must be CANDIDATE before approval");
  const identity = approvalIdentity(approver);
  assertTransition(typeof identity === "string" && identity.trim() !== "", "approver identity is required");
  const approvedBy = Array.isArray(normalized.approved_by) ? [...normalized.approved_by] : [];
  if (approvedBy.some((item) => item && item.identity === identity)) throw new ConfigError(`duplicate release approval: ${identity}`);
  const timestamp = approver && approver.timestamp || new Date().toISOString();
  const approval = { identity, timestamp, ...(approver && approver.signature ? { signature: approver.signature } : {}) };
  const next = appendReleaseEvent({ ...normalized, approved_by: [...approvedBy, approval] }, {
    type: "RELEASE_APPROVED",
    from_status: "CANDIDATE",
    to_status: "APPROVED",
    actor: isObject(approver) ? approver : { identity },
    timestamp,
  });
  return sealProvenance(next);
}

function finalizeRelease(release, actor = {}) {
  const normalized = normalizeReleaseManifest(release);
  assertTransition(normalized.status === "APPROVED", "release must be APPROVED before finalization");
  assertTransition(Array.isArray(normalized.approved_by) && normalized.approved_by.length > 0, "release requires approval before finalization");
  const timestamp = actor && actor.timestamp || new Date().toISOString();
  const next = appendReleaseEvent({ ...normalized, released_at: timestamp }, {
    type: "RELEASE_FINALIZED",
    from_status: "APPROVED",
    to_status: "RELEASED",
    actor,
    timestamp,
  });
  return sealProvenance({ ...next, released_at: timestamp });
}

function createRelease({ snapshot, migration, impact_report: impactReport, compat_result: compatResult, migration_verification: migrationVerification, now, release_id: releaseId } = {}) {
  const timestamp = now || new Date().toISOString();
  const compatibility = normalizeCompatibility(compatResult || {});
  if (typeof compatibility.is_backward_compatible !== "boolean" && typeof compatibility.breaking === "boolean") {
    compatibility.is_backward_compatible = !compatibility.breaking;
  }
  const release = {
    schema_version: "1",
    release_id: releaseId || `release-${crypto.randomUUID()}`,
    version: migration && migration.version_target || snapshot && snapshot.version || "",
    change_type: compatibility.change_level || "NONE",
    status: "DRAFT",
    migration: {
      migration_id: migration && migration.migration_id,
      version_source: migration && migration.version_source,
      version_target: migration && migration.version_target,
      before_hash: impactReport && impactReport.before_hash || null,
      after_hash: impactReport && impactReport.after_hash || null,
    },
    snapshot: { version: snapshot && snapshot.version, governance_hash: snapshot ? governanceHash(snapshot) : null },
    impact_report: normalizeImpactReport(impactReport || {}),
    compatibility,
    provenance: {
      snapshot_hash: snapshot ? governanceHash(snapshot) : null,
      migration_hash: migration ? sourceMigrationHash(migration) : null,
      migration_verification_hash: migrationVerification ? stateHash(migrationVerification) : null,
      content_hash: null,
      seal_hash: null,
    },
    approved_by: [],
    released_at: null,
    events: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  release.provenance.content_hash = hashReleaseContent(release);
  return release;
}

module.exports = {
  appendReleaseEvent,
  buildProvenanceChain,
  createRelease,
  finalizeRelease,
  hashReleaseContent,
  hashReleaseEvent,
  hashReleaseSeal,
  normalizeReleaseManifest,
  promoteRelease,
  recordApproval,
  rejectRelease,
  sealProvenance,
  serializeRelease,
  validateReleaseEventLog,
  validateReleaseManifest,
  verifyProvenanceChain,
};
