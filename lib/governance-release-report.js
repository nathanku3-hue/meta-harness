"use strict";

function valueOrDash(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function listItems(items, render) {
  const source = Array.isArray(items) ? items : [];
  if (source.length === 0) return "- None";
  return source.map((item) => `- ${render(item)}`).join("\n");
}

function countValue(counts, key) {
  return counts && Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0;
}

function changeLabel(change) {
  if (!change || typeof change !== "object") return "unknown change";
  const severity = change.severity || change.change_level || "UNKNOWN";
  return `${valueOrDash(change.category)}: ${valueOrDash(change.label || change.breaking_reason || severity)}`;
}

function approvalLabel(approval) {
  if (!approval || typeof approval !== "object") return "unknown approver";
  return `${valueOrDash(approval.identity)} at ${valueOrDash(approval.timestamp)}`;
}

function generateReleaseReportSummary(release = {}) {
  return `Governance release ${valueOrDash(release.version)} is ${valueOrDash(release.status)} with ${valueOrDash(release.change_type)} change type.`;
}

function generateReleaseReport({
  release = {},
  diff = null,
  impact = null,
  compatibility = null,
  migration_verification: migrationVerification = null,
} = {}) {
  const migration = release.migration || {};
  const impactReport = release.impact_report || {};
  const releaseCompatibility = release.compatibility || {};
  const provenance = release.provenance || {};
  const changes = impact && Array.isArray(impact.changes)
    ? impact.changes
    : diff && Array.isArray(diff.changes)
      ? diff.changes
      : [];
  const compatibilitySource = compatibility && compatibility.classification
    ? compatibility.classification
    : compatibility || releaseCompatibility;
  const impactCounts = impactReport.counts || impact && impact.counts || {};
  const approvedBy = Array.isArray(release.approved_by) ? release.approved_by : [];

  return [
    `# Governance Release ${valueOrDash(release.version)}`,
    "",
    generateReleaseReportSummary(release),
    "",
    "## Release Identity",
    "",
    `- release_id: ${valueOrDash(release.release_id)}`,
    `- version: ${valueOrDash(release.version)}`,
    `- status: ${valueOrDash(release.status)}`,
    `- change_type: ${valueOrDash(release.change_type)}`,
    "",
    "## What Changed",
    "",
    listItems(changes, changeLabel),
    "",
    "## Migration",
    "",
    `- migration_id: ${valueOrDash(migration.migration_id)}`,
    `- version_source: ${valueOrDash(migration.version_source)}`,
    `- version_target: ${valueOrDash(migration.version_target)}`,
    `- before_hash: ${valueOrDash(migration.before_hash)}`,
    `- after_hash: ${valueOrDash(migration.after_hash)}`,
    `- verification_ok: ${valueOrDash(migrationVerification && migrationVerification.ok)}`,
    "",
    "## Impact",
    "",
    `- risk_level: ${valueOrDash(impactReport.risk_level)}`,
    `- safety: ${valueOrDash(impactReport.safety)}`,
    `- summary: ${valueOrDash(impactReport.summary)}`,
    `- artifacts: ${valueOrDash(countValue(impactCounts, "artifacts"))}`,
    `- affected_artifacts: ${valueOrDash(countValue(impactCounts, "affected_artifacts"))}`,
    `- readiness_degraded: ${valueOrDash(countValue(impactCounts, "readiness_degraded"))}`,
    `- dependency_edges: ${valueOrDash(countValue(impactCounts, "dependency_edges"))}`,
    "",
    "## Compatibility",
    "",
    `- change_level: ${valueOrDash(compatibilitySource.change_level)}`,
    `- breaking: ${valueOrDash(compatibilitySource.breaking)}`,
    `- migration_required: ${valueOrDash(compatibilitySource.migration_required)}`,
    `- is_backward_compatible: ${valueOrDash(releaseCompatibility.is_backward_compatible)}`,
    "",
    "## Provenance",
    "",
    `- snapshot_hash: ${valueOrDash(provenance.snapshot_hash)}`,
    `- migration_hash: ${valueOrDash(provenance.migration_hash)}`,
    `- migration_verification_hash: ${valueOrDash(provenance.migration_verification_hash)}`,
    `- content_hash: ${valueOrDash(provenance.content_hash)}`,
    `- seal_hash: ${valueOrDash(provenance.seal_hash)}`,
    "",
    "## Approval State",
    "",
    `- released_at: ${valueOrDash(release.released_at)}`,
    `- event_count: ${Array.isArray(release.events) ? release.events.length : 0}`,
    "",
    listItems(approvedBy, approvalLabel),
    "",
  ].join("\n");
}

module.exports = {
  generateReleaseReport,
  generateReleaseReportSummary,
};
