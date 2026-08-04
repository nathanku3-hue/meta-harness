"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  POLICY_SCHEMA,
  buildPortfolioReport,
  gitPathArgument,
  writePortfolioReport,
} = require("../lib/portfolio-audit");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function createRepository(name) {
  const root = tempDir(`portfolio-${name}-`);
  const remote = tempDir(`portfolio-${name}-remote-`);
  git(remote, ["init", "--bare"]);
  git(root, ["init"]);
  git(root, ["config", "user.email", `${name}@example.invalid`]);
  git(root, ["config", "user.name", `Portfolio ${name}`]);
  fs.writeFileSync(path.join(root, "README.md"), `${name}\n`, "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "fixture"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-u", "origin", "main"]);
  fs.mkdirSync(path.join(root, ".worktrees"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "info", "exclude"), "/.worktrees/\n", "utf8");
  return { root, remote };
}

function repositoryPolicy(id, root, overrides = {}) {
  return {
    id,
    canonicalPath: root,
    remote: "origin",
    declaredIntegrationBranch: "main",
    integrationBranchResolution: { status: "resolved", evidence: "origin/HEAD or explicit owner branch" },
    permittedPrimaryBranches: ["main"],
    vendorClassification: "first-party",
    maximumActiveWorktrees: 1,
    maximumInactiveWorktrees: 0,
    terminalCustodyMode: "remote",
    externalEvidenceRoot: tempDir(`portfolio-${id}-evidence-`),
    externalArchiveRoot: tempDir(`portfolio-${id}-archive-`),
    physicalParityRequired: true,
    primaryCleanRequired: true,
    exceptions: [],
    baselineClassification: "clean control",
    ...overrides,
  };
}

test("bundle path arguments convert WSL mounts for Windows Git", () => {
  assert.equal(gitPathArgument("/mnt/e/Code/archive/repo.bundle"), "E:/Code/archive/repo.bundle");
  assert.equal(gitPathArgument("/tmp/repo.bundle"), "/tmp/repo.bundle");
});

function writePolicy(repositories) {
  const root = tempDir("portfolio-policy-");
  const policyPath = path.join(root, "portfolio-policy.json");
  fs.writeFileSync(policyPath, `${JSON.stringify({ schema: POLICY_SCHEMA, repositories }, null, 2)}\n`, "utf8");
  return policyPath;
}

test("portfolio report classifies clean control, dirty primary, active worktree, and capacity", () => {
  const clean = createRepository("clean");
  fs.writeFileSync(path.join(clean.root, ".gitignore"), "cache/\n", "utf8");
  git(clean.root, ["add", ".gitignore"]);
  git(clean.root, ["commit", "-m", "ignore generated cache"]);
  git(clean.root, ["push", "origin", "main"]);
  fs.mkdirSync(path.join(clean.root, "cache"));
  fs.writeFileSync(path.join(clean.root, "cache", "generated.txt"), "generated\n", "utf8");
  const pilot = createRepository("pilot");
  const worktree = path.join(pilot.root, ".worktrees", "active-pilot");
  git(pilot.root, ["worktree", "add", "-b", "pilot-work", worktree, "HEAD"]);
  fs.appendFileSync(path.join(pilot.root, "README.md"), "dirty\n", "utf8");
  const receipt = path.join(tempDir("portfolio-live-receipt-"), "receipt.json");
  fs.writeFileSync(receipt, `${JSON.stringify({ health: { ok: true } }, null, 2)}\n`, "utf8");

  const policyPath = writePolicy([
    repositoryPolicy("clean", clean.root),
    repositoryPolicy("pilot", pilot.root, {
      maximumActiveWorktrees: 1,
      exceptions: [{
        id: "pilot-live",
        kind: "live-runtime",
        path: worktree,
        owner: "owner",
        reviewCondition: "until runtime is migrated or deliberately stopped",
        receiptPath: receipt,
      }],
      baselineClassification: "pilot target",
    }),
  ]);

  const report = buildPortfolioReport({
    policyPath,
    processEntries: [{ pid: 42, executable: "/usr/bin/node", commandLine: `node ${worktree}/dist/cli.js serve` }],
    now: new Date("2026-08-03T12:00:00.000Z"),
  });

  assert.equal(report.mode, "report-only");
  assert.equal(report.repositories.length, 2);
  const cleanResult = report.repositories.find((entry) => entry.id === "clean");
  const pilotResult = report.repositories.find((entry) => entry.id === "pilot");
  assert.equal(cleanResult.pass, true);
  assert.equal(cleanResult.primary.counts.tracked, 0);
  assert.equal(cleanResult.primary.counts.ignored, 1);
  assert.equal(cleanResult.primary.clean, true);
  assert.equal(cleanResult.terminal_custody.remote_contains_head, true);
  assert.equal(pilotResult.primary.clean, false);
  assert.equal(pilotResult.primary.counts.tracked, 1);
  assert.equal(pilotResult.capacity.active, 1);
  assert.equal(pilotResult.capacity.pass, true);
  assert.equal(pilotResult.worktrees[0].active_reason, "process");
  assert.equal(pilotResult.exceptions[0].active, true);
  assert.equal(pilotResult.findings.some((entry) => entry.code === "PRIMARY_DIRTY"), true);
});

test("terminal custody requires the remote declared by policy", () => {
  const repository = createRepository("declared-remote");
  fs.writeFileSync(path.join(repository.root, "SECOND.md"), "second\n", "utf8");
  git(repository.root, ["add", "SECOND.md"]);
  git(repository.root, ["commit", "-m", "second commit"]);
  const backup = tempDir("portfolio-declared-remote-backup-");
  git(backup, ["init", "--bare"]);
  git(repository.root, ["remote", "add", "backup", backup]);
  git(repository.root, ["push", "backup", "main"]);

  const policyPath = writePolicy([repositoryPolicy("declared-remote", repository.root)]);
  const report = buildPortfolioReport({
    policyPath,
    processEntries: [],
    now: new Date("2026-08-03T12:00:00.000Z"),
  });
  const result = report.repositories[0];

  assert.equal(result.terminal_custody.remote_contains_head, false);
  assert.deepEqual(result.terminal_custody.remote_refs, []);
  assert.equal(result.findings.some((entry) => entry.code === "TERMINAL_CUSTODY"), true);
});

test("one staged rename counts as one tracked change", () => {
  const repository = createRepository("rename");
  git(repository.root, ["mv", "README.md", "RENAMED.md"]);
  const policyPath = writePolicy([repositoryPolicy("rename", repository.root)]);

  const report = buildPortfolioReport({
    policyPath,
    processEntries: [],
    now: new Date("2026-08-03T12:00:00.000Z"),
  });

  assert.equal(report.repositories[0].primary.counts.tracked, 1);
  assert.equal(report.summary.tracked, 1);
});

test("portfolio report writes byte-identical external copies", () => {
  const clean = createRepository("copy");
  const policyPath = writePolicy([repositoryPolicy("copy", clean.root)]);
  const evidence = tempDir("portfolio-report-");
  const output = path.join(evidence, "report.json");
  const copy = path.join(evidence, "mirror", "report.json");

  const result = writePortfolioReport({
    policyPath,
    outputPath: output,
    copyPath: copy,
    processEntries: [],
    now: new Date("2026-08-03T12:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "report-only");
  assert.equal(result.second_copy.byte_identical, true);
  assert.equal(fs.readFileSync(output).equals(fs.readFileSync(copy)), true);
});

test("portfolio audit CLI is registered and remains report-only when findings exist", () => {
  const dirty = createRepository("cli");
  fs.appendFileSync(path.join(dirty.root, "README.md"), "dirty\n", "utf8");
  const policyPath = writePolicy([repositoryPolicy("cli", dirty.root)]);
  const evidence = tempDir("portfolio-cli-report-");
  const output = path.join(evidence, "report.json");
  const copy = path.join(evidence, "report-copy.json");

  const result = spawnSync(process.execPath, [
    CLI,
    "portfolio",
    "audit",
    "--policy",
    policyPath,
    "--output",
    output,
    "--copy",
    copy,
    "--json",
  ], { cwd: dirty.root, encoding: "utf8", windowsHide: true });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, "report-only");
  assert.equal(summary.verdict, "FINDINGS");
  assert.equal(fs.existsSync(output), true);
  assert.equal(fs.readFileSync(output).equals(fs.readFileSync(copy)), true);

  const help = spawnSync(process.execPath, [CLI, "help", "--advanced"], { encoding: "utf8", windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /meta-harness portfolio audit --policy <path> --output <path>/);
});
