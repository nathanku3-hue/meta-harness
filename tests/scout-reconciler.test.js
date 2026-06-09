"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { normalizeRepoPath, reconcileScoutOutputs } = require("../lib/scout-reconciler");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-scout-reconciler-"));
}

function writeFile(cwd, relativePath, text) {
  const fullPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, text, "utf8");
}

test("repo path normalization is repository-relative and deterministic", () => {
  assert.equal(normalizeRepoPath("docs\\guide.md"), "docs/guide.md");
  assert.equal(normalizeRepoPath("./docs/guide.md"), "docs/guide.md");
  assert.throws(() => normalizeRepoPath("../outside.md"), /must not traverse/);
  assert.throws(() => normalizeRepoPath("/outside.md"), /repository-relative/);
  assert.throws(() => normalizeRepoPath("C:\\outside.md"), /repository-relative/);
  assert.throws(() => normalizeRepoPath("safe\0bad.md"), /NUL/);
});

test("scout reconciler deduplicates and validates findings against repo state", () => {
  const cwd = tempDir();
  writeFile(cwd, "README.md", "# Meta Harness\n");
  writeFile(cwd, "tests/subagent-packet.test.js", "test\n");

  const report = reconcileScoutOutputs([
    {
      role: "repo-scout",
      findings: [
        { path: "README.md", issue: "README exists but phase 8 status is not mentioned", severity: "warn" },
        { path: "missing.md", issue: "claimed missing evidence", severity: "info" },
      ],
    },
    {
      role: "security-scout",
      findings: [
        { path: "README.md", issue: "README exists but phase 8 status is not mentioned", severity: "warn" },
        { path: "", issue: "security posture requires separate decision before write-enabled scouts", severity: "block" },
      ],
    },
  ], { targetRoot: cwd });

  assert.equal(report.schema_version, "1.0.0");
  assert.equal(report.authority, "reconciler-only");
  assert.equal(report.evidence_only, true);
  assert.equal(report.raw_finding_count, 4);
  assert.equal(report.deduped_finding_count, 3);
  assert.deepEqual(report.severity_counts, { block: 1, warn: 1, info: 1 });

  const readmeFinding = report.findings.find((finding) => finding.path === "README.md");
  assert.deepEqual(readmeFinding.roles, ["repo-scout", "security-scout"]);
  assert.equal(readmeFinding.duplicate_count, 2);
  assert.equal(readmeFinding.validation_status, "validated");
  assert.equal(readmeFinding.path_exists, true);

  const missingFinding = report.findings.find((finding) => finding.path === "missing.md");
  assert.equal(missingFinding.validation_status, "unverified-missing-path");
  assert.equal(missingFinding.path_exists, false);
});

test("scout reconciler rejects malformed findings before merging", () => {
  const cwd = tempDir();
  assert.throws(() => reconcileScoutOutputs([{ role: "repo-scout", findings: "nope" }], { targetRoot: cwd }), /findings array/);
  assert.throws(() => reconcileScoutOutputs([{ role: "repo-scout", findings: [{ path: "README.md", issue: "", severity: "warn" }] }], { targetRoot: cwd }), /issue is required/);
  assert.throws(() => reconcileScoutOutputs([{ role: "repo-scout", findings: [{ path: "README.md", issue: "x", severity: "critical" }] }], { targetRoot: cwd }), /invalid scout finding severity/);
});
