"use strict";

const { spawnSync } = require("node:child_process");
const { UsageError } = require("./errors");

const CHECK_IDS = {
  base: "MH_MERGE_BASE_001",
  diffSize: "MH_MERGE_DIFF_SIZE_001",
  scope: "MH_MERGE_SCOPE_001",
  status: "MH_MERGE_STATUS_001",
  worktree: "MH_MERGE_WORKTREE_001",
  authority: "MH_MERGE_AUTHORITY_001",
};

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

const PASS_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const SCOPES = {
  "phase7-prototype": {
    expectedBase: "codex/phase6-code-to-pr-contract",
    maxFiles: 90,
    maxLines: 8_000,
    allowedPaths: [
      ".agents/skills/repo-adoption-doctor/",
      ".meta-harness/clean-code-contract.json",
      ".meta-harness/events.jsonl",
      ".meta-harness/skill-registry.json",
      ".meta-harness/status.md",
      ".meta-harness/templates/contracts/",
      ".meta-harness/templates/manifest.json",
      "bin/meta-harness.js",
      "lib/",
      "package.json",
      "scripts/run-tests.js",
      "templates/contracts/",
      "tests/",
    ],
  },
  "merge-protocol": {
    expectedBase: "codex/phase6-code-to-pr-contract",
    maxFiles: 12,
    maxLines: 2_000,
    allowedPaths: [
      "lib/merge-check.js",
      "lib/commands/merge.js",
      "lib/command-registry.js",
      "tests/merge-check.test.js",
      "tests/cli-merge.test.js",
      "tests/command-registry.test.js",
      "tests/cli-help-routing.test.js",
    ],
  },
  "roadmap-docs": {
    expectedBase: "codex/phase6-code-to-pr-contract",
    maxFiles: 5,
    maxLines: 3_000,
    allowedPaths: [
      "docs/product/roadmap.md",
      "docs/product/decision-log.md",
      "README.md",
    ],
  },
  "crlf-normalization": {
    maxFiles: 500,
    maxLines: 80_000,
    allowedPaths: ["*"],
  },
};

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
    error: result.error,
  };
}

function commandFailure(result, fallback) {
  return (result.stderr || result.error?.message || fallback).trim();
}

function runGit(targetRoot, args) {
  return runCommand("git", args, { cwd: targetRoot });
}

function runGh(targetRoot, args) {
  return runCommand("gh", args, { cwd: targetRoot });
}

function pass(id, name, reason = "") {
  return { id, name, status: "pass", reason };
}

function fail(id, name, reason, details = undefined) {
  const check = { id, name, status: "fail", reason };
  if (details !== undefined) {
    check.details = details;
  }
  return check;
}

function normalizeRefName(value) {
  return String(value || "")
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/origin\//, "")
    .replace(/^origin\//, "");
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveRef(targetRoot, ref) {
  const candidates = String(ref || "").startsWith("origin/") || String(ref || "").startsWith("refs/")
    ? [String(ref)]
    : [String(ref), `origin/${ref}`];
  for (const candidate of candidates) {
    const result = runGit(targetRoot, ["rev-parse", "--verify", `${candidate}^{commit}`]);
    if (result.status === 0) {
      return { ref: candidate, sha: result.stdout.trim() };
    }
  }
  return {
    error: `could not resolve git ref: ${ref}`,
  };
}

function changedPaths(targetRoot, baseRef, headRef) {
  const result = runGit(targetRoot, ["diff", "--name-only", `${baseRef}...${headRef}`]);
  if (result.status !== 0) {
    throw new UsageError(`git diff unavailable: ${commandFailure(result, "git diff failed")}`);
  }
  return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function changedLineCount(targetRoot, baseRef, headRef) {
  const result = runGit(targetRoot, ["diff", "--numstat", `${baseRef}...${headRef}`]);
  if (result.status !== 0) {
    throw new UsageError(`git diff --numstat unavailable: ${commandFailure(result, "git diff --numstat failed")}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).reduce((sum, line) => {
    const [additions, deletions] = line.split(/\t/);
    const added = additions === "-" ? 0 : Number.parseInt(additions, 10);
    const deleted = deletions === "-" ? 0 : Number.parseInt(deletions, 10);
    return sum + (Number.isFinite(added) ? added : 0) + (Number.isFinite(deleted) ? deleted : 0);
  }, 0);
}

function diffText(targetRoot, baseRef, headRef) {
  const result = runGit(targetRoot, ["diff", "--unified=0", `${baseRef}...${headRef}`]);
  if (result.status !== 0) {
    throw new UsageError(`git diff unavailable: ${commandFailure(result, "git diff failed")}`);
  }
  return result.stdout;
}

function scopeFor(name) {
  const scope = SCOPES[name];
  if (!scope) {
    throw new UsageError(`unknown merge scope: ${name}. Expected ${Object.keys(SCOPES).join(", ")}`);
  }
  return scope;
}

function matchesPattern(filePath, pattern) {
  const normalized = normalizePath(pattern);
  if (normalized === "*") return true;
  if (normalized.endsWith("*")) return filePath.startsWith(normalized.slice(0, -1));
  if (normalized.endsWith("/")) return filePath.startsWith(normalized);
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}

function pathAllowed(filePath, allowedPaths) {
  return allowedPaths.some((pattern) => matchesPattern(filePath, pattern));
}

function checkBase({ baseName, headName, baseResolved, headResolved, scope, expectedBase, expectedHead }) {
  const reasons = [];
  if (!baseResolved.sha) reasons.push(baseResolved.error);
  if (!headResolved.sha) reasons.push(headResolved.error);
  if (baseResolved.sha && headResolved.sha && baseResolved.sha === headResolved.sha) {
    reasons.push("base and head resolve to the same commit");
  }

  const baseExpectation = expectedBase || scope.expectedBase;
  if (baseExpectation && normalizeRefName(baseName) !== normalizeRefName(baseExpectation)) {
    reasons.push(`base ${baseName} does not match expected base ${baseExpectation}`);
  }
  if (expectedHead && normalizeRefName(headName) !== normalizeRefName(expectedHead)) {
    reasons.push(`head ${headName} does not match expected head ${expectedHead}`);
  }

  return reasons.length === 0
    ? pass(CHECK_IDS.base, "base/head")
    : fail(CHECK_IDS.base, "base/head", reasons.join("; "));
}

function checkDiffSize({ fileCount, lineCount, scope, maxFiles, maxLines }) {
  const allowedFiles = maxFiles ?? scope.maxFiles;
  const allowedLines = maxLines ?? scope.maxLines;
  const reasons = [];
  if (fileCount > allowedFiles) {
    reasons.push(`${fileCount} changed files exceeds limit ${allowedFiles}`);
  }
  if (lineCount > allowedLines) {
    reasons.push(`${lineCount} changed lines exceeds limit ${allowedLines}`);
  }
  return reasons.length === 0
    ? pass(CHECK_IDS.diffSize, "diff size", `${fileCount} files, ${lineCount} changed lines`)
    : fail(CHECK_IDS.diffSize, "diff size", reasons.join("; "), { fileCount, lineCount, maxFiles: allowedFiles, maxLines: allowedLines });
}

function checkScope(paths, scope) {
  const outside = paths.filter((filePath) => !pathAllowed(filePath, scope.allowedPaths));
  return outside.length === 0
    ? pass(CHECK_IDS.scope, "scope", `${paths.length} changed paths inside scope`)
    : fail(CHECK_IDS.scope, "scope", `paths outside declared scope: ${outside.slice(0, 20).join(", ")}${outside.length > 20 ? ", ..." : ""}`, { outside });
}

function normalizeChecksStatus(value) {
  if (!value) return "unknown";
  const normalized = String(value).trim().toLowerCase();
  if (["pass", "passed", "success", "ok", "true"].includes(normalized)) return "pass";
  if (["fail", "failed", "failure", "false"].includes(normalized)) return "fail";
  if (["pending", "queued", "in_progress", "in-progress"].includes(normalized)) return "pending";
  return "unknown";
}

function prStatusCheck(prData, localHeadSha) {
  const reasons = [];
  if (prData.mergeStateStatus && prData.mergeStateStatus !== "CLEAN") {
    reasons.push(`merge state is ${prData.mergeStateStatus}`);
  }
  if (prData.headRefOid && localHeadSha && prData.headRefOid !== localHeadSha) {
    reasons.push(`local head ${localHeadSha} does not match latest PR head ${prData.headRefOid}`);
  }
  const rollup = prData.statusCheckRollup || [];
  if (rollup.length === 0) {
    reasons.push("no status checks reported for PR head");
  }
  for (const item of rollup) {
    if (item.status !== "COMPLETED") {
      reasons.push(`${item.name || "status check"} is ${item.status}`);
      continue;
    }
    if (!PASS_CONCLUSIONS.has(item.conclusion)) {
      reasons.push(`${item.name || "status check"} concluded ${item.conclusion || "unknown"}`);
    }
  }
  return reasons.length === 0
    ? pass(CHECK_IDS.status, "status checks", `${rollup.length} checks passed on PR head`)
    : fail(CHECK_IDS.status, "status checks", reasons.join("; "));
}

function explicitStatusCheck(value) {
  const status = normalizeChecksStatus(value);
  if (status === "pass") {
    return pass(CHECK_IDS.status, "status checks", "checks-status supplied as pass");
  }
  return fail(CHECK_IDS.status, "status checks", `status checks are ${status}; use --pr or supply --checks-status pass only when latest-head checks are verified`);
}

function checkWorktree(targetRoot) {
  const result = runGit(targetRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.status !== 0) {
    return fail(CHECK_IDS.worktree, "worktree", `git status unavailable: ${commandFailure(result, "git status failed")}`);
  }
  const dirty = result.stdout.split(/\r?\n/).filter(Boolean);
  return dirty.length === 0
    ? pass(CHECK_IDS.worktree, "worktree")
    : fail(CHECK_IDS.worktree, "worktree", `local worktree is not clean: ${dirty.slice(0, 20).join(", ")}${dirty.length > 20 ? ", ..." : ""}`, { dirty });
}

function addedLines(text) {
  return text.split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function checkAuthority({ paths, diff, decisionId }) {
  if (decisionId && String(decisionId).trim()) {
    return pass(CHECK_IDS.authority, "authority", `decision recorded: ${decisionId}`);
  }

  const additions = addedLines(diff);
  const reasons = [];
  if (paths.includes(".meta-harness/skill-registry.json")) {
    if (additions.some((line) => /"status"\s*:\s*"active"/.test(line) || /"active_skills"\s*:\s*[1-9]/.test(line))) {
      reasons.push("skill promotion requires an explicit decision");
    }
  }
  const phaseGovernancePaths = paths.filter((filePath) => (
    filePath === "README.md"
    || filePath === ".meta-harness/status.md"
    || filePath === ".meta-harness/events.jsonl"
    || filePath.startsWith("docs/product/")
  ));
  if (phaseGovernancePaths.length > 0 && additions.some((line) => /\bPhase\s*8\b/i.test(line))) {
    reasons.push("Phase 8 expansion requires an explicit decision");
  }
  if (paths.includes("package.json") && additions.some((line) => /"version"\s*:/.test(line))) {
    reasons.push("release/version expansion requires an explicit decision");
  }
  const securityPaths = paths.filter((filePath) => (
    filePath === "SECURITY.md"
    || filePath.startsWith(".github/")
    || filePath === "docs/architecture/owners.json"
    || filePath === ".meta-harness/security-policy.json"
    || filePath.startsWith("lib/security")
    || filePath.startsWith("tests/security")
  ));
  if (securityPaths.length > 0) {
    reasons.push(`security/workflow authority expansion requires an explicit decision: ${securityPaths.slice(0, 10).join(", ")}`);
  }

  return reasons.length === 0
    ? pass(CHECK_IDS.authority, "authority")
    : fail(CHECK_IDS.authority, "authority", reasons.join("; "));
}

function readPrData(targetRoot, prNumber) {
  const result = runGh(targetRoot, [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,title,baseRefName,headRefName,headRefOid,mergeStateStatus,statusCheckRollup,url",
  ]);
  if (result.status !== 0) {
    throw new UsageError(`gh pr view unavailable: ${commandFailure(result, "gh pr view failed")}`);
  }
  return JSON.parse(result.stdout);
}

function numberOption(value, fallback) {
  if (value === undefined || value === null || value === true || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`expected non-negative integer, got ${value}`);
  }
  return parsed;
}

function runMergeCheck(options = {}) {
  const targetRoot = options.targetRoot || process.cwd();
  const scopeName = options.scope;
  if (!scopeName) {
    throw new UsageError("--scope is required");
  }
  const scope = scopeFor(scopeName);
  const prMode = options.pr !== undefined && options.pr !== null && options.pr !== true;
  const refMode = options.base && options.head && options.base !== true && options.head !== true;
  if (prMode === refMode) {
    throw new UsageError("provide exactly one of --pr or --base/--head");
  }

  let prData = null;
  let baseName = options.base;
  let headName = options.head;
  let sourceBaseName = baseName;
  let sourceHeadName = headName;
  if (prMode) {
    prData = readPrData(targetRoot, options.pr);
    sourceBaseName = prData.baseRefName;
    sourceHeadName = prData.headRefName;
    baseName = `origin/${prData.baseRefName}`;
    headName = `origin/${prData.headRefName}`;
  }

  const baseResolved = resolveRef(targetRoot, baseName);
  const headResolved = resolveRef(targetRoot, headName);
  const checks = [
    checkBase({
      baseName,
      headName,
      baseResolved,
      headResolved,
      scope,
      expectedBase: options.expectedBase,
      expectedHead: options.expectedHead,
    }),
  ];

  let paths = [];
  let lineCount = 0;
  let fullDiff = "";
  if (baseResolved.sha && headResolved.sha) {
    paths = changedPaths(targetRoot, baseResolved.ref, headResolved.ref);
    lineCount = changedLineCount(targetRoot, baseResolved.ref, headResolved.ref);
    fullDiff = diffText(targetRoot, baseResolved.ref, headResolved.ref);
    checks.push(checkDiffSize({
      fileCount: paths.length,
      lineCount,
      scope,
      maxFiles: numberOption(options.maxFiles, undefined),
      maxLines: numberOption(options.maxLines, undefined),
    }));
    checks.push(checkScope(paths, scope));
  } else {
    checks.push(fail(CHECK_IDS.diffSize, "diff size", "diff size unavailable because base/head did not resolve"));
    checks.push(fail(CHECK_IDS.scope, "scope", "scope unavailable because base/head did not resolve"));
  }

  checks.push(prMode ? prStatusCheck(prData, headResolved.sha) : explicitStatusCheck(options.checksStatus));
  checks.push(checkWorktree(targetRoot));
  checks.push(checkAuthority({ paths, diff: fullDiff, decisionId: options.decisionId }));

  const ok = checks.every((check) => check.status === "pass");
  return {
    schema_version: "1.0.0",
    ok,
    scope: scopeName,
    source: prMode
      ? { mode: "pr", pr: Number(options.pr), base: sourceBaseName, head: sourceHeadName, url: prData.url }
      : { mode: "refs", base: sourceBaseName, head: sourceHeadName },
    base_sha: baseResolved.sha || null,
    head_sha: headResolved.sha || null,
    changed_files: paths.length,
    changed_lines: lineCount,
    changed_paths: paths,
    checks,
    next_action: ok ? "merge may proceed if human review is satisfied" : "fix merge boundary, checks, worktree, or authority before merge",
  };
}

module.exports = {
  CHECK_IDS,
  SCOPES,
  runMergeCheck,
  _test: {
    addedLines,
    matchesPattern,
    normalizeChecksStatus,
    normalizeRefName,
    pathAllowed,
  },
};
