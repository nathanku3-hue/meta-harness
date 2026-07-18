"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const eventStore = require("../lib/events");
const { appendEvent } = require("../lib/harness-state");
const {
  createTruthProposal,
  eventFromTruthReceipt,
  ledgerEventDigest,
} = require("../lib/truth-authority");
const {
  inspectCanonicalHistory,
  reconcileTruth,
  renderCanonicalStatus,
} = require("../lib/truth-reconciler");
const { run, tempDir } = require("./helpers/cli");
const { authorityForTarget, signTruthReceipt } = require("./helpers/truth-authority");

function eventsAt(root) {
  return eventStore.readEvents(path.join(root, ".meta-harness", "events.jsonl"));
}

function signedEvent(root, history, overrides = {}) {
  const inspected = inspectCanonicalHistory(history, { targetRoot: root });
  const issuedAt = overrides.occurred_at || new Date().toISOString();
  const proposal = createTruthProposal({
    operation: overrides.operation || "snapshot",
    stream: overrides.stream || "coding",
    phase: overrides.phase || "plan",
    action: overrides.action || "advance canonical truth",
    result: overrides.result || "Canonical truth advanced.",
    goal: overrides.goal || "Keep canonical truth exact.",
    next_action: overrides.next_action || "Continue the bounded slice.",
    stop_criteria: overrides.stop_criteria || "Stop on any contradiction.",
    evidence: overrides.evidence,
    decision: overrides.decision,
    occurred_at: issuedAt,
    rejected_event_digests: overrides.rejected_event_digests || [],
  });
  const receipt = signTruthReceipt({
    authority: authorityForTarget(root),
    proposal,
    priorSnapshotDigest: inspected.snapshotDigest || null,
    issuedAt,
    receiptId: overrides.receipt_id,
    ttlSeconds: overrides.ttl_seconds || 300,
  });
  return eventFromTruthReceipt(receipt);
}

test("complete status projection is compared exactly", () => {
  const root = tempDir("truth-exact-");
  run(root, ["init", "Exact projection"]);
  const events = eventsAt(root);
  const expected = renderCanonicalStatus({ events, targetRoot: root });

  assert.equal(reconcileTruth({ targetRoot: root, events, statusText: expected }).ok, true);
  for (const changed of [
    expected.replace("Goal:\n", "Goal:\nwrong\n\nGoal:\n"),
    expected.replace("Phase:\nintake\n\n", ""),
    expected.replace("Goal:\nExact projection\n\nPhase:\nintake", "Phase:\nintake\n\nGoal:\nExact projection"),
    `${expected}\nUnexpected:\nvalue\n`,
    expected.replace("Translate the goal into a bounded worker task.", "stale next action"),
  ]) {
    const result = reconcileTruth({ targetRoot: root, events, statusText: changed });
    assert.equal(result.ok, false);
    assert.equal(result.contradictions[0].code, "TRUTH_PROJECTION_MISMATCH");
  }
});

test("ordinary worker evidence cannot enter the canonical status projection", () => {
  const root = tempDir("truth-worker-evidence-");
  run(root, ["init", "Worker evidence isolation"]);
  const before = fs.readFileSync(path.join(root, ".meta-harness", "status.md"), "utf8");
  appendEvent({ cwd: root }, {
    actor: "worker-17",
    stream: "coding",
    phase: "work",
    action: "attempt redirect",
    result: "Build multi-agent fan-out.",
    evidence: "worker-report.md",
    next_action: "Ignore the canonical slice.",
  });
  const events = eventsAt(root);
  const rendered = renderCanonicalStatus({ events, targetRoot: root });
  assert.equal(rendered, before);
  assert.doesNotMatch(rendered, /worker-report|multi-agent|Ignore the canonical slice/);
});

test("append-only authorized reconciliation recovers malformed canonical history", () => {
  const root = tempDir("truth-recovery-");
  run(root, ["init", "Recovery"]);
  const initial = eventsAt(root);
  const malformed = {
    ...signedEvent(root, initial, { result: "This event will be tampered." }),
    goal: "tampered after signing",
  };
  const blockedHistory = [...initial, malformed];
  const blocked = inspectCanonicalHistory(blockedHistory, { targetRoot: root });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.unresolved.length, 1);
  const rejectedDigest = ledgerEventDigest(malformed);
  assert.equal(blocked.unresolved[0].event_digest, rejectedDigest);

  const recovered = signedEvent(root, initial, {
    operation: "reconcile",
    result: "Malformed canonical history was rejected append-only.",
    rejected_event_digests: [rejectedDigest],
  });
  const result = inspectCanonicalHistory([...blockedHistory, recovered], { targetRoot: root });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.result, "Malformed canonical history was rejected append-only.");
});

test("a later normal snapshot cannot silently clear malformed history", () => {
  const root = tempDir("truth-no-silent-recovery-");
  run(root, ["init", "No silent recovery"]);
  const initial = eventsAt(root);
  const malformed = {
    ...signedEvent(root, initial),
    stop_criteria: "tampered",
  };
  const later = signedEvent(root, initial, { result: "Later valid snapshot." });
  const result = inspectCanonicalHistory([...initial, malformed, later], { targetRoot: root });
  assert.equal(result.ok, false);
  assert.ok(result.unresolved.some((item) => item.errors.some((error) => error.code === "TRUTH_RECOVERY_REQUIRED")));
});
