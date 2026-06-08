"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ROOT, run, runRaw, snapshotTree, tempDir } = require("./helpers/cli");
const { writePhase5SecurityFixture } = require("./helpers/security-fixture");
const { CHECK_IDS } = require("../lib/release-check");

const DEFAULT_GITHUB_SECURITY_EVIDENCE = { status: "pass", source: "fixture://github-security", checked_at: "2026-06-08T00:00:00.000Z" };

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function releaseEvidenceFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "release-evidence", name), "utf8"));
}

function releasePolicy(evidence = { github_security: DEFAULT_GITHUB_SECURITY_EVIDENCE }) {
  const externalEvidence = evidence?.external_evidence || evidence || {};
  return {
    schema_version: "1",
    package: { name: "dummy-target", registry: "https://registry.npmjs.org/", access: "public", tag_prefix: "v" },
    publish: { workflow: null, trusted_publisher_environment: null },
    evidence_requirements: {
      github_security: { required: true, fields: ["status", "source", "checked_at"] },
      full_release: { required: true, fields: ["status", "source", "checked_at"], artifacts: ["executed_test_result", "package_dry_run_output", "publish_mode_external_evidence"] },
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
    scripts: { test: "node -e \"\"" },
    engines: { node: ">=20" },
    packageManager: "npm@11.16.0",
    devEngines: { runtime: { name: "node", version: ">=20", onFail: "error" }, packageManager: { name: "npm", version: ">=11.6.0", onFail: "error" } },
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

test("release check --json with GitHub evidence recorded still requires full release evidence", () => {
  const root = prepareReleaseTarget();
  const before = snapshotTree(root);

  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(snapshotTree(root), before);

  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { schema_version: "1", local_ok: true, ok: true, release_ready: false, external_evidence_ok: false, git_tree_clean: null, release_policy_source: ".meta-harness/release-policy.json" });
  assertCheckStatus(data, CHECK_IDS.cleanTree, "unknown");
  assert.equal(checkById(data, CHECK_IDS.cleanTree).required_for_local, false);
  assert.equal(checkById(data, CHECK_IDS.cleanTree).required_for_release, true);
  for (const id of [CHECK_IDS.policy, CHECK_IDS.ready, CHECK_IDS.quality, CHECK_IDS.test, CHECK_IDS.packDryRun, CHECK_IDS.externalEvidence]) assertCheckStatus(data, id, "pass");
  assert.equal(checkById(data, CHECK_IDS.test).required_for_release, false);
  assert.equal(checkById(data, CHECK_IDS.packDryRun).required_for_release, false);
  assertCheckStatus(data, CHECK_IDS.fullReleaseEvidence, "unknown");
  assert.equal(data.full_release_evidence_status, "unknown");
  assert.equal(checkById(data, CHECK_IDS.fullReleaseEvidence).required_for_local, false);
  assert.equal(checkById(data, CHECK_IDS.fullReleaseEvidence).required_for_release, true);
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /full release evidence/);
});

test("release check reports dirty git tree without failing local checks", () => {
  const root = prepareReleaseTarget();
  git(root, ["init"]);

  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  const cleanTree = checkById(data, CHECK_IDS.cleanTree);
  assertTopLevel(data, { local_ok: true, release_ready: false, git_tree_clean: false });
  assert.ok(data.git_dirty_count > 0);
  assert.equal(cleanTree.status, "fail");
  assert.equal(cleanTree.required_for_local, false);
  assert.equal(cleanTree.required_for_release, true);
  assert.equal(cleanTree.details.git_status, "dirty");
  assert.ok(cleanTree.details.dirty_entries.some((entry) => entry.includes("package.json")));
});

test("release check --publish fails closed on release readiness while preserving local result", () => {
  const root = prepareReleaseTarget({ evidence: { github_security: { status: "not_evaluated", source: null, checked_at: null } } });
  commitAll(root);
  const result = runRaw(root, ["release", "check", "--publish", "--json"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { ok: false, local_ok: true, release_ready: false, external_evidence_ok: false, mode: "publish", publish: true });
  assertCheckStatus(data, CHECK_IDS.cleanTree, "pass");
  assertCheckStatus(data, CHECK_IDS.externalEvidence, "unknown");
  assert.match(checkById(data, CHECK_IDS.externalEvidence).reason, /external GitHub\/security evidence missing/);
  assertCheckStatus(data, CHECK_IDS.fullReleaseEvidence, "unknown");
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /full release evidence/);
});

test("package prepublishOnly binds npm publish to the fail-closed release check boundary", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts?.prepublishOnly, "node bin/meta-harness.js release check --publish --json");

  const npmPublish = npmPublishInvocation(["publish", "--dry-run", "--foreground-scripts"]);
  const result = spawnSync(npmPublish.command, npmPublish.args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /"publish": true/);
  assert.match(output, /"local_ok": true/);
  assert.match(output, /"release_ready": false/);
  assert.match(output, /REL_FULL_RELEASE_EVIDENCE_001/);
  assert.doesNotMatch(output, /npm notice Publishing to .*\(dry-run\)/);
});

test("release check allows only the publish-mode prepublishOnly guard", () => {
  const allowed = prepareReleaseTarget({
    packageOverrides: { scripts: { test: "node -e \"\"", prepublishOnly: "node bin/meta-harness.js release check --publish --json" } },
  });
  const allowedResult = runRaw(allowed, ["release", "check", "--json"]);
  assert.equal(allowedResult.status, 0);
  const allowedData = JSON.parse(allowedResult.stdout);
  assert.equal(checkById(allowedData, CHECK_IDS.lifecycle).status, "pass");
  assert.equal(checkById(allowedData, CHECK_IDS.packDryRun).status, "pass");

  const blocked = prepareReleaseTarget({
    packageOverrides: { scripts: { test: "node -e \"\"", prepublishOnly: "node bin/meta-harness.js release check" } },
  });
  const blockedResult = runRaw(blocked, ["release", "check", "--json"]);
  assert.equal(blockedResult.status, 1);
  const blockedData = JSON.parse(blockedResult.stdout);
  assert.equal(checkById(blockedData, CHECK_IDS.lifecycle).status, "fail");
  assert.deepEqual(checkById(blockedData, CHECK_IDS.lifecycle).details.blocked, ["prepublishOnly"]);
  assert.equal(checkById(blockedData, CHECK_IDS.packDryRun).status, "fail");
});

test("release check fails local readiness when release policy is missing", () => {
  const root = prepareReleaseTarget({ policy: false });
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { local_ok: false, release_ready: false });
  assertCheckStatus(data, CHECK_IDS.policy, "fail");
  assert.match(checkById(data, CHECK_IDS.policy).reason, /release-policy\.json missing/);
});

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
  assert.deepEqual(checkById(data, CHECK_IDS.externalEvidence).details.validation_errors, ["source", "checked_at must be a valid date-time"]);
  assertCheckStatus(data, CHECK_IDS.fullReleaseEvidence, "fail");
  assert.equal(checkById(data, CHECK_IDS.fullReleaseEvidence).required_for_local, false);
  assert.match(checkById(data, CHECK_IDS.fullReleaseEvidence).reason, /evidence invalid/);
  assert.deepEqual(checkById(data, CHECK_IDS.fullReleaseEvidence).details.validation_errors, ["artifacts.package_dry_run_output", "artifacts.publish_mode_external_evidence"]);
});

test("release check --publish accepts fixture-backed valid evidence for release readiness", () => {
  const root = prepareReleaseTarget({ evidence: releaseEvidenceFixture("valid.json") });
  commitAll(root);
  const result = runRaw(root, ["release", "check", "--publish", "--json"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assertTopLevel(data, { ok: true, local_ok: true, release_ready: true, external_evidence_ok: true, external_evidence_status: "pass", full_release_evidence_status: "pass", mode: "publish", publish: true, next_action: "none" });
  for (const id of [CHECK_IDS.cleanTree, CHECK_IDS.externalEvidence, CHECK_IDS.fullReleaseEvidence]) assertCheckStatus(data, id, "pass");
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
