"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { tempDir } = require("./helpers/cli");
const { checkDomainGovernance } = require("../lib/domain-governance");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeText(root, relativePath, text = "ok\n") {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
}

function initGitFixture() {
  const root = tempDir("domain-governance-");
  if (git(root, ["init"]).status !== 0) return null;
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@test.com"]);
  writeText(root, "docs/boundary.md", "Boundary\n");
  writeText(root, "data/source.txt", "Source\n");
  writeText(root, "src/mapping.js", "module.exports = {};\n");
  writeText(root, "test/golden.txt", "Golden\n");
  git(root, ["add", "."]);
  if (git(root, ["commit", "-m", "fixture"]).status !== 0) return null;
  const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  return { root, head };
}

function activation(commit) {
  return {
    decision_id: "D123",
    domain: "clinical-demo",
    adopter: {
      repo_url: "https://example.test/repo.git",
      repo_path: "E:/example/repo",
      commit,
      owner: "owner-a",
    },
    ready_evidence: {
      command: "meta-harness ready --target . --json",
      ok: true,
      git_commit: commit,
      state_hash: "sha256-demo",
      generated_at: "2026-06-09T00:00:00.000Z",
    },
    domain_owner: {
      name: "Domain Owner",
      handle: "owner-a",
      request: "Activate bounded pilot",
    },
    reviewer: {
      name: "Pilot Reviewer",
      handle: "reviewer-a",
    },
    boundary: {
      doc: "docs/boundary.md",
      in_scope: ["facts"],
      out_of_scope: ["release automation"],
    },
    activation: {
      requested_at: "2026-06-09T00:00:00.000Z",
    },
    release_impact: {
      phase_10_guard_weakens: false,
    },
    patch_plan: {
      files: ["src/mapping.js"],
      non_goals: ["release changes"],
    },
  };
}

function pilotChain() {
  return {
    activation_decision_id: "D123",
    chain_id: "chain-001",
    source: {
      id: "source-001",
      uri: "data/source.txt",
    },
    fact: {
      id: "fact-001",
      source_id: "source-001",
      statement: "The source supports the mapped term.",
    },
    ontology_term: {
      id: "term-001",
      label: "Mapped Term",
      definition: "A bounded term for the pilot.",
    },
    code_mapping: {
      fact_id: "fact-001",
      term_id: "term-001",
      file: "src/mapping.js",
    },
    golden_case: {
      id: "golden-001",
      file: "test/golden.txt",
      assertion: "The mapping preserves the pilot fact.",
    },
    review: {
      reviewer: "reviewer-a",
      status: "signed_off",
      signed_at: "2026-06-09T00:00:00.000Z",
    },
  };
}

function writeGovernance(root, activationValue, pilotValue) {
  writeJson(root, ".meta-harness/domain-governance/activation.json", activationValue);
  writeJson(root, ".meta-harness/domain-governance/pilot-chain.json", pilotValue);
}

test("domain governance passes with bounded activation and pilot chain", () => {
  const fixture = initGitFixture();
  if (!fixture) return;
  writeGovernance(fixture.root, activation(fixture.head), pilotChain());

  const result = checkDomainGovernance({ targetRoot: fixture.root });

  assert.equal(result.schema_version, "1");
  assert.equal(result.ok, true);
  assert.equal(result.activation_decision_id, "D123");
  assert.equal(result.pilot_chain_id, "chain-001");
  assert.equal(result.counts.fail, 0);
});

test("domain governance fails when activation is missing", () => {
  const root = tempDir("domain-governance-missing-");

  const result = checkDomainGovernance({ targetRoot: root });

  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.id === "MH_DG_ACTIVATION_001").status, "fail");
  assert.equal(result.activation_decision_id, null);
});

test("domain governance fails when ready evidence commit does not match HEAD", () => {
  const fixture = initGitFixture();
  if (!fixture) return;
  writeGovernance(fixture.root, activation("0000000000000000000000000000000000000000"), pilotChain());

  const result = checkDomainGovernance({ targetRoot: fixture.root });
  const readyCommit = result.checks.find((item) => item.id === "MH_DG_READY_COMMIT_001");

  assert.equal(result.ok, false);
  assert.equal(readyCommit.status, "fail");
  assert.match(readyCommit.reason, /does not match target HEAD/);
});

test("domain governance fails for missing boundary scope and patch non-goals", () => {
  const fixture = initGitFixture();
  if (!fixture) return;
  const badActivation = activation(fixture.head);
  badActivation.boundary.doc = "docs/missing.md";
  badActivation.boundary.in_scope = [];
  badActivation.patch_plan.non_goals = [];
  writeGovernance(fixture.root, badActivation, pilotChain());

  const result = checkDomainGovernance({ targetRoot: fixture.root });
  const boundary = result.checks.find((item) => item.id === "MH_DG_BOUNDARY_001");
  const patch = result.checks.find((item) => item.id === "MH_DG_PATCH_BOUNDS_001");

  assert.equal(result.ok, false);
  assert.equal(boundary.status, "fail");
  assert.match(boundary.reason, /boundary.in_scope/);
  assert.match(boundary.reason, /boundary.doc missing/);
  assert.equal(patch.status, "fail");
  assert.match(patch.reason, /non_goals/);
});

test("domain governance fails unsigned or mismatched reviewer signoff", () => {
  const fixture = initGitFixture();
  if (!fixture) return;
  const badPilot = pilotChain();
  badPilot.review.reviewer = "someone-else";
  badPilot.review.status = "pending";
  writeGovernance(fixture.root, activation(fixture.head), badPilot);

  const result = checkDomainGovernance({ targetRoot: fixture.root });
  const signoff = result.checks.find((item) => item.id === "MH_DG_REVIEW_SIGNOFF_001");

  assert.equal(result.ok, false);
  assert.equal(signoff.status, "fail");
  assert.match(signoff.reason, /reviewer must match/);
  assert.match(signoff.reason, /signed_off/);
});
