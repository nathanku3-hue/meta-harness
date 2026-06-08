"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { run, runRaw, snapshotTree, tempDir } = require("./helpers/cli");
const { writePhase5SecurityFixture } = require("./helpers/security-fixture");
const { CHECK_IDS } = require("../lib/release-check");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function releasePolicy(evidence = { status: "pass", source: "fixture://github-security", checked_at: "2026-06-08T00:00:00.000Z" }) {
  return {
    schema_version: "1",
    package: {
      name: "dummy-target",
      registry: "https://registry.npmjs.org/",
      access: "public",
      tag_prefix: "v",
    },
    publish: {
      workflow: null,
      trusted_publisher_environment: null,
    },
    external_evidence: {
      github_security: evidence,
    },
  };
}

function writePackageLock(root) {
  writeJson(root, "package-lock.json", {
    name: "dummy-target",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {},
  });
}

function writePackageJson(root, overrides = {}) {
  const pkg = {
    name: "dummy-target",
    version: "1.0.0",
    license: "MIT",
    repository: { type: "git", url: "https://example.com/dummy-target.git" },
    bin: { "dummy-target": "bin/dummy.js" },
    files: ["bin/", "README.md", "package.json"],
    scripts: { test: "node -e \"\"" },
    engines: { node: ">=20" },
    packageManager: "npm@11.16.0",
    devEngines: {
      runtime: { name: "node", version: ">=20", onFail: "error" },
      packageManager: { name: "npm", version: ">=11.6.0", onFail: "error" },
    },
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

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

test("release check --json with external evidence recorded passes local checks without claiming Phase 10A release readiness", () => {
  const root = prepareReleaseTarget();
  const before = snapshotTree(root);

  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(snapshotTree(root), before);

  const data = JSON.parse(result.stdout);
  assert.equal(data.schema_version, "1");
  assert.equal(data.local_ok, true);
  assert.equal(data.ok, true);
  assert.equal(data.release_ready, false);
  assert.equal(data.git_tree_clean, null);
  assert.equal(data.release_policy_source, ".meta-harness/release-policy.json");
  assert.equal(checkById(data, CHECK_IDS.cleanTree).status, "unknown");
  assert.equal(checkById(data, CHECK_IDS.cleanTree).required_for_local, false);
  assert.equal(checkById(data, CHECK_IDS.cleanTree).required_for_release, true);
  assert.equal(checkById(data, CHECK_IDS.policy).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.ready).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.quality).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.test).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.test).required_for_release, false);
  assert.equal(checkById(data, CHECK_IDS.packDryRun).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.packDryRun).required_for_release, false);
  assert.equal(checkById(data, CHECK_IDS.externalEvidence).status, "pass");
  assert.equal(checkById(data, CHECK_IDS.fullReleaseEvidence).status, "unknown");
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
  assert.equal(data.local_ok, true);
  assert.equal(data.release_ready, false);
  assert.equal(data.git_tree_clean, false);
  assert.ok(data.git_dirty_count > 0);
  assert.equal(cleanTree.status, "fail");
  assert.equal(cleanTree.required_for_local, false);
  assert.equal(cleanTree.required_for_release, true);
  assert.equal(cleanTree.details.git_status, "dirty");
  assert.ok(cleanTree.details.dirty_entries.some((entry) => entry.includes("package.json")));
});

test("release check --publish is rejected during Phase 10A", () => {
  const root = prepareReleaseTarget();
  const result = runRaw(root, ["release", "check", "--publish", "--json"]);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, false);
  assert.equal(data.error.code, "MH_USAGE");
  assert.equal(data.error.message, "release check --publish is not implemented in Phase 10A");
});

test("release check fails local readiness when release policy is missing", () => {
  const root = prepareReleaseTarget({ policy: false });
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.local_ok, false);
  assert.equal(data.release_ready, false);
  assert.equal(checkById(data, CHECK_IDS.policy).status, "fail");
  assert.match(checkById(data, CHECK_IDS.policy).reason, /release-policy\.json missing/);
});

test("release check reports missing external evidence without failing local implementation checks", () => {
  const root = prepareReleaseTarget({ evidence: { status: "not_evaluated", source: null, checked_at: null } });
  const result = runRaw(root, ["release", "check", "--json"]);

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(data.local_ok, true);
  assert.equal(data.release_ready, false);
  assert.equal(data.external_evidence_status, "unknown");
  assert.equal(checkById(data, CHECK_IDS.externalEvidence).status, "unknown");
  assert.match(checkById(data, CHECK_IDS.externalEvidence).reason, /missing or not evaluated/);
});

test("release check fails package metadata and identity cases", () => {
  const cases = [
    {
      name: "missing license",
      packageOverrides: { license: undefined },
      checkId: CHECK_IDS.packageMetadata,
      reason: /license/,
    },
    {
      name: "private package",
      packageOverrides: { private: true },
      checkId: CHECK_IDS.packageIdentity,
      reason: /private/,
    },
  ];

  for (const item of cases) {
    const root = prepareReleaseTarget({ packageOverrides: item.packageOverrides });
    const result = runRaw(root, ["release", "check", "--json"]);
    assert.equal(result.status, 1, item.name);
    const data = JSON.parse(result.stdout);
    assert.equal(data.local_ok, false, item.name);
    assert.equal(data.release_ready, false, item.name);
    assert.equal(checkById(data, item.checkId).status, "fail", item.name);
    assert.match(checkById(data, item.checkId).reason, item.reason, item.name);
  }
});
