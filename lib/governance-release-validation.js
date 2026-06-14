"use strict";

const {
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
  hasOwn,
  hashReleaseContent,
  hashReleaseEvent,
  hashReleaseSeal,
  isObject,
  normalizeReleaseManifest,
  rejectUnknownFields,
} = require("./governance-release-core");

function requireObject(issues, value, field) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_field", `${field} must be an object`, { field });
    return null;
  }
  return value;
}

function requireArray(issues, value, field) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_field", `${field} must be an array`, { field });
    return null;
  }
  return value;
}

function requireString(issues, value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    addIssue(issues, "invalid_field", `${field} must be a non-empty string`, { field });
    return null;
  }
  return value;
}

function requireBoolean(issues, value, field) {
  if (typeof value !== "boolean") {
    addIssue(issues, "invalid_field", `${field} must be a boolean`, { field });
    return null;
  }
  return value;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function requireIsoTimestamp(issues, value, field) {
  if (!isIsoTimestamp(value)) {
    addIssue(issues, "invalid_field", `${field} must be an ISO timestamp`, { field });
    return null;
  }
  return value;
}

function requireHash(issues, value, field, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    addIssue(issues, "invalid_field", `${field} must be a lowercase sha256 hex digest`, { field });
    return null;
  }
  return value;
}

function requireEnum(issues, value, allowed, field) {
  if (typeof value !== "string" || !allowed.has(value)) {
    addIssue(issues, "invalid_field", `${field} has invalid value`, { field, value });
    return null;
  }
  return value;
}

function validateApproval(issues, approval, index) {
  const label = `approved_by[${index}]`;
  if (!requireObject(issues, approval, label)) return;
  rejectUnknownFields(issues, approval, APPROVAL_FIELDS, label);
  requireString(issues, approval.identity, `${label}.identity`);
  requireIsoTimestamp(issues, approval.timestamp, `${label}.timestamp`);
  if (hasOwn(approval, "signature") && approval.signature !== null && typeof approval.signature !== "string") {
    addIssue(issues, "invalid_field", `${label}.signature must be a string or null`, { field: `${label}.signature` });
  }
}

function validateReleaseEventLog(events) {
  const issues = [];
  if (!Array.isArray(events)) {
    addIssue(issues, "invalid_field", "events must be an array", { field: "events" });
    return { ok: false, status: "fail", issues };
  }

  let previousHash = null;
  events.forEach((event, index) => {
    const label = `events[${index}]`;
    if (!isObject(event)) {
      addIssue(issues, "invalid_event", `${label} must be an object`, { event: index });
      return;
    }
    rejectUnknownFields(issues, event, EVENT_FIELDS, label);
    if (event.sequence !== index + 1) addIssue(issues, "event_sequence", `${label}.sequence must be ${index + 1}`, { event: index, expected: index + 1, actual: event.sequence });
    requireEnum(issues, event.type, EVENT_TYPES, `${label}.type`);
    requireEnum(issues, event.from_status, RELEASE_STATUSES, `${label}.from_status`);
    requireEnum(issues, event.to_status, RELEASE_STATUSES, `${label}.to_status`);
    requireObject(issues, event.actor, `${label}.actor`);
    if (hasOwn(event, "reason") && event.reason !== null && typeof event.reason !== "string") addIssue(issues, "invalid_field", `${label}.reason must be a string or null`, { field: `${label}.reason` });
    requireIsoTimestamp(issues, event.timestamp, `${label}.timestamp`);
    if (event.previous_event_hash !== previousHash) addIssue(issues, "event_hash_chain", `${label}.previous_event_hash does not match previous event hash`, { event: index, expected: previousHash, actual: event.previous_event_hash });
    requireHash(issues, event.event_hash, `${label}.event_hash`);
    const expectedHash = hashReleaseEvent(event);
    if (typeof event.event_hash === "string" && event.event_hash !== expectedHash) addIssue(issues, "event_hash", `${label}.event_hash does not match event contents`, { event: index, expected: expectedHash, actual: event.event_hash });
    previousHash = event.event_hash;
  });
  return { ok: issues.length === 0, status: issues.length === 0 ? "pass" : "fail", issues };
}

function validateNestedFields(issues, release) {
  const migration = requireObject(issues, release.migration, "migration");
  if (migration) {
    rejectUnknownFields(issues, migration, MIGRATION_FIELDS, "migration");
    requireString(issues, migration.migration_id, "migration.migration_id");
    requireString(issues, migration.version_source, "migration.version_source");
    requireString(issues, migration.version_target, "migration.version_target");
    requireHash(issues, migration.before_hash, "migration.before_hash");
    requireHash(issues, migration.after_hash, "migration.after_hash");
  }
  const snapshot = requireObject(issues, release.snapshot, "snapshot");
  if (snapshot) {
    rejectUnknownFields(issues, snapshot, SNAPSHOT_FIELDS, "snapshot");
    requireString(issues, snapshot.version, "snapshot.version");
    requireHash(issues, snapshot.governance_hash, "snapshot.governance_hash");
  }
  const impact = requireObject(issues, release.impact_report, "impact_report");
  if (impact) {
    rejectUnknownFields(issues, impact, IMPACT_FIELDS, "impact_report");
    requireEnum(issues, impact.risk_level, RISK_LEVELS, "impact_report.risk_level");
    requireEnum(issues, impact.safety, SAFETY_LEVELS, "impact_report.safety");
    requireString(issues, impact.summary, "impact_report.summary");
    requireObject(issues, impact.counts, "impact_report.counts");
  }
  return { migration, snapshot, impact };
}

function validateCompatibilityAndProvenance(issues, release) {
  const compatibility = requireObject(issues, release.compatibility, "compatibility");
  if (compatibility) {
    rejectUnknownFields(issues, compatibility, COMPATIBILITY_FIELDS, "compatibility");
    requireEnum(issues, compatibility.change_level, CHANGE_TYPES, "compatibility.change_level");
    requireBoolean(issues, compatibility.breaking, "compatibility.breaking");
    requireBoolean(issues, compatibility.migration_required, "compatibility.migration_required");
    requireBoolean(issues, compatibility.is_backward_compatible, "compatibility.is_backward_compatible");
    requireArray(issues, compatibility.reasons, "compatibility.reasons");
  }
  const provenance = requireObject(issues, release.provenance, "provenance");
  if (provenance) {
    rejectUnknownFields(issues, provenance, PROVENANCE_FIELDS, "provenance");
    requireHash(issues, provenance.snapshot_hash, "provenance.snapshot_hash");
    requireHash(issues, provenance.migration_hash, "provenance.migration_hash");
    requireHash(issues, provenance.migration_verification_hash, "provenance.migration_verification_hash");
    requireHash(issues, provenance.content_hash, "provenance.content_hash");
    requireHash(issues, provenance.seal_hash, "provenance.seal_hash", { nullable: true });
  }
  return { compatibility, provenance };
}

function validateApprovals(issues, release) {
  const approvals = requireArray(issues, release.approved_by, "approved_by");
  if (!approvals) return approvals;
  const identities = new Set();
  approvals.forEach((approval, index) => {
    validateApproval(issues, approval, index);
    if (approval && typeof approval.identity === "string") {
      if (identities.has(approval.identity)) addIssue(issues, "duplicate_approval", "approved_by must not contain duplicate identities", { identity: approval.identity });
      identities.add(approval.identity);
    }
  });
  return approvals;
}

function validateCrossFieldRules(issues, release, parts) {
  const normalized = normalizeReleaseManifest(release);
  const { approvals, compatibility, migration, provenance, snapshot } = parts;
  if (Array.isArray(release.events)) {
    const lastEvent = release.events.at(-1);
    if (!lastEvent && normalized.status !== "DRAFT") addIssue(issues, "event_status", "empty events are allowed only for initial DRAFT releases", { status: normalized.status });
    if (lastEvent && lastEvent.to_status !== normalized.status) addIssue(issues, "event_status", "release.status must match the last event to_status", { expected: lastEvent.to_status, actual: normalized.status });
  }
  if (migration && snapshot && normalized.version !== migration.version_target) addIssue(issues, "version_mismatch", "version must match migration.version_target", { expected: migration.version_target, actual: normalized.version });
  if (snapshot && normalized.version !== snapshot.version) addIssue(issues, "version_mismatch", "version must match snapshot.version", { expected: snapshot.version, actual: normalized.version });
  if (compatibility && normalized.change_type !== compatibility.change_level) addIssue(issues, "change_type_mismatch", "change_type must match compatibility.change_level", { expected: compatibility.change_level, actual: normalized.change_type });
  if (compatibility && typeof compatibility.breaking === "boolean" && typeof compatibility.is_backward_compatible === "boolean" && compatibility.is_backward_compatible !== !compatibility.breaking) addIssue(issues, "compatibility_mismatch", "is_backward_compatible must equal !compatibility.breaking");
  if (provenance && snapshot && provenance.snapshot_hash !== snapshot.governance_hash) addIssue(issues, "snapshot_hash_mismatch", "provenance.snapshot_hash must match snapshot.governance_hash", { expected: snapshot.governance_hash, actual: provenance.snapshot_hash });
  if (provenance && typeof provenance.content_hash === "string" && provenance.content_hash !== hashReleaseContent(release)) addIssue(issues, "content_hash", "provenance.content_hash does not match release contents", { expected: hashReleaseContent(release), actual: provenance.content_hash });
  if (normalized.status === "RELEASED" && normalized.released_at === null) addIssue(issues, "released_at", "RELEASED releases require released_at");
  if (normalized.status !== "RELEASED" && normalized.released_at !== null) addIssue(issues, "released_at", "released_at is allowed only for RELEASED releases");
  if ((normalized.status === "APPROVED" || normalized.status === "RELEASED") && (!approvals || approvals.length === 0)) addIssue(issues, "approval_required", `${normalized.status} releases require at least one approval`);
  if (provenance) {
    const expectedSealHash = hashReleaseSeal(release);
    const requiresSeal = normalized.status === "APPROVED" || normalized.status === "RELEASED";
    if ((requiresSeal && provenance.seal_hash !== expectedSealHash) || (!requiresSeal && provenance.seal_hash !== null && provenance.seal_hash !== expectedSealHash)) {
      addIssue(issues, "seal_hash", "provenance.seal_hash does not match release seal", { expected: expectedSealHash, actual: provenance.seal_hash });
    }
  }
}

function validateReleaseManifest(release) {
  const issues = [];
  if (!isObject(release)) {
    addIssue(issues, "invalid_release", "release manifest must be an object");
    return { ok: false, status: "fail", issues };
  }
  rejectUnknownFields(issues, release, TOP_LEVEL_FIELDS, "release manifest");
  const normalized = normalizeReleaseManifest(release);
  requireEnum(issues, normalized.schema_version, new Set(["1"]), "schema_version");
  requireString(issues, normalized.release_id, "release_id");
  requireString(issues, normalized.version, "version");
  requireEnum(issues, normalized.change_type, CHANGE_TYPES, "change_type");
  requireEnum(issues, normalized.status, RELEASE_STATUSES, "status");
  requireIsoTimestamp(issues, normalized.created_at, "created_at");
  requireIsoTimestamp(issues, normalized.updated_at, "updated_at");
  if (normalized.released_at !== null) requireIsoTimestamp(issues, normalized.released_at, "released_at");
  const nested = validateNestedFields(issues, release);
  const compatAndProvenance = validateCompatibilityAndProvenance(issues, release);
  const approvals = validateApprovals(issues, release);
  issues.push(...validateReleaseEventLog(release.events).issues);
  validateCrossFieldRules(issues, release, { ...nested, ...compatAndProvenance, approvals });
  return { ok: issues.length === 0, status: issues.length === 0 ? "pass" : "fail", issues };
}

module.exports = { validateReleaseEventLog, validateReleaseManifest };
