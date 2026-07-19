"use strict";

const eventStore = require("./events");
const { ConfigError } = require("./errors");
const { harnessPath } = require("./harness-state");
const {
  eventFromTruthReceipt,
  validatePublicAuthorityInstallation,
  validateTruthAuthorityReceipt,
} = require("./truth-authority");
const { inspectCanonicalHistory } = require("./truth-reconciler");
const { assertCanonicalMutationPaths } = require("./truth-paths");

function throwAuthority(errors) {
  throw new ConfigError(errors.map((error) => error.message).join("; "), {
    code: "MH_TRUTH_AUTHORITY",
    exitCode: 1,
    details: errors,
  });
}

function preflightInitialCanonicalReceipt(context, authorityDocument, receipt, at = new Date().toISOString()) {
  try {
    validatePublicAuthorityInstallation(context.cwd, authorityDocument);
  } catch (error) {
    throwAuthority([{ code: error.code || "TRUTH_AUTHORITY_KEY_INVALID", message: error.message }]);
  }

  const validation = validateTruthAuthorityReceipt({
    authorityDocument,
    receipt,
    expectedPriorSnapshotDigest: null,
    seenReceiptIds: new Set(),
    at,
    allowLegacy: false,
    allowLegacyAuthority: false,
  });
  if (receipt?.proposal?.operation !== "snapshot") {
    validation.errors.push({ code: "TRUTH_INITIAL_SNAPSHOT_REQUIRED", message: "initial authority receipt must authorize a snapshot" });
    validation.ok = false;
  }
  if (!validation.ok) throwAuthority(validation.errors);

  const event = eventFromTruthReceipt(receipt);
  const simulated = inspectCanonicalHistory([event], { authorityDocument });
  if (!simulated.ok) {
    throw new ConfigError(simulated.contradiction.message, {
      code: "MH_TRUTH_CONTRADICTION",
      exitCode: 1,
      details: simulated.contradiction,
    });
  }
  return event;
}

function appendCanonicalReceipt(context, receipt, { requireInitialSnapshot = false } = {}) {
  const event = eventFromTruthReceipt(receipt);
  assertCanonicalMutationPaths(context.cwd, { allowMissingStatus: true });
  return eventStore.appendEventAtomic(
    harnessPath(context, "events.jsonl"),
    event,
    () => receipt.proposal.occurred_at,
    ({ events, payload }) => {
      if (requireInitialSnapshot && events.length !== 0) {
        throwAuthority([{ code: "TRUTH_INITIAL_STATE_EXISTS", message: "initial authority receipt requires an empty event ledger" }]);
      }
      if (requireInitialSnapshot && receipt.proposal.operation !== "snapshot") {
        throwAuthority([{ code: "TRUTH_INITIAL_SNAPSHOT_REQUIRED", message: "initial authority receipt must authorize a snapshot" }]);
      }

      const history = inspectCanonicalHistory(events, { targetRoot: context.cwd });
      const seenReceiptIds = new Set(
        events
          .map((item) => item.authority_receipt?.receipt_id)
          .filter((value) => typeof value === "string"),
      );
      const validation = validateTruthAuthorityReceipt({
        targetRoot: context.cwd,
        receipt,
        expectedPriorSnapshotDigest: history.snapshotDigest || null,
        seenReceiptIds,
        at: new Date().toISOString(),
        allowLegacy: false,
      });
      if (!validation.ok) throwAuthority(validation.errors);

      const simulated = inspectCanonicalHistory([...events, payload], { targetRoot: context.cwd });
      if (!simulated.ok) {
        throw new ConfigError(simulated.contradiction.message, {
          code: "MH_TRUTH_CONTRADICTION",
          exitCode: 1,
          details: simulated.contradiction,
        });
      }
    },
    { targetRoot: context.cwd },
  );
}

module.exports = { appendCanonicalReceipt, preflightInitialCanonicalReceipt };
