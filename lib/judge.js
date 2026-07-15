"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { SMOKE_CHECKS, runJudgeChecks } = require("./judge-checks");

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_SMOKE_TIMEOUT_MS = 3000;

function toSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableEnvelope(fields = {}) {
  const checks = fields.checks || [];
  const errors = fields.errors || [];
  const hasFail = checks.some((check) => check.status === "fail") || errors.length > 0;
  const hasWarn = checks.some((check) => check.status === "warn");
  return {
    schema_version: SCHEMA_VERSION,
    tool: "meta-harness-judge",
    generated_at: fields.generated_at || new Date().toISOString(),
    ok: !hasFail,
    status: hasFail ? "fail" : (hasWarn ? "warn" : "pass"),
    target: fields.target || null,
    input: fields.input || null,
    checks,
    errors,
    traits_triggered: fields.traits_triggered || [],
    candidate_profile_events: fields.candidate_profile_events || [],
  };
}

function inputError(code, message, fields = {}) {
  return stableEnvelope({
    ...fields,
    errors: [{ code, message }],
  });
}

function runGit(targetRoot, args, options = {}) {
  return spawnSync("git", args, {
    cwd: targetRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 3000,
    maxBuffer: options.maxBuffer || 512 * 1024,
  });
}

function gitOutput(targetRoot, args, options = {}) {
  const result = runGit(targetRoot, args, options);
  if (result.error || result.status !== 0) {
    return { ok: false, result };
  }
  return { ok: true, stdout: String(result.stdout || "").trim(), result };
}

function gitFailureSummary(result) {
  const text = result?.error?.message || result?.stderr || result?.stdout || `exit ${result?.status}`;
  return String(text || "unknown Git failure").trim().replace(/\s+/g, " ").slice(0, 240);
}

function isInside(root, child) {
  const relative = path.relative(root, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isInsideExistingDirectory(root, child) {
  let rootStat;
  try {
    rootStat = fs.statSync(root, { bigint: true });
  } catch {
    return false;
  }
  let current = child;
  while (true) {
    try {
      const currentStat = fs.statSync(current, { bigint: true });
      if (currentStat.dev === rootStat.dev && currentStat.ino === rootStat.ino) return true;
    } catch {
      return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function normalizeRepoPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: "path must be a non-empty string" };
  }
  const raw = value.trim();
  const slash = toSlash(raw);
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[A-Za-z]:\//.test(slash)) {
    return { ok: false, reason: "absolute paths are not allowed" };
  }
  if (slash.includes("\0")) {
    return { ok: false, reason: "NUL bytes are not allowed" };
  }
  const parts = slash.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    return { ok: false, reason: "path traversal and empty segments are not allowed" };
  }
  const normalized = path.posix.normalize(slash);
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    return { ok: false, reason: "normalized path escapes target" };
  }
  return { ok: true, path: normalized };
}

function validateContainedPath(targetRoot, value, field) {
  const normalized = normalizeRepoPath(value);
  if (!normalized.ok) {
    return { ok: false, code: "JUDGE_INPUT_PATH_INVALID", message: `${field}: ${normalized.reason}` };
  }
  const resolved = path.resolve(targetRoot, ...normalized.path.split("/"));
  if (!isInside(targetRoot, resolved)) {
    return { ok: false, code: "JUDGE_INPUT_PATH_INVALID", message: `${field}: path is outside target` };
  }
  if (fs.existsSync(resolved)) {
    const realTarget = fs.realpathSync(targetRoot);
    const realResolved = fs.realpathSync(resolved);
    if (!isInside(realTarget, realResolved)) {
      return { ok: false, code: "JUDGE_INPUT_PATH_INVALID", message: `${field}: symlink escapes target` };
    }
  }
  return { ok: true, path: normalized.path };
}

function readInput(options) {
  if (isPlainObject(options.input)) {
    return { ok: true, input: options.input, source: "inline" };
  }
  if (typeof options.inputPath !== "string" || options.inputPath.trim() === "") {
    return { ok: false, code: "JUDGE_INPUT_MISSING", message: "inputPath or input is required" };
  }
  try {
    return {
      ok: true,
      input: JSON.parse(fs.readFileSync(options.inputPath, "utf8")),
      source: toSlash(options.inputPath),
    };
  } catch (error) {
    return { ok: false, code: "JUDGE_INPUT_INVALID_JSON", message: `judge input JSON could not be read: ${error.message}` };
  }
}

function validateInput(targetRoot, input) {
  if (!isPlainObject(input)) return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "judge input must be an object" };
  if (input.version !== 1) return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "version must be 1" };
  if (typeof input.base_ref !== "string" || input.base_ref.trim() === "") return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "base_ref is required" };
  if (!isPlainObject(input.scope)) return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "scope is required" };
  if (!Array.isArray(input.scope.files) || input.scope.files.length === 0) return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "scope.files must be a non-empty array" };
  if (!Number.isInteger(input.scope.line_budget) || input.scope.line_budget < 0) return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "scope.line_budget must be a non-negative integer" };
  if (input.old_symbols !== undefined && (!Array.isArray(input.old_symbols) || input.old_symbols.some((item) => typeof item !== "string" || item.length === 0))) {
    return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "old_symbols must be an array of non-empty literal strings" };
  }
  if (input.smoke_checks !== undefined && (!Array.isArray(input.smoke_checks) || input.smoke_checks.some((item) => typeof item !== "string"))) {
    return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "smoke_checks must be an array of smoke check IDs" };
  }
  if (input.exceptions !== undefined && !Array.isArray(input.exceptions)) {
    return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: "exceptions must be an array" };
  }
  for (const smokeId of input.smoke_checks || []) {
    if (!SMOKE_CHECKS[smokeId]) return { ok: false, code: "JUDGE_INPUT_SMOKE_UNKNOWN", message: `unknown smoke check: ${smokeId}` };
  }
  const files = [];
  for (const [index, file] of input.scope.files.entries()) {
    const validated = validateContainedPath(targetRoot, file, `scope.files[${index}]`);
    if (!validated.ok) return validated;
    files.push(validated.path);
  }
  const exceptions = [];
  for (const [index, exception] of (input.exceptions || []).entries()) {
    if (!isPlainObject(exception) || typeof exception.check_id !== "string" || typeof exception.reason !== "string") {
      return { ok: false, code: "JUDGE_INPUT_SCHEMA_INVALID", message: `exceptions[${index}] must include check_id and reason strings` };
    }
    const validated = validateContainedPath(targetRoot, exception.file, `exceptions[${index}].file`);
    if (!validated.ok) return validated;
    exceptions.push({ ...exception, file: validated.path });
  }
  return {
    ok: true,
    input: {
      ...input,
      scope: { ...input.scope, files },
      old_symbols: input.old_symbols || [],
      smoke_checks: input.smoke_checks || [],
      exceptions,
    },
  };
}

function gitContext(gitTargetRoot, canonicalTargetRoot, input) {
  const root = gitOutput(gitTargetRoot, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) {
    return {
      ok: false,
      code: "JUDGE_INPUT_TARGET_NOT_GIT",
      message: `target is not a git repository: ${gitFailureSummary(root.result)}`,
    };
  }
  const gitRoot = fs.realpathSync(root.stdout);
  if (!isInsideExistingDirectory(gitRoot, canonicalTargetRoot)) {
    return { ok: false, code: "JUDGE_INPUT_TARGET_NOT_GIT", message: "target is not inside the resolved git repository" };
  }
  if (input.base_ref_freshness?.status === "stale") {
    return { ok: false, code: "JUDGE_INPUT_BASE_REF_STALE", message: `base_ref ${input.base_ref} is marked stale by local freshness artifact` };
  }
  const base = gitOutput(gitTargetRoot, ["rev-parse", "--verify", `${input.base_ref}^{commit}`]);
  if (!base.ok) return { ok: false, code: "JUDGE_INPUT_BASE_REF_UNAVAILABLE", message: `base_ref ${input.base_ref} does not resolve to a commit` };
  const head = gitOutput(gitTargetRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!head.ok) return { ok: false, code: "JUDGE_INPUT_BASE_REF_INVALID", message: "HEAD does not resolve to a commit" };
  const mergeBase = gitOutput(gitTargetRoot, ["merge-base", base.stdout, head.stdout]);
  if (!mergeBase.ok) return { ok: false, code: "JUDGE_INPUT_BASE_REF_INVALID", message: `base_ref ${input.base_ref} has no merge base with HEAD` };
  return { ok: true, gitRoot, baseSha: base.stdout, headSha: head.stdout, mergeBase: mergeBase.stdout };
}

function parsePorcelain(stdout) {
  const untracked = [];
  for (const entry of String(stdout || "").split("\0").filter(Boolean)) {
    if (!entry.startsWith("?? ")) continue;
    untracked.push(toSlash(entry.slice(3)));
  }
  return untracked;
}

function isJudgeIgnoredRuntimePath(relativePath) {
  return relativePath === ".meta-harness/local" || relativePath.startsWith(".meta-harness/local/");
}

function changedFiles(targetRoot, baseSha) {
  const tracked = gitOutput(targetRoot, ["diff", "--name-only", baseSha, "--"], { maxBuffer: 1024 * 1024 });
  const status = gitOutput(targetRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { maxBuffer: 1024 * 1024 });
  const trackedFiles = tracked.ok ? String(tracked.stdout || "").split(/\r?\n/).filter(Boolean).map(toSlash).filter((item) => !isJudgeIgnoredRuntimePath(item)) : [];
  const untrackedFiles = status.ok ? parsePorcelain(status.stdout).filter((item) => !isJudgeIgnoredRuntimePath(item)) : [];
  return {
    changedFiles: Array.from(new Set([...trackedFiles, ...untrackedFiles])).sort((left, right) => left.localeCompare(right)),
    untrackedFiles,
  };
}

function applyExceptions(checks, exceptions) {
  if (!Array.isArray(exceptions) || exceptions.length === 0) return checks;
  return checks.map((check) => {
    if (check.status !== "fail" || check.files.length === 0) return check;
    const excepted = check.files.filter((file) => exceptions.some((item) => item.check_id === check.check_id && item.file === file));
    if (excepted.length === 0) return check;
    if (excepted.length === check.files.length) {
      return {
        ...check,
        status: "warn",
        evidence: `${check.evidence}; machine-readable exception applied`,
        exception_applied: true,
      };
    }
    return {
      ...check,
      exception_files: excepted,
      evidence: `${check.evidence}; exception covers ${excepted.length}/${check.files.length} file(s)`,
    };
  });
}

function candidateEvents(checks) {
  return checks
    .filter((check) => check.trait && check.status !== "pass")
    .map((check) => ({
      trait: check.trait,
      check_id: check.check_id,
      status: check.status,
      files: check.files,
    }));
}

async function check(options = {}) {
  const targetPath = path.resolve(options.target || ".");
  const inputRead = readInput(options);
  const target = { path: toSlash(targetPath) };
  if (!inputRead.ok) return inputError(inputRead.code, inputRead.message, { target });
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    return inputError("JUDGE_INPUT_TARGET_NOT_GIT", "target must be an existing directory", { target });
  }
  const targetRoot = fs.realpathSync(targetPath);
  const validated = validateInput(targetRoot, inputRead.input);
  if (!validated.ok) return inputError(validated.code, validated.message, { target, input: { source: inputRead.source } });
  const git = gitContext(targetPath, targetRoot, validated.input);
  if (!git.ok) return inputError(git.code, git.message, { target, input: { source: inputRead.source, round: validated.input.round || null, model: validated.input.model || null, base_ref: validated.input.base_ref } });
  const changes = changedFiles(targetPath, git.mergeBase);
  const context = {
    targetRoot: targetPath,
    input: validated.input,
    baseSha: git.mergeBase,
    headSha: git.headSha,
    changedFiles: changes.changedFiles,
    untrackedFiles: changes.untrackedFiles,
    smokeTimeoutMs: options.smokeTimeoutMs || DEFAULT_SMOKE_TIMEOUT_MS,
  };
  const checks = applyExceptions(runJudgeChecks(context), validated.input.exceptions);
  const events = candidateEvents(checks);
  return stableEnvelope({
    target: {
      path: toSlash(targetRoot),
      git_root: toSlash(git.gitRoot),
      base_ref: validated.input.base_ref,
      base_sha: git.baseSha,
      merge_base: git.mergeBase,
      head_sha: git.headSha,
      changed_files: changes.changedFiles,
      untracked_files: changes.untrackedFiles,
    },
    input: {
      source: inputRead.source,
      round: validated.input.round || null,
      model: validated.input.model || null,
      smoke_checks: validated.input.smoke_checks,
    },
    checks,
    traits_triggered: Array.from(new Set(events.map((event) => event.trait))).sort((left, right) => left.localeCompare(right)),
    candidate_profile_events: events,
  });
}

async function report(options = {}) {
  const result = await check(options);
  const lines = [
    `judge: ${result.status}`,
    `target: ${result.target?.path || "(unknown)"}`,
    `checks: ${result.checks.length}`,
  ];
  for (const item of result.errors) lines.push(`error ${item.code}: ${item.message}`);
  for (const item of result.checks) lines.push(`${item.status.toUpperCase()} ${item.check_id}: ${item.evidence}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  check,
  report,
  _test: {
    isInsideExistingDirectory,
    normalizeRepoPath,
    parsePorcelain,
    validateInput,
  },
};
