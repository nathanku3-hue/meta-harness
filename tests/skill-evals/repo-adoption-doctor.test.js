"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { diagnoseRepoAdoption, _test } = require("../../lib/repo-adoption-doctor");
const { ROOT, run, tempDir, writeFile } = require("../helpers/cli");

const EVAL_ROOT = path.join(ROOT, ".agents", "skills", "repo-adoption-doctor", "evals");

function readEval(name) {
  return JSON.parse(fs.readFileSync(path.join(EVAL_ROOT, name), "utf8"));
}

function setupFixture(fixture) {
  const cwd = tempDir();
  for (const [relative, content] of Object.entries(fixture.setup.files || {})) {
    writeFile(cwd, relative, content);
  }
  if (fixture.setup.install_templates) {
    run(cwd, ["templates", "install", "--allow-dirty"]);
  }
  return cwd;
}

function compactFindings(findings) {
  return findings.map((finding) => ({ id: finding.id, severity: finding.severity }));
}

test("repo adoption doctor passes a fully adopted fixture", () => {
  const fixture = readEval("pass-adopted-repo.json");
  const cwd = setupFixture(fixture);
  const result = diagnoseRepoAdoption({ sourceRoot: ROOT, targetRoot: cwd });

  assert.equal(result.ok, fixture.expected.ok);
  assert.deepEqual(result.findings, fixture.expected.findings);
});

test("repo adoption doctor returns exact finding IDs for an unadopted fixture", () => {
  const fixture = readEval("fail-unadopted-repo.json");
  const cwd = setupFixture(fixture);
  const result = diagnoseRepoAdoption({ sourceRoot: ROOT, targetRoot: cwd });

  assert.equal(result.ok, fixture.expected.ok);
  assert.deepEqual(compactFindings(result.findings), fixture.expected.findings);
});

test("repo adoption doctor warns on operative action-law conflicts", () => {
  const fixture = readEval("warn-action-law-conflict.json");
  const cwd = setupFixture(fixture);
  const result = diagnoseRepoAdoption({ sourceRoot: ROOT, targetRoot: cwd });

  assert.equal(result.ok, fixture.expected.ok);
  assert.deepEqual(compactFindings(result.findings), fixture.expected.findings);
  assert.match(result.findings[0].evidence, /AGENTS\.md/);
  assert.match(result.findings[0].evidence, /universal review before new work/);
  assert.match(result.findings[0].evidence, /review or SAW after every round/);
  assert.match(result.findings[0].evidence, /routine owner approval before ordinary continuation/);
});

test("repo adoption doctor puts dirty recovery before generic review without inventing mutation provenance", () => {
  const cwd = tempDir();
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init"]);
  git(["config", "user.email", "doctor@example.invalid"]);
  git(["config", "user.name", "Repo Doctor Test"]);
  writeFile(cwd, "tracked.txt", "baseline\n");
  git(["add", "tracked.txt"]);
  git(["commit", "-m", "baseline"]);
  writeFile(cwd, "tracked.txt", "owner work in progress\n");

  const result = diagnoseRepoAdoption({ sourceRoot: ROOT, targetRoot: cwd });
  const recovery = result.findings.find((entry) => entry.id === "ADOPT_DIRTY_RECOVERY_FIRST");
  assert.equal(result.findings[0].id, "ADOPT_DIRTY_RECOVERY_FIRST");
  assert.equal(recovery.severity, "warn");
  assert.match(recovery.fix, /preserve the checkout/i);
  assert.match(recovery.fix, /provenance only from retained evidence/i);
  assert.match(recovery.evidence, /mutation origin is not established by Git/i);
  assert.doesNotMatch(`${recovery.issue} ${recovery.fix} ${recovery.evidence}`, /reset|clean|stash/i);
});

test("repo adoption doctor refuses direct forbidden-path reads", () => {
  assert.equal(_test.deniedReadPath(".env"), true);
  assert.equal(_test.deniedReadPath("provider-config/provider.json"), true);
  assert.equal(_test.deniedReadPath(".meta-harness/local/events.jsonl"), true);
  assert.throws(() => _test.safeReadText(tempDir(), ".env"), /refusing to read forbidden path/);
});
