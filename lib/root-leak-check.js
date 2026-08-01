"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gitExecutableForWorkspace } = require("./git-command");

const SCHEMA_VERSION = "repository-layout-inventory/v1";
const APPROVED_RUNTIME_ROOTS = new Set([
  ".git",
  ".meta-harness",
  ".worktrees",
  ".worktree-owners",
  ".devspace",
  ".cursor",
  "node_modules",
  "tmp",
  "dist",
  "build",
  "coverage",
]);
const EVIDENCE_EXTENSIONS = new Set([".patch", ".diff", ".zip", ".tgz", ".tar", ".log"]);

function toSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function isWslMountPath(value) {
  return /^\/mnt\/[A-Za-z](?:\/|$)/.test(String(value || ""));
}

function windowsDriveToWsl(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(String(value || ""));
  if (!match) return String(value || "");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function wslToWindowsDrive(value) {
  const match = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(String(value || ""));
  if (!match) return String(value || "");
  return `${match[1].toUpperCase()}:/${match[2] || ""}`;
}

function nativePath(value) {
  let raw = String(value || "").trim();
  if (process.platform === "win32" && isWslMountPath(raw)) {
    raw = wslToWindowsDrive(raw);
  } else if (process.platform !== "win32" && isWindowsDrivePath(raw)) {
    raw = windowsDriveToWsl(raw);
  }
  return path.resolve(raw);
}

function comparisonPath(value) {
  let current = nativePath(value);
  const suffix = [];
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    suffix.unshift(path.basename(current));
    current = path.dirname(current);
  }
  if (fs.existsSync(current)) {
    try {
      current = fs.realpathSync.native(current);
    } catch {
      // Retain the native spelling when the host cannot resolve this component.
    }
  }
  for (const part of suffix) current = path.join(current, part);
  return current;
}

function pathIdentity(value) {
  let normalized = toSlash(comparisonPath(value));
  if (isWslMountPath(normalized)) normalized = wslToWindowsDrive(normalized);
  normalized = path.posix.normalize(normalized);
  if (isWindowsDrivePath(normalized)) return normalized.toLowerCase();
  return normalized;
}

function pathsEqual(left, right) {
  return pathIdentity(left) === pathIdentity(right);
}

function isPathInside(child, parent) {
  const childKey = pathIdentity(child);
  const parentKey = pathIdentity(parent);
  if (childKey === parentKey) return false;
  const prefix = parentKey.endsWith("/") ? parentKey : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

function runGit(args, cwd) {
  const nativeCwd = nativePath(cwd);
  const executable = gitExecutableForWorkspace({ cwd: nativeCwd, fs });
  const result = spawnSync(executable, args, {
    cwd: nativeCwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function parseWorktreeList(text) {
  const entries = [];
  for (const block of String(text || "").split(/\r?\n\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const entry = { path: "", head: "", branch: "", detached: false, locked: false, prunable: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) entry.path = line.slice(9).trim();
      else if (line.startsWith("HEAD ")) entry.head = line.slice(5).trim();
      else if (line.startsWith("branch ")) entry.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
      else if (line === "detached") entry.detached = true;
      else if (line.startsWith("locked")) entry.locked = true;
      else if (line.startsWith("prunable")) entry.prunable = true;
    }
    if (entry.path) entries.push(entry);
  }
  return entries;
}

function resolveGitOwner(targetRoot) {
  const top = runGit(["rev-parse", "--show-toplevel"], targetRoot);
  const common = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], targetRoot);
  if (!top.ok || !common.ok) {
    return { ok: false, reason: top.stderr || common.stderr || "not a Git repository" };
  }
  const topLevel = nativePath(top.stdout);
  const commonDir = nativePath(common.stdout);
  const ownerRoot = path.basename(commonDir).toLowerCase() === ".git" ? path.dirname(commonDir) : topLevel;
  return { ok: true, topLevel, commonDir, ownerRoot };
}

function listImmediateDirectories(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => pathIdentity(left).localeCompare(pathIdentity(right)));
}

function readGitPointer(worktreePath) {
  const gitPath = path.join(nativePath(worktreePath), ".git");
  if (!fs.existsSync(gitPath)) {
    return { present: false, valid: false, path: gitPath, reason: "missing .git metadata" };
  }
  const stat = fs.lstatSync(gitPath);
  if (stat.isDirectory()) return { present: true, valid: true, path: gitPath, target: gitPath, kind: "directory" };
  if (!stat.isFile()) return { present: true, valid: false, path: gitPath, reason: ".git is not a regular file or directory" };
  const text = fs.readFileSync(gitPath, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/i.exec(text);
  if (!match) return { present: true, valid: false, path: gitPath, reason: "malformed .git pointer" };
  const rawTarget = match[1].trim();
  const target = isWindowsDrivePath(rawTarget) || isWslMountPath(rawTarget) || path.isAbsolute(rawTarget)
    ? nativePath(rawTarget)
    : path.resolve(path.dirname(gitPath), rawTarget);
  return {
    present: true,
    valid: fs.existsSync(target),
    path: gitPath,
    target,
    rawTarget,
    kind: "file",
    reason: fs.existsSync(target) ? "" : "gitdir target does not exist",
  };
}

function item(classification, itemPath, fields = {}) {
  return {
    classification,
    path: toSlash(itemPath),
    ...fields,
  };
}

function issue(code, message, itemPath, classification) {
  return { code, message, path: toSlash(itemPath), classification };
}

function scanOwner(ownerPath, ownerKind) {
  const resolved = resolveGitOwner(ownerPath);
  if (!resolved.ok) {
    return {
      owners: [],
      items: [],
      issues: [issue("OWNER_RESOLUTION_FAILED", resolved.reason, ownerPath, "broken-git-pointer")],
      registeredCount: 0,
      physicalCount: 0,
    };
  }

  const listed = runGit(["worktree", "list", "--porcelain"], resolved.ownerRoot);
  if (!listed.ok) {
    return {
      owners: [{ kind: ownerKind, ...resolved }],
      items: [],
      issues: [issue("WORKTREE_LIST_FAILED", listed.stderr || "git worktree list failed", resolved.ownerRoot, "broken-git-pointer")],
      registeredCount: 0,
      physicalCount: 0,
    };
  }

  const worktreesRoot = path.join(resolved.ownerRoot, ".worktrees");
  const registered = parseWorktreeList(listed.stdout)
    .filter((entry) => !pathsEqual(entry.path, resolved.ownerRoot));
  const physical = listImmediateDirectories(worktreesRoot);
  const registeredCanonical = new Map();
  const items = [];
  const issues = [];

  for (const entry of registered) {
    const entryPath = nativePath(entry.path);
    const canonical = isPathInside(entryPath, worktreesRoot);
    const exists = fs.existsSync(entryPath);
    const pointer = exists ? readGitPointer(entryPath) : { present: false, valid: false, reason: "registered path does not exist" };
    if (canonical) registeredCanonical.set(pathIdentity(entryPath), entry);

    let classification = "registered-active";
    if (!exists) classification = "registered-missing";
    else if (!canonical) classification = "noncanonical-managed-path";
    else if (entry.prunable || !pointer.valid) classification = "broken-git-pointer";

    items.push(item(classification, entryPath, {
      owner_kind: ownerKind,
      head: entry.head,
      branch: entry.branch || null,
      detached: entry.detached,
      locked: entry.locked,
      prunable: entry.prunable,
      git_pointer: pointer.rawTarget || null,
    }));

    if (classification !== "registered-active") {
      issues.push(issue(
        classification === "registered-missing" ? "REGISTERED_MISSING" : classification === "broken-git-pointer" ? "BROKEN_GIT_POINTER" : "NONCANONICAL_MANAGED_PATH",
        classification === "registered-missing"
          ? `registered worktree path is missing: ${toSlash(entryPath)}`
          : classification === "broken-git-pointer"
            ? `registered worktree has broken administration metadata: ${toSlash(entryPath)}`
            : `registered worktree is outside ${toSlash(worktreesRoot)}: ${toSlash(entryPath)}`,
        entryPath,
        classification,
      ));
    }
  }

  for (const physicalPath of physical) {
    if (!registeredCanonical.has(pathIdentity(physicalPath))) {
      items.push(item("physical-orphan", physicalPath, { owner_kind: ownerKind }));
      issues.push(issue(
        "PHYSICAL_ORPHAN",
        `physical managed-worktree directory is not registered: ${toSlash(physicalPath)}`,
        physicalPath,
        "physical-orphan",
      ));
    }
  }

  const adminRoot = path.join(resolved.commonDir, "worktrees");
  for (const adminPath of listImmediateDirectories(adminRoot)) {
    const gitdirFile = path.join(adminPath, "gitdir");
    if (!fs.existsSync(gitdirFile)) {
      items.push(item("broken-git-pointer", adminPath, { owner_kind: ownerKind, source: "administration" }));
      issues.push(issue("BROKEN_ADMINISTRATION_ENTRY", `worktree administration entry lacks gitdir: ${toSlash(adminPath)}`, adminPath, "broken-git-pointer"));
      continue;
    }
    const rawTarget = fs.readFileSync(gitdirFile, "utf8").trim();
    const target = nativePath(rawTarget);
    if (!fs.existsSync(target)) {
      items.push(item("broken-git-pointer", adminPath, {
        owner_kind: ownerKind,
        source: "administration",
        git_pointer: rawTarget,
      }));
      issues.push(issue("BROKEN_ADMINISTRATION_ENTRY", `worktree administration points to a missing .git file: ${toSlash(adminPath)}`, adminPath, "broken-git-pointer"));
    }
  }

  return {
    owners: [{ kind: ownerKind, ...resolved, worktreesRoot }],
    items,
    issues,
    registeredCount: registered.length,
    physicalCount: physical.length,
  };
}

function trackedRootNames(targetRoot) {
  const result = runGit(["ls-files", "-z"], targetRoot);
  if (!result.ok) return new Set();
  const names = new Set();
  for (const file of result.stdout.split("\0").filter(Boolean)) {
    names.add(toSlash(file).split("/")[0]);
  }
  return names;
}

function classifyRootEntries(targetRoot) {
  const tracked = trackedRootNames(targetRoot);
  const items = [];
  const issues = [];
  for (const entry of fs.readdirSync(nativePath(targetRoot), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(nativePath(targetRoot), entry.name);
    if (tracked.has(entry.name)) {
      items.push(item("tracked-source", entryPath));
      continue;
    }
    if (APPROVED_RUNTIME_ROOTS.has(entry.name)) {
      items.push(item("approved-runtime-directory", entryPath));
      continue;
    }
    if (entry.isFile() && EVIDENCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      items.push(item("evidence-artifact", entryPath));
      issues.push(issue("ROOT_EVIDENCE_ARTIFACT", `evidence artifact must not live at repository root: ${entry.name}`, entryPath, "evidence-artifact"));
      continue;
    }
    items.push(item("unexpected-root-entry", entryPath));
    issues.push(issue("UNEXPECTED_ROOT_ENTRY", `untracked repository-root entry is not approved runtime state: ${entry.name}`, entryPath, "unexpected-root-entry"));
  }
  return { items, issues };
}

function defaultCreatorRoots() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  if (!userProfile) return [];
  return [
    path.join(nativePath(userProfile), ".devspace", "worktrees"),
    path.join(nativePath(userProfile), ".cursor", "worktrees"),
  ];
}

function scanExternalCreatorRoots(primaryOwner, creatorRoots) {
  const items = [];
  const issues = [];
  for (const creatorRoot of creatorRoots) {
    for (const candidate of listImmediateDirectories(nativePath(creatorRoot))) {
      const resolved = resolveGitOwner(candidate);
      if (!resolved.ok || !pathsEqual(resolved.commonDir, primaryOwner.commonDir)) continue;
      items.push(item("external-creator-residue", candidate, { creator_root: toSlash(creatorRoot) }));
      issues.push(issue("EXTERNAL_CREATOR_RESIDUE", `managed worktree remains under external creator root: ${toSlash(candidate)}`, candidate, "external-creator-residue"));
    }
  }
  return { items, issues };
}

function scanRepositoryLayout({ targetRoot, creatorRoots = defaultCreatorRoots() } = {}) {
  const root = nativePath(targetRoot || process.cwd());
  const primaryOwner = resolveGitOwner(root);
  if (!primaryOwner.ok) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "SKIP",
      applicable: false,
      targetRoot: toSlash(root),
      reason: primaryOwner.reason,
      counts: {
        owners: 0,
        registered_managed: 0,
        physical_managed: 0,
        physical_only: 0,
        registered_only: 0,
        broken_pointers: 0,
        unexpected_root_entries: 0,
        external_creator_residue: 0,
      },
      items: [],
      issues: [],
    };
  }

  const scans = [scanOwner(primaryOwner.ownerRoot, "primary-owner")];
  const stableOwnersRoot = path.join(primaryOwner.ownerRoot, ".worktree-owners");
  for (const stableOwner of listImmediateDirectories(stableOwnersRoot)) {
    if (fs.existsSync(path.join(stableOwner, ".git"))) {
      scans.push(scanOwner(stableOwner, "stable-owner"));
    } else {
      const physical = listImmediateDirectories(path.join(stableOwner, ".worktrees"));
      scans.push({
        owners: [],
        registeredCount: 0,
        physicalCount: physical.length,
        items: physical.map((entry) => item("physical-orphan", entry, { owner_kind: "unregistered-stable-owner" })),
        issues: physical.map((entry) => issue("PHYSICAL_ORPHAN", `physical worktree belongs to an invalid stable owner: ${toSlash(entry)}`, entry, "physical-orphan")),
      });
    }
  }

  const rootEntries = classifyRootEntries(root);
  const external = scanExternalCreatorRoots(primaryOwner, creatorRoots);
  const owners = scans.flatMap((scan) => scan.owners);
  const items = [
    item("primary", root, { owner_root: toSlash(primaryOwner.ownerRoot) }),
    ...scans.flatMap((scan) => scan.items),
    ...rootEntries.items,
    ...external.items,
  ].sort((left, right) => left.path.localeCompare(right.path) || left.classification.localeCompare(right.classification));
  const issues = [
    ...scans.flatMap((scan) => scan.issues),
    ...rootEntries.issues,
    ...external.issues,
  ].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));

  const countClass = (classification) => items.filter((entry) => entry.classification === classification).length;
  const registeredCount = scans.reduce((total, scan) => total + scan.registeredCount, 0);
  const physicalCount = scans.reduce((total, scan) => total + scan.physicalCount, 0);
  const counts = {
    owners: owners.length,
    registered_managed: registeredCount,
    physical_managed: physicalCount,
    physical_only: countClass("physical-orphan"),
    registered_only: countClass("registered-missing") + countClass("noncanonical-managed-path"),
    broken_pointers: countClass("broken-git-pointer"),
    unexpected_root_entries: countClass("unexpected-root-entry") + countClass("evidence-artifact"),
    external_creator_residue: countClass("external-creator-residue"),
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    status: issues.length === 0 ? "PASS" : "REJECTED",
    applicable: true,
    targetRoot: toSlash(root),
    ownerRoot: toSlash(primaryOwner.ownerRoot),
    owners: owners.map((owner) => ({
      kind: owner.kind,
      ownerRoot: toSlash(owner.ownerRoot),
      commonDir: toSlash(owner.commonDir),
      worktreesRoot: toSlash(owner.worktreesRoot),
    })),
    counts,
    items,
    issues,
  };
}

module.exports = {
  APPROVED_RUNTIME_ROOTS,
  SCHEMA_VERSION,
  nativePath,
  pathIdentity,
  pathsEqual,
  scanRepositoryLayout,
};
