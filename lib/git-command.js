"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function gitExecutableForWorkspace({ cwd, fs }) {
  if (process.platform === "win32") return "git";
  try {
    const dotGit = path.join(cwd, ".git");
    const stat = fs.lstatSync(dotGit);
    if (stat.isFile()) {
      const pointer = fs.readFileSync(dotGit, "utf8").trim();
      if (/^gitdir:\s*[A-Za-z]:[\\/]/i.test(pointer)) {
        const probe = spawnSync("git.exe", ["--version"], {
          encoding: "utf8",
          shell: false,
        });
        if (!probe.error && probe.status === 0) return "git.exe";
      }
    }
  } catch {
    // Ordinary checkout or unavailable Windows Git; use the host-default Git.
  }
  return "git";
}

module.exports = { gitExecutableForWorkspace };
