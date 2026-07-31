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

test("release check --publish fails closed on release readiness while preserving local result", { concurrency: false }, () => {
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
