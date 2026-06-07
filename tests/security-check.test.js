"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkSecurityBaseline } = require("../lib/security-check");
const { writePhase5SecurityFixture } = require("./helpers/security-fixture");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-security-"));
}

function writePackageLock(root) {
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {}
  }), "utf8");
}

function checkById(result, id) {
  return result.checks.find(check => check.id === id);
}

test("security baseline passes local file posture and warns only on API-only settings", async () => {
  const cwd = tempDir();
  writePackageLock(cwd);
  writePhase5SecurityFixture(cwd);

  const result = await checkSecurityBaseline({ targetRoot: cwd, noExec: true });

  assert.equal(result.status, "warn");
  assert.equal(checkById(result, "SEC_OWNER_FILE_001").status, "pass");
  assert.equal(checkById(result, "SEC_DEP_001").status, "pass");
  assert.equal(checkById(result, "SEC_POLICY_001").status, "pass");
  assert.equal(checkById(result, "SEC_WF_PIN_001").status, "pass");
  assert.equal(checkById(result, "SEC_REPRO_001").status, "pass");
  assert.equal(checkById(result, "SEC_REPORTING_001").status, "warn");
  assert.equal(checkById(result, "SEC_DEP_SETTINGS_001").status, "warn");
  assert.equal(checkById(result, "SEC_OWNER_ENFORCE_001").status, "warn");
});

test("workflow pinning allows local actions but fails remote mutable refs", async () => {
  const cwd = tempDir();
  writePackageLock(cwd);
  writePhase5SecurityFixture(cwd);
  fs.writeFileSync(path.join(cwd, ".github", "workflows", "ci.yml"), [
    "name: CI",
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./local-action",
    "      - uses: actions/checkout@v4",
    "      - run: npm ci",
    ""
  ].join("\n"), "utf8");

  const result = await checkSecurityBaseline({ targetRoot: cwd, noExec: true });
  const pinning = checkById(result, "SEC_WF_PIN_001");

  assert.equal(pinning.status, "fail");
  assert.match(pinning.reason, /full commit SHA/);
  assert.doesNotMatch(pinning.reason, /local-action/);
});

test("strict security settings fail closed without GitHub API credentials", async () => {
  const cwd = tempDir();
  writePackageLock(cwd);
  writePhase5SecurityFixture(cwd);
  const oldToken = process.env.GITHUB_TOKEN;
  const oldRepo = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  try {
    const result = await checkSecurityBaseline({ targetRoot: cwd, noExec: true, strictGithubSettings: true });
    assert.equal(checkById(result, "SEC_REPORTING_001").status, "fail");
    assert.equal(checkById(result, "SEC_DEP_SETTINGS_001").status, "fail");
    assert.equal(checkById(result, "SEC_OWNER_ENFORCE_001").status, "fail");
  } finally {
    if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = oldToken;
    if (oldRepo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = oldRepo;
  }
});

test("security-policy drift is reported when implemented checks are not represented", async () => {
  const cwd = tempDir();
  writePackageLock(cwd);
  writePhase5SecurityFixture(cwd);
  const policyPath = path.join(cwd, ".meta-harness", "security-policy.json");
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  delete policy.workflow_run;
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2), "utf8");

  const result = await checkSecurityBaseline({ targetRoot: cwd, noExec: true });
  const policyCheck = checkById(result, "SEC_POLICY_001");

  assert.equal(policyCheck.status, "fail");
  assert.match(policyCheck.reason, /workflow_run/);
});
