"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UsageError } = require("./errors");
const { readJsonFile, writeJsonFile } = require("./json");
const { ensureDir } = require("./paths");
const { stateHash } = require("./state-hash");
const { importDirtyDecisions } = require("./decisions");
const { classifyDirtyResult } = require("./ship-gate");

const DEFAULT_QUEUE = ".meta-harness/dirty-work-queue.json";
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
const SENSITIVE_HINTS = [
  ".env", "secret", "secrets", "credential", "credentials", "token",
  "provider", "providers", "wrds", "runtime", "dashboard", "scoring",
  "broker", "data-output", "data_output",
];
const GENERATED_HINTS = [
  "dist/", "build/", "coverage/", ".pytest_cache/", ".ruff_cache/", "__pycache__/",
  ".meta-harness/snapshots/", ".meta-harness/dirty-work.json",
  ".meta-harness/dirty-work-queue.json", ".meta-harness/decision-inbox.json",
];

function fail(message) { throw new UsageError(message); }

function requireOptionValue(value, label) {
  if (Array.isArray(value)) fail(`${label} must be provided once`);
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    fail(`${label} requires a value`);
  }
  return String(value).trim();
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

function toSlash(value) { return value.split(path.sep).join("/"); }

function resolveGitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error || result.status !== 0) {
    fail(`dirty commands require a git repository: ${(result.stderr || result.error?.message || "git rev-parse failed").trim()}`);
  }
  return path.resolve(result.stdout.trim());
}

function resolveInside(repoRoot, rawPath, label) {
  const resolved = path.resolve(repoRoot, rawPath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} must stay inside the repository root: ${rawPath}`);
  }
  return resolved;
}

function readRequiredJson(repoRoot, rawPath, label) {
  const resolved = resolveInside(repoRoot, rawPath, label);
  if (!fs.existsSync(resolved)) fail(`${label} file not found: ${rawPath}`);
  return readJsonFile(resolved);
}

function runGitStatus(repoRoot) {
  const result = spawnSync("git", [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error || result.status !== 0) {
    fail(`dirty snapshot requires git status: ${(result.stderr || result.error?.message || "git status failed").trim()}`);
  }
  return result.stdout;
}

function dirtyItem(filePath, index, worktree, originalPath = undefined) {
  const body = { path: filePath, index, worktree, status: `${index}${worktree}` };
  if (originalPath) body.original_path = originalPath;
  return { ...body, state_hash: stateHash(body) };
}

function parseStatusZ(text) {
  const tokens = text.split("\0").filter((token) => token.length > 0);
  const items = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const itemStatus = token.slice(0, 2);
    const filePath = token.slice(3).split("\\").join("/");
    const originalPath = ["R", "C"].includes(itemStatus[0]) ? tokens[index + 1]?.split("\\").join("/") : undefined;
    if (originalPath) index += 1;
    items.push(dirtyItem(filePath, itemStatus[0] || " ", itemStatus[1] || " ", originalPath));
  }
  return items.sort((left, right) => left.path.localeCompare(right.path));
}

function takeDirtySnapshot(repoRoot) {
  const dirty = parseStatusZ(runGitStatus(repoRoot));
  const body = { v: 1, dirty };
  return { ...body, generated_at: new Date().toISOString(), state_hash: stateHash(body) };
}

function normalizedPatterns(patterns = []) {
  return patterns.map((pattern) => String(pattern).split("\\").join("/").replace(/^\.\//, ""));
}

function pathMatches(filePath, patterns = []) {
  const normalized = filePath.split("\\").join("/");
  return normalizedPatterns(patterns).some((pattern) => {
    if (pattern.endsWith("*")) return normalized.startsWith(pattern.slice(0, -1));
    if (pattern.endsWith("/")) return normalized.startsWith(pattern);
    return normalized === pattern || normalized.startsWith(`${pattern}/`);
  });
}

function isSensitivePath(filePath) {
  const lower = filePath.toLowerCase();
  return SENSITIVE_HINTS.some((hint) => lower.includes(hint));
}

function isGeneratedPath(filePath, scope) {
  return pathMatches(filePath, [...GENERATED_HINTS, ...scope.generated_paths]);
}

function readScope(repoRoot, scopePath) {
  const resolved = resolveInside(repoRoot, scopePath, "scope");
  if (!fs.existsSync(resolved)) fail(`scope file not found: ${scopePath}`);
  const scope = readJsonFile(resolved, {});
  const normalized = {
    owned_paths: scope.owned_paths || scope.ownedPaths || [],
    generated_paths: scope.generated_paths || scope.generatedPaths || [],
    ignored_paths: scope.ignored_paths || scope.ignoredPaths || [],
    allow_clean_inherited_paths: scope.allow_clean_inherited_paths || scope.allowCleanInheritedPaths || [],
    queue_path: scope.queue_path || DEFAULT_QUEUE,
    decision_inbox_path: scope.decision_inbox_path || ".meta-harness/decision-inbox.json",
  };
  return { ...normalized, scope_hash: stateHash(normalized) };
}

function classifyBeforeOnly(item, scope) {
  if (isSensitivePath(item.path)) {
    return ["credential_provider_runtime_dirt", "ESCALATE", true, "credential/provider/runtime dirt changed from before-state metadata"];
  }
  if (pathMatches(item.path, scope.allow_clean_inherited_paths)) {
    return ["inherited_dirty_removed_or_cleaned", "PASS", false, "inherited dirty path was explicitly allowlisted for cleanup"];
  }
  return ["inherited_dirty_removed_or_cleaned", "BLOCK", true, "pre-existing dirty work disappeared during the task"];
}

function classifyAfterItem(item, beforeSet, scope) {
  const inherited = beforeSet.has(item.path);
  const owned = pathMatches(item.path, scope.owned_paths);
  const staged = item.index !== " " && item.index !== "?";
  if (isSensitivePath(item.path)) {
    return ["credential_provider_runtime_dirt", "ESCALATE", true, "credential/provider/runtime dirt is decision-relevant by metadata"];
  }
  if (staged && !owned) {
    return ["staged_outside_scope", "BLOCK", true, "staged change is outside owned scope"];
  }
  if (pathMatches(item.path, scope.ignored_paths) || isGeneratedPath(item.path, scope)) {
    return ["generated_cache_artifact", "QUEUE", false, "generated or ignored artifact is mechanical dirty work"];
  }
  if (inherited && !owned) {
    return ["inherited_dirty_outside_scope", "QUEUE", false, "pre-existing dirt outside current scope is queued and suppressed"];
  }
  if (inherited && owned) {
    return ["inherited_dirty_inside_scope", "DECISION", true, "pre-existing dirt overlaps owned scope"];
  }
  if (!inherited && !owned) {
    return ["agent_created_outside_scope", "BLOCK", true, "new dirty work is outside owned scope"];
  }
  return ["clean_owned_path_edit", "PASS", false, "dirty work is inside owned scope"];
}

function classifiedItem(item, before, after, scope, beforeOnly = false) {
  const beforeSet = new Set((before.dirty || []).map((entry) => entry.path));
  const [classification, action, pmVisible, reason] = beforeOnly
    ? classifyBeforeOnly(item, scope)
    : classifyAfterItem(item, beforeSet, scope);
  const decisionState = {
    path: item.path,
    classification,
    action,
    before_state_hash: before.state_hash,
    after_state_hash: after.state_hash,
    scope_hash: scope.scope_hash,
    reason,
  };
  return {
    path: item.path,
    status: beforeOnly ? "before-only" : item.status,
    classification,
    action,
    pm_visible: pmVisible,
    reason,
    inherited: beforeOnly || beforeSet.has(item.path),
    owned: pathMatches(item.path, scope.owned_paths),
    staged: !beforeOnly && item.index !== " " && item.index !== "?",
    evidence: {
      before_state_hash: before.state_hash,
      after_state_hash: after.state_hash,
      item_state_hash: item.state_hash,
      scope_hash: scope.scope_hash,
    },
    decision_state_hash: stateHash(decisionState),
  };
}

function classifyDirtyWork(before, after, scope) {
  const afterSet = new Set((after.dirty || []).map((item) => item.path));
  const afterItems = (after.dirty || []).map((item) => classifiedItem(item, before, after, scope));
  const beforeOnly = (before.dirty || [])
    .filter((item) => !afterSet.has(item.path))
    .map((item) => classifiedItem(item, before, after, scope, true));
  const classifications = [...afterItems, ...beforeOnly].sort((left, right) => left.path.localeCompare(right.path));
  const summary = {
    pass: classifications.filter((item) => item.action === "PASS").length,
    queued: classifications.filter((item) => item.action === "QUEUE").length,
    suppressed: classifications.filter((item) => item.action === "QUEUE" && !item.pm_visible).length,
    decisions: classifications.filter((item) => item.action === "DECISION").length,
    blockers: classifications.filter((item) => item.action === "BLOCK").length,
    escalations: classifications.filter((item) => item.action === "ESCALATE").length,
  };
  const body = { v: 1, scope_hash: scope.scope_hash, summary, classifications };
  return { ...body, generated_at: new Date().toISOString(), state_hash: stateHash(body) };
}

function withDirtyMetadata(result, repoRoot) {
  return {
    ...result,
    schema_version: "1.0.0",
    target: toSlash(path.resolve(repoRoot)),
    redacted: true,
    expires_after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function writeQueue(repoRoot, scope, result) {
  const queuePath = resolveInside(repoRoot, scope.queue_path, "dirty queue");
  const queue = readJsonFile(queuePath, { v: 1, items: [] });
  const existing = new Set((queue.items || []).map((item) => item.key));
  for (const item of result.classifications.filter((entry) => entry.action === "QUEUE")) {
    const key = `${item.path}|${item.classification}|${item.decision_state_hash}`;
    if (existing.has(key)) continue;
    queue.items.push({ key, path: item.path, classification: item.classification, reason: item.reason, state_hash: item.decision_state_hash, status: "queued", first_seen: result.generated_at });
  }
  ensureDir(path.dirname(queuePath));
  writeJsonFile(queuePath, queue);
}

function renderPmSummary(result) {
  const decisionCount = result.summary.decisions + result.summary.escalations;
  const blockerCount = result.summary.blockers + result.summary.escalations;
  return [
    "Dirty Work Autopilot classified repo state.",
    blockerCount === 0 ? "No current-scope blocker." : `${blockerCount} current-scope blocker(s) or escalation(s).`,
    `${result.summary.suppressed} queued item(s) were suppressed from the PM loop.`,
    decisionCount === 0 ? "No user decision needed." : `${decisionCount} user/expert decision item(s) needed.`,
  ].join("\n");
}

function commandDirty(argv, context = {}) {
  const repoRoot = resolveGitRoot(context.cwd || process.cwd());
  const { positional, options } = parseArgs(argv);
  const action = positional[0];
  if (action === "snapshot") {
    const out = requireOptionValue(options.out, "dirty snapshot --out");
    const outPath = resolveInside(repoRoot, out, "snapshot output");
    ensureDir(path.dirname(outPath));
    writeJsonFile(outPath, takeDirtySnapshot(repoRoot));
    console.log(`Wrote dirty snapshot: ${toSlash(path.relative(repoRoot, outPath))}`);
    return;
  }
  if (action === "classify") {
    for (const flag of ["before", "after", "scope", "out"]) {
      requireOptionValue(options[flag], `dirty classify --${flag}`);
    }
    const scope = readScope(repoRoot, options.scope);
    const before = readRequiredJson(repoRoot, options.before, "before snapshot");
    const after = readRequiredJson(repoRoot, options.after, "after snapshot");
    const result = withDirtyMetadata(classifyDirtyWork(before, after, scope), repoRoot);
    const outPath = resolveInside(repoRoot, options.out, "dirty classification output");
    ensureDir(path.dirname(outPath));
    writeJsonFile(outPath, result);
    writeQueue(repoRoot, scope, result);
    importDirtyDecisions(repoRoot, scope, result, toSlash(path.relative(repoRoot, outPath)));
    console.log(renderPmSummary(result));
    return;
  }
  fail(`unknown dirty action: ${action || "missing"}`);
}

function commandGate(argv, context = {}) {
  const repoRoot = resolveGitRoot(context.cwd || process.cwd());
  const { positional, options } = parseArgs(argv);
  const action = positional[0];
  if (!["scope", "ship"].includes(action)) fail(`unknown gate action: ${action || "missing"}`);
  if (options.dirty === undefined) fail(`gate ${action} requires --dirty <path>`);
  if (options.scope === undefined) fail(`gate ${action} requires --scope <path>`);
  const dirtyPath = requireOptionValue(options.dirty, `gate ${action} --dirty`);
  const scopePath = requireOptionValue(options.scope, `gate ${action} --scope`);
  const scope = readScope(repoRoot, scopePath);
  const dirty = readRequiredJson(repoRoot, dirtyPath, "dirty classification");

  if (action === "ship") {
    let result;
    if (dirty.scope_hash !== scope.scope_hash) {
      result = {
        tier: "BLOCK",
        resolution: "blocked",
        reasons: ["stale dirty classification scope hash does not match current scope"],
        changed_paths: [],
        decision_required: false,
      };
    } else {
      try {
        result = classifyDirtyResult(dirty, {
          targetRoot: repoRoot,
          owned_paths: scope.owned_paths,
          checks_status: options.checksStatus || options.checkStatus,
          max_age_ms: options.maxAgeMs,
        });
      } catch (error) {
        result = {
          tier: "BLOCK",
          resolution: "blocked",
          reasons: [`ship gate classification failed: ${error.message}`],
          changed_paths: [],
          decision_required: false,
        };
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ schema_version: "1.0.0", ok: ["ship", "follow-up-queued"].includes(result.resolution), ...result }, null, 2));
    } else {
      console.log(`Ship gate: ${result.resolution.toUpperCase()} (${result.tier})`);
      for (const reason of result.reasons) {
        console.log(`- ${reason}`);
      }
    }
    return ["ship", "follow-up-queued"].includes(result.resolution) ? undefined : { exitCode: 1 };
  }

  if (dirty.scope_hash !== scope.scope_hash) {
    fail("scope gate failed: dirty classification scope hash does not match scope");
  }
  const blocked = dirty.classifications.filter((item) => ["BLOCK", "ESCALATE", "DECISION"].includes(item.action));
  if (blocked.length > 0) {
    console.log(`Scope gate: BLOCK\n${blocked.map((item) => `- ${item.action}: ${item.path} (${item.classification})`).join("\n")}`);
    fail("scope gate failed");
  }
  console.log("Scope gate: PASS");
}

module.exports = { classifyDirtyWork, commandDirty, commandGate, parseStatusZ, renderPmSummary, takeDirtySnapshot };
