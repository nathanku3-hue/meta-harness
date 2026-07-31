"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TRUTH_CHECK_ID = "MH_SEMANTIC_TRUTH_004";
const ADVISORY_REASON = "repository-local status is advisory; release authority is produced only by the Meta-Harness 0.4 semantic kernel";

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
  const actualStatus = statusText === undefined ? readStatus(targetRoot) : normalizedText(statusText);
  if (!actualStatus || actualStatus.trim().length === 0) {
    return {
      ok: false,
      blocked: true,
      check_id: TRUTH_CHECK_ID,
      authority_mode: "semantic-kernel/v2",
      advisory_status: true,
      canonical_snapshot: null,
      canonical_snapshot_digest: null,
      unresolved_event_digests: [],
      expected_status: null,
      actual_status: actualStatus,
      contradictions: [{
        code: "ADVISORY_STATUS_MISSING",
        message: "repository-local advisory status is missing",
      }],
    };
  }
  return {
    ok: true,
    blocked: false,
    check_id: TRUTH_CHECK_ID,
    authority_mode: "semantic-kernel/v2",
    advisory_status: true,
    canonical_snapshot: null,
    canonical_snapshot_digest: null,
    unresolved_event_digests: [],
    expected_status: actualStatus,
    actual_status: actualStatus,
    contradictions: [],
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
    "Authority state:",
    "Repository-local status is advisory.",
    "",
    "Product acceptance:",
    "Not evaluated.",
    "",
    "Canonical closure:",
    "Produced only by a completed Meta-Harness 0.4 semantic-kernel terminal operation.",
    "",
  ].join("\n");
}

function reconcileTruth(options = {}) {
  return advisoryResult(options);
}

function truthCheck({ targetRoot } = {}) {
  const details = advisoryResult({ targetRoot });
  return details.ok
    ? {
      status: "pass",
      reason: ADVISORY_REASON,
      next_action: "Use the semantic-kernel execution and release chain for authoritative acceptance",
      details,
    }
    : {
      status: "fail",
      reason: details.contradictions[0].message,
      next_action: "Create .meta-harness/status.md with explicit advisory project state",
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
