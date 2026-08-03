"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  evaluateNodeRange,
  isNodeRangeSupported,
  resolvePackageRoot,
} = require("../lib/package-root");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-package-root-"));
}

function writeManifest(root, relativePath, extra = {}) {
  const directory = path.join(root, relativePath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
    name: relativePath.replace(/[\\/]/g, "-") || "root-package",
    version: "1.0.0",
    ...extra,
  }), "utf8");
  return directory;
}

test("package resolver prefers the target-root package.json", () => {
  const root = tempDir();
  const rootPackage = writeManifest(root, "");
  writeManifest(root, "nested");

  const result = resolvePackageRoot(root);

  assert.equal(result.packageRoot, rootPackage);
  assert.equal(result.packageRootRelative, ".");
  assert.equal(result.packageDiscovery, "root_package");
  assert.deepEqual(result.candidates, []);
});

test("package resolver discovers one bounded nested package", () => {
  const root = tempDir();
  const nested = writeManifest(root, "learn-diff");
  writeManifest(root, "node_modules/ignored-dependency");

  const result = resolvePackageRoot(root);

  assert.equal(result.packageRoot, nested);
  assert.equal(result.packageRootRelative, "learn-diff");
  assert.equal(result.packageDiscovery, "single_nested_candidate");
  assert.deepEqual(result.candidates, ["learn-diff"]);
});

test("explicit package root selects one package from an ambiguous target", () => {
  const root = tempDir();
  const selected = writeManifest(root, "learn-diff");
  writeManifest(root, "other-package");

  const result = resolvePackageRoot(root, "learn-diff");

  assert.equal(result.packageRoot, selected);
  assert.equal(result.packageRootRelative, "learn-diff");
  assert.equal(result.packageDiscovery, "explicit");
});

test("ambiguous nested package discovery returns an actionable selection error", () => {
  const root = tempDir();
  writeManifest(root, "learn-diff");
  writeManifest(root, "other-package");

  const result = resolvePackageRoot(root);

  assert.equal(result.packageRoot, null);
  assert.equal(result.packageDiscovery, "ambiguous");
  assert.deepEqual(result.candidates, ["learn-diff", "other-package"]);
  assert.match(result.error, /--package-root <relative-path>/);
});

test("package resolver rejects traversal, absolute paths, and escaping symlinks", () => {
  const root = tempDir();
  const outside = tempDir();
  writeManifest(outside, "package");

  assert.throws(() => resolvePackageRoot(root, "../outside"), /parent traversal/);
  assert.throws(() => resolvePackageRoot(root, path.join(outside, "package")), /must be relative/);
  assert.throws(() => resolvePackageRoot(root, "node_modules/ignored"), /excluded directory/);
  assert.throws(() => resolvePackageRoot(root, ".git/ignored"), /excluded directory/);

  const link = path.join(root, "linked-package");
  try {
    fs.symlinkSync(path.join(outside, "package"), link, "dir");
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") return;
    throw error;
  }
  assert.throws(() => resolvePackageRoot(root, "linked-package"), /escapes the target root/);
});

test("Node range evaluation enforces the supported Node 20 baseline without dependencies", () => {
  const supported = [">=20", ">=22.19 <27", "^20.0.0", "20.x"];
  for (const range of supported) {
    const result = evaluateNodeRange(range);
    assert.equal(result.valid, true, range);
    assert.equal(result.supported, true, range);
    assert.equal(isNodeRangeSupported(range), true, range);
  }

  const rejected = ["18", ">=18 <20", "<20"];
  for (const range of rejected) {
    const result = evaluateNodeRange(range);
    assert.equal(result.valid, true, range);
    assert.equal(result.supported, false, range);
    assert.equal(isNodeRangeSupported(range), false, range);
  }

  assert.equal(evaluateNodeRange("not-a-range").valid, false);
  assert.equal(isNodeRangeSupported("not-a-range"), false);
});
