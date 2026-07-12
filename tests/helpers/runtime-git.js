"use strict";

/** Shared git helpers for D071 offline/live fixtures. */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  throw new Error("runtime-git: unable to resolve git");
}

function gitEnv(author = "meta-harness-d071-fixture") {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: "fixture@meta-harness.local",
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: "fixture@meta-harness.local",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

function hooksPathDisabled() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function runGit(gitPath, cwd, args, env = gitEnv()) {
  const result = spawnSync(
    gitPath,
    ["-c", `core.hooksPath=${hooksPathDisabled()}`, "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", windowsHide: true, env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

module.exports = { resolveGit, gitEnv, hooksPathDisabled, runGit };
