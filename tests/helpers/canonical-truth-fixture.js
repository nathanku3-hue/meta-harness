"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { appendEvent, readEvents } = require("../../lib/harness-state");
const {
  createTruthProposal,
  eventFromTruthReceipt,
} = require("../../lib/truth-authority");
const { inspectCanonicalHistory, renderCanonicalStatus } = require("../../lib/truth-reconciler");
const { installTestAuthority, signTruthReceipt } = require("./truth-authority");

function statusField(text, label) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `${label}:`);
  if (start === -1) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Z][A-Za-z0-9 /_-]{1,60}:\s*$/.test(lines[index].trim())) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function installCanonicalFixtureTruth(targetRoot) {
  const statusPath = path.join(targetRoot, ".meta-harness", "status.md");
  const status = fs.readFileSync(statusPath, "utf8").replace(/\r\n?/g, "\n");
  const phase = statusField(status, "Phase").split(/\s*->\s*/)[0].trim();
  const goal = statusField(status, "Goal") || "Exercise the context gate fixture.";
  const currentTruth = statusField(status, "Current truth") || "The context gate fixture is active.";
  const nextAction = statusField(status, "Next action") || "Run the context gate check.";
  const stopCriteria = statusField(status, "Stop criteria") || statusField(status, "Stop rules") || "Stop when the fixture assertion is satisfied.";

  const authority = installTestAuthority(targetRoot);
  const events = readEvents({ cwd: targetRoot });
  const inspected = inspectCanonicalHistory(events, { targetRoot });
  if (inspected.ok) {
    fs.writeFileSync(statusPath, renderCanonicalStatus({ events, targetRoot }), "utf8");
    return;
  }

  const rejected = inspected.unresolved.map((item) => item.event_digest);
  const occurredAt = new Date().toISOString();
  const proposal = createTruthProposal({
    operation: rejected.length > 0 ? "reconcile" : "snapshot",
    stream: "coding",
    phase,
    action: "set canonical context fixture truth",
    goal,
    result: currentTruth,
    next_action: nextAction,
    stop_criteria: stopCriteria,
    occurred_at: occurredAt,
    rejected_event_digests: rejected,
  });
  const receipt = signTruthReceipt({
    authority,
    proposal,
    priorSnapshotDigest: inspected.snapshotDigest || null,
    issuedAt: occurredAt,
  });
  const snapshot = eventFromTruthReceipt(receipt);
  appendEvent({ cwd: targetRoot }, snapshot, { timestamp: occurredAt });
  fs.writeFileSync(statusPath, renderCanonicalStatus({ events: [...events, snapshot], targetRoot }), "utf8");
}

module.exports = { installCanonicalFixtureTruth, statusField };
