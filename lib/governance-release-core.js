"use strict";

const { validateMigrationSpec } = require("./governance-migration");
const { stableJson, stateHash } = require("./state-hash");
const { ConfigError } = require("./errors");

const RELEASE_STATUSES = new Set(["DRAFT", "CANDIDATE", "APPROVED", "RELEASED"]);
const CHANGE_TYPES = new Set(["NONE", "PATCH", "MINOR", "MAJOR"]);
const SAFETY_LEVELS = new Set(["SAFE", "REQUIRES_REGENERATION", "REQUIRES_MANUAL_REVIEW"]);
const RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const EVENT_TYPES = new Set(["RELEASE_PROMOTED", "RELEASE_REJECTED", "RELEASE_APPROVED", "RELEASE_FINALIZED"]);

const TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version", "release_id", "version", "change_type", "status", "migration", "snapshot",
  "impact_report", "compatibility", "provenance", "approved_by", "released_at", "events", "created_at", "updated_at",
]);
const MIGRATION_FIELDS = Object.freeze(["migration_id", "version_source", "version_target", "before_hash", "after_hash"]);
const SNAPSHOT_FIELDS = Object.freeze(["version", "governance_hash"]);
const IMPACT_FIELDS = Object.freeze(["risk_level", "safety", "summary", "counts"]);
const COMPATIBILITY_FIELDS = Object.freeze(["change_level", "breaking", "migration_required", "is_backward_compatible", "reasons"]);
const PROVENANCE_FIELDS = Object.freeze(["snapshot_hash", "migration_hash", "migration_verification_hash", "content_hash", "seal_hash"]);
const APPROVAL_FIELDS = Object.freeze(["identity", "timestamp", "signature"]);
const EVENT_FIELDS = Object.freeze(["sequence", "type", "from_status", "to_status", "actor", "reason", "timestamp", "previous_event_hash", "event_hash"]);

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function addIssue(issues, code, message, details = {}) { issues.push({ severity: "fail", code, message, ...details }); }

function rejectUnknownFields(issues, value, allowed, label) {
  if (!isObject(value)) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) addIssue(issues, "unknown_field", `${label} contains unknown field: ${key}`, { field: key });
  }
}

function normalizeCompatibility(input = {}) {
  const classification = input.classification && isObject(input.classification) ? input.classification : input;
  return {
    change_level: classification.change_level,
    breaking: classification.breaking,
    migration_required: classification.migration_required,
    is_backward_compatible: classification.is_backward_compatible,
    reasons: Array.isArray(classification.reasons) ? cloneJson(classification.reasons) : [],
  };
}

function normalizeImpactReport(input = {}) {
  return {
    risk_level: input.risk_level,
    safety: input.safety,
    summary: input.summary,
    counts: isObject(input.counts) ? cloneJson(input.counts) : {},
  };
}

function normalizeReleaseManifest(release) {
  const input = isObject(release) ? release : {};
  return {
    schema_version: input.schema_version,
    release_id: input.release_id,
    version: input.version,
    change_type: input.change_type,
    status: input.status,
    migration: isObject(input.migration) ? {
      migration_id: input.migration.migration_id,
      version_source: input.migration.version_source,
      version_target: input.migration.version_target,
      before_hash: input.migration.before_hash,
      after_hash: input.migration.after_hash,
    } : input.migration,
    snapshot: isObject(input.snapshot) ? {
      version: input.snapshot.version,
      governance_hash: input.snapshot.governance_hash,
    } : input.snapshot,
    impact_report: isObject(input.impact_report) ? normalizeImpactReport(input.impact_report) : input.impact_report,
    compatibility: isObject(input.compatibility) ? {
      change_level: input.compatibility.change_level,
      breaking: input.compatibility.breaking,
      migration_required: input.compatibility.migration_required,
      is_backward_compatible: input.compatibility.is_backward_compatible,
      reasons: Array.isArray(input.compatibility.reasons) ? cloneJson(input.compatibility.reasons) : input.compatibility.reasons,
    } : input.compatibility,
    provenance: isObject(input.provenance) ? {
      snapshot_hash: input.provenance.snapshot_hash,
      migration_hash: input.provenance.migration_hash,
      migration_verification_hash: input.provenance.migration_verification_hash,
      content_hash: input.provenance.content_hash,
      seal_hash: hasOwn(input.provenance, "seal_hash") ? input.provenance.seal_hash : null,
    } : input.provenance,
    approved_by: Array.isArray(input.approved_by) ? cloneJson(input.approved_by) : input.approved_by,
    released_at: hasOwn(input, "released_at") ? input.released_at : null,
    events: Array.isArray(input.events) ? cloneJson(input.events) : input.events,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

function serializeRelease(release) { return stableJson(normalizeReleaseManifest(release)); }

function contentHashInput(release) {
  const normalized = normalizeReleaseManifest(release);
  return {
    schema_version: normalized.schema_version,
    version: normalized.version,
    change_type: normalized.change_type,
    migration: normalized.migration,
    snapshot: normalized.snapshot,
    impact_report: normalized.impact_report,
    compatibility: normalized.compatibility,
    provenance: {
      snapshot_hash: normalized.provenance && normalized.provenance.snapshot_hash,
      migration_hash: normalized.provenance && normalized.provenance.migration_hash,
      migration_verification_hash: normalized.provenance && normalized.provenance.migration_verification_hash,
    },
  };
}

function hashReleaseContent(release) { return stateHash(contentHashInput(release)); }
function hashReleaseSeal(release) {
  const normalized = normalizeReleaseManifest(release);
  return stateHash({ ...normalized, provenance: { ...normalized.provenance, seal_hash: null } });
}
function hashReleaseEvent(event) {
  const { event_hash: _eventHash, ...canonical } = event;
  return stateHash(canonical);
}

function sourceMigrationHash(migration) {
  const validation = validateMigrationSpec(migration);
  if (!validation.ok) {
    throw new ConfigError(`invalid governance migration spec: ${validation.issues.map((item) => item.code).join(", ")}`, {
      details: { issues: validation.issues },
    });
  }
  return stateHash(validation.spec);
}

module.exports = {
  APPROVAL_FIELDS,
  CHANGE_TYPES,
  COMPATIBILITY_FIELDS,
  EVENT_FIELDS,
  EVENT_TYPES,
  IMPACT_FIELDS,
  MIGRATION_FIELDS,
  PROVENANCE_FIELDS,
  RELEASE_STATUSES,
  RISK_LEVELS,
  SAFETY_LEVELS,
  SNAPSHOT_FIELDS,
  TOP_LEVEL_FIELDS,
  addIssue,
  cloneJson,
  hasOwn,
  hashReleaseContent,
  hashReleaseEvent,
  hashReleaseSeal,
  isObject,
  normalizeCompatibility,
  normalizeImpactReport,
  normalizeReleaseManifest,
  rejectUnknownFields,
  serializeRelease,
  sourceMigrationHash,
};
