"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { commandSummary, runNpm } = require("./release-package-check");

const DEFENSIVE_HELPER_PATTERN = /\b(hasObject|toRecord|safeGet[A-Za-z0-9_]*|normalize[A-Z][A-Za-z0-9_]*|ensure[A-Z][A-Za-z0-9_]*)\b/;
const HELPER_FUNCTION_PATTERN = /^\s*(?:function\s+[A-Za-z_$][\w$]*|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|module\.exports\.[A-Za-z_$][\w$]*\s*=)/;
const DEFAULT_TIMEOUT_MS = 3000;
const OUTPUT_CAP_BYTES = 256 * 1024;
const EXCLUDED_SCAN_DIRS = new Set([".git", "node_modules"]);

function toSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function checkResult(checkId, trait, status, evidence, files = [], extra = {}) {
  return {
    check_id: checkId,
    trait,
    status,
    evidence,
    files: Array.from(new Set(files)).sort((left, right) => left.localeCompare(right)),
    ...extra,
  };
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer || OUTPUT_CAP_BYTES,
  });
}

function runGit(targetRoot, args, options = {}) {
  return runCommand("git", args, {
    cwd: targetRoot,
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer || OUTPUT_CAP_BYTES,
  });
}

function gitSuccess(targetRoot, args) {
  const result = runGit(targetRoot, args);
  return !result.error && result.status === 0;
}

function readTextIfSmall(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function diffAddedLines(targetRoot, baseSha, relativePath, untracked) {
  if (untracked) {
    const text = readTextIfSmall(path.join(targetRoot, ...relativePath.split("/")));
    return text === null ? [] : text.split(/\r?\n/);
  }
  const diff = runGit(targetRoot, ["diff", "--unified=0", "--no-ext-diff", baseSha, "--", relativePath], { maxBuffer: 1024 * 1024 });
  if (diff.error || diff.status !== 0) return [];
  return String(diff.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function baseHasPath(targetRoot, baseSha, relativePath) {
  return gitSuccess(targetRoot, ["cat-file", "-e", `${baseSha}:${relativePath}`]);
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1).length;
}

function changedLineCount(targetRoot, baseSha, changedFiles, untrackedFiles) {
  let total = 0;
  const untrackedSet = new Set(untrackedFiles);
  for (const relativePath of changedFiles) {
    if (untrackedSet.has(relativePath)) {
      total += countLines(readTextIfSmall(path.join(targetRoot, ...relativePath.split("/"))) || "");
      continue;
    }
    const stat = runGit(targetRoot, ["diff", "--numstat", baseSha, "--", relativePath]);
    if (stat.error || stat.status !== 0) continue;
    const line = String(stat.stdout || "").split(/\r?\n/).find(Boolean);
    if (!line) continue;
    const [added, deleted] = line.split(/\s+/);
    total += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return total;
}

function checkDefensiveHelpers(context) {
  const findings = [];
  for (const file of context.changedFiles) {
    const added = diffAddedLines(context.targetRoot, context.baseSha, file, context.untrackedFiles.includes(file));
    if (added.some((line) => DEFENSIVE_HELPER_PATTERN.test(line))) findings.push(file);
  }
  if (findings.length > 0) {
    return checkResult(
      "JUDGE_DEFENSIVE_001",
      "over-defensive-abstraction",
      "fail",
      "new generic defensive helper pattern found in added lines",
      findings,
    );
  }
  return checkResult("JUDGE_DEFENSIVE_001", "over-defensive-abstraction", "pass", "no new generic defensive helper patterns found");
}

function checkNewUtilsFiles(context) {
  const files = context.changedFiles.filter((file) => {
    const lower = file.toLowerCase();
    const looksLikeUtils = /(^|\/)utils?\//.test(lower) || /(^|\/)[^/]*-utils?\.js$/.test(lower);
    return looksLikeUtils && !baseHasPath(context.targetRoot, context.baseSha, file);
  });
  if (files.length > 0) {
    return checkResult("JUDGE_DEFENSIVE_002", "over-defensive-abstraction", "fail", "new utils-style file found", files);
  }
  return checkResult("JUDGE_DEFENSIVE_002", "over-defensive-abstraction", "pass", "no new utils-style files found");
}

function checkHelperBudget(context) {
  const helpers = [];
  for (const file of context.changedFiles.filter((item) => item.endsWith(".js"))) {
    const added = diffAddedLines(context.targetRoot, context.baseSha, file, context.untrackedFiles.includes(file));
    for (const line of added) {
      if (HELPER_FUNCTION_PATTERN.test(line)) helpers.push({ file, line: line.trim().slice(0, 160) });
    }
  }
  if (helpers.length > 2) {
    return checkResult(
      "JUDGE_DEFENSIVE_003",
      "over-defensive-abstraction",
      "warn",
      `helper budget exceeded: ${helpers.length} helper-like additions`,
      helpers.map((item) => item.file),
      { details: { helpers } },
    );
  }
  return checkResult("JUDGE_DEFENSIVE_003", "over-defensive-abstraction", "pass", `helper-like additions within budget: ${helpers.length}`);
}

function walkFiles(root, visitor, relative = "") {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  for (const name of fs.readdirSync(directory)) {
    const itemRelative = relative ? `${relative}/${name}` : name;
    if (EXCLUDED_SCAN_DIRS.has(name) || itemRelative === ".meta-harness/local") continue;
    const itemPath = path.join(directory, name);
    const stat = fs.lstatSync(itemPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkFiles(root, visitor, itemRelative);
    } else if (stat.isFile()) {
      visitor(itemRelative, itemPath, stat);
    }
  }
}

function checkOldSymbolResidue(context) {
  const oldSymbols = context.input.old_symbols || [];
  if (oldSymbols.length === 0) {
    return checkResult("JUDGE_RESIDUE_001", "refactor-residue", "pass", "no old symbols declared");
  }
  const matches = [];
  walkFiles(context.targetRoot, (relativePath, filePath, stat) => {
    if (stat.size > 1024 * 1024) return;
    const text = readTextIfSmall(filePath);
    if (text === null) return;
    for (const symbol of oldSymbols) {
      if (text.includes(symbol)) matches.push({ file: relativePath, symbol });
    }
  });
  if (matches.length > 0) {
    return checkResult(
      "JUDGE_RESIDUE_001",
      "refactor-residue",
      "fail",
      "old symbol residue found",
      matches.map((item) => item.file),
      { details: { matches } },
    );
  }
  return checkResult("JUDGE_RESIDUE_001", "refactor-residue", "pass", "declared old symbols were not found");
}

function checkScopeFiles(context) {
  const allowed = new Set((context.input.scope?.files || []).map(toSlash));
  const outside = context.changedFiles.filter((file) => !allowed.has(file));
  if (outside.length > 0) {
    return checkResult("JUDGE_SCOPE_001", "eager-broad-edits", "fail", "changed files outside declared scope", outside);
  }
  return checkResult("JUDGE_SCOPE_001", "eager-broad-edits", "pass", "changed files stay inside declared scope");
}

function checkLineBudget(context) {
  const budget = context.input.scope?.line_budget;
  if (!Number.isInteger(budget)) {
    return checkResult("JUDGE_SCOPE_002", "eager-broad-edits", "pass", "no line budget declared");
  }
  const changedLines = changedLineCount(context.targetRoot, context.baseSha, context.changedFiles, context.untrackedFiles);
  if (changedLines > budget) {
    return checkResult(
      "JUDGE_SCOPE_002",
      "eager-broad-edits",
      "warn",
      `changed line budget exceeded: ${changedLines}/${budget}`,
      context.changedFiles,
      { details: { changed_lines: changedLines, line_budget: budget } },
    );
  }
  return checkResult("JUDGE_SCOPE_002", "eager-broad-edits", "pass", `changed lines within budget: ${changedLines}/${budget}`, [], { details: { changed_lines: changedLines, line_budget: budget } });
}

function hasNpmRunner() {
  const npmExecPath = process.env.npm_execpath;
  const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return Boolean((npmExecPath && fs.existsSync(npmExecPath)) || fs.existsSync(bundledNpmCli));
}

function smokePackageDryRun(context) {
  if (!hasNpmRunner()) {
    return checkResult("JUDGE_SMOKE_UNAVAILABLE", "tests-pass-therefore-done", "warn", "package_dry_run unavailable: no npm helper or npm_execpath found");
  }
  const result = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: context.targetRoot,
    timeout: context.smokeTimeoutMs,
  });
  if ((result.error && result.error.code === "ETIMEDOUT") || result.signal) {
    return checkResult("JUDGE_SMOKE_PACKAGE_DRY_RUN", "tests-pass-therefore-done", "fail", "package dry-run timed out");
  }
  if (result.error && result.error.code === "ENOBUFS") {
    return checkResult("JUDGE_SMOKE_PACKAGE_DRY_RUN", "tests-pass-therefore-done", "fail", "package dry-run output exceeded cap");
  }
  if (result.error || result.status !== 0) {
    return checkResult("JUDGE_SMOKE_PACKAGE_DRY_RUN", "tests-pass-therefore-done", "fail", `package dry-run failed: ${commandSummary(result)}`);
  }
  return checkResult("JUDGE_SMOKE_PACKAGE_DRY_RUN", "tests-pass-therefore-done", "pass", "package dry-run succeeded");
}

function smokeCliHelp(context) {
  const result = runCommand(process.execPath, [path.join("bin", "meta-harness.js"), "--help"], {
    cwd: context.targetRoot,
    timeout: context.smokeTimeoutMs,
  });
  if ((result.error && result.error.code === "ETIMEDOUT") || result.signal) {
    return checkResult("JUDGE_SMOKE_CLI_HELP", "tests-pass-therefore-done", "fail", "CLI help timed out");
  }
  if (result.error || result.status !== 0) {
    return checkResult("JUDGE_SMOKE_CLI_HELP", "tests-pass-therefore-done", "fail", `CLI help failed: ${commandSummary(result)}`);
  }
  return checkResult("JUDGE_SMOKE_CLI_HELP", "tests-pass-therefore-done", "pass", "CLI help succeeded");
}

function smokeRequireCommandRegistry(context) {
  const result = runCommand(process.execPath, ["-e", "require('./lib/command-registry')"], {
    cwd: context.targetRoot,
    timeout: context.smokeTimeoutMs,
  });
  if ((result.error && result.error.code === "ETIMEDOUT") || result.signal) {
    return checkResult("JUDGE_SMOKE_COMMAND_REGISTRY", "tests-pass-therefore-done", "fail", "command registry require timed out");
  }
  if (result.error || result.status !== 0) {
    return checkResult("JUDGE_SMOKE_COMMAND_REGISTRY", "tests-pass-therefore-done", "fail", `command registry require failed: ${commandSummary(result)}`);
  }
  return checkResult("JUDGE_SMOKE_COMMAND_REGISTRY", "tests-pass-therefore-done", "pass", "command registry require succeeded");
}

const SMOKE_CHECKS = Object.freeze({
  package_dry_run: smokePackageDryRun,
  cli_help: smokeCliHelp,
  require_command_registry: smokeRequireCommandRegistry,
});

function checkSmoke(context) {
  const smokeChecks = context.input.smoke_checks || [];
  if (smokeChecks.length === 0) {
    return [checkResult("JUDGE_SMOKE_001", "tests-pass-therefore-done", "pass", "no smoke checks declared")];
  }
  return smokeChecks.map((id) => SMOKE_CHECKS[id](context));
}

function runJudgeChecks(context) {
  return [
    checkDefensiveHelpers(context),
    checkNewUtilsFiles(context),
    checkHelperBudget(context),
    checkOldSymbolResidue(context),
    checkScopeFiles(context),
    checkLineBudget(context),
    ...checkSmoke(context),
  ];
}

module.exports = {
  SMOKE_CHECKS,
  runJudgeChecks,
  _test: {
    DEFENSIVE_HELPER_PATTERN,
    hasNpmRunner,
  },
};
