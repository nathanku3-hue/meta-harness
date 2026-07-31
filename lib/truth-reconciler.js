"use strict";

const { ConfigError } = require("./errors");

const TRUTH_CHECK_ID = "MH_SEMANTIC_TRUTH_004";
const BLOCK_REASON = "pre-0.4 canonical truth interpretation is retired; deterministic terminal projection is not installed yet";

function blockedResult() {
  return {
    ok: false,
    blocked: true,
    check_id: TRUTH_CHECK_ID,
    canonical_snapshot: null,
    canonical_snapshot_digest: null,
    unresolved_event_digests: [],
    expected_status: null,
    actual_status: null,
    contradictions: [{
      code: "SEMANTIC_CANONICAL_STATE_UNAVAILABLE",
      message: BLOCK_REASON,
    }],
  };
}

function validateCanonicalSnapshot() {
  return {
    ok: false,
    errors: [{
      code: "UNSUPPORTED_SCHEMA",
      message: BLOCK_REASON,
    }],
  };
}

function inspectCanonicalHistory() {
  const result = blockedResult();
  return {
    ok: false,
    snapshot: null,
    snapshotDigest: null,
    unresolved: [],
    contradiction: result.contradictions[0],
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

function renderCanonicalStatus() {
  return "# Status\n\nAuthority state:\nSemantic kernel transition in progress.\n\nProduct acceptance:\nNot evaluated.\n\nCanonical closure:\nUnavailable until deterministic terminal projection is installed.\n";
}

function reconcileTruth() {
  return blockedResult();
}

function truthCheck() {
  return {
    status: "fail",
    reason: BLOCK_REASON,
    next_action: "Complete SliceAuthorization, terminal assessment, publication observation, and deterministic closure projection",
    details: blockedResult(),
  };
}

function assertTruthReconciled() {
  throw new ConfigError(BLOCK_REASON, {
    code: "SEMANTIC_CANONICAL_STATE_UNAVAILABLE",
    exitCode: 1,
    details: blockedResult(),
  });
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
