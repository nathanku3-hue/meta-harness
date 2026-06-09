"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ROOT, run, runRaw, snapshotTree, tempDir } = require("./helpers/cli");
const { writePhase5SecurityFixture } = require("./helpers/security-fixture");
const { CHECK_IDS } = require("../lib/release-check");

const DEFAULT_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_GITHUB_SECURITY_EVIDENCE = {
  status: "pass",
  source: "fixture://github-security",
  checked_at: "2026-06-08T00:00:00.000Z",
  commit: DEFAULT_COMMIT,
  dependency_review: "not_applicable_no_dependency_delta",
};

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function releaseEvidenceFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "release-evidence", name), "utf8"));
}

function releaseEvidenceForCommit(commit) {
  const evidence = releaseEvidenceFixture("valid.json");
  evidence.external_evidence.github_security.commit = commit;
  evidence.external_evidence.full_release.commit = commit;
  evidence.external_evidence.github_security.dependency_review = "not_applicable_no_dependency_delta";
  return evidence;
}

function writeLocalReleaseEvidence(root, commit) {
  writeJson(root, ".meta-harness/local/release-evidence.json", releaseEvidenceForCommit(commit));
}

function releasePolicy(evidence = { github_security: DEFAULT_GITHUB_SECURITY_EVIDENCE }) {
  const externalEvidence = evidence?.external_evidence || evidence || {};
  return {
    schema_version: "1",
    package: { name: "dummy-target", registry: "https://registry.npmjs.org/", access: "public", tag_prefix: "v" },
    publish: { workflow: null, trusted_publisher_environment: null },
    evidence_requirements: {
      github_security: { required: true, fields: ["status", "source", "checked_at", "commit"] },
      full_release: { required: true, fields: ["status", "source", "checked_at", "commit"], artifacts: ["executed_test_result", "package_dry_run_output", "publish_mode_external_evidence"] },
    },
    rollback_policy: {
      tag_delete_allowed_only_if_package_unpublished: true,
      partial_publish_requires_incident: true,
      same_version_retry_requires_human_review: true,
    },
    external_evidence: externalEvidence,
  };
}

function writePackageLock(root) {
  writeJson(root, "package-lock.json", { name: "dummy-target", version: "1.0.0", lockfileVersion: 3, packages: {} });
}

function writePackageJson(root, overrides = {}) {
  const pkg = {
    name: "dummy-target",
    version: "1.0.0",
    license: "MIT",
    repository: { type: "git", url: "https://example.com/dummy-target.git" }, bin: { "dummy-target": "bin/dummy.js" },
    files: ["bin/", "README.md", "package.json"],
    scripts: { test: "node -e \"\"", prepublishOnly: "node bin/meta-harness.js release check --publish --json" },
    engines: { node: ">=20" },
    packageManager: "npm@11.16.0",
    devEngines: { runtime: { name: "node", version: ">=20", onFail: "error" }, packageManager: { name: "npm", version: ">=10.9.0", onFail: "error" } },
    ...overrides,
  };
  writeJson(root, "package.json", pkg);
}

function prepareReleaseTarget(options = {}) {
  const root = tempDir("meta-harness-release-");
  run(root, ["init", "Release check target"]);
  run(root, ["templates", "install", "--allow-dirty"]);
  writePhase5SecurityFixture(root);
  writePackageJson(root, options.packageOverrides);
  writePackageLock(root);
  run(root, ["quality", "init"]);
  if (options.policy !== false) {
    writeJson(root, ".meta-harness/release-policy.json", releasePolicy(options.evidence));
  }
  return root;
}

function checkById(result, id) {
  return result.checks.find((item) => item.id === id);
}
function assertTopLevel(result, expected) { for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key); }
function assertCheckStatus(result, id, status) { assert.equal(checkById(result, id).status, status, id); }

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function commitAll(root) {
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Meta Harness Test", "-c", "user.email=meta-harness@example.test", "commit", "-m", "fixture"]);
}

function npmPublishInvocation(args) {
  const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(bundledNpmCli)) {
    return { command: process.execPath, args: [bundledNpmCli, ...args] };
  }
  return { command: "npm", args };
}

test("release check reports missing external evidence without failing local implementation checks", () => {
  const root = prepareReleaseTarget({ evidence: {} });
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { local_ok: true, release_ready: false, external_evidence_ok: false, external_evidence_status: "unknown", full_release_evidence_status: "unknown" });
  assertCheckStatus(data, CHECK_IDS.externalEvidence, "unknown");
  assert.match(checkById(data, CHECK_IDS.externalEvidence).reason, /missing or not evaluated/);
  assertCheckStatus(data, CHECK_IDS.fullReleaseEvidence, "unknown");
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /missing or not evaluated/);
});

test("release check reports invalid external evidence without failing local implementation checks", () => {
  const root = prepareReleaseTarget({ evidence: releaseEvidenceFixture("invalid.json") });
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { local_ok: true, release_ready: false, external_evidence_ok: false, external_evidence_status: "fail", full_release_evidence_status: "fail" });
  assertCheckStatus(data, CHECK_IDS.externalEvidence, "fail");
  assert.equal(checkById(data, CHECK_IDS.externalEvidence).required_for_local, false);
  assert.match(checkById(data, CHECK_IDS.externalEvidence).reason, /evidence invalid/);
  assert.deepEqual(checkById(data, CHECK_IDS.externalEvidence).details.validation_errors, ["source", "commit", "checked_at must be a valid date-time"]);
  assertCheckStatus(data, CHECK_IDS.fullReleaseEvidence, "fail");
  assert.equal(checkById(data, CHECK_IDS.fullReleaseEvidence).required_for_local, false);
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /evidence invalid/);
  assert.deepEqual(checkById(data, CHECK_IDS.fullReleaseEvidence).details.validation_errors, ["commit must be a 40-character hash", "artifacts.package_dry_run_output", "artifacts.publish_mode_external_evidence"]);
});


test("malformed local release evidence overlay fails closed", () => {
  const root = prepareReleaseTarget({ evidence: releaseEvidenceFixture("valid.json") });
  fs.mkdirSync(path.join(root, ".meta-harness", "local"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "local", "release-evidence.json"), "{bad json", "utf8");
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { local_ok: true, release_ready: false, external_evidence_ok: false, external_evidence_status: "fail", full_release_evidence_status: "fail" });
  assert.match(data.release_evidence_source, /local\/release-evidence\.json/);
  assert.match(checkById(data, CHECK_IDS.externalEvidence).reason, /invalid JSON/);
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /invalid JSON/);
});

test("release check --publish accepts exact-commit local evidence for release readiness", { concurrency: false }, () => {
  const root = prepareReleaseTarget({ evidence: { github_security: { status: "not_evaluated", source: null, checked_at: null } } });
  commitAll(root);
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["tag", "v1.0.0"]);
  writeLocalReleaseEvidence(root, commit);
  const result = runRaw(root, ["release", "check", "--publish", "--json"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { ok: true, local_ok: true, release_ready: true, external_evidence_ok: true, external_evidence_status: "pass", full_release_evidence_status: "pass", mode: "publish", publish: true, next_action: "none" });
  assert.match(data.release_evidence_source, /local\/release-evidence\.json/);
  for (const id of [CHECK_IDS.cleanTree, CHECK_IDS.versionTag, CHECK_IDS.externalEvidence, CHECK_IDS.fullReleaseEvidence]) assertCheckStatus(data, id, "pass");
});

test("release check fails package metadata and identity cases", () => {
  const cases = [
    { name: "missing license", packageOverrides: { license: undefined }, checkId: CHECK_IDS.packageMetadata, reason: /license/ },
    { name: "private package", packageOverrides: { private: true }, checkId: CHECK_IDS.packageIdentity, reason: /private/ },
  ];

  for (const item of cases) {
    const root = prepareReleaseTarget({ packageOverrides: item.packageOverrides });
    const result = runRaw(root, ["release", "check", "--json"]);
    assert.equal(result.status, 1, item.name);
    const data = JSON.parse(result.stdout);
    assertTopLevel(data, { local_ok: false, release_ready: false });
    assertCheckStatus(data, item.checkId, "fail");
    assert.match(checkById(data, item.checkId).reason, item.reason, item.name);
  }
});
