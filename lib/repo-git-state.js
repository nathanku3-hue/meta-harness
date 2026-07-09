"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { stateHash } = require("./state-hash");

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

function runGit(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

function tryGitRoot(cwd) {
  const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.error || result.status !== 0) return null;
  const root = String(result.stdout || "").trim();
  return root ? path.resolve(root) : null;
}

/**
 * Parse porcelain -z status into redacted dirty metadata only.
 * Never retains file paths, original paths, per-file entries, or raw output.
 */
function redactedDirtyFromPorcelainZ(text) {
  let count = 0;
  let has_staged = false;
  let has_untracked = false;
  const tokens = String(text || "").split("\0").filter((token) => token.length > 0);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 2) continue;
    const xy = token.slice(0, 2);
    const indexStatus = xy[0] || " ";
    const worktreeStatus = xy[1] || " ";
    // Rename/copy: next token is original path — skip without storing
    if (indexStatus === "R" || indexStatus === "C") {
      index += 1;
    }
    count += 1;
    if (indexStatus !== " " && indexStatus !== "?") has_staged = true;
    if (worktreeStatus === "?") has_untracked = true;
  }
  return {
    is_clean: count === 0,
    count,
    has_staged,
    has_untracked,
  };
}

function emptyDirty() {
  return { is_clean: false, count: 0, has_staged: false, has_untracked: false };
}

/**
 * Read-only git inspection for a child repo path.
 * Soft-fail: never throws for non-git / missing / empty paths.
 * Dirty metadata is redacted (counts/booleans only — no paths).
 */
function getRepoGitState(absoluteChildPath) {
  const result = {
    exists: false,
    isGitRepo: false,
    branch: null,
    detached: false,
    has_head: false,
    head_commit: null,
    is_clean: false,
    dirty: emptyDirty(),
    state_hash: null,
  };

  if (typeof absoluteChildPath !== "string" || absoluteChildPath.length === 0) {
    return result;
  }

  try {
    if (!fs.existsSync(absoluteChildPath) || !fs.statSync(absoluteChildPath).isDirectory()) {
      return result;
    }
  } catch {
    return result;
  }
  result.exists = true;

  const repoRoot = tryGitRoot(absoluteChildPath);
  if (!repoRoot) {
    result.isGitRepo = false;
    return result;
  }
  result.isGitRepo = true;

  try {
    const symResult = runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (symResult.status === 0 && String(symResult.stdout || "").trim()) {
      result.branch = String(symResult.stdout).trim();
      result.detached = false;
    } else {
      result.detached = true;
      result.branch = null;
    }

    const headResult = runGit(repoRoot, ["rev-parse", "HEAD"]);
    if (headResult.status === 0 && String(headResult.stdout || "").trim()) {
      result.head_commit = String(headResult.stdout).trim();
      result.has_head = true;
    } else {
      result.has_head = false;
    }
  } catch {
    result.has_head = false;
  }

  try {
    const statusResult = runGit(repoRoot, [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    if (statusResult.error || statusResult.status !== 0) {
      result.is_clean = false;
      result.dirty = emptyDirty();
    } else {
      result.dirty = redactedDirtyFromPorcelainZ(statusResult.stdout);
      result.is_clean = result.dirty.is_clean;
    }
  } catch {
    result.is_clean = false;
    result.dirty = emptyDirty();
  }

  const toHash = {
    branch: result.branch,
    detached: result.detached,
    has_head: result.has_head,
    head_commit: result.head_commit,
    is_clean: result.is_clean,
    dirty: result.dirty,
  };
  result.state_hash = stateHash(toHash);

  return result;
}

module.exports = {
  getRepoGitState,
};
