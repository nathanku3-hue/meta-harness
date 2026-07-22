"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  assessEntryAuthority,
  attachEntryAuthorityToRollup,
  buildControllerExpectedIdentity,
  canonicalRemoteRepositoryId,
  renderEntryAuthorityResult,
} = require("../lib/entry-authority");
const { buildWorkerEntryGate } = require("../lib/worker-entry-gate");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return String(result.stdout || "").trim();
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-entry-runtime-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "entry@example.invalid"]);
  git(root, ["config", "user.name", "Entry Runtime"]);
  git(root, ["remote", "add", "origin", "https://github.com/example/entry-runtime.git"]);
  fs.mkdirSync(path.join(root, "product"));
  fs.writeFileSync(path.join(root, "product", "tracked.txt"), "tracked\n");
  git(root, ["add", "product/tracked.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return {
    root,
    head: git(root, ["rev-parse", "HEAD"]),
    ref: git(root, ["symbolic-ref", "-q", "HEAD"]),
  };
}

function runSpec(repo) {
  return {
    schemaVersion: "run-spec/v1",
    runId: "R3-ENTRY-RUNTIME",
    repository: {
      repositoryId: "github:example/entry-runtime",
      objectFormat: "sha1",
      expectedBaseRevision: repo.head,
    },
    objective: "Verify runtime entry authority",
    scope: { allow: ["product"], deny: [] },
    validation: {
      commands: [{
        argv: ["node", "--test", "tests/entry-authority-runtime.test.js"],
        cwdRelative: ".",
        timeoutSeconds: 120,
        networkPolicy: "denied",
        environmentPolicy: { allow: [] },
      }],
    },
    changePolicy: "forbid-noop",
  };
}

function expected(repo, over = {}) {
  return buildControllerExpectedIdentity({
    runSpec: runSpec(repo),
    authority: {
      path: repo.root.replace(/\\/g, "/"),
      ref: repo.ref,
      ...(over.authority || {}),
    },
  });
}

function readiness() {
  return {
    kind: "execution_readiness",
    verdict: "ready",
    ok: true,
    runs_read_only_git_inspection: true,
    executes_child_commands: false,
    mutates: false,
  };
}

test("runtime collector derives exact live facts and returns PASS_CURRENT", () => {
  const repo = setupRepo();
  const assessment = assessEntryAuthority({
    checkoutPath: repo.root,
    expected: expected(repo),
    productPaths: ["product"],
  });

  assert.equal(assessment.verdict, "PASS_CURRENT");
  assert.equal(assessment.result.verdict, "PASS_CURRENT");
  assert.equal(assessment.observed.repositoryId, "github:example/entry-runtime");
  assert.equal(assessment.observed.observedHeadRevision, repo.head);
  assert.equal(assessment.observed.ref, repo.ref);
  assert.equal(assessment.observed.clean, true);
  assert.equal(assessment.observed.productBytesPresent, true);
  assert.equal(assessment.observed.productBytesReachableFromNamedAuthority, true);
  assert.equal(assessment.evidence.productFileCount, 1);
  assert.equal(assessment.evidence.unreachableProductFileCount, 0);
  assert.equal(assessment.runs_read_only_git_inspection, true);
  assert.equal(assessment.executes_child_commands, true);
  assert.equal(assessment.mutates, false);
  assert.equal(assessment.writes_files, false);
  assert.equal(assessment.network, false);
  assert.equal(renderEntryAuthorityResult(assessment.result), "PASS_CURRENT");
});

test("runtime collector detects unversioned product bytes before dirty-state redirect", () => {
  const repo = setupRepo();
  fs.writeFileSync(path.join(repo.root, "product", "untracked.txt"), "untracked\n");

  const assessment = assessEntryAuthority({
    checkoutPath: repo.root,
    expected: expected(repo),
    productPaths: ["product"],
  });

  assert.equal(assessment.verdict, "CUSTODY_REQUIRED");
  assert.equal(assessment.observed.clean, false);
  assert.equal(assessment.observed.productBytesPresent, true);
  assert.equal(assessment.observed.productBytesReachableFromNamedAuthority, false);
  assert.equal(assessment.evidence.productFileCount, 2);
  assert.equal(assessment.evidence.unreachableProductFileCount, 1);
  assert.equal(
    renderEntryAuthorityResult(assessment.result),
    "CUSTODY_REQUIRED — product bytes lack named Git authority",
  );
});

test("runtime collector renders an exact redirect without creating authority", () => {
  const repo = setupRepo();
  const target = `${repo.root}-authority`.replace(/\\/g, "/");
  const assessment = assessEntryAuthority({
    checkoutPath: repo.root,
    expected: expected(repo, { authority: { path: target } }),
  });

  assert.equal(assessment.verdict, "REDIRECT");
  assert.deepEqual(assessment.result.redirect, {
    path: target,
    ref: repo.ref,
    commit: repo.head,
  });
  assert.equal(
    assessment.rendered,
    `REDIRECT — ${target} ${repo.ref} ${repo.head}`,
  );
});

test("runtime collector fails closed for missing Git checkout and path escape", () => {
  const repo = setupRepo();
  let assessment = assessEntryAuthority({
    checkoutPath: path.join(repo.root, "missing"),
    expected: expected(repo),
  });
  assert.equal(assessment.verdict, "BLOCK");
  assert.match(assessment.rendered, /^BLOCK — ENTRY_GIT_FAILED:/);

  assessment = assessEntryAuthority({
    checkoutPath: repo.root,
    expected: expected(repo),
    productPaths: ["../outside"],
  });
  assert.equal(assessment.verdict, "BLOCK");
  assert.match(assessment.rendered, /^BLOCK — ENTRY_PRODUCT_PATH_INVALID:/);
});

test("rollup attachment feeds raw observed input into the existing worker gate", () => {
  const repo = setupRepo();
  const rollup = {};
  const assessment = attachEntryAuthorityToRollup(rollup, {
    checkoutPath: repo.root,
    expected: expected(repo),
    productPaths: ["product"],
  });
  assert.equal(assessment.verdict, "PASS_CURRENT");
  assert.equal(rollup.entry_authority.verdict, "PASS_CURRENT");
  assert.equal(rollup.entry_authority_input.observed.observedHeadRevision, repo.head);

  const gate = buildWorkerEntryGate({
    operatorPlanArtifactValidation: { verdict: "pass", ok: true },
    selectedRepoResolution: { ok: true, name: "entry-runtime", path: repo.root },
    executionReadiness: readiness(),
    entryAuthorityInput: rollup.entry_authority_input,
  });
  assert.equal(gate.verdict, "open");
  assert.equal(gate.entry_authority.verdict, "PASS_CURRENT");
});

test("remote identity normalization is deterministic and checkout-independent", () => {
  assert.equal(
    canonicalRemoteRepositoryId("git@github.com:Example/Repo.git"),
    "github:example/repo",
  );
  assert.equal(
    canonicalRemoteRepositoryId("https://example.invalid/scm/repo.git"),
    "remote:https://example.invalid/scm/repo",
  );
});
