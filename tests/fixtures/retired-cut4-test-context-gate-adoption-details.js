"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { detailedOverrideStatus } = require("../lib/context-gate-adoption");
const { checkContextGateArtifact } = require("../lib/ready-context-gate-evaluation");
const { artifact, initAdoptedRepo, writeContextArtifact, writeOverrideEvent } = require("./helpers/context-gate-adoption");

test("detailed override status distinguishes event mismatch reasons", () => {
  const cwd = initAdoptedRepo("plan");
  const generatedAt = new Date(Date.now() - 10_000).toISOString();
  const artifactPath = path.join(cwd, ".meta-harness", "local", "context", "ROUND-001.json");
  const blocked = artifact({
    generated_at: generatedAt,
    override: {
      reason: "Accept the known gap for this run.",
      code: "human_override",
      actor: "human",
    },
  });
  writeContextArtifact(cwd, "ROUND-001", blocked);

  assert.equal(detailedOverrideStatus({ targetRoot: cwd, artifact: blocked, artifactPath }).status, "missing_event");
  assert.equal(detailedOverrideStatus({
    targetRoot: cwd,
    artifact: { ...blocked, generated_at: "not-a-date" },
    artifactPath,
  }).status, "invalid_generated_at");
  assert.match(detailedOverrideStatus({
    targetRoot: cwd,
    artifact: { ...blocked, override: { reason: "", code: "bad", actor: "human" } },
    artifactPath,
  }).status, /^invalid_override:/);

  const staleTs = new Date(Date.parse(generatedAt) - 1000).toISOString();
  writeOverrideEvent(cwd, {
    ts: staleTs,
    action: "context-gate-override",
    transition: "plan->work",
    code: "human_override",
    round_id: "ROUND-001",
    evidence: ".meta-harness/local/context/ROUND-001.json",
  });
  assert.equal(detailedOverrideStatus({ targetRoot: cwd, artifact: blocked, artifactPath }).status, "stale_event");

  const wrongPathCwd = initAdoptedRepo("plan");
  const wrongPathArtifactPath = path.join(wrongPathCwd, ".meta-harness", "local", "context", "ROUND-001.json");
  writeContextArtifact(wrongPathCwd, "ROUND-001", blocked);
  writeOverrideEvent(wrongPathCwd, {
    ts: new Date().toISOString(),
    action: "context-gate-override",
    transition: "plan->work",
    code: "human_override",
    round_id: "ROUND-001",
    evidence: ".meta-harness/local/context/ROUND-999.json",
  });
  assert.equal(detailedOverrideStatus({
    targetRoot: wrongPathCwd,
    artifact: blocked,
    artifactPath: wrongPathArtifactPath,
  }).status, "wrong_artifact_path");
});

test("detailed override status distinguishes wrong round or transition and valid bypass", () => {
  const cwd = initAdoptedRepo("plan");
  const generatedAt = new Date(Date.now() - 10_000).toISOString();
  const artifactPath = path.join(cwd, ".meta-harness", "local", "context", "ROUND-001.json");
  const blocked = artifact({
    generated_at: generatedAt,
    override: {
      reason: "Accept the known gap for this run.",
      code: "human_override",
      actor: "human",
    },
  });
  writeContextArtifact(cwd, "ROUND-001", blocked);

  const freshTs = new Date().toISOString();
  writeOverrideEvent(cwd, {
    ts: freshTs,
    action: "context-gate-override",
    transition: "work->verify",
    code: "human_override",
    round_id: "ROUND-999",
    evidence: ".meta-harness/local/context/ROUND-001.json",
  });
  assert.equal(detailedOverrideStatus({ targetRoot: cwd, artifact: blocked, artifactPath }).status, "wrong_round_or_transition");

  writeOverrideEvent(cwd, {
    ts: freshTs,
    action: "context-gate-override",
    transition: "plan->work",
    code: "human_override",
    round_id: "ROUND-001",
    evidence: ".meta-harness/local/context/ROUND-001.json",
  });
  assert.equal(detailedOverrideStatus({ targetRoot: cwd, artifact: blocked, artifactPath }).status, "valid_bypass");
});

test("context gate explain attaches explanation remediation and provenance without changing default result", () => {
  const cwd = initAdoptedRepo("plan");
  writeContextArtifact(cwd, "ROUND-001", artifact());

  const plain = checkContextGateArtifact({ targetRoot: cwd });
  assert.equal(plain.status, "fail");
  assert.equal(plain.explanation, undefined);
  assert.equal(plain.remediation, undefined);
  assert.equal(plain.provenance, undefined);

  const explained = checkContextGateArtifact({ targetRoot: cwd, explain: true });
  assert.equal(explained.status, plain.status);
  assert.match(explained.explanation.reason, /context gate blocked/);
  assert.equal(explained.explanation.override.status, "no_override");
  assert.match(explained.diagnostic, /Context gate diagnostic/);
  assert.match(typeof explained.remediation === "string"
    ? explained.remediation
    : explained.remediation.commands.map((item) => item.command).join("\n"), /--override-context-gate/);
  assert.equal(explained.provenance.artifact_path, ".meta-harness/local/context/ROUND-001.json");
});
