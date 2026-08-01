"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  closeLayoutTarget,
  loadManifest,
  writeLayoutManifest,
} = require("../lib/repository-layout-close");
const { collectFileInventory, scanRepositoryLayout } = require("../lib/root-leak-check");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join("/tmp", prefix));
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function createRepo({ ignored = false } = {}) {
  const root = tempDir("layout-close-fixture-");
  git(root, ["init"]);
  git(root, ["config", "user.email", "layout@example.invalid"]);
  git(root, ["config", "user.name", "Layout Fixture"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n", "utf8");
  if (ignored) fs.writeFileSync(path.join(root, ".gitignore"), "ignored.txt\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

function addRegisteredWorktree(root, name) {
  const target = path.join(root, ".worktrees", name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  git(root, ["worktree", "add", "-b", `fixture-${name}`, target, "HEAD"]);
  return target;
}

function evidencePaths() {
  const directory = tempDir("layout-close-evidence-");
  return {
    directory,
    manifest: path.join(directory, "manifest.json"),
    copy: path.join(directory, "manifest-copy.json"),
    receipt: path.join(directory, "close-receipt.json"),
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("manifest binds complete custody evidence and closes exactly one empty orphan", () => {
  const root = createRepo();
  const target = path.join(root, ".worktrees", "orphan");
  fs.mkdirSync(target, { recursive: true });
  const evidence = evidencePaths();

  const created = writeLayoutManifest({
    targetRoot: root,
    outputPath: evidence.manifest,
    copyPath: evidence.copy,
    creatorRoots: [],
  });
  const manifest = JSON.parse(fs.readFileSync(evidence.manifest, "utf8"));

  for (const field of [
    "schema",
    "generated_at",
    "candidate_tool_commit",
    "target_repository_identity",
    "owner_common_git_directory_identity",
    "registered_worktrees",
    "physical_worktrees",
    "administration_entries",
    "root_entry_classifications",
    "target_path_identity",
    "target_classification",
    "target_byte_file_inventory",
    "tracked_untracked_ignored_state",
    "head",
    "branch",
    "lock_and_active_process_findings",
    "remote_reachability",
    "archive_requirement",
    "inventory_digest",
  ]) assert.ok(Object.hasOwn(manifest, field), field);
  assert.equal(manifest.target_classification, "primary-checkout");
  assert.equal(manifest.physical_worktrees.length, 1);
  assert.equal(manifest.archive_requirement.digest.length, 64);
  assert.equal(Buffer.compare(fs.readFileSync(evidence.manifest), fs.readFileSync(evidence.copy)), 0);
  assert.equal(sha256(evidence.manifest), created.manifest_sha256);
  assert.equal(loadManifest(evidence.manifest).sha256, created.manifest_sha256);

  const registeredBefore = git(root, ["worktree", "list", "--porcelain"]);
  const closed = closeLayoutTarget({
    target,
    manifestPath: evidence.manifest,
    manifestCopyPath: evidence.copy,
    receiptPath: evidence.receipt,
  });

  assert.equal(closed.verdict, "CLOSED");
  assert.equal(closed.ok, true);
  assert.equal(fs.existsSync(target), false);
  assert.equal(git(root, ["worktree", "list", "--porcelain"]), registeredBefore);
  assert.deepEqual(closed.delta.expected_counts, {
    physical_managed: 0,
    physical_only: 0,
    registered_managed: 0,
    broken_pointers: 0,
  });
  assert.equal(closed.delta.only_selected_target_changed, true);
  const receipt = JSON.parse(fs.readFileSync(evidence.receipt, "utf8"));
  assert.equal(receipt.state, "closed");
  assert.equal(receipt.before.counts.physical_managed, 1);
  assert.equal(receipt.after.counts.physical_managed, 0);
});

test("dirty registered worktree is refused and remains byte-for-byte intact", () => {
  const root = createRepo();
  const target = addRegisteredWorktree(root, "dirty");
  fs.writeFileSync(path.join(target, "README.md"), "changed\n", "utf8");
  fs.writeFileSync(path.join(target, "unique.txt"), "unique\n", "utf8");
  const before = collectFileInventory(target);
  const evidence = evidencePaths();
  writeLayoutManifest({ targetRoot: root, outputPath: evidence.manifest, creatorRoots: [] });

  const result = closeLayoutTarget({ target, manifestPath: evidence.manifest, receiptPath: evidence.receipt });

  assert.equal(result.verdict, "REFUSED_DIRTY");
  assert.equal(result.receipt_state, "close_failed");
  assert.equal(fs.existsSync(target), true);
  assert.deepEqual(collectFileInventory(target), before);
  assert.equal(scanRepositoryLayout({ targetRoot: root, creatorRoots: [] }).counts.registered_managed, 1);
  assert.equal(JSON.parse(fs.readFileSync(evidence.receipt, "utf8")).state, "close_failed");
});

test("ignored content without rescue custody is refused", () => {
  const root = createRepo({ ignored: true });
  const target = addRegisteredWorktree(root, "ignored");
  fs.writeFileSync(path.join(target, "ignored.txt"), "do not lose me\n", "utf8");
  const evidence = evidencePaths();
  writeLayoutManifest({ targetRoot: root, outputPath: evidence.manifest, creatorRoots: [] });

  const result = closeLayoutTarget({ target, manifestPath: evidence.manifest, receiptPath: evidence.receipt });

  assert.equal(result.verdict, "REFUSED_DIRTY");
  assert.equal(fs.existsSync(path.join(target, "ignored.txt")), true);
  assert.equal(JSON.parse(fs.readFileSync(evidence.receipt, "utf8")).state, "close_failed");
});

test("locked worktree is refused without changing administration", () => {
  const root = createRepo();
  const target = addRegisteredWorktree(root, "locked");
  git(root, ["worktree", "lock", "--reason", "fixture lock", target]);
  const before = git(root, ["worktree", "list", "--porcelain"]);
  const evidence = evidencePaths();
  writeLayoutManifest({ targetRoot: root, outputPath: evidence.manifest, creatorRoots: [] });

  const result = closeLayoutTarget({ target, manifestPath: evidence.manifest, receiptPath: evidence.receipt });

  assert.equal(result.verdict, "REFUSED_LOCKED");
  assert.equal(fs.existsSync(target), true);
  assert.equal(git(root, ["worktree", "list", "--porcelain"]), before);
});

test("primary checkout and outside-owner targets are refused", () => {
  const root = createRepo();
  const outside = tempDir("layout-close-outside-");
  const evidence = evidencePaths();
  writeLayoutManifest({ targetRoot: root, outputPath: evidence.manifest, creatorRoots: [] });

  const primary = closeLayoutTarget({ target: root, manifestPath: evidence.manifest, receiptPath: evidence.receipt });
  assert.equal(primary.verdict, "REFUSED_PRIMARY");
  assert.equal(fs.existsSync(path.join(root, "README.md")), true);

  const externalReceipt = path.join(evidence.directory, "outside-receipt.json");
  const external = closeLayoutTarget({ target: outside, manifestPath: evidence.manifest, receiptPath: externalReceipt });
  assert.equal(external.verdict, "REFUSED_OUTSIDE_OWNER");
  assert.equal(fs.existsSync(outside), true);
  assert.equal(JSON.parse(fs.readFileSync(externalReceipt, "utf8")).state, "close_failed");
});

test("stale manifest is refused before any target bytes change", () => {
  const root = createRepo();
  const target = path.join(root, ".worktrees", "orphan");
  fs.mkdirSync(target, { recursive: true });
  const evidence = evidencePaths();
  writeLayoutManifest({ targetRoot: root, outputPath: evidence.manifest, creatorRoots: [] });
  fs.writeFileSync(path.join(target, "late.txt"), "changed after manifest\n", "utf8");
  const before = collectFileInventory(target);

  const result = closeLayoutTarget({ target, manifestPath: evidence.manifest, receiptPath: evidence.receipt });

  assert.equal(result.verdict, "REFUSED_STALE_MANIFEST");
  assert.equal(fs.existsSync(target), true);
  assert.deepEqual(collectFileInventory(target), before);
  assert.equal(JSON.parse(fs.readFileSync(evidence.receipt, "utf8")).state, "close_failed");
});

test("close source contains no force, recursive deletion, or global prune path", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "repository-layout-close.js"), "utf8");
  assert.doesNotMatch(source, /--force/);
  assert.doesNotMatch(source, /recursive/);
  assert.doesNotMatch(source, /worktree[\s\S]{0,80}prune/);
  assert.doesNotMatch(source, /rmSync/);
});
