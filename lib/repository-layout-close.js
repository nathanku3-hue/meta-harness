"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError, FileSystemError } = require("./errors");
const {
  collectFileInventory,
  isPathInside,
  nativePath,
  pathIdentity,
  pathsEqual,
  runGitInspection,
  scanRepositoryLayout,
} = require("./root-leak-check");

const MANIFEST_SCHEMA = "repository-layout-close/v1";
const RECEIPT_SCHEMA = "repository-layout-close-receipt/v1";
const REPOSITORY_SKIP_DIRECTORIES = [".git", ".worktrees", ".worktree-owners"];

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestObject(value) {
  return sha256Bytes(Buffer.from(stableJson(value), "utf8"));
}

function resolveInputPath(value, cwd = process.cwd()) {
  const raw = String(value || "").trim();
  if (!raw) throw new ConfigError("path value is required");
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\\\")) {
    return nativePath(raw);
  }
  return nativePath(path.resolve(cwd, raw));
}

function requireDirectory(targetPath, label = "target") {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    throw new ConfigError(`${label} must be an existing directory: ${targetPath}`, { cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError(`${label} must be a non-symlink directory: ${targetPath}`);
  }
}

function assertExternalFile(filePath, ownerRoot, label) {
  if (pathsEqual(filePath, ownerRoot) || isPathInside(filePath, ownerRoot)) {
    throw new ConfigError(`${label} must be outside the target repository: ${filePath}`);
  }
}

function ensureParentDirectory(filePath) {
  const missing = [];
  let current = path.dirname(filePath);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const directory of missing.reverse()) fs.mkdirSync(directory);
}

function writeExternalFile(filePath, bytes) {
  try {
    ensureParentDirectory(filePath);
    fs.writeFileSync(filePath, bytes);
  } catch (error) {
    throw new FileSystemError(`unable to write ${filePath}: ${error.message}`, { cause: error });
  }
}

function parseStatus(text) {
  const entries = [];
  for (const raw of String(text || "").split("\0").filter(Boolean)) {
    const xy = raw.slice(0, 2);
    const filePath = raw.slice(3);
    if (xy === "??") entries.push({ kind: "untracked", path: filePath });
    else if (xy === "!!") entries.push({ kind: "ignored", path: filePath });
    else if (xy !== "  ") entries.push({ kind: "tracked_modified", path: filePath, xy });
  }
  return {
    entries,
    tracked_modified: entries.filter((entry) => entry.kind === "tracked_modified").map((entry) => entry.path),
    untracked: entries.filter((entry) => entry.kind === "untracked").map((entry) => entry.path),
    ignored: entries.filter((entry) => entry.kind === "ignored").map((entry) => entry.path),
  };
}

function inspectGitState(targetPath) {
  const head = runGitInspection(["rev-parse", "--verify", "HEAD^{commit}"], targetPath);
  const top = runGitInspection(["rev-parse", "--show-toplevel"], targetPath);
  const branch = runGitInspection(["symbolic-ref", "--quiet", "--short", "HEAD"], targetPath);
  const status = runGitInspection([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignored=matching",
    "-z",
  ], targetPath);
  const gitDirectory = runGitInspection(["rev-parse", "--git-dir"], targetPath);
  const statusState = status.ok ? parseStatus(status.stdout) : {
    entries: [],
    tracked_modified: [],
    untracked: [],
    ignored: [],
  };
  return {
    readable: head.ok && top.ok,
    head: head.ok ? head.stdout : null,
    branch: branch.ok ? branch.stdout : null,
    detached: head.ok && !branch.ok,
    top_level: top.ok ? top.stdout : null,
    git_directory: gitDirectory.ok ? gitDirectory.stdout : null,
    status_readable: status.ok,
    status: statusState,
    clean: status.ok && statusState.entries.length === 0,
    errors: [head, top, status, gitDirectory]
      .filter((result) => !result.ok)
      .map((result) => result.stderr || "Git inspection failed"),
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function readActivityFindings(targetPath) {
  const markerPath = path.join(nativePath(targetPath), ".worktree-lifecycle", "active.json");
  if (!fs.existsSync(markerPath)) {
    return { active: false, markers: [], live_pids: [] };
  }
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (error) {
    return {
      active: true,
      markers: [{ path: markerPath, readable: false, reason: error.message }],
      live_pids: [],
    };
  }
  const pid = Number(marker?.pid);
  return {
    active: true,
    markers: [{ path: markerPath, readable: true, pid: Number.isInteger(pid) ? pid : null }],
    live_pids: processIsAlive(pid) ? [pid] : [],
  };
}

function readLockFindings(targetPath, targetRecord, administrationEntries) {
  const findings = [];
  const targetIdentity = pathIdentity(targetPath);
  if (targetRecord?.locked) findings.push({ kind: "worktree-locked", path: targetPath });
  for (const entry of administrationEntries || []) {
    if (entry.target_identity !== targetIdentity) continue;
    const adminPath = nativePath(entry.path);
    if (entry.locked || fs.existsSync(path.join(adminPath, "locked"))) {
      findings.push({ kind: "administration-lock", path: adminPath });
    }
  }
  const gitPath = path.join(nativePath(targetPath), ".git");
  if (fs.existsSync(gitPath)) {
    try {
      const stat = fs.lstatSync(gitPath);
      const candidate = stat.isDirectory()
        ? gitPath
        : (() => {
          const pointer = fs.readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+)$/i);
          return pointer ? nativePath(pointer[1].trim()) : null;
        })();
      if (candidate && fs.existsSync(path.join(candidate, "locked"))) {
        findings.push({ kind: "git-worktree-lock", path: path.join(candidate, "locked") });
      }
      if (candidate && fs.existsSync(path.join(candidate, "index.lock"))) {
        findings.push({ kind: "git-index-lock", path: path.join(candidate, "index.lock") });
      }
    } catch (error) {
      findings.push({ kind: "lock-inspection-failed", path: gitPath, reason: error.message });
    }
  }
  return { locked: findings.length > 0, findings };
}

function inspectRemoteReachability(ownerRoot) {
  const remoteList = runGitInspection(["remote"], ownerRoot);
  if (!remoteList.ok) {
    return { checked: false, remotes: [], reason: remoteList.stderr || "remote inspection failed" };
  }
  const remotes = remoteList.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).map((name) => {
    const url = runGitInspection(["remote", "get-url", name], ownerRoot);
    const probe = runGitInspection(["ls-remote", "--exit-code", name, "HEAD"], ownerRoot);
    return {
      name,
      url: url.ok ? url.stdout : null,
      reachable: probe.ok,
      detail: probe.ok ? "remote HEAD reachable" : probe.stderr || "remote HEAD unreachable",
    };
  });
  return { checked: true, remotes };
}

function layoutItemFor(layout, targetPath) {
  return (layout.items || []).find((entry) => pathsEqual(entry.path, targetPath)) || null;
}

function layoutSnapshot(layout) {
  const canonical = (entry) => {
    const copy = { ...entry };
    if (copy.path) copy.path_identity = pathIdentity(copy.path);
    return copy;
  };
  return {
    schema_version: layout.schemaVersion,
    status: layout.status,
    applicable: layout.applicable,
    owner_root: layout.ownerRoot ? pathIdentity(layout.ownerRoot) : null,
    counts: layout.counts,
    registered_worktrees: (layout.registeredWorktrees || []).map(canonical),
    physical_worktrees: (layout.physicalWorktrees || []).map(canonical),
    administration_entries: (layout.administrationEntries || []).map(canonical),
    root_entries: (layout.rootEntries || []).map(canonical),
    items: (layout.items || []).map(canonical),
    issues: (layout.issues || []).map(canonical),
  };
}

function inventoryByteCount(inventory) {
  return (inventory?.files || []).reduce((total, file) => total + Number(file.size || 0), 0);
}

function buildWorktreeInventories(ownerRoot, layout, requestedTarget) {
  const inventories = [];
  const seen = new Set();
  const add = (scope, root, skipDirectories = []) => {
    const resolved = nativePath(root);
    const identity = pathIdentity(resolved);
    if (seen.has(identity) || !fs.existsSync(resolved)) return;
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    seen.add(identity);
    inventories.push({
      scope,
      root: pathIdentity(resolved),
      inventory: collectFileInventory(resolved, { skipDirectories }),
    });
  };

  add("repository", ownerRoot, REPOSITORY_SKIP_DIRECTORIES);
  for (const entry of layout.physicalWorktrees || []) add("worktree", entry.path);
  if (requestedTarget && !seen.has(pathIdentity(requestedTarget))) add("requested-target", requestedTarget);
  return inventories.sort((left, right) => left.root.localeCompare(right.root));
}

function inventoryForTarget(inventories, targetPath) {
  const identity = pathIdentity(targetPath);
  return inventories.find((entry) => entry.root === identity)?.inventory || { root: toDisplayPath(targetPath), root_identity: identity, files: [] };
}

function toDisplayPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function managedTargetRecords(layout, inventories) {
  const records = [];
  const add = (rawPath, classification, fields = {}) => {
    const targetPath = nativePath(rawPath);
    const identity = pathIdentity(targetPath);
    if (records.some((entry) => entry.path_identity === identity)) return;
    const inventory = inventoryForTarget(inventories, targetPath);
    const gitState = ["primary", "registered-active", "broken-git-pointer", "registered-missing"].includes(classification)
      && fs.existsSync(targetPath)
      ? inspectGitState(targetPath)
      : null;
    const locks = readLockFindings(targetPath, fields, layout.administrationEntries);
    const activity = fs.existsSync(targetPath) ? readActivityFindings(targetPath) : { active: false, markers: [], live_pids: [] };
    const archiveRequired = inventory.files.length > 0 && (
      classification === "physical-orphan"
      || Boolean(gitState?.status?.untracked?.length)
      || Boolean(gitState?.status?.ignored?.length)
    );
    records.push({
      path: toDisplayPath(targetPath),
      path_identity: identity,
      classification,
      head: gitState?.head || fields.head || null,
      branch: gitState?.branch || fields.branch || null,
      detached: gitState?.detached ?? fields.detached ?? false,
      registered: classification !== "physical-orphan" && classification !== "primary",
      physical: (layout.physicalWorktrees || []).some((entry) => entry.path_identity === identity),
      byte_file_count: inventory.files.length,
      byte_count: inventoryByteCount(inventory),
      inventory_digest: digestObject(inventory),
      git_state: gitState,
      lock_findings: locks,
      active_process_findings: activity,
      archive_requirement: {
        required: archiveRequired,
        verified: !archiveRequired,
        digest: null,
        reason: archiveRequired ? "untracked, ignored, or unregistered bytes require rescue custody" : null,
      },
    });
  };

  add(layout.ownerRoot, "primary", {});
  for (const entry of layout.registeredWorktrees || []) add(entry.path, entry.classification, entry);
  for (const entry of layout.physicalWorktrees || []) {
    if (!entry.registered) add(entry.path, "physical-orphan", entry);
  }
  return records.sort((left, right) => left.path_identity.localeCompare(right.path_identity));
}

function captureRepositoryState(ownerRoot, requestedTarget) {
  const layout = scanRepositoryLayout({ targetRoot: ownerRoot });
  if (!layout.applicable) throw new ConfigError(`target repository is not readable: ${layout.reason}`);
  const snapshot = layoutSnapshot(layout);
  const inventories = buildWorktreeInventories(ownerRoot, layout, requestedTarget);
  const targets = managedTargetRecords(layout, inventories);
  const gitStates = targets
    .filter((entry) => entry.git_state)
    .map((entry) => ({ path_identity: entry.path_identity, state: entry.git_state }));
  const inventoryDigest = digestObject({
    layout: snapshot,
    inventories,
    git_states: gitStates,
    targets: targets.map((entry) => ({
      path_identity: entry.path_identity,
      lock_findings: entry.lock_findings,
      active_process_findings: entry.active_process_findings,
    })),
  });
  return {
    ownerRoot: nativePath(ownerRoot),
    layout,
    layout_snapshot: snapshot,
    inventories,
    targets,
    git_states: gitStates,
    inventory_digest: inventoryDigest,
  };
}

function candidateToolCommit() {
  const sourceRoot = path.resolve(__dirname, "..");
  const result = runGitInspection(["rev-parse", "HEAD"], sourceRoot);
  return result.ok ? result.stdout : null;
}

function repositoryIdentity(ownerRoot, layout) {
  const owner = (layout.owners || [])[0] || {};
  const top = runGitInspection(["rev-parse", "--show-toplevel"], ownerRoot);
  const common = runGitInspection(["rev-parse", "--path-format=absolute", "--git-common-dir"], ownerRoot);
  return {
    target_root: toDisplayPath(ownerRoot),
    target_path_identity: pathIdentity(ownerRoot),
    owner_root: toDisplayPath(ownerRoot),
    owner_root_identity: pathIdentity(ownerRoot),
    top_level: top.ok ? toDisplayPath(nativePath(top.stdout)) : null,
    top_level_identity: top.ok ? pathIdentity(top.stdout) : null,
    common_dir: owner.commonDir || (common.ok ? toDisplayPath(nativePath(common.stdout)) : null),
    common_dir_identity: owner.commonDir ? pathIdentity(owner.commonDir) : (common.ok ? pathIdentity(common.stdout) : null),
  };
}

function targetClassification(record) {
  if (!record) return "outside-approved-owner-root";
  return record.classification === "primary" ? "primary-checkout" : record.classification;
}

function isWithinOrOwner(targetPath, ownerRoot) {
  return pathsEqual(targetPath, ownerRoot) || isPathInside(targetPath, ownerRoot);
}

function buildManifest({ targetRoot, creatorRoots } = {}) {
  const requestedTarget = nativePath(targetRoot);
  requireDirectory(requestedTarget, "--target");
  const initialLayout = scanRepositoryLayout({ targetRoot: requestedTarget, creatorRoots });
  if (!initialLayout.applicable) throw new ConfigError(`target repository is not readable: ${initialLayout.reason}`);
  const ownerRoot = nativePath(initialLayout.ownerRoot);
  const state = captureRepositoryState(ownerRoot, requestedTarget);
  const repository = repositoryIdentity(ownerRoot, state.layout);
  const target = state.targets.find((entry) => pathsEqual(entry.path, requestedTarget));
  if (!target) throw new ConfigError(`--target is not a managed path in the repository layout: ${requestedTarget}`);
  const targetInventory = inventoryForTarget(state.inventories, requestedTarget);
  const targetGitState = target.git_state;
  const unsigned = {
    schema: MANIFEST_SCHEMA,
    schema_version: MANIFEST_SCHEMA,
    generated_at: new Date().toISOString(),
    candidate_tool_commit: candidateToolCommit(),
    target_repository_identity: repository,
    owner_common_git_directory_identity: {
      owner_root: repository.owner_root,
      owner_root_identity: repository.owner_root_identity,
      common_dir: repository.common_dir,
      common_dir_identity: repository.common_dir_identity,
    },
    registered_worktrees: state.layout.registeredWorktrees || [],
    physical_worktrees: state.layout.physicalWorktrees || [],
    administration_entries: state.layout.administrationEntries || [],
    root_entry_classifications: state.layout.rootEntries || [],
    target: {
      path: toDisplayPath(requestedTarget),
      path_identity: pathIdentity(requestedTarget),
      classification: targetClassification(target),
      raw_classification: target.classification,
      owner_root_identity: repository.owner_root_identity,
    },
    target_path_identity: pathIdentity(requestedTarget),
    target_classification: targetClassification(target),
    target_byte_file_inventory: targetInventory,
    worktree_inventories: state.inventories,
    managed_targets: state.targets,
    tracked_untracked_ignored_state: state.git_states,
    head: targetGitState?.head || null,
    branch: targetGitState?.branch || null,
    lock_and_active_process_findings: state.targets.map((entry) => ({
      path_identity: entry.path_identity,
      lock_findings: entry.lock_findings,
      active_process_findings: entry.active_process_findings,
    })),
    remote_reachability: inspectRemoteReachability(ownerRoot),
    archive_requirement: {
      policy: "untracked-or-ignored-and-nonregistered-bytes-require-rescue-custody",
      required: state.targets.some((entry) => entry.archive_requirement.required),
      verified: state.targets.every((entry) => entry.archive_requirement.verified),
      digest: digestObject(state.targets.map((entry) => ({
        path_identity: entry.path_identity,
        required: entry.archive_requirement.required,
        verified: entry.archive_requirement.verified,
        digest: entry.archive_requirement.digest,
      }))),
      targets: state.targets.map((entry) => ({
        path_identity: entry.path_identity,
        required: entry.archive_requirement.required,
        verified: entry.archive_requirement.verified,
        digest: entry.archive_requirement.digest,
        reason: entry.archive_requirement.reason,
      })),
    },
    layout_snapshot: state.layout_snapshot,
    inventory_digest: state.inventory_digest,
    manifest_payload_sha256: null,
  };
  unsigned.manifest_payload_sha256 = digestObject(unsigned);
  return unsigned;
}

function serializeManifest(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeLayoutManifest({ targetRoot, outputPath, copyPath, creatorRoots } = {}) {
  const requestedTarget = nativePath(targetRoot);
  const manifest = buildManifest({ targetRoot: requestedTarget, creatorRoots });
  const ownerRoot = nativePath(manifest.target_repository_identity.owner_root);
  const output = nativePath(outputPath);
  assertExternalFile(output, ownerRoot, "manifest output");
  const bytes = serializeManifest(manifest);
  const manifestSha256 = sha256Bytes(bytes);
  writeExternalFile(output, bytes);
  let copy = null;
  if (copyPath) {
    const copyFile = nativePath(copyPath);
    assertExternalFile(copyFile, ownerRoot, "manifest copy");
    writeExternalFile(copyFile, bytes);
    const copySha256 = sha256Bytes(fs.readFileSync(copyFile));
    if (copySha256 !== manifestSha256) {
      throw new FileSystemError("manifest copies are not byte-identical");
    }
    copy = { path: toDisplayPath(copyFile), sha256: copySha256, byte_identical: true };
  }
  return {
    ok: true,
    schema: MANIFEST_SCHEMA,
    manifest_path: toDisplayPath(output),
    manifest_sha256: manifestSha256,
    manifest_bytes: bytes.length,
    second_copy: copy,
    manifest,
  };
}

function loadManifest(manifestPath) {
  const bytes = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ConfigError(`manifest is not valid JSON: ${manifestPath}`, { cause: error });
  }
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.schema_version !== MANIFEST_SCHEMA) {
    throw new ConfigError(`unsupported layout manifest schema: ${manifest.schema || "missing"}`);
  }
  const unsigned = { ...manifest, manifest_payload_sha256: null };
  if (manifest.manifest_payload_sha256 !== digestObject(unsigned)) {
    throw new ConfigError("manifest payload digest mismatch");
  }
  return { manifest, bytes, sha256: sha256Bytes(bytes) };
}

function findTargetRecord(state, targetPath) {
  return state.targets.find((entry) => pathsEqual(entry.path, targetPath)) || null;
}

function manifestTargetRecord(manifest, targetPath) {
  return (manifest.managed_targets || []).find((entry) => pathsEqual(entry.path, targetPath)) || null;
}

function stateSummary(state) {
  if (!state) return null;
  return {
    inventory_digest: state.inventory_digest,
    layout_digest: digestObject(state.layout_snapshot),
    counts: state.layout.counts,
    registered_worktree_paths: (state.layout.registeredWorktrees || []).map((entry) => entry.path_identity),
    physical_worktree_paths: (state.layout.physicalWorktrees || []).map((entry) => entry.path_identity),
    broken_pointer_paths: (state.layout.items || [])
      .filter((entry) => entry.classification === "broken-git-pointer")
      .map((entry) => pathIdentity(entry.path)),
  };
}

function failureResult({ verdict, reason, receiptPath, manifestPath, targetPath, before, after, details = {} }) {
  return {
    ok: false,
    verdict,
    receipt_state: "close_failed",
    reason,
    target: toDisplayPath(targetPath),
    target_path_identity: pathIdentity(targetPath),
    manifest: toDisplayPath(manifestPath),
    receipt: toDisplayPath(receiptPath),
    before: stateSummary(before),
    after: stateSummary(after),
    details,
  };
}

function writeReceipt(receiptPath, receipt) {
  writeExternalFile(receiptPath, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
}

function compareOtherPaths(before, after, targetIdentity) {
  const filterPath = (entry) => entry.path_identity !== targetIdentity;
  const beforeLayout = before.layout_snapshot;
  const afterLayout = after.layout_snapshot;
  if (JSON.stringify(beforeLayout.registered_worktrees) !== JSON.stringify(afterLayout.registered_worktrees)) return false;
  if (JSON.stringify(beforeLayout.administration_entries) !== JSON.stringify(afterLayout.administration_entries)) return false;
  if (JSON.stringify(beforeLayout.root_entries) !== JSON.stringify(afterLayout.root_entries)) return false;
  if (JSON.stringify(beforeLayout.physical_worktrees.filter(filterPath)) !== JSON.stringify(afterLayout.physical_worktrees.filter(filterPath))) return false;
  if (JSON.stringify(beforeLayout.items.filter(filterPath)) !== JSON.stringify(afterLayout.items.filter(filterPath))) return false;
  if (JSON.stringify(beforeLayout.issues.filter(filterPath)) !== JSON.stringify(afterLayout.issues.filter(filterPath))) return false;
  const beforeInventories = before.inventories.filter((entry) => entry.root !== targetIdentity);
  const afterInventories = after.inventories.filter((entry) => entry.root !== targetIdentity);
  if (JSON.stringify(beforeInventories) !== JSON.stringify(afterInventories)) return false;
  if (JSON.stringify(before.git_states) !== JSON.stringify(after.git_states)) return false;
  return true;
}

function expectedCloseDelta(before, after, targetPath) {
  const targetIdentity = pathIdentity(targetPath);
  const beforeTarget = findTargetRecord(before, targetPath);
  const afterTarget = findTargetRecord(after, targetPath);
  const expectedCounts = {
    physical_managed: before.layout.counts.physical_managed - 1,
    physical_only: before.layout.counts.physical_only - 1,
    registered_managed: before.layout.counts.registered_managed,
    broken_pointers: before.layout.counts.broken_pointers,
  };
  const actualCounts = {
    physical_managed: after.layout.counts.physical_managed,
    physical_only: after.layout.counts.physical_only,
    registered_managed: after.layout.counts.registered_managed,
    broken_pointers: after.layout.counts.broken_pointers,
  };
  const targetGone = !afterTarget && !fs.existsSync(nativePath(targetPath));
  const onlyTargetChanged = compareOtherPaths(before, after, targetIdentity);
  const ok = Boolean(
    beforeTarget
      && beforeTarget.classification === "physical-orphan"
      && targetGone
      && JSON.stringify(expectedCounts) === JSON.stringify(actualCounts)
      && onlyTargetChanged,
  );
  return {
    ok,
    selected_target: targetIdentity,
    target_classification_before: beforeTarget?.classification || null,
    target_present_after: Boolean(afterTarget) || fs.existsSync(nativePath(targetPath)),
    expected_counts: expectedCounts,
    actual_counts: actualCounts,
    only_selected_target_changed: onlyTargetChanged,
  };
}

function refusalFor({ manifest, current, targetPath }) {
  const ownerRoot = nativePath(manifest.target_repository_identity.owner_root);
  if (!isWithinOrOwner(targetPath, ownerRoot)) {
    return { verdict: "REFUSED_OUTSIDE_OWNER", reason: "target is outside the manifest owner root" };
  }
  if (current.inventory_digest !== manifest.inventory_digest) {
    return { verdict: "REFUSED_STALE_MANIFEST", reason: "current inventory does not match the hash-bound manifest" };
  }
  const manifestTarget = manifestTargetRecord(manifest, targetPath);
  const currentTarget = findTargetRecord(current, targetPath);
  if (!manifestTarget || !currentTarget) {
    return { verdict: "REFUSED_STALE_MANIFEST", reason: "target is absent from the complete manifest inventory" };
  }
  if (manifestTarget.classification !== currentTarget.classification) {
    return { verdict: "REFUSED_CLASSIFICATION_CHANGED", reason: "target classification changed since manifest creation" };
  }
  if (currentTarget.classification === "primary") {
    return { verdict: "REFUSED_PRIMARY", reason: "primary checkout is never a close target" };
  }
  if (currentTarget.lock_findings.locked) {
    return { verdict: "REFUSED_LOCKED", reason: "target has a Git or administration lock", details: currentTarget.lock_findings };
  }
  if (currentTarget.active_process_findings.active) {
    return { verdict: "REFUSED_ACTIVE", reason: "target has an active-process marker", details: currentTarget.active_process_findings };
  }
  if (currentTarget.git_state && !currentTarget.git_state.readable) {
    return { verdict: "REFUSED_UNREACHABLE_HEAD", reason: "target HEAD is not readable" };
  }
  if (currentTarget.git_state && !currentTarget.git_state.status_readable) {
    return { verdict: "REFUSED_DIRTY", reason: "target status is not readable" };
  }
  if (currentTarget.git_state && (
    currentTarget.git_state.status.tracked_modified.length > 0
      || currentTarget.git_state.status.untracked.length > 0
      || currentTarget.git_state.status.ignored.length > 0
  )) {
    return {
      verdict: "REFUSED_DIRTY",
      reason: "target has tracked, untracked, or ignored changes",
      details: currentTarget.git_state.status,
    };
  }
  if (currentTarget.archive_requirement.required && !currentTarget.archive_requirement.verified) {
    return { verdict: "REFUSED_DIRTY", reason: "target bytes require a verified archive before close" };
  }
  if (currentTarget.classification !== "physical-orphan") {
    return { verdict: "REFUSED_REGISTERED", reason: "registered or administratively known worktrees are not closed by this slice" };
  }
  if (currentTarget.byte_file_count !== 0) {
    return { verdict: "REFUSED_DIRTY", reason: "physical orphan contains bytes" };
  }
  if (fs.readdirSync(nativePath(targetPath)).length !== 0) {
    return { verdict: "REFUSED_DIRTY", reason: "physical orphan is not empty" };
  }
  if (fs.existsSync(path.join(nativePath(targetPath), ".git"))) {
    return { verdict: "REFUSED_GIT_METADATA", reason: "physical orphan contains Git metadata" };
  }
  return null;
}

function closeLayoutTarget({ target, manifestPath, receiptPath, manifestCopyPath, cwd = process.cwd() } = {}) {
  const targetPath = resolveInputPath(target, cwd);
  const manifestFile = resolveInputPath(manifestPath, cwd);
  const receiptFile = resolveInputPath(receiptPath, cwd);
  let loaded = null;
  let before = null;
  let after = null;
  let removed = false;
  try {
    loaded = loadManifest(manifestFile);
    const manifest = loaded.manifest;
    const ownerRoot = nativePath(manifest.target_repository_identity.owner_root);
    assertExternalFile(receiptFile, ownerRoot, "receipt output");
    if (manifestCopyPath) {
      const copyFile = resolveInputPath(manifestCopyPath, cwd);
      assertExternalFile(copyFile, ownerRoot, "manifest copy");
      const copyBytes = fs.readFileSync(copyFile);
      if (!copyBytes.equals(loaded.bytes)) throw new ConfigError("manifest copy is not byte-identical to the selected manifest");
    }
    requireDirectory(targetPath, "--target");
    if (!isWithinOrOwner(targetPath, ownerRoot)) {
      const result = failureResult({
        verdict: "REFUSED_OUTSIDE_OWNER",
        reason: "target is outside the manifest owner root",
        receiptPath: receiptFile,
        manifestPath: manifestFile,
        targetPath,
      });
      writeReceipt(receiptFile, {
        schema: RECEIPT_SCHEMA,
        state: "close_failed",
        generated_at: new Date().toISOString(),
        operation: "layout-close",
        verdict: result.verdict,
        reason: result.reason,
        target: result.target,
        target_path_identity: result.target_path_identity,
        manifest: { path: result.manifest, sha256: loaded.sha256 },
        before: null,
        after: null,
      });
      return result;
    }
    before = captureRepositoryState(ownerRoot, targetPath);
    const refusal = refusalFor({ manifest, current: before, targetPath });
    if (refusal) {
      const result = failureResult({
        ...refusal,
        receiptPath: receiptFile,
        manifestPath: manifestFile,
        targetPath,
        before,
      });
      writeReceipt(receiptFile, {
        schema: RECEIPT_SCHEMA,
        state: "close_failed",
        generated_at: new Date().toISOString(),
        operation: "layout-close",
        verdict: result.verdict,
        reason: result.reason,
        target: result.target,
        target_path_identity: result.target_path_identity,
        manifest: { path: result.manifest, sha256: loaded.sha256 },
        before: result.before,
        after: null,
        details: result.details,
      });
      return result;
    }

    writeReceipt(receiptFile, {
      schema: RECEIPT_SCHEMA,
      state: "closing",
      generated_at: new Date().toISOString(),
      operation: "layout-close",
      verdict: "CLOSING",
      target: toDisplayPath(targetPath),
      target_path_identity: pathIdentity(targetPath),
      manifest: { path: toDisplayPath(manifestFile), sha256: loaded.sha256 },
      before: stateSummary(before),
    });

    const rechecked = captureRepositoryState(ownerRoot, targetPath);
    const recheckRefusal = refusalFor({ manifest, current: rechecked, targetPath });
    if (recheckRefusal) throw new ConfigError(`close recheck failed: ${recheckRefusal.reason}`);
    if (rechecked.inventory_digest !== before.inventory_digest) throw new ConfigError("close recheck changed before mutation");
    if (fs.readdirSync(nativePath(targetPath)).length !== 0) throw new ConfigError("close recheck found target content");

    fs.rmdirSync(nativePath(targetPath));
    removed = true;
    after = captureRepositoryState(ownerRoot, targetPath);
    const delta = expectedCloseDelta(before, after, targetPath);
    if (!delta.ok) throw new ConfigError("post-close proof did not show exactly one selected-target delta");
    const result = {
      ok: true,
      verdict: "CLOSED",
      receipt_state: "closed",
      target: toDisplayPath(targetPath),
      target_path_identity: pathIdentity(targetPath),
      manifest: toDisplayPath(manifestFile),
      receipt: toDisplayPath(receiptFile),
      before: stateSummary(before),
      after: stateSummary(after),
      delta,
    };
    writeReceipt(receiptFile, {
      schema: RECEIPT_SCHEMA,
      state: "closed",
      generated_at: new Date().toISOString(),
      operation: "layout-close",
      verdict: "CLOSED",
      target: result.target,
      target_path_identity: result.target_path_identity,
      manifest: { path: result.manifest, sha256: loaded.sha256 },
      before: result.before,
      after: result.after,
      delta,
    });
    return result;
  } catch (error) {
    if (removed && !fs.existsSync(nativePath(targetPath))) {
      try {
        fs.mkdirSync(nativePath(targetPath));
      } catch {
        // Preserve the original failure; the receipt records that restoration was attempted.
      }
    }
    const result = failureResult({
      verdict: error.code === "MH_CONFIG" ? "REFUSED_VALIDATION" : "CLOSE_FAILED",
      reason: error.message,
      receiptPath: receiptFile,
      manifestPath: manifestFile,
      targetPath,
      before,
      after,
      details: { error_code: error.code || "UNKNOWN", removed_before_failure: removed },
    });
    try {
      writeReceipt(receiptFile, {
        schema: RECEIPT_SCHEMA,
        state: "close_failed",
        generated_at: new Date().toISOString(),
        operation: "layout-close",
        verdict: result.verdict,
        reason: result.reason,
        target: result.target,
        target_path_identity: result.target_path_identity,
        manifest: { path: result.manifest, sha256: loaded?.sha256 || null },
        before: result.before,
        after: result.after,
        details: result.details,
      });
    } catch (receiptError) {
      throw new FileSystemError(`unable to write close_failed receipt: ${receiptError.message}`, { cause: receiptError });
    }
    return result;
  }
}

module.exports = {
  MANIFEST_SCHEMA,
  RECEIPT_SCHEMA,
  buildManifest,
  closeLayoutTarget,
  digestObject,
  loadManifest,
  resolveInputPath,
  writeLayoutManifest,
};
