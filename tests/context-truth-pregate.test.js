"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { run, runRaw, tempDir, writeFile } = require("./helpers/cli");
const { installCanonicalFixtureTruth } = require("./helpers/canonical-truth-fixture");

test("MH_TRUTH_001 blocks context before scoring and cannot be overridden", () => {
  const cwd = tempDir("context-truth-pregate-");
  run(cwd, ["init", "Context truth pre-gate"]);
  const harness = path.join(cwd, ".meta-harness");
  const statusPath = path.join(harness, "status.md");
  const eventsPath = path.join(harness, "events.jsonl");
  const eventsBefore = fs.readFileSync(eventsPath, "utf8");
  const stale = fs.readFileSync(statusPath, "utf8").replace(
    "Translate the goal into a bounded worker task.",
    "Resume D076 release mechanics.",
  );
  fs.writeFileSync(statusPath, stale, "utf8");

  const result = runRaw(cwd, [
    "context", "check",
    "--from", "intake",
    "--to", "plan",
    "--round", "ROUND-001",
    "--json",
    "--override-context-gate", "accept stale status",
    "--override-context-gate-code", "human_override",
  ]);

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.blocked, true);
  assert.equal(output.truth_blocked, true);
  assert.equal(output.check_id, "MH_TRUTH_001");
  assert.equal(output.score_computed, false);
  assert.equal(output.scores, null);
  assert.equal(output.overall_score, null);
  assert.equal(output.wrote, false);
  assert.equal(output.override_applied, false);
  assert.match(output.reason, /status projection does not exactly match canonical truth/i);
  assert.equal(fs.readFileSync(statusPath, "utf8"), stale);
  assert.equal(fs.readFileSync(eventsPath, "utf8"), eventsBefore);
  assert.equal(fs.existsSync(path.join(harness, "local", "context", "ROUND-001.json")), false);
});

test("context evaluation cannot alter canonical status when evidence is insufficient", () => {
  const cwd = tempDir("context-truth-refresh-");
  fs.cpSync(path.join(__dirname, "fixtures", "context-gate", "complete"), cwd, { recursive: true });
  installCanonicalFixtureTruth(cwd);
  writeFile(cwd, ".meta-harness/contracts/context-adoption.md", "# Context Gate Adoption Contract\n");

  const statusBefore = fs.readFileSync(path.join(cwd, ".meta-harness", "status.md"), "utf8");
  const eventsPath = path.join(cwd, ".meta-harness", "events.jsonl");
  const eventsBefore = fs.readFileSync(eventsPath, "utf8");
  const checked = runRaw(cwd, [
    "context", "check",
    "--from", "plan",
    "--to", "work",
    "--round", "ROUND-018",
    "--json",
  ]);
  assert.equal(checked.status, 0, checked.stderr);
  const output = JSON.parse(checked.stdout);
  assert.equal(output.verdict, "blocked");
  assert.equal(output.truth_blocked, undefined);
  assert.equal(fs.readFileSync(eventsPath, "utf8"), eventsBefore);
  const status = runRaw(cwd, ["status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, statusBefore);
  assert.doesNotMatch(status.stdout, /context gate satisfied|ROUND-018/);
});
