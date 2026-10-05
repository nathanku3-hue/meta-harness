"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runContextGate } = require("../lib/context-gate");

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "context-gate");
const NOW = "2026-06-12T08:30:00.000Z";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "context-gate-fingerprint-"));
}

function copyFixture(name = "complete") {
  const targetRoot = tempDir();
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetRoot, { recursive: true });
  return targetRoot;
}

test("context gate artifacts include fingerprints and explain renders stored hashes", async () => {
  const root = copyFixture();
  const result = await runContextGate({
    cwd: root,
    targetRoot: root,
    from: "plan",
    to: "work",
    roundId: "ROUND-001",
    now: NOW,
    explain: true,
  });
  const stored = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));

  assert.deepEqual(stored.fingerprint, result.artifact.fingerprint);
  assert.match(result.diagnostic, new RegExp(stored.fingerprint.governance_hash));
  assert.match(result.diagnostic, new RegExp(stored.fingerprint.evaluation_hash));
  assert.match(result.diagnostic, new RegExp(stored.fingerprint.evidence_hash));
  assert.match(fs.readFileSync(result.markdownPath, "utf8"), /## Fingerprint/);
});

test("with and without explain produce the same fingerprint when inputs are pinned", async () => {
  const plainRoot = copyFixture();
  const explainRoot = copyFixture();
  const common = {
    from: "plan",
    to: "work",
    roundId: "ROUND-001",
    now: NOW,
  };

  const plain = await runContextGate({
    cwd: plainRoot,
    targetRoot: plainRoot,
    ...common,
  });
  const explained = await runContextGate({
    cwd: explainRoot,
    targetRoot: explainRoot,
    explain: true,
    ...common,
  });

  assert.deepEqual(plain.artifact.fingerprint, explained.artifact.fingerprint);
});
