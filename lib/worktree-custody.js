"use strict";

/**
 * Worktree custody contract (WORKTREE-CONFINEMENT-AND-C-MIGRATION-0).
 *
 * Policy authority for repository-local managed worktrees:
 *   <canonical-owner-root>\.worktrees\<bounded-name>
 *
 * Also accepts stable promoted owners:
 *   <canonical-owner-root>\.worktree-owners\<name>\.worktrees\<unit>
 *
 * Check id: MH_WORKTREE_001
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CHECK_ID = "MH_WORKTREE_001";
const CONTRACT_VERSION = "1.0.0";
const EXCLUDE_LINE = "/.worktrees/";

const FORBIDDEN_DESTINATION_PATTERNS = Object.freeze([
  /^[A-Za-z]:\\/i, // any absolute Windows path is checked more carefully below
  /^\/mnt\//i,
  /\\mnt\\/i,
  /\.devspace[\\/]+worktrees/i,
  /\.cursor[\\/]+worktrees/i,
]);

function runGit(args, cwd, timeoutMs = 30000) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error || null,
  };
}

function normalizePath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+/g, "\\");
}

function pathsEqual(a, b) {
  const left = normalizePath(a).toLowerCase();
  const right = normalizePath(b).toLowerCase();
  return left === right;
}

function isPathInside(child, parent) {
  const c = normalizePath(child).toLowerCase();
  const p = normalizePath(parent).toLowerCase();
  if (c === p) return false;
  const prefix = p.endsWith("\\") ? p : `${p}\\`;
  return c.startsWith(prefix);
}

function hasGitMetadata(root) {
  return fs.existsSync(path.join(root, ".git"));
}

function resolveOwner(root) {
  const top = runGit(["rev-parse", "--show-toplevel"], root);
  const common = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (!top.ok || !common.ok) {
    return {
      ok: false,
      reason: top.stderr || common.stderr || "not a git repository",
    };
  }
  const commonDir = common.stdout;
  const topLevel = top.stdout;
  const ownerRoot =
    path.basename(commonDir).toLowerCase() === ".git"
      ? path.dirname(commonDir)
      : topLevel;
  return {
    ok: true,
    topLevel: normalizePath(topLevel),
    gitCommonDir: normalizePath(commonDir),
    ownerRoot: normalizePath(ownerRoot),
    approvedWorktreesRoot: normalizePath(path.join(ownerRoot, ".worktrees")),
  };
}

function listWorktreesPorcelain(ownerRoot) {
  const res = runGit(["worktree", "list", "--porcelain"], ownerRoot);
  if (!res.ok) {
    return { ok: false, reason: res.stderr || "git worktree list failed", entries: [] };
  }
  const blocks = res.stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
  const entries = [];
  for (const block of blocks) {
    const entry = {
      path: "",
      head: "",
      branch: "",
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) {
        entry.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      } else if (line === "detached") entry.detached = true;
      else if (line.startsWith("locked")) entry.locked = true;
      else if (line.startsWith("prunable")) entry.prunable = true;
    }
    if (entry.path) {
      entry.path = normalizePath(entry.path);
      entries.push(entry);
    }
  }
  return { ok: true, entries };
}

function isPrimaryWorktree(entry, ownerRoot) {
  return pathsEqual(entry.path, ownerRoot);
}

function isApprovedLinkedPath(entryPath, ownerRoot) {
  const worktreesRoot = path.join(ownerRoot, ".worktrees");
  if (isPathInside(entryPath, worktreesRoot)) return { approved: true, kind: "repo_local_worktrees" };

  const ownersRoot = path.join(ownerRoot, ".worktree-owners");
  if (isPathInside(entryPath, ownersRoot)) {
    // Require .../.worktree-owners/<name>/.worktrees/<unit>
    const rel = path.relative(ownersRoot, entryPath);
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (parts.length >= 3 && parts[1].toLowerCase() === ".worktrees") {
      return { approved: true, kind: "stable_worktree_owner" };
    }
  }
  return { approved: false, kind: "external_or_sibling" };
}

function classifyExternalLeak(entryPath, ownerRoot) {
  const p = entryPath.replace(/\//g, "\\");
  const lower = p.toLowerCase();
  const owner = ownerRoot ? normalizePath(ownerRoot) : "";

  // Global creator roots are always leaks.
  if (lower.includes("\\.devspace\\worktrees") || lower.includes("\\.cursor\\worktrees")) {
    return { leak: true, class: "creator_global_root", detail: "global creator worktree root" };
  }
  // mnt mirrors are always leaks unless somehow under owner (they should not be).
  if (lower.includes("e:\\mnt\\") || lower.includes("\\mnt\\e\\") || lower.includes("/mnt/e/")) {
    return { leak: true, class: "mnt_path", detail: "worktree under mnt path" };
  }
  // C: is a leak when the worktree is not a child of the owning repository root.
  // Repo-local .worktrees under a C:-hosted owner (tests / rare checkouts) are allowed
  // only via isApprovedLinkedPath; this flags C: paths outside the owner tree.
  if (lower.startsWith("c:\\") || lower.startsWith("\\mnt\\c\\") || lower.includes("/mnt/c/")) {
    if (!owner || !isPathInside(p, owner)) {
      return { leak: true, class: "c_drive", detail: "worktree on C: or /mnt/c outside owner root" };
    }
  }
  // Non-E: volumes outside the owner are leaks (E: is the intentional workspace volume).
  if (/^[a-z]:\\/i.test(p) && !lower.startsWith("e:\\") && owner && !isPathInside(p, owner)) {
    return { leak: true, class: "non_e_drive", detail: "worktree on non-E: volume outside owner root" };
  }
  return { leak: false, class: "none", detail: "" };
}

function hasLocalWorktreesExclude(ownerRoot) {
  const excludePath = path.join(ownerRoot, ".git", "info", "exclude");
  if (!fs.existsSync(excludePath)) return false;
  const text = fs.readFileSync(excludePath, "utf8");
  return text.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE || line.trim() === ".worktrees/");
}

function ensureLocalWorktreesExclude(ownerRoot) {
  const infoDir = path.join(ownerRoot, ".git", "info");
  fs.mkdirSync(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, "exclude");
  let text = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  if (!text.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE || line.trim() === ".worktrees/")) {
    if (text && !text.endsWith("\n")) text += "\n";
    text += `${EXCLUDE_LINE}\n`;
    fs.writeFileSync(excludePath, text, "utf8");
  }
  return excludePath;
}

function readLifecycle(worktreePath) {
  const marker = path.join(worktreePath, ".worktree-lifecycle", "active.json");
  if (!fs.existsSync(marker)) return { present: false, marker };
  try {
    const doc = JSON.parse(fs.readFileSync(marker, "utf8"));
    return { present: true, marker, doc };
  } catch (error) {
    return { present: true, marker, error: error.message };
  }
}

function writeLifecycle(worktreePath, fields = {}) {
  const dir = path.join(worktreePath, ".worktree-lifecycle");
  fs.mkdirSync(dir, { recursive: true });
  const doc = {
    state: fields.state || "active",
    owner: fields.owner || "meta-harness",
    stream: fields.stream || "",
    openedAt: fields.openedAt || new Date().toISOString(),
    closeWhen: fields.closeWhen || "stream complete",
    ttlAfterCloseHours: fields.ttlAfterCloseHours ?? 24,
    ...fields,
  };
  const marker = path.join(dir, "active.json");
  fs.writeFileSync(marker, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return marker;
}

/**
 * Validate a proposed managed worktree destination.
 * Callers must not supply arbitrary absolute destinations outside owner .worktrees.
 */
function assertManagedDestination(ownerRoot, destinationPath) {
  const owner = normalizePath(ownerRoot);
  const dest = normalizePath(destinationPath);
  const findings = [];
  const destLower = dest.toLowerCase();

  // C: is forbidden for managed worktrees unless the owning repo itself lives on C:
  // and the destination remains a strict child of that owner (repo-local .worktrees).
  const destOnC = /^c:\\/i.test(dest) || destLower.includes("\\mnt\\c") || destLower.startsWith("/mnt/c");
  const ownerOnC = /^c:\\/i.test(owner) || owner.toLowerCase().includes("\\mnt\\c");
  if (destOnC && (!ownerOnC || !isPathInside(dest, owner))) {
    findings.push({ code: "REJECT_C_DRIVE", message: `C: destinations are forbidden: ${dest}` });
  }
  if (
    (destLower.includes("\\mnt\\") || destLower.includes("/mnt/") || destLower.includes("e:\\mnt\\")) &&
    !isPathInside(dest, owner)
  ) {
    findings.push({ code: "REJECT_MNT", message: `mnt destinations are forbidden: ${dest}` });
  }
  if (/\.devspace[\\/]+worktrees/i.test(dest) || /\.cursor[\\/]+worktrees/i.test(dest)) {
    findings.push({ code: "REJECT_GLOBAL_CREATOR_ROOT", message: `global creator roots are forbidden: ${dest}` });
  }

  const approved = isApprovedLinkedPath(dest, owner);
  if (!approved.approved) {
    findings.push({
      code: "REJECT_NOT_UNDER_WORKTREES",
      message: `destination must be a strict child of ${path.join(owner, ".worktrees")} (or stable .worktree-owners/*/.worktrees): ${dest}`,
    });
  }

  // Reject sibling repo-task style: E:\Code\Quant-task
  const parent = path.dirname(dest);
  if (pathsEqual(parent, path.dirname(owner)) && !isPathInside(dest, owner)) {
    findings.push({
      code: "REJECT_SIBLING_PATH",
      message: `sibling of owner is not an approved worktree location: ${dest}`,
    });
  }

  // Symlink/junction escape: lstat chain
  try {
    let cursor = dest;
    // Walk existing ancestors
    while (cursor && cursor !== path.dirname(cursor)) {
      if (fs.existsSync(cursor)) {
        const st = fs.lstatSync(cursor);
        if (st.isSymbolicLink()) {
          findings.push({
            code: "REJECT_SYMLINK_ESCAPE",
            message: `symlink/junction component rejected: ${cursor}`,
          });
          break;
        }
      }
      cursor = path.dirname(cursor);
    }
  } catch (error) {
    findings.push({ code: "REJECT_PATH_STAT", message: error.message });
  }

  return {
    ok: findings.length === 0,
    findings,
    destination: dest,
    ownerRoot: owner,
  };
}

function auditKnownCreatorRoots() {
  const roots = [
    path.join(process.env.USERPROFILE || "C:\\Users\\Lenovo", ".devspace", "worktrees"),
    path.join(process.env.USERPROFILE || "C:\\Users\\Lenovo", ".cursor", "worktrees"),
  ];
  const leaks = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(root, ent.name);
      // empty dirs still count as unclassified residue if named
      leaks.push({ root, path: full, kind: ent.isDirectory() ? "dir" : "file" });
    }
  }
  return leaks;
}

/**
 * MH_WORKTREE_001 readiness evaluation for a repository root.
 */
function checkWorktreeCustody({
  targetRoot,
  mode = "local",
  requireLifecycle = true,
  auditCreatorRoots = true,
} = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  const findings = [];
  const details = {
    check_id: CHECK_ID,
    contract_version: CONTRACT_VERSION,
    target: root,
  };

  if (!hasGitMetadata(root)) {
    return {
      status: "skip",
      reason: "not a git repository",
      applicable: false,
      findings,
      details,
    };
  }

  const owner = resolveOwner(root);
  if (!owner.ok) {
    return {
      status: "fail",
      reason: `owner resolution failed: ${owner.reason}`,
      next_action: "Repair git metadata so rev-parse --show-toplevel and --git-common-dir succeed",
      findings,
      details,
    };
  }
  details.owner = owner;

  // Exclude required when .worktrees exists or any linked worktree present
  const excludeOk = hasLocalWorktreesExclude(owner.ownerRoot);
  details.local_exclude = excludeOk;
  if (!excludeOk) {
    findings.push({
      severity: "fail",
      code: "MISSING_LOCAL_EXCLUDE",
      message: `missing ${EXCLUDE_LINE} in .git/info/exclude`,
    });
  }

  const listed = listWorktreesPorcelain(owner.ownerRoot);
  if (!listed.ok) {
    return {
      status: "fail",
      reason: listed.reason,
      next_action: "Repair git worktree administration",
      findings,
      details,
    };
  }

  const linked = listed.entries.filter((e) => !isPrimaryWorktree(e, owner.ownerRoot));
  details.linked_count = linked.length;
  details.linked = [];

  for (const entry of linked) {
    const leak = classifyExternalLeak(entry.path, owner.ownerRoot);
    const approved = isApprovedLinkedPath(entry.path, owner.ownerRoot);
    const exists = fs.existsSync(entry.path);
    const lifecycle = exists ? readLifecycle(entry.path) : { present: false };

    const unit = {
      path: entry.path,
      head: entry.head,
      branch: entry.branch,
      detached: entry.detached,
      locked: entry.locked,
      prunable: entry.prunable,
      exists,
      approved: approved.approved,
      approved_kind: approved.kind,
      leak,
      lifecycle_present: lifecycle.present,
    };
    details.linked.push(unit);

    if (entry.locked) {
      findings.push({
        severity: "fail",
        code: "LOCKED_WORKTREE",
        message: `locked worktree requires explicit exception before ready: ${entry.path}`,
      });
    }
    if (entry.prunable) {
      findings.push({
        severity: "fail",
        code: "PRUNABLE_WORKTREE",
        message: `prunable worktree registration without exception: ${entry.path}`,
      });
    }
    if (leak.leak) {
      findings.push({
        severity: "fail",
        code: "EXTERNAL_LEAK_PATH",
        message: `${leak.detail}: ${entry.path}`,
      });
    }
    if (!approved.approved) {
      findings.push({
        severity: "fail",
        code: "NONCANONICAL_WORKTREE_PATH",
        message: `linked worktree not under approved .worktrees custody path: ${entry.path}`,
      });
    }
    // Noncanonical .git pointer (absolute C: admin paths etc.) — best effort
    if (exists) {
      const gitFile = path.join(entry.path, ".git");
      if (fs.existsSync(gitFile) && fs.statSync(gitFile).isFile()) {
        const ptr = fs.readFileSync(gitFile, "utf8").trim();
        if (/gitdir:\s*[Cc]:\\/.test(ptr) || /gitdir:\s*\/mnt\//.test(ptr)) {
          findings.push({
            severity: "fail",
            code: "NONCANONICAL_GITDIR_POINTER",
            message: `noncanonical .git pointer: ${ptr}`,
          });
        }
      }
      if (requireLifecycle && !lifecycle.present) {
        findings.push({
          severity: mode === "local" ? "warn" : "fail",
          code: "MISSING_LIFECYCLE",
          message: `active linked worktree lacks .worktree-lifecycle/active.json: ${entry.path}`,
        });
      }
    }
  }

  if (auditCreatorRoots) {
    const creatorLeaks = auditKnownCreatorRoots();
    details.creator_root_leaks = creatorLeaks;
    if (creatorLeaks.length > 0) {
      findings.push({
        severity: "fail",
        code: "CREATOR_ROOT_RESIDUE",
        message: `known C: creator worktree roots are not empty (${creatorLeaks.length} entries)`,
      });
    }
  } else {
    details.creator_root_leaks = [];
  }

  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");

  if (fails.length > 0) {
    return {
      status: "fail",
      reason: fails.map((f) => f.message).slice(0, 5).join("; "),
      next_action:
        "Migrate external/noncanonical worktrees under <repo>/.worktrees, install /.worktrees/ exclude, write lifecycle markers, clear C: creator roots",
      findings,
      details,
    };
  }
  if (warns.length > 0 && mode === "local") {
    return {
      status: "warn",
      reason: warns.map((f) => f.message).slice(0, 5).join("; "),
      next_action: "Add lifecycle markers for linked worktrees",
      findings,
      details,
    };
  }
  return {
    status: "pass",
    reason: "",
    findings,
    details,
  };
}

function deriveManagedWorktreePath(ownerRoot, boundedName) {
  if (!boundedName || /[\\/]/.test(boundedName) || boundedName.includes("..")) {
    throw new Error("boundedName must be a single path segment");
  }
  const dest = path.join(ownerRoot, ".worktrees", boundedName);
  const verdict = assertManagedDestination(ownerRoot, dest);
  if (!verdict.ok) {
    const err = new Error(verdict.findings.map((f) => f.message).join("; "));
    err.findings = verdict.findings;
    throw err;
  }
  return normalizePath(dest);
}

function getContractDocument() {
  return {
    schema_version: CONTRACT_VERSION,
    id: "worktree-custody",
    check_id: CHECK_ID,
    destination_template: "<canonical-owner-root>/.worktrees/<bounded-name>",
    approved_roots: [
      "<owner>/.worktrees/*",
      "<owner>/.worktree-owners/*/.worktrees/*",
    ],
    forbidden: [
      "C:\\...",
      "/mnt/...",
      "E:\\mnt\\...",
      "<owner-sibling>-task",
      "%USERPROFILE%\\.devspace\\worktrees",
      "%USERPROFILE%\\.cursor\\worktrees",
      "caller-supplied global worktree root",
    ],
    local_exclude: EXCLUDE_LINE,
    lifecycle_marker: ".worktree-lifecycle/active.json",
    owner_resolution: [
      "git rev-parse --show-toplevel",
      "git rev-parse --git-common-dir",
    ],
  };
}

module.exports = {
  CHECK_ID,
  CONTRACT_VERSION,
  EXCLUDE_LINE,
  FORBIDDEN_DESTINATION_PATTERNS,
  resolveOwner,
  listWorktreesPorcelain,
  isApprovedLinkedPath,
  classifyExternalLeak,
  hasLocalWorktreesExclude,
  ensureLocalWorktreesExclude,
  readLifecycle,
  writeLifecycle,
  assertManagedDestination,
  auditKnownCreatorRoots,
  checkWorktreeCustody,
  deriveManagedWorktreePath,
  getContractDocument,
};
