"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

test("repo adoption doctor refuses direct forbidden-path reads", () => {
  assert.equal(_test.deniedReadPath(".env"), true);
  assert.equal(_test.deniedReadPath("provider-config/provider.json"), true);
  assert.equal(_test.deniedReadPath(".meta-harness/local/events.jsonl"), true);
  assert.throws(() => _test.safeReadText(tempDir(), ".env"), /refusing to read forbidden path/);
});
