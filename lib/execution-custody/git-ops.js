"use strict";

/** Private Git helpers for execution custody. */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { codedError, sameCanonicalExistingPath } = require("./support");

const CONTROLLER_AUTHOR_NAME = "meta-harness-custody";
const CONTROLLER_AUTHOR_EMAIL = "custody@meta-harness.local";

function ensureIsolatedGitHome(stateRoot) {
  const home = path.join(stateRoot, ".custody-git-home");
  fs.mkdirSync(home, { recursive: true });
  const emptyConfig = path.join(home, "gitconfig");
  if (!fs.existsSync(emptyConfig)) {
    fs.writeFileSync(emptyConfig, "", "utf8");
  }
  const xdg = path.join(home, "xdg-config");
  fs.mkdirSync(xdg, { recursive: true });
  return { home, emptyConfig, xdg };
}

function sanitizedGitEnv(gitHome, extra = {}) {
  const env = {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot,
    SYSTEMROOT: process.env.SYSTEMROOT,
    windir: process.env.windir,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    PATHEXT: process.env.PATHEXT,
    ...extra,
  };
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k];
  }

  env.HOME = gitHome.home;
  env.USERPROFILE = gitHome.home;
  env.XDG_CONFIG_HOME = gitHome.xdg;
  env.GIT_CONFIG_GLOBAL = gitHome.emptyConfig;
  env.GIT_CONFIG_SYSTEM = gitHome.emptyConfig;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GC_AUTO = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.GIT_AUTHOR_NAME = CONTROLLER_AUTHOR_NAME;
  env.GIT_AUTHOR_EMAIL = CONTROLLER_AUTHOR_EMAIL;
  env.GIT_COMMITTER_NAME = CONTROLLER_AUTHOR_NAME;
  env.GIT_COMMITTER_EMAIL = CONTROLLER_AUTHOR_EMAIL;
  delete env.GIT_EDITOR;
  delete env.EDITOR;
  delete env.VISUAL;
  delete env.GIT_CONFIG;
  delete env.GIT_CONFIG_PARAMETERS;
  return env;
}

function hooksPathDisabled() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function gitArgsPrefix() {
  return [
    "-c", `core.hooksPath=${hooksPathDisabled()}`,
    "-c", "commit.gpgsign=false",
    "-c", "tag.gpgsign=false",
    "-c", "gpg.format=openpgp",
    "-c", "core.autocrlf=false",
  ];
}

function resolveGitExecutable(gitHome) {
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push("D:\\Git\\cmd\\git.exe");
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe"));
    }
  }
  candidates.push("git");

  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
        env: sanitizedGitEnv(gitHome),
      });
      if (probe.error || probe.status !== 0) continue;
      const versionLine = String(probe.stdout || "").trim().split(/\r?\n/)[0] || "";
      let absolute = candidate;
      if (!path.isAbsolute(candidate)) {
        const whereCmd = process.platform === "win32" ? "where" : "which";
        const located = spawnSync(whereCmd, [candidate], {
          encoding: "utf8",
          windowsHide: true,
          env: process.env,
        });
        if (located.status !== 0) continue;
        absolute = String(located.stdout || "").trim().split(/\r?\n/)[0];
      }
      if (!absolute || !path.isAbsolute(absolute)) continue;
      const real = fs.realpathSync(absolute);
      if (!path.isAbsolute(real)) continue;
      return { gitExecutablePath: real, gitVersion: versionLine };
    } catch {
      // try next
    }
  }
  throw codedError("CUSTODY_GIT_UNRESOLVED", "failed to resolve absolute git executable");
}

function runGit(gitExecutablePath, repoCwd, args, gitHome, options = {}) {
  const result = spawnSync(gitExecutablePath, [...gitArgsPrefix(), ...args], {
    cwd: repoCwd,
    encoding: "utf8",
    windowsHide: true,
    env: sanitizedGitEnv(gitHome, options.env || {}),
  });
  if (result.error) {
    throw codedError("CUSTODY_GIT_SPAWN_FAILED", result.error.message);
  }
  if (result.status !== 0) {
    throw codedError(
      "CUSTODY_GIT_FAILED",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`,
      { status: result.status, stderr: result.stderr, stdout: result.stdout },
    );
  }
  return result;
}

function tryRunGit(gitExecutablePath, repoCwd, args, gitHome) {
  return spawnSync(gitExecutablePath, [...gitArgsPrefix(), ...args], {
    cwd: repoCwd,
    encoding: "utf8",
    windowsHide: true,
    env: sanitizedGitEnv(gitHome),
  });
}

function zeroObjectId(objectFormat) {
  return objectFormat === "sha256" ? "0".repeat(64) : "0".repeat(40);
}

function refExists(gitExecutablePath, repositoryPath, refName, gitHome) {
  const result = tryRunGit(
    gitExecutablePath,
    repositoryPath,
    ["show-ref", "--verify", "--quiet", refName],
    gitHome,
  );
  return result.status === 0;
}

/** Create-only ref update; fails closed if the ref already exists. */
function createOnlyRef(gitExecutablePath, repositoryPath, refName, newOid, objectFormat, gitHome) {
  if (refExists(gitExecutablePath, repositoryPath, refName, gitHome)) {
    throw codedError("CUSTODY_REF_EXISTS", `durable ref already exists: ${refName}`);
  }
  runGit(
    gitExecutablePath,
    repositoryPath,
    ["update-ref", refName, newOid, zeroObjectId(objectFormat)],
    gitHome,
  );
}

function isDetachedHead(gitExecutablePath, cwd, gitHome) {
  const sym = tryRunGit(gitExecutablePath, cwd, ["symbolic-ref", "-q", "HEAD"], gitHome);
  return sym.status !== 0;
}

/**
 * Remove linked worktree and verify absence (path + registration).
 * Failures throw (controller_failed); not best-effort for winner path.
 */
function removeWorktreeVerified(gitExecutablePath, repositoryPath, worktreePath, gitHome) {
  try {
    runGit(
      gitExecutablePath,
      repositoryPath,
      ["worktree", "remove", "--force", worktreePath],
      gitHome,
    );
  } catch (err) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (rmErr) {
      throw codedError(
        "CUSTODY_WORKTREE_CLEANUP",
        `worktree remove failed: ${err.message}; rm failed: ${rmErr.message}`,
      );
    }
    tryRunGit(gitExecutablePath, repositoryPath, ["worktree", "prune"], gitHome);
  }

  tryRunGit(gitExecutablePath, repositoryPath, ["worktree", "prune"], gitHome);

  if (fs.existsSync(worktreePath)) {
    throw codedError(
      "CUSTODY_WORKTREE_CLEANUP",
      `worktree path still present after cleanup: ${worktreePath}`,
    );
  }

  const listed = String(
    runGit(gitExecutablePath, repositoryPath, ["worktree", "list", "--porcelain"], gitHome).stdout,
  );
  for (const line of listed.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const registered = line.slice("worktree ".length).trim();
    // Same-location compare: Git porcelain may differ in separators / drive case.
    let stillRegistered = false;
    try {
      stillRegistered = sameCanonicalExistingPath(registered, worktreePath);
    } catch {
      // Registered path may already be gone; fall back to string compare after resolve.
      stillRegistered = path.resolve(registered) === path.resolve(worktreePath)
        || (process.platform === "win32"
          && path.resolve(registered).toLowerCase() === path.resolve(worktreePath).toLowerCase());
    }
    if (stillRegistered) {
      throw codedError(
        "CUSTODY_WORKTREE_CLEANUP",
        `worktree still registered after cleanup: ${worktreePath}`,
      );
    }
  }
}

/** Best-effort cleanup for loser / pre-claim failure paths only. */
function removeWorktreeBestEffort(gitExecutablePath, repositoryPath, worktreePath, gitHome) {
  try {
    removeWorktreeVerified(gitExecutablePath, repositoryPath, worktreePath, gitHome);
  } catch {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      tryRunGit(gitExecutablePath, repositoryPath, ["worktree", "prune"], gitHome);
    } catch {
      // best-effort
    }
  }
}

function liveRepositoryFacts(gitExecutablePath, repositoryPath, gitHome) {
  const head = String(
    runGit(gitExecutablePath, repositoryPath, ["rev-parse", "HEAD"], gitHome).stdout,
  ).trim();
  let objectFormat = "sha1";
  try {
    const fmt = String(
      runGit(
        gitExecutablePath,
        repositoryPath,
        ["rev-parse", "--show-object-format"],
        gitHome,
      ).stdout,
    ).trim();
    if (fmt === "sha1" || fmt === "sha256") objectFormat = fmt;
  } catch {
    objectFormat = head.length === 64 ? "sha256" : "sha1";
  }
  const status = String(
    runGit(gitExecutablePath, repositoryPath, ["status", "--porcelain", "-uall"], gitHome).stdout,
  );
  return { head, objectFormat, clean: status.trim() === "" };
}

module.exports = {
  CONTROLLER_AUTHOR_NAME,
  CONTROLLER_AUTHOR_EMAIL,
  ensureIsolatedGitHome,
  sanitizedGitEnv,
  resolveGitExecutable,
  runGit,
  tryRunGit,
  zeroObjectId,
  refExists,
  createOnlyRef,
  isDetachedHead,
  removeWorktreeVerified,
  removeWorktreeBestEffort,
  liveRepositoryFacts,
};
