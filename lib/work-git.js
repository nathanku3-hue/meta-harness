"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { gitExecutableForWorkspace } = require("./git-command");
const { writeJsonAtomic } = require("./paths");
const { loadWorkSession, validRelativePath } = require("./work-session");

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const WORK_SESSION_POINTER_SCHEMA = "work-session-pointer/v2";
const MANAGED_WORKTREE_DIRECTORY = ".worktrees";
const MANAGED_WORKTREE_PREFIX = "meta-harness-";
const LEGACY_WORKTREE_DIRECTORY = ".meta-harness-worktrees";
const resumeRecords = new WeakMap();

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

function realPath(targetPath, code, label) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    fail(code, `${label} cannot be resolved canonically: ${error.message}`);
  }
}

function lstatIfExists(targetPath, code, label) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code, `${label} is unreadable: ${error.message}`);
  }
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function pathContainedBy(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function repositoryRoot(repositoryPath) {
  const target = path.resolve(repositoryPath);
  requireDirectory(target);
  const result = runGit(target, ["rev-parse", "--show-toplevel"]);
  const root = String(result.stdout || "").trim();
  if (!root) fail("MH_WORK_REPOSITORY", "target is not a Git repository");
  const resolved = path.resolve(root);
  requireDirectory(resolved);
  return realPath(resolved, "MH_WORK_REPOSITORY", "repository root");
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

function exactDeliveryPaths(values) {
  if (!Array.isArray(values)) {
    fail("MH_WORK_DELIVERY_PATH", "accepted delivery paths must be an array");
  }
  const paths = [...new Set(values.map(normalizedPath))].sort();
  for (const itemPath of paths) {
    if (itemPath === "." || !validRelativePath(itemPath)) {
      fail("MH_WORK_DELIVERY_PATH", `invalid accepted delivery path: ${itemPath}`);
    }
  }
  return paths;
}

function hashAcceptedPaths(workspacePath, acceptedPaths) {
  const root = repositoryRoot(workspacePath);
  const hashes = {};
  for (const itemPath of exactDeliveryPaths(acceptedPaths)) {
    const target = path.resolve(root, ...itemPath.split("/"));
    const rootPrefix = `${root}${path.sep}`.toLowerCase();
    if (!target.toLowerCase().startsWith(rootPrefix)) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path escapes the repository: ${itemPath}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path is unreadable: ${itemPath}: ${error.message}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("MH_WORK_DELIVERY_PATH", `accepted delivery path must be a regular non-symlink file: ${itemPath}`);
    }
    const digest = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    hashes[itemPath] = `sha256:${digest}`;
  }
  return Object.freeze(hashes);
}

function verifyAcceptedPathHashes(workspacePath, expectedHashes) {
  if (!expectedHashes || typeof expectedHashes !== "object" || Array.isArray(expectedHashes)) {
    fail("MH_WORK_DELIVERY_HASH", "accepted path hashes must be an object");
  }
  const paths = exactDeliveryPaths(Object.keys(expectedHashes));
  const actual = hashAcceptedPaths(workspacePath, paths);
  for (const itemPath of paths) {
    if (actual[itemPath] !== expectedHashes[itemPath]) {
      fail("MH_WORK_DELIVERY_MUTATION", `accepted path changed after validation: ${itemPath}`, {
        expected: expectedHashes[itemPath],
        actual: actual[itemPath],
      });
    }
  }
  return paths;
}

function nulPaths(text) {
  return String(text || "").split("\0").filter(Boolean).map(normalizedPath).sort();
}

function stagedPaths(root) {
  return nulPaths(runGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout);
}

function samePaths(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function deliveryCommitMessage(productResult) {
  const summary = String(productResult || "validated task")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `Deliver ${summary || "validated task"}`;
}

function remoteBranchHead(root, branch) {
  const ref = `refs/heads/${branch}`;
  const output = String(runGit(root, ["ls-remote", "--heads", "origin", ref]).stdout || "").trim();
  if (!output) return null;
  const [sha, returnedRef] = output.split(/\s+/);
  return returnedRef === ref ? sha : null;
}

function deliverValidatedChanges({
  workspacePath,
  acceptedPathHashes,
  delivery,
  productResult,
}) {
  if (!delivery || typeof delivery.commit !== "boolean" || typeof delivery.push !== "boolean") {
    fail("MH_WORK_DELIVERY_AUTHORITY", "delivery authority must contain boolean commit and push fields");
  }
  if (delivery.push && !delivery.commit) {
    fail("MH_WORK_DELIVERY_AUTHORITY", "push authority requires commit authority");
  }
  const root = repositoryRoot(workspacePath);
  const acceptedPaths = exactDeliveryPaths(Object.keys(acceptedPathHashes || {}));
  const notAuthorized = {
    validation: "passed",
    commit: { status: "not_authorized" },
    push: { status: "not_authorized" },
  };
  if (!delivery.commit) return notAuthorized;

  verifyAcceptedPathHashes(root, acceptedPathHashes);
  const before = inspectWorkspace(root, ["."]);
  const accepted = new Set(acceptedPaths);
  const beforeStaged = stagedPaths(root);
  const beforeStagedSet = new Set(beforeStaged);
  const unrelatedStaged = beforeStaged.filter((itemPath) => !accepted.has(itemPath));
  const unrelatedIndexDiff = unrelatedStaged.length === 0
    ? ""
    : String(runGit(root, ["diff", "--cached", "--binary", "--", ...unrelatedStaged]).stdout || "");

  if (acceptedPaths.length === 0) {
    return {
      validation: "passed",
      commit: { status: "no_changes", sha: before.head },
      push: { status: "not_attempted" },
    };
  }

  runGit(root, ["add", "--", ...acceptedPaths]);
  verifyAcceptedPathHashes(root, acceptedPathHashes);
  const afterStage = stagedPaths(root);
  const unexpectedStaged = afterStage.filter((itemPath) => !beforeStagedSet.has(itemPath) && !accepted.has(itemPath));
  if (unexpectedStaged.length > 0) {
    fail("MH_WORK_DELIVERY_STAGE", "staging changed paths outside the accepted delivery set", { paths: unexpectedStaged });
  }
  const acceptedStaged = afterStage.filter((itemPath) => accepted.has(itemPath));
  if (acceptedStaged.length === 0) {
    return {
      validation: "passed",
      commit: { status: "no_changes", sha: before.head },
      push: { status: "not_attempted" },
    };
  }

  runGit(root, [
    "commit",
    "--only",
    "--no-verify",
    "-m",
    deliveryCommitMessage(productResult),
    "--",
    ...acceptedStaged,
  ]);
  const sha = String(runGit(root, ["rev-parse", "HEAD"]).stdout || "").trim();
  const committedPaths = nulPaths(runGit(root, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    sha,
  ]).stdout);
  if (!samePaths(committedPaths, acceptedStaged)) {
    fail("MH_WORK_DELIVERY_COMMIT", "commit path set does not equal the accepted staged path set", {
      accepted: acceptedStaged,
      committed: committedPaths,
    });
  }

  const unrelatedAfter = unrelatedStaged.length === 0
    ? ""
    : String(runGit(root, ["diff", "--cached", "--binary", "--", ...unrelatedStaged]).stdout || "");
  if (unrelatedAfter !== unrelatedIndexDiff) {
    fail("MH_WORK_DELIVERY_INDEX", "unrelated staged changes were modified during delivery");
  }
  verifyAcceptedPathHashes(root, acceptedPathHashes);

  const commit = { status: "committed", sha, paths: acceptedStaged };
  if (!delivery.push) {
    return {
      validation: "passed",
      commit,
      push: { status: "not_authorized" },
    };
  }

  const branch = currentBranch(root);
  if (!branch) fail("MH_WORK_DELIVERY_BRANCH", "authorized push requires a checked-out branch");
  runGit(root, ["push", "origin", `HEAD:refs/heads/${branch}`]);
  const remoteHead = remoteBranchHead(root, branch);
  if (remoteHead !== sha) {
    fail("MH_WORK_DELIVERY_PUSH", "authorized push did not end with local commit equal to remote HEAD", {
      local: sha,
      remote: remoteHead,
      branch,
    });
  }
  return {
    validation: "passed",
    commit,
    push: { status: "remote_equal", sha, remote: "origin", branch },
  };
}

function slug(value) {
  const normalized = String(value || "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return normalized || "work";
}

function legacyIsolationRoot(root) {
  const legacyRoot = path.join(path.dirname(root), LEGACY_WORKTREE_DIRECTORY);
  return lstatIfExists(legacyRoot, "MH_WORK_LEGACY_ROOT", "legacy isolation root") ? legacyRoot : null;
}

function requireManagedWorktreeIgnore(root) {
  const ignored = runGit(root, ["check-ignore", "-q", "--", `${MANAGED_WORKTREE_DIRECTORY}/`], { allowFailure: true });
  if (ignored.status !== 0) {
    fail(
      "MH_WORK_WORKTREE_IGNORE",
      `${MANAGED_WORKTREE_DIRECTORY}/ must be ignored before Meta-Harness creates an isolated worktree`,
    );
  }
}

function managedWorktreeRoot(root, { create = false } = {}) {
  const target = path.join(root, MANAGED_WORKTREE_DIRECTORY);
  let stat = lstatIfExists(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  if (!stat) {
    if (!create) return target;
    fs.mkdirSync(target);
    stat = lstatIfExists(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_WORKTREE_ROOT", "managed worktree root must be a real directory, not a symlink or junction");
  }
  const canonical = realPath(target, "MH_WORK_WORKTREE_ROOT", "managed worktree root");
  if (!samePath(path.dirname(canonical), root)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree root escapes the repository");
  }
  return canonical;
}

function expectedManagedWorktreePath(root, session) {
  return path.join(root, MANAGED_WORKTREE_DIRECTORY, `${MANAGED_WORKTREE_PREFIX}${session.sessionDigest.slice(-10)}`);
}

function validateManagedWorktreePath(root, session, workspacePath, { mustExist = false } = {}) {
  const expected = expectedManagedWorktreePath(root, session);
  if (!samePath(workspacePath, expected)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree path does not match the repository-local session path");
  }
  const rootPath = path.join(root, MANAGED_WORKTREE_DIRECTORY);
  if (lstatIfExists(rootPath, "MH_WORK_WORKTREE_ROOT", "managed worktree root")) managedWorktreeRoot(root);
  const stat = lstatIfExists(expected, "MH_WORK_WORKTREE_PATH", "managed worktree path");
  if (!stat) {
    if (mustExist) fail("MH_WORK_WORKTREE_MISSING", `managed worktree is missing: ${expected}`);
    return expected;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("MH_WORK_WORKTREE_PATH", "managed worktree path must be a real directory, not a symlink or junction");
  }
  const canonicalRoot = managedWorktreeRoot(root);
  const canonicalWorkspace = realPath(expected, "MH_WORK_WORKTREE_PATH", "managed worktree");
  if (!samePath(path.dirname(canonicalWorkspace), canonicalRoot) || !pathContainedBy(root, canonicalWorkspace)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree escapes the repository-local worktree root");
  }
  return canonicalWorkspace;
}

function registeredWorktree(root, workspacePath) {
  const output = String(runGit(root, ["worktree", "list", "--porcelain"]).stdout || "");
  const blocks = output.trim().split(/\r?\n\r?\n/).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (!worktreeLine) continue;
    const candidate = path.resolve(worktreeLine.slice("worktree ".length));
    if (!samePath(candidate, workspacePath)) continue;
    const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"));
    return {
      path: candidate,
      branch: branchLine ? branchLine.slice("branch refs/heads/".length) : null,
      detached: lines.includes("detached"),
    };
  }
  return null;
}

function validatePersistedWorkspace(root, session, workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    fail("MH_WORK_RESUME", "persisted workspace record is invalid");
  }
  if (workspace.mode === "current") {
    if (!samePath(workspace.path, root) || workspace.branch !== currentBranch(root)) {
      fail("MH_WORK_RESUME", "persisted current-workspace identity no longer matches the repository");
    }
    return { mode: "current", path: root, branch: workspace.branch };
  }
  if (workspace.mode !== "isolated" || typeof workspace.branch !== "string") {
    fail("MH_WORK_RESUME", "persisted workspace record has an invalid mode or branch");
  }
  if (!samePath(workspace.path, expectedManagedWorktreePath(root, session))) {
    fail("MH_WORK_RESUME", "persisted managed worktree path was substituted");
  }
  const canonicalWorkspace = validateManagedWorktreePath(root, session, workspace.path, { mustExist: true });
  requireManagedWorktreeIgnore(root);
  const registered = registeredWorktree(root, canonicalWorkspace);
  if (!registered || registered.branch !== workspace.branch) {
    fail("MH_WORK_RESUME", "persisted managed worktree is not registered by Git with the recorded branch");
  }
  return { mode: "isolated", path: canonicalWorkspace, branch: workspace.branch };
}

function worktreePlan(repositoryPath, session) {
  const inspected = inspectWorkspace(repositoryPath, session.allowedPaths);
  const resumed = resumeRecords.get(session);
  if (resumed) {
    const workspace = validatePersistedWorkspace(inspected.root, session, resumed.workspace);
    return {
      mode: workspace.mode,
      reason: "resuming the persisted workspace record",
      repositoryRoot: inspected.root,
      workspacePath: workspace.path,
      branch: workspace.branch,
      head: inspected.head,
      existingDirtyPaths: inspected.entries.map((entry) => entry.path),
      outOfScopeDirtyPaths: inspected.outOfScope.map((entry) => entry.path),
      legacyIsolationRoot: legacyIsolationRoot(inspected.root),
      wouldCreate: false,
    };
  }

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

  const workspacePath = validateManagedWorktreePath(inspected.root, session, expectedManagedWorktreePath(inspected.root, session));
  requireManagedWorktreeIgnore(inspected.root);
  return {
    mode: "isolated",
    reason: session.dirtyPolicy === "isolate"
      ? "the work session requires isolation"
      : "existing changes cross the accepted path boundary",
    repositoryRoot: inspected.root,
    workspacePath,
    branch: `work/${slug(session.productResult)}-${session.sessionDigest.slice(-10)}`,
    head: inspected.head,
    existingDirtyPaths: inspected.entries.map((entry) => entry.path),
    outOfScopeDirtyPaths: inspected.outOfScope.map((entry) => entry.path),
    legacyIsolationRoot: legacyIsolationRoot(inspected.root),
    wouldCreate: !lstatIfExists(workspacePath, "MH_WORK_WORKTREE_PATH", "managed worktree path"),
  };
}

function prepareWorkspace(repositoryPath, session) {
  const plan = worktreePlan(repositoryPath, session);
  if (plan.mode === "current") return { ...plan, created: false };

  const registered = registeredWorktree(plan.repositoryRoot, plan.workspacePath);
  if (registered) {
    const physicalPath = validateManagedWorktreePath(plan.repositoryRoot, session, registered.path, { mustExist: true });
    if (registered.branch !== plan.branch) {
      fail("MH_WORK_WORKTREE_COLLISION", `existing worktree uses a different branch: ${plan.workspacePath}`);
    }
    const reused = inspectWorkspace(physicalPath, session.allowedPaths);
    if (reused.outOfScope.length > 0 || reused.staged.length > 0) {
      fail("MH_WORK_WORKTREE_DIRTY", "existing isolated worktree contains staged or out-of-scope changes");
    }
    return { ...plan, workspacePath: physicalPath, created: false, reused: true };
  }

  if (lstatIfExists(plan.workspacePath, "MH_WORK_WORKTREE_PATH", "managed worktree path")) {
    fail("MH_WORK_WORKTREE_COLLISION", `unregistered path already exists: ${plan.workspacePath}`);
  }
  const root = managedWorktreeRoot(plan.repositoryRoot, { create: true });
  const target = path.join(root, path.basename(plan.workspacePath));
  if (!samePath(target, plan.workspacePath)) {
    fail("MH_WORK_WORKTREE_ESCAPE", "managed worktree target changed after canonical root resolution");
  }
  const branchExists = runGit(plan.repositoryRoot, ["show-ref", "--verify", `refs/heads/${plan.branch}`], { allowFailure: true }).status === 0;
  const args = branchExists
    ? ["worktree", "add", target, plan.branch]
    : ["worktree", "add", "-b", plan.branch, target, plan.head];
  runGit(plan.repositoryRoot, args);
  const physicalPath = validateManagedWorktreePath(plan.repositoryRoot, session, target, { mustExist: true });
  const createdRegistration = registeredWorktree(plan.repositoryRoot, physicalPath);
  if (!createdRegistration || createdRegistration.branch !== plan.branch) {
    fail("MH_WORK_WORKTREE_REGISTRATION", "created managed worktree is not registered by Git at the recorded physical path");
  }
  return { ...plan, workspacePath: physicalPath, created: true, reused: false };
}

function stateDirectory(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  return path.join(commonGitDirectory(root), "meta-harness", "work-sessions");
}

function persistWorkSession(repositoryPath, session, workspace) {
  const root = repositoryRoot(repositoryPath);
  const directory = stateDirectory(root);
  fs.mkdirSync(directory, { recursive: true });
  const name = `${session.sessionDigest.slice("sha256:".length)}.json`;
  const sessionPath = path.join(directory, name);
  const persistedWorkspace = workspace.mode === "isolated"
    ? validatePersistedWorkspace(root, session, { mode: workspace.mode, path: workspace.workspacePath, branch: workspace.branch })
    : validatePersistedWorkspace(root, session, { mode: workspace.mode, path: root, branch: workspace.branch });
  writeJsonAtomic(sessionPath, session);
  writeJsonAtomic(path.join(directory, "latest.json"), {
    schemaVersion: WORK_SESSION_POINTER_SCHEMA,
    repositoryRoot: root,
    sessionFile: name,
    sessionDigest: session.sessionDigest,
    workspace: persistedWorkspace,
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
  const root = repositoryRoot(repositoryPath);
  const directory = stateDirectory(root);
  const pointerPath = path.join(directory, "latest.json");
  let pointer;
  try {
    pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  } catch (error) {
    fail("MH_WORK_RESUME", `no resumable work session: ${error.message}`);
  }
  if (!pointer || pointer.schemaVersion !== WORK_SESSION_POINTER_SCHEMA
    || typeof pointer.repositoryRoot !== "string"
    || typeof pointer.sessionFile !== "string"
    || typeof pointer.sessionDigest !== "string") {
    fail("MH_WORK_RESUME", "latest work-session pointer is invalid");
  }
  if (!samePath(pointer.repositoryRoot, root) || !/^[a-f0-9]{64}\.json$/u.test(pointer.sessionFile)) {
    fail("MH_WORK_RESUME", "latest work-session pointer does not belong to this repository");
  }
  const sessionPath = path.resolve(directory, pointer.sessionFile);
  if (!samePath(path.dirname(sessionPath), directory)) {
    fail("MH_WORK_RESUME", "latest work-session pointer escapes the persisted session directory");
  }
  const session = loadWorkSession(sessionPath);
  const expectedFile = `${session.sessionDigest.slice("sha256:".length)}.json`;
  if (pointer.sessionDigest !== session.sessionDigest || pointer.sessionFile !== expectedFile) {
    fail("MH_WORK_RESUME", "persisted session identity does not match the workspace record");
  }
  const workspace = validatePersistedWorkspace(root, session, pointer.workspace);
  resumeRecords.set(session, { repositoryRoot: root, workspace });
  return session;
}

module.exports = {
  deliverValidatedChanges,
  hashAcceptedPaths,
  inspectWorkspace,
  loadLatestWorkSession,
  parsePorcelainZ,
  pathAllowed,
  persistWorkSession,
  prepareWorkspace,
  repositoryRoot,
  runGit,
  stateDirectory,
  verifyAcceptedPathHashes,
  worktreePlan,
};
