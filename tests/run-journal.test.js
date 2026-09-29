"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appendRunEvent,
  journalDirectory,
  readRunEventsForSession,
  readRunJournal,
  runIdForExecution,
  runIdForSession,
} = require("../lib/run-journal");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-run-journal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runId = runIdForSession(`sha256:${"a".repeat(64)}`);
  return { root, runId };
}

test("run journal is append-only, ordered, and reconstructable after restart", (t) => {
  const { root, runId } = fixture(t);
  const first = appendRunEvent({
    gitCommonDirectory: root,
    runId,
    type: "run/started",
    data: { snapshotOid: "a".repeat(40) },
    now: new Date("2026-09-05T00:00:00.000Z"),
  });
  const second = appendRunEvent({
    gitCommonDirectory: root,
    runId,
    type: "mutation/result",
    data: { snapshotOid: "b".repeat(40), treeOid: "c".repeat(40) },
    now: new Date("2026-09-05T00:00:01.000Z"),
  });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousDigest, first.eventDigest);

  const restarted = readRunJournal({ gitCommonDirectory: root, runId });
  assert.deepEqual(restarted.map((entry) => entry.type), ["run/started", "mutation/result"]);
  assert.equal(restarted[1].data.snapshotOid, "b".repeat(40));
  assert.equal(restarted[1].previousDigest, restarted[0].eventDigest);
});

test("one logical session can have independent physical execution journals", (t) => {
  const { root } = fixture(t);
  const sessionDigest = `sha256:${"b".repeat(64)}`;
  const workspaceA = "00000000-0000-4000-8000-000000000001";
  const workspaceB = "00000000-0000-4000-8000-000000000002";
  const runA = runIdForExecution(sessionDigest, workspaceA);
  const runB = runIdForExecution(sessionDigest, workspaceB);

  assert.notEqual(runA, runB);
  const firstA = appendRunEvent({
    gitCommonDirectory: root,
    runId: runA,
    type: "run/started",
    data: { sessionDigest, workspaceId: workspaceA },
  });
  const firstB = appendRunEvent({
    gitCommonDirectory: root,
    runId: runB,
    type: "run/started",
    data: { sessionDigest, workspaceId: workspaceB },
  });

  assert.equal(firstA.sequence, 1);
  assert.equal(firstB.sequence, 1);
  assert.equal(firstA.previousDigest, null);
  assert.equal(firstB.previousDigest, null);

  const aggregate = readRunEventsForSession({ gitCommonDirectory: root, sessionDigest });
  assert.deepEqual(
    aggregate.map((event) => [event.runId, event.sequence, event.data.workspaceId]).sort(),
    [[runA, 1, workspaceA], [runB, 1, workspaceB]].sort(),
  );
});

test("orphan temporary journal files are not durable events", (t) => {
  const { root, runId } = fixture(t);
  appendRunEvent({
    gitCommonDirectory: root,
    runId,
    type: "run/started",
    data: {},
  });
  const directory = journalDirectory(root, runId);
  fs.writeFileSync(path.join(directory, ".tmp-crash.json"), "{partial", "utf8");

  const events = readRunJournal({ gitCommonDirectory: root, runId });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run/started");
});

test("run journal detects mutation of a committed fact instead of silently rewriting history", (t) => {
  const { root, runId } = fixture(t);
  appendRunEvent({ gitCommonDirectory: root, runId, type: "run/started", data: { value: 1 } });
  const directory = journalDirectory(root, runId);
  const [name] = fs.readdirSync(directory).filter((entry) => /^\d{12}-/u.test(entry));
  const filePath = path.join(directory, name);
  const event = JSON.parse(fs.readFileSync(filePath, "utf8"));
  event.data.value = 2;
  fs.writeFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");

  assert.throws(
    () => readRunJournal({ gitCommonDirectory: root, runId }),
    (error) => error.code === "MH_RUN_JOURNAL_EVENT",
  );
});
