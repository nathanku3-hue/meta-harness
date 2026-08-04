"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { writeJsonAtomic } = require("./paths");
const { loadWorkSession } = require("./work-session");

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function runGit(cwd, args, { allowFailure = false } = {}) {
  const executable = gitExecutableForWorkspace({ cwd, fs });
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(
      "MH_WORK_GIT",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`,
      { status: result.status, causeCode: result.error?.code },
    );
  }
  return result;
}

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function parsePorcelainZ(text) {
  const tokens = String(text || "").split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index];
    if (!raw) continue;
    const xy = raw.slice(0, 2);
    const itemPath = normalizedPath(raw.slice(3));
    const indexStatus = xy[0] || " ";
    const worktreeStatus = xy[1] || " ";
    let originalPath = null;
    if (indexStatus === "R" || indexStatus === "C") {
      originalPath = normalizedPath(tokens[index + 1] || "");
      index += 1;
    }
    entries.push({
      xy,
      indexStatus,
      worktreeStatus,
      path: itemPath,
      originalPath,
      staged: indexStatus !== " " && indexStatus !== "?",
      untracked: xy === "??",
    });
  }
  return entries;
}

function pathAllowed(itemPath, allowedPaths) {
  const candidate = normalizedPath(itemPath).replace(/\/$/, "");
  return allowedPaths.some((entry) => {
    const allowed = normalizedPath(entry).replace(/\/$/, "");
    return allowed === "." || candidate === allowed || candidate.startsWith(`${allowed}/`);
  });
}

function requireDirectory(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    fail("MH_WORK_REPOSITORY", `repository path is unreadable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_REPOSITORY", "repository path must be an existing non-symlink directory");
  }
}

function repositoryRoot(repositoryPath) {
  const target = path.resolve(repositoryPath);
  requireDirectory(target);
  const result = runGit(target, ["rev-parse", "--show-toplevel"]);
  const root = String(result.stdout || "").trim();
  if (!root) fail("MH_WORK_REPOSITORY", "target is not a Git repository");
  return path.resolve(root);
}

function commonGitDirectory(root) {
  const value = String(runGit(root, ["rev-parse", "--git-common-dir"]).stdout || "").trim();
  if (!value) fail("MH_WORK_GIT", "Git common directory could not be resolved");
  return path.resolve(root, value);
}

function currentBranch(root) {
  const result = runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function inspectWorkspace(repositoryPath, allowedPaths = ["."]) {
  const root = repositoryRoot(repositoryPath);
  const head = String(runGit(root, ["rev-parse", "HEAD"]).stdout || "").trim();
  const status = runGit(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const entries = parsePorcelainZ(status.stdout);
  const outOfScope = entries.filter((entry) => {
    if (!pathAllowed(entry.path, allowedPaths)) return true;
    return entry.originalPath ? !pathAllowed(entry.originalPath, allowedPaths) : false;
  });
  return {
    root,
    head,
    branch: currentBranch(root),
    clean: entries.length === 0,
    entries,
    outOfScope,
    staged: entries.filter((entry) => entry.staged),
  };
}

function primaryWorktreeRoot(root) {
  const output = String(runGit(root, ["worktree", "list", "--porcelain"]).stdout || "");
  const first = output.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  if (!first) return root;
  return path.resolve(first.slice("worktree ".length));
}

function slug(value) {
  const normalized = String(value || "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return normalized || "work";
}

function worktreePlan(repositoryPath, session) {
  const inspected = inspectWorkspace(repositoryPath, session.allowedPaths);
  const continueCurrent = inspected.clean
    || (session.dirtyPolicy === "continue-in-scope" && inspected.outOfScope.length === 0);
  if (continueCurrent) {
    return {
      mode: "current",
      reason: inspected.clean ? "repository is clean" : "all existing changes are inside the accepted path boundary",
      repositoryRoot: inspected.root,
      workspacePath: inspected.root,
      branch: inspected.branch,
      head: inspected.head,
      existingDirtyPaths: inspected.entries.map((entry) => entry.path),
      wouldCreate: false,
    };
  }

  const suffix = session.sessionDigest.slice(-10);
  const primaryRoot = primaryWorktreeRoot(inspected.root);
  const branch = `work/${slug(session.productResult)}-${suffix}`;
  const workspacePath = path.join(
    path.dirname(primaryRoot),
    ".meta-harness-worktrees",
    `${path.basename(primaryRoot)}-${suffix}`,
  );
  return {
    mode: "isolated",
    reason: session.dirtyPolicy === "isolate"
      ? "the work session requires isolation"
      : "existing changes cross the accepted path boundary",
    repositoryRoot: inspected.root,
    workspacePath,
    branch,
    head: inspected.head,
    existingDirtyPaths: inspected.entries.map((entry) => entry.path),
    outOfScopeDirtyPaths: inspected.outOfScope.map((entry) => entry.path),
    wouldCreate: !fs.existsSync(workspacePath),
  };
}

function registeredWorktree(root, workspacePath) {
  const output = String(runGit(root, ["worktree", "list", "--porcelain"]).stdout || "");
  const blocks = output.trim().split(/\r?\n\r?\n/).filter(Boolean);
  const wanted = path.resolve(workspacePath).toLowerCase();
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (!worktreeLine) continue;
    const candidate = path.resolve(worktreeLine.slice("worktree ".length));
    if (candidate.toLowerCase() !== wanted) continue;
    const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"));
    return {
      path: candidate,
      branch: branchLine ? branchLine.slice("branch refs/heads/".length) : null,
      detached: lines.includes("detached"),
    };
  }
  return null;
}

function prepareWorkspace(repositoryPath, session) {
  const plan = worktreePlan(repositoryPath, session);
  if (plan.mode === "current") return { ...plan, created: false };

  const registered = registeredWorktree(plan.repositoryRoot, plan.workspacePath);
  if (registered) {
    if (registered.branch !== plan.branch) {
      fail("MH_WORK_WORKTREE_COLLISION", `existing worktree uses a different branch: ${plan.workspacePath}`);
    }
    const reused = inspectWorkspace(plan.workspacePath, session.allowedPaths);
    if (reused.outOfScope.length > 0 || reused.staged.length > 0) {
      fail("MH_WORK_WORKTREE_DIRTY", "existing isolated worktree contains staged or out-of-scope changes");
    }
    return { ...plan, created: false, reused: true };
  }

  if (fs.existsSync(plan.workspacePath)) {
    fail("MH_WORK_WORKTREE_COLLISION", `unregistered path already exists: ${plan.workspacePath}`);
  }
  fs.mkdirSync(path.dirname(plan.workspacePath), { recursive: true });
  const branchExists = runGit(plan.repositoryRoot, ["show-ref", "--verify", `refs/heads/${plan.branch}`], { allowFailure: true }).status === 0;
  const args = branchExists
    ? ["worktree", "add", plan.workspacePath, plan.branch]
    : ["worktree", "add", "-b", plan.branch, plan.workspacePath, plan.head];
  runGit(plan.repositoryRoot, args);
  return { ...plan, created: true, reused: false };
}

function stateDirectory(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  return path.join(commonGitDirectory(root), "meta-harness", "work-sessions");
}

function persistWorkSession(repositoryPath, session, workspace) {
  const directory = stateDirectory(repositoryPath);
  fs.mkdirSync(directory, { recursive: true });
  const name = `${session.sessionDigest.slice("sha256:".length)}.json`;
  const sessionPath = path.join(directory, name);
  writeJsonAtomic(sessionPath, session);
  writeJsonAtomic(path.join(directory, "latest.json"), {
    schemaVersion: "work-session-pointer/v1",
    sessionFile: name,
    workspacePath: workspace.workspacePath,
    mode: workspace.mode,
  });
  return {
    directory,
    sessionPath,
    resultPath: path.join(directory, `${session.sessionDigest.slice("sha256:".length)}.result.json`),
    schemaPath: path.join(directory, "worker-result.schema.json"),
    agentOutputPath: path.join(directory, `${session.sessionDigest.slice("sha256:".length)}.agent.json`),
  };
}

function loadLatestWorkSession(repositoryPath) {
  const directory = stateDirectory(repositoryPath);
  const pointerPath = path.join(directory, "latest.json");
  let pointer;
  try {
    pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  } catch (error) {
    fail("MH_WORK_RESUME", `no resumable work session: ${error.message}`);
  }
  if (!pointer || pointer.schemaVersion !== "work-session-pointer/v1" || typeof pointer.sessionFile !== "string") {
    fail("MH_WORK_RESUME", "latest work-session pointer is invalid");
  }
  return loadWorkSession(path.join(directory, pointer.sessionFile));
}

module.exports = {
  inspectWorkspace,
  loadLatestWorkSession,
  parsePorcelainZ,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  repositoryRoot,
  runGit,
  stateDirectory,
  worktreePlan,
};
