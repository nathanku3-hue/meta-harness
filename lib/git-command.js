"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function isWindowsBackedWorkspace(cwd) {
  const normalized = String(cwd || "").replace(/\\/g, "/");
  return /^\/mnt\/[A-Za-z](?:\/|$)/.test(normalized) || /^[A-Za-z]:\//.test(normalized);
}

function gitExecutableForWorkspace({ cwd, fs, spawn = spawnSync, platform = process.platform }) {
  if (platform === "win32") return "git";

  let preferWindowsGit = isWindowsBackedWorkspace(cwd);
  if (!preferWindowsGit) {
    try {
      const dotGit = path.join(cwd, ".git");
      const stat = fs.lstatSync(dotGit);
      if (stat.isFile()) {
        const pointer = fs.readFileSync(dotGit, "utf8").trim();
        preferWindowsGit = /^gitdir:\s*[A-Za-z]:[\\/]/i.test(pointer);
      }
    } catch {
      // Ordinary checkout; use the host-default Git unless the path itself is Windows-backed.
    }
  }

  if (preferWindowsGit) {
    const probe = spawn("git.exe", ["--version"], {
      encoding: "utf8",
      shell: false,
    });
    if (!probe.error && probe.status === 0) return "git.exe";
  }
  return "git";
}

module.exports = { gitExecutableForWorkspace };
