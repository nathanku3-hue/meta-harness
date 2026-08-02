"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runContextGate } = require("../lib/context-gate");
const { replayFromSnapshot } = require("../lib/governance-replay");
const { writeGovernanceSnapshot } = require("../lib/context-gate-governance");
const { installCanonicalFixtureTruth } = require("./helpers/canonical-truth-fixture");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");
const NOW = "2020-01-01T00:00:00.000Z";

function tempDir(prefix = "governance-replay-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyFixture(name = "complete") {
  const targetRoot = tempDir();
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetRoot, { recursive: true });
  return targetRoot;
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function event(index, overrides = {}) {
  const time = `2019-12-31T23:5${index}:00.000Z`;
  return {
    ts: time,
    time,
    actor: "codex",
    stream: "coding",
    phase: "plan",
    action: `pre-write-event-${index}`,
    result: `pre-write result ${index}`,
    evidence: `.meta-harness/events.jsonl#${index}`,
    ...overrides,
  };
}

function writeEvents(root, events) {
  writeFile(root, ".meta-harness/events.jsonl", `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
}

function appendEvent(root, eventValue) {
  fs.appendFileSync(path.join(root, ".meta-harness", "events.jsonl"), `${JSON.stringify(eventValue)}\n`, "utf8");
}

async function writeSnapshotAndGate(root, options = {}) {
  const snapshot = writeGovernanceSnapshot({
    targetRoot: root,
    generatedAt: "2020-01-01T00:00:00.000Z",
  });
  const gate = await runContextGate({
    cwd: root,
    targetRoot: root,
    from: "plan",
    to: "work",
    roundId: "ROUND-001",
    now: NOW,
    ...options,
  });
  return {
    snapshotPath: snapshot.path,
    artifactPath: gate.jsonPath,
    artifact: gate.artifact,
  };
}

test("governance replay matches an immediate fingerprinted context artifact", async () => {
  const root = copyFixture("complete");
  const { snapshotPath, artifactPath, artifact } = await writeSnapshotAndGate(root);

  assert.equal(typeof artifact.fingerprint.governance_hash, "string");
  assert.equal(typeof artifact.fingerprint.evaluation_hash, "string");
  assert.equal(typeof artifact.fingerprint.evidence_hash, "string");

  const replay = await replayFromSnapshot({ snapshotPath, artifactPath, targetRoot: root });

  assert.equal(replay.status, "match");
  assert.equal(replay.replayable, true);
  assert.equal(replay.matches_original, true);
  assert.equal(replay.original.evaluation_hash, replay.replayed.evaluation_hash);
});

test("governance replay rejects legacy artifacts without fingerprints", async () => {
  const root = copyFixture("complete");
  const { snapshotPath, artifactPath } = await writeSnapshotAndGate(root);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  delete artifact.fingerprint;
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const replay = await replayFromSnapshot({ snapshotPath, artifactPath, targetRoot: root });

  assert.equal(replay.status, "fingerprint_missing");
  assert.equal(replay.replayable, false);
});

test("governance replay reports evidence drift for unrelated post-write events", async () => {
  const root = copyFixture("complete");
  const { snapshotPath, artifactPath } = await writeSnapshotAndGate(root);
  appendEvent(root, event(9, {
    ts: "2020-01-02T00:00:00.000Z",
    time: "2020-01-02T00:00:00.000Z",
    action: "unrelated-user-evidence",
    result: "user changed evidence after artifact",
  }));

  const replay = await replayFromSnapshot({ snapshotPath, artifactPath, targetRoot: root });

  assert.equal(replay.status, "evidence_drift");
  assert.equal(replay.replayable, false);
});

test("governance replay filters self-generated gate events before last-five retention", async () => {
  const root = copyFixture("complete");
  writeEvents(root, [0, 1, 2, 3, 4].map((index) => event(index)));
  installCanonicalFixtureTruth(root);
  const { snapshotPath, artifactPath, artifact } = await writeSnapshotAndGate(root, {
    overrideContextGate: {
      reason: "Human accepts the remaining context risk for replay proof.",
      code: "human_override",
      actor: "human",
    },
  });
  appendEvent(root, event(8, {
    ts: "2020-01-02T00:01:00.000Z",
    time: "2020-01-02T00:01:00.000Z",
    actor: "system",
    action: "context-gate-satisfied",
    result: `context gate satisfied: ${artifact.verdict}`,
    transition: artifact.transition,
    round_id: artifact.round_id,
    verdict: artifact.verdict,
    evidence: ".meta-harness/local/context/ROUND-001.json",
    generated_at: artifact.generated_at,
  }));

  const replay = await replayFromSnapshot({ snapshotPath, artifactPath, targetRoot: root });

  assert.equal(replay.status, "match");
  assert.equal(replay.replayable, true);
  assert.equal(replay.diff.length, 0);
});
