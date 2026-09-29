"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TRUTH_CHECK_ID = "MH_REPOSITORY_OBSERVATION_004";
const ADVISORY_REASON = "repository-local status is an advisory observation; product completion comes from current product evidence, validation, and integration facts";

function normalizedText(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function readStatus(targetRoot) {
  if (!targetRoot) return null;
  const statusPath = path.join(path.resolve(targetRoot), ".meta-harness", "status.md");
  try {
    const stat = fs.lstatSync(statusPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return normalizedText(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return null;
  }
}

function advisoryResult({ targetRoot, statusText } = {}) {
  const actualStatus = statusText === undefined
    ? readStatus(targetRoot)
    : (statusText ? normalizedText(statusText) : null);
  return {
    ok: true,
    blocked: false,
    check_id: TRUTH_CHECK_ID,
    semantic_role: "OBSERVATION",
    advisory_status: true,
    canonical_snapshot: null,
    canonical_snapshot_digest: null,
    unresolved_event_digests: [],
    expected_status: actualStatus,
    actual_status: actualStatus,
    contradictions: [],
    observations: actualStatus
      ? []
      : [{ code: "ADVISORY_STATUS_ABSENT", message: "repository-local advisory status is absent" }],
    reason: ADVISORY_REASON,
  };
}

function validateCanonicalSnapshot() {
  return {
    ok: false,
    errors: [{
      code: "UNSUPPORTED_SCHEMA",
      message: "pre-0.4 canonical truth snapshots are retired",
    }],
  };
}

function inspectCanonicalHistory() {
  return {
    ok: false,
    snapshot: null,
    snapshotDigest: null,
    unresolved: [],
    contradiction: {
      code: "UNSUPPORTED_SCHEMA",
      message: "pre-0.4 canonical truth history is retired",
    },
  };
}

function canonicalSnapshotFromEvents() {
  const inspected = inspectCanonicalHistory();
  return {
    ok: false,
    snapshot: null,
    snapshotDigest: null,
    contradiction: inspected.contradiction,
  };
}

function renderCanonicalStatus({ targetRoot } = {}) {
  const existing = readStatus(targetRoot);
  if (existing) return existing;
  return [
    "# Status",
    "",
    "Observation state:",
    "No repository-local advisory status is recorded.",
    "",
    "Product completion:",
    "Evaluate current product evidence, validation, and integration facts.",
    "",
  ].join("\n");
}

function reconcileTruth(options = {}) {
  return advisoryResult(options);
}

function truthCheck({ targetRoot } = {}) {
  const details = advisoryResult({ targetRoot });
  return {
    status: "pass",
    reason: ADVISORY_REASON,
    next_action: "Use current product observations; advisory status never gates reversible work",
    details,
  };
}

function assertTruthReconciled({ targetRoot } = {}) {
  return advisoryResult({ targetRoot });
}

module.exports = {
  TRUTH_CHECK_ID,
  assertTruthReconciled,
  canonicalSnapshotFromEvents,
  inspectCanonicalHistory,
  reconcileTruth,
  renderCanonicalStatus,
  truthCheck,
  validateCanonicalSnapshot,
};
