"use strict";

/**
 * D071/D072: create a detached no-hardlink local clone of ToolLauncher.
 * Does not use git worktree (avoids mutating dirty live checkout admin state).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { absNorm } = require("../../internal/d069/support");

const TOOLLAUNCHER_BASE_REVISION = "7fab419f20ba5c7a4008d6a6071d5aad10ba534c";
const TOOLLAUNCHER_BASE_TREE = "6bd348cd7ade94a49e17e881560b26ed799c4d49";
const DEFAULT_SOURCE = "E:\\code\\ToolLauncher";

function runGit(gitPath, cwd, args, envExtra = {}) {
  const result = spawnSync(gitPath, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      ...envExtra,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function resolveGit() {
  const preferred = process.platform === "win32" ? "D:\\Git\\cmd\\git.exe" : "git";
  for (const c of [preferred, "git"]) {
    const probe = spawnSync(c, ["--version"], { encoding: "utf8", windowsHide: true });
    if (probe.error || probe.status !== 0) continue;
    if (path.isAbsolute(c) && fs.existsSync(c)) return fs.realpathSync(c);
    const whereCmd = process.platform === "win32" ? "where" : "which";
    const located = spawnSync(whereCmd, [c], { encoding: "utf8", windowsHide: true });
    if (located.status === 0) {
      const first = String(located.stdout || "").trim().split(/\r?\n/)[0];
      if (first) return fs.realpathSync(first);
    }
  }
  throw new Error("toollauncher-clone: unable to resolve git");
}

/**
 * @param {{ sourcePath?: string, baseRevision?: string, rootPath?: string, retain?: boolean }} [options]
 * @returns {{ repositoryPath: string, headRevision: string, tree: string, cleanup: Function, gitExecutablePath: string, sourcePath: string }}
 */
function createDetachedToolLauncherClone(options = {}) {
  const sourcePath = absNorm(options.sourcePath || process.env.D071_TOOLLAUNCHER_SOURCE || DEFAULT_SOURCE);
  const baseRevision = options.baseRevision || TOOLLAUNCHER_BASE_REVISION;
  if (!fs.existsSync(path.join(sourcePath, ".git")) && !fs.existsSync(sourcePath)) {
    throw new Error(`ToolLauncher source missing: ${sourcePath}`);
  }

  const gitExecutablePath = resolveGit();
  const retain = options.retain === true;
  let root;
  if (options.rootPath) {
    root = absNorm(options.rootPath);
    if (fs.existsSync(root)) {
      throw new Error(`ToolLauncher custody root already exists: ${root}`);
    }
    fs.mkdirSync(root, { recursive: false });
  } else {
    root = absNorm(fs.mkdtempSync(path.join(os.tmpdir(), "d071-tl-clone-")));
  }
  const repositoryDirectoryName = options.rootPath ? "repository" : "repo";
  const repositoryPath = absNorm(path.join(root, repositoryDirectoryName));

  // Local clone without hardlinks so object store is independent of the dirty live tree.
  runGit(gitExecutablePath, root, [
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    sourcePath,
    repositoryDirectoryName,
  ]);

  // Normalize line-ending policy before materializing files so controller
  // isolated git home (empty global/system config) still sees a clean tree.
  runGit(gitExecutablePath, repositoryPath, ["config", "core.autocrlf", "false"]);
  runGit(gitExecutablePath, repositoryPath, ["config", "core.eol", "lf"]);
  runGit(gitExecutablePath, repositoryPath, ["checkout", "--detach", baseRevision]);
  runGit(gitExecutablePath, repositoryPath, ["reset", "--hard", "HEAD"]);
  // Drop remote so the clone cannot push/fetch accidentally during dogfood.
  try {
    runGit(gitExecutablePath, repositoryPath, ["remote", "remove", "origin"]);
  } catch {
    // ignore if origin absent
  }

  const headRevision = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"]).stdout,
  ).trim();
  if (headRevision !== baseRevision) {
    throw new Error(`clone HEAD ${headRevision} != required ${baseRevision}`);
  }

  const tree = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD^{tree}"]).stdout,
  ).trim();
  if (tree !== TOOLLAUNCHER_BASE_TREE) {
    throw new Error(`clone tree ${tree} != required ${TOOLLAUNCHER_BASE_TREE}`);
  }

  // Verify cleanliness under the same empty-global git config style the controller uses.
  const cleanEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
  };
  const statusResult = spawnSync(
    gitExecutablePath,
    ["-c", "core.autocrlf=false", "status", "--porcelain", "-uall"],
    { cwd: repositoryPath, encoding: "utf8", windowsHide: true, env: cleanEnv },
  );
  if (statusResult.error) throw statusResult.error;
  if (statusResult.status !== 0) {
    throw new Error(`clone status failed: ${String(statusResult.stderr || "").trim()}`);
  }
  const status = String(statusResult.stdout || "").trim();
  if (status !== "") {
    throw new Error(`clone worktree not clean under isolated git config: ${status}`);
  }

  // Confirm subject path exists at pin.
  const subject = path.join(repositoryPath, "scripts", "utils", "CheckShortcut.ps1");
  if (!fs.existsSync(subject)) {
    throw new Error(`CheckShortcut.ps1 missing in clone at ${subject}`);
  }

  function cleanup() {
    if (retain) return;
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    } catch {
      // best-effort
    }
  }

  return {
    root,
    repositoryPath,
    headRevision,
    tree,
    sourcePath,
    gitExecutablePath,
    cleanup,
  };
}

module.exports = {
  createDetachedToolLauncherClone,
  TOOLLAUNCHER_BASE_REVISION,
  TOOLLAUNCHER_BASE_TREE,
  DEFAULT_SOURCE,
};
