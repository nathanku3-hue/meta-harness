"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { canonicalize } = require("./contracts/canonical-json");
const eventStore = require("./events");
const { ConfigError } = require("./errors");
const {
  canonicalSnapshotDigest,
  eventFromTruthReceipt,
  ledgerEventDigest,
  loadPublicKey,
  normalizePublicAuthority,
  signerKeyId,
  validateTruthAuthorityReceipt,
} = require("./truth-authority");
const { assertCanonicalReadPaths, assertContainedPath } = require("./truth-paths");

const HARNESS_DIR = ".meta-harness";
const TRUTH_CHECK_ID = "MH_TRUTH_001";
const CANONICAL_PHASES = new Set(["intake", "plan", "work", "verify", "synthesize", "handoff", "lookback"]);
const DIRECTION_FIELDS = Object.freeze([
  ["Goal", "goal"],
  ["Phase", "phase"],
  ["Current truth", "result"],
  ["Next action", "next_action"],
  ["Stop criteria", "stop_criteria"],
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedText(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function timestampMs(event) {
  const parsed = Date.parse(event && (event.ts || event.time));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateDirectionFields(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return [{ code: "TRUTH_CANONICAL_NOT_OBJECT", message: "canonical snapshot must be an object" }];
  }
  if (event.truth_snapshot !== true) {
    errors.push({ code: "TRUTH_CANONICAL_MARKER_MISSING", message: "truth_snapshot must be true" });
  }
  if (!CANONICAL_PHASES.has(event.phase)) {
    errors.push({ code: "TRUTH_PHASE_INVALID", message: `canonical phase must be one of: ${[...CANONICAL_PHASES].join(", ")}` });
  }
  for (const [, field] of DIRECTION_FIELDS) {
    if (!nonEmptyString(event[field])) {
      errors.push({ code: "TRUTH_DIRECTION_FIELD_MISSING", field, message: `${field} must be a non-empty string` });
    }
  }
  if (!Number.isFinite(timestampMs(event))) {
    errors.push({ code: "TRUTH_TIMESTAMP_INVALID", message: "canonical snapshot ts must be a valid timestamp" });
  }
  return errors;
}

function validateSecureCanonicalSnapshot(event, {
  targetRoot, authorityDocument, priorSnapshotDigest, seenReceiptIds,
} = {}) {
  const errors = validateDirectionFields(event);
  if (!event.authority_receipt) {
    errors.push({ code: "TRUTH_RECEIPT_MISSING", message: "canonical mutation requires an authority receipt" });
    return { ok: false, errors };
  }
  const receiptValidation = validateTruthAuthorityReceipt({
    targetRoot,
    authorityDocument,
    receipt: event.authority_receipt,
    expectedPriorSnapshotDigest: priorSnapshotDigest,
    seenReceiptIds,
    at: event.ts || event.time,
  });
  errors.push(...receiptValidation.errors);
  if (receiptValidation.ok) {
    const expected = eventFromTruthReceipt(event.authority_receipt);
    if (canonicalize(event) !== canonicalize(expected)) {
      errors.push({
        code: "TRUTH_EVENT_RECEIPT_MISMATCH",
        message: "canonical event does not exactly match the signed proposal",
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateCanonicalSnapshot(event, options = {}) {
  if (!options.targetRoot && options.authorityDocument === undefined) {
    return { ok: false, errors: [{ code: "TRUTH_AUTHORITY_ROOT_REQUIRED", message: "targetRoot or authorityDocument is required for canonical authority validation" }] };
  }
  return validateSecureCanonicalSnapshot(event, options);
}

function sameDigestSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function authorityAnchorFailure(code, message) {
  return { ok: false, snapshot: null, snapshotDigest: null, unresolved: [], contradiction: { code, message } };
}
function inspectSecureHistory(events, { targetRoot, authorityDocument } = {}) {
  let snapshot = null;
  let snapshotDigest = null;
  const unresolved = new Map();
  const seenReceiptIds = new Set();
  const pinnedSigner = events.find((event) => nonEmptyString(event.authority_receipt?.signer_key_id))?.authority_receipt.signer_key_id;
  if (pinnedSigner) {
    let currentSigner;
    try {
      const publicKey = authorityDocument === undefined
        ? loadPublicKey(targetRoot)
        : normalizePublicAuthority(authorityDocument).public_key;
      currentSigner = signerKeyId(publicKey);
    } catch (error) {
      return authorityAnchorFailure(error.code || "TRUTH_AUTHORITY_KEY_MISSING", error.message);
    }
    if (currentSigner !== pinnedSigner) return authorityAnchorFailure("TRUTH_AUTHORITY_KEY_MISMATCH", "truth authority public key does not match the append-only signer anchor");
  }
  events.forEach((event, index) => {
    if (event.truth_snapshot !== true) return;
    const eventDigest = ledgerEventDigest(event);
    const receiptId = event.authority_receipt?.receipt_id;
    const validation = validateSecureCanonicalSnapshot(event, {
      targetRoot,
      authorityDocument,
      priorSnapshotDigest: snapshotDigest,
      seenReceiptIds,
    });
    if (nonEmptyString(receiptId)) seenReceiptIds.add(receiptId);
    if (!validation.ok) {
      unresolved.set(eventDigest, { index, event, event_digest: eventDigest, errors: validation.errors });
      return;
    }

    const proposal = event.authority_receipt.proposal;
    if (proposal.operation === "snapshot") {
      if (unresolved.size > 0) {
        unresolved.set(eventDigest, {
          index,
          event,
          event_digest: eventDigest,
          errors: [{ code: "TRUTH_RECOVERY_REQUIRED", message: "unresolved canonical history requires an authorized reconciliation event" }],
        });
        return;
      }
      snapshot = event;
      snapshotDigest = canonicalSnapshotDigest(event);
      return;
    }

    const rejected = new Set(proposal.rejected_event_digests);
    const pending = new Set(unresolved.keys());
    if (!sameDigestSet(rejected, pending)) {
      unresolved.set(eventDigest, {
        index,
        event,
        event_digest: eventDigest,
        errors: [{ code: "TRUTH_RECONCILIATION_SET_MISMATCH", message: "reconciliation must name exactly every unresolved canonical event digest" }],
      });
      return;
    }
    unresolved.clear();
    snapshot = event;
    snapshotDigest = canonicalSnapshotDigest(event);
  });

  if (unresolved.size > 0) {
    return {
      ok: false,
      snapshot,
      snapshotDigest,
      unresolved: [...unresolved.values()],
      contradiction: {
        code: "TRUTH_CANONICAL_INVALID",
        message: "canonical history contains unresolved malformed or unauthorized events",
        invalid: [...unresolved.values()],
      },
    };
  }
  if (!snapshot) {
    return {
      ok: false,
      snapshot: null,
      snapshotDigest: null,
      unresolved: [],
      contradiction: { code: "TRUTH_CANONICAL_MISSING", message: "no valid canonical truth snapshot exists" },
    };
  }
  return { ok: true, snapshot, snapshotDigest, unresolved: [] };
}

function inspectCanonicalHistory(events, { targetRoot, authorityDocument } = {}) {
  const sourceEvents = Array.isArray(events) ? events : [];
  if (!targetRoot && authorityDocument === undefined) {
    return authorityAnchorFailure("TRUTH_AUTHORITY_ROOT_REQUIRED", "targetRoot or authorityDocument is required for canonical history validation");
  }
  return inspectSecureHistory(sourceEvents, { targetRoot, authorityDocument });
}

function canonicalSnapshotFromEvents(events, options = {}) {
  const inspected = inspectCanonicalHistory(events, options);
  return inspected.ok
    ? { ok: true, snapshot: inspected.snapshot, snapshotDigest: inspected.snapshotDigest }
    : { ok: false, contradiction: inspected.contradiction, snapshot: inspected.snapshot, snapshotDigest: inspected.snapshotDigest };
}

function renderCanonicalStatus({ events, canonicalSnapshot, targetRoot } = {}) {
  const sourceEvents = Array.isArray(events) ? events : [];
  const selected = canonicalSnapshot
    ? { ok: true, snapshot: canonicalSnapshot }
    : canonicalSnapshotFromEvents(sourceEvents, { targetRoot });
  if (!selected.ok) {
    throw new ConfigError(selected.contradiction.message, {
      code: "MH_TRUTH_CONTRADICTION",
      exitCode: 1,
      details: selected.contradiction,
    });
  }
  const snapshot = selected.snapshot;
  const validation = validateDirectionFields(snapshot);
  if (validation.length > 0) {
    throw new ConfigError("canonical truth snapshot is malformed or unauthorized", {
      code: "MH_TRUTH_CONTRADICTION",
      exitCode: 1,
      details: validation,
    });
  }
  return `# Status\n\nGoal:\n${snapshot.goal}\n\nPhase:\n${snapshot.phase}\n\nCurrent truth:\n${snapshot.result}\n\nNext action:\n${snapshot.next_action}\n\nStop criteria:\n${snapshot.stop_criteria}\n\nUpdated:\n${snapshot.ts || snapshot.time}\n`;
}

function readEventsAt(targetRoot) {
  assertCanonicalReadPaths(targetRoot);
  return eventStore.readEvents(path.join(targetRoot, HARNESS_DIR, "events.jsonl"));
}

function reconcileTruth({ targetRoot, events, statusText } = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  const sourceEvents = Array.isArray(events) ? events : readEventsAt(root);
  const selected = inspectCanonicalHistory(sourceEvents, { targetRoot: root });
  if (!selected.ok) {
    return {
      ok: false,
      blocked: true,
      check_id: TRUTH_CHECK_ID,
      canonical_snapshot: selected.snapshot || null,
      canonical_snapshot_digest: selected.snapshotDigest || null,
      unresolved_event_digests: selected.unresolved.map((item) => item.event_digest),
      expected_status: null,
      actual_status: statusText === undefined ? null : normalizedText(statusText),
      contradictions: [selected.contradiction],
    };
  }

  const expectedStatus = renderCanonicalStatus({
    events: sourceEvents,
    canonicalSnapshot: selected.snapshot,
    targetRoot: root,
  });
  const statusPath = path.join(root, HARNESS_DIR, "status.md");
  if (statusText === undefined) {
    assertContainedPath(root, statusPath, {
      allowMissingLeaf: true,
      leafType: "file",
      label: "canonical status projection",
    });
  }
  const exists = statusText !== undefined || fs.existsSync(statusPath);
  const actualStatus = statusText !== undefined
    ? normalizedText(statusText)
    : (exists ? normalizedText(fs.readFileSync(statusPath, "utf8")) : null);
  if (!exists) {
    return {
      ok: false,
      blocked: true,
      check_id: TRUTH_CHECK_ID,
      canonical_snapshot: selected.snapshot,
      canonical_snapshot_digest: selected.snapshotDigest,
      unresolved_event_digests: [],
      expected_status: expectedStatus,
      actual_status: null,
      contradictions: [{ code: "TRUTH_STATUS_MISSING", message: "status projection is missing" }],
    };
  }
  if (actualStatus !== expectedStatus) {
    return {
      ok: false,
      blocked: true,
      check_id: TRUTH_CHECK_ID,
      canonical_snapshot: selected.snapshot,
      canonical_snapshot_digest: selected.snapshotDigest,
      unresolved_event_digests: [],
      expected_status: expectedStatus,
      actual_status: actualStatus,
      contradictions: [{
        code: "TRUTH_PROJECTION_MISMATCH",
        message: "status projection does not exactly match canonical truth",
      }],
    };
  }
  return {
    ok: true,
    blocked: false,
    check_id: TRUTH_CHECK_ID,
    canonical_snapshot: selected.snapshot,
    canonical_snapshot_digest: selected.snapshotDigest,
    unresolved_event_digests: [],
    expected_status: expectedStatus,
    actual_status: actualStatus,
    contradictions: [],
  };
}

function truthCheck({ targetRoot } = {}) {
  const result = reconcileTruth({ targetRoot });
  if (result.ok) return { status: "pass", details: { authority: result.canonical_snapshot.authority } };
  return {
    status: "fail",
    reason: result.contradictions.map((item) => item.message).join("; "),
    next_action: result.unresolved_event_digests.length > 0
      ? "Append an authorized truth reconciliation event naming every unresolved event digest"
      : "Run status --refresh after reconciling canonical truth",
    details: result,
  };
}

function assertTruthReconciled(options = {}) {
  const result = reconcileTruth(options);
  if (!result.ok) {
    throw new ConfigError(result.contradictions.map((item) => item.message).join("; "), {
      code: "MH_TRUTH_CONTRADICTION",
      exitCode: 1,
      details: result,
    });
  }
  return result;
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
