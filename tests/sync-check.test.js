"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const {
  checkTemplateSync,
  scanContracts,
  checkTrustPolicy,
  checkStateLayout,
} = require("../lib/sync-check");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-sync-"));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function snapshotTree(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const items = [];
  function walk(directoryPath) {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right))) {
      const itemPath = path.join(directoryPath, name);
      const relative = path.relative(root, itemPath).split(path.sep).join("/");
      const stat = fs.lstatSync(itemPath);
      if (stat.isDirectory()) {
        items.push({ path: relative, type: "dir" });
        walk(itemPath);
      } else if (stat.isFile()) {
        items.push({ path: relative, type: "file", content: fs.readFileSync(itemPath).toString("base64") });
      } else if (stat.isSymbolicLink()) {
        items.push({ path: relative, type: "symlink", link: fs.readlinkSync(itemPath) });
      }
    }
  }
  walk(root);
  return items;
}

function installMatchingTemplates(sourceRoot, targetRoot) {
  const manifestTemplates = [];
  for (const relativePath of [
    "templates/skills/scope-selector.md",
    "templates/contracts/worker-done-contract.md",
  ]) {
    const content = fs.readFileSync(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
    writeFile(targetRoot, `.meta-harness/${relativePath}`, content);
    const normalized = content.replace(/\r\n/g, "\n");
    const hash = require("node:crypto").createHash("sha256").update(normalized, "utf8").digest("hex");
    manifestTemplates.push({
      source_path: relativePath,
      installed_path: `.meta-harness/${relativePath}`,
      content_hash: hash,
    });
  }

  const manifestWithoutHash = {
    schema_version: "2.0.0",
    generated_at: new Date().toISOString(),
    template_count: manifestTemplates.length,
    hash_algorithm: "sha256",
    line_ending_normalization: "LF",
    templates: manifestTemplates,
  };
  const manifestHash = require("node:crypto").createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex");

  writeFile(targetRoot, ".meta-harness/templates/manifest.json", JSON.stringify({
    ...manifestWithoutHash,
    manifest_hash: manifestHash
  }, null, 2));
}

test("sync check passes when source and installed templates match", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");
  writeFile(sourceRoot, "templates/contracts/worker-done-contract.md", "worker\n");
  installMatchingTemplates(sourceRoot, targetRoot);

  const result = checkTemplateSync({ sourceRoot, targetRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 3);
  assert.deepEqual(result.items.map((item) => item.status), ["PASS", "PASS", "PASS"]);
});

test("sync check reports missing installed templates", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");
  
  const mockTemplates = [{
    source_path: "templates/skills/scope-selector.md",
    installed_path: ".meta-harness/templates/skills/scope-selector.md",
    content_hash: "scope-hash"
  }];
  const manifestWithoutHash = {
    schema_version: "2.0.0",
    generated_at: new Date().toISOString(),
    template_count: mockTemplates.length,
    hash_algorithm: "sha256",
    line_ending_normalization: "LF",
    templates: mockTemplates
  };
  const manifestHash = require("node:crypto").createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex");
  writeFile(targetRoot, ".meta-harness/templates/manifest.json", JSON.stringify({
    ...manifestWithoutHash,
    manifest_hash: manifestHash
  }));

  const result = checkTemplateSync({ sourceRoot, targetRoot });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items.filter(item => item.path !== "manifest.json"), [{
    status: "MISSING",
    path: "skills/scope-selector.md",
    detail: "installed template is missing",
  }]);
});

test("sync check reports byte-exact drift when installed copy differs", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");
  writeFile(targetRoot, ".meta-harness/templates/skills/scope-selector.md", "different\n");
  
  const hash = require("node:crypto").createHash("sha256").update("scope\n", "utf8").digest("hex");
  const mockTemplates = [{
    source_path: "templates/skills/scope-selector.md",
    installed_path: ".meta-harness/templates/skills/scope-selector.md",
    content_hash: hash
  }];
  const manifestWithoutHash = {
    schema_version: "2.0.0",
    generated_at: new Date().toISOString(),
    template_count: mockTemplates.length,
    hash_algorithm: "sha256",
    line_ending_normalization: "LF",
    templates: mockTemplates
  };
  const manifestHash = require("node:crypto").createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex");
  writeFile(targetRoot, ".meta-harness/templates/manifest.json", JSON.stringify({
    ...manifestWithoutHash,
    manifest_hash: manifestHash
  }));

  const result = checkTemplateSync({ sourceRoot, targetRoot });
  assert.equal(result.status, "FAIL");
  assert.equal(result.items[0].status, "DRIFT");
  assert.equal(result.items[0].path, "skills/scope-selector.md");
});

test("trust check scans only skill reference values and rejects remote or path-like names", () => {
  for (const skill of [
    "https://example.com/skill.md",
    "http://example.com/skill.md",
    "git@example.com:org/repo.git",
    "github:org/repo",
    "../skill",
    "./skill",
    "C:\\skills\\skill",
    "/skills/skill",
    "dirty-work-autopilot.md",
    "skills/dirty-work-autopilot",
  ]) {
    const targetRoot = tempDir();
    writeFile(targetRoot, ".meta-harness/skill-distillations.json", JSON.stringify({
      v: 1,
      distillations: [{ skill }],
    }));

    const result = checkTrustPolicy({ targetRoot });
    assert.equal(result.status, "FAIL", skill);
    assert.equal(result.checked, 1);
    assert.equal(result.items[0].status, "REJECTED");
  }
});

test("trust check treats missing registry as pass and malformed registry as failure", () => {
  const missing = tempDir();
  assert.deepEqual(checkTrustPolicy({ targetRoot: missing }), { status: "PASS", checked: 0, items: [] });

  const malformed = tempDir();
  writeFile(malformed, ".meta-harness/skill-distillations.json", "{not-json");
  const result = checkTrustPolicy({ targetRoot: malformed });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 0);
  assert.equal(result.items[0].status, "REJECTED");
  assert.match(result.items[0].detail, /malformed JSON/);
});

test("contract scan fails on exact old primary headings", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/workers/old.md", [
    "# Worker Report",
    "",
    "## Result",
    "",
    "## Human Summary",
    "",
  ].join("\n"));

  const result = scanContracts({ targetRoot });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items.map((item) => item.detail), [
    "old primary heading: # Worker Report",
    "old primary heading: ## Result",
    "old primary heading: ## Human Summary",
  ]);
});

test("contract scan allows warning text mentioning old headings", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/templates/contracts/worker-done-contract.md", [
    "# Worker Done Contract",
    "",
    "Do not use # Worker Report as the primary report heading.",
    "Do not use ## Result or ## Human Summary as section names.",
    "## Worker Report Artifact",
    "",
  ].join("\n"));

  const result = scanContracts({ targetRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, []);
});

test("state-layout check reports old runs layout as migration-needed without writes", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/runs/RUN-001/status.md", "# Old Status\n");
  writeFile(targetRoot, ".meta-harness/runs/RUN-001/events.jsonl", "");
  writeFile(targetRoot, ".meta-harness/current-run", "RUN-001\n");

  const before = snapshotTree(targetRoot);
  const result = checkStateLayout({ targetRoot });
  const after = snapshotTree(targetRoot);

  assert.equal(result.status, "MIGRATION_NEEDED");
  assert.deepEqual(result.items.map((item) => item.status), ["MIGRATION_NEEDED", "MISSING", "MISSING"]);
  assert.equal(fs.existsSync(path.join(targetRoot, ".meta-harness", "status.md")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, ".meta-harness", "events.jsonl")), false);
  assert.deepEqual(after, before);
});

test("templates install/upgrade round-trip integration test", () => {
  const ROOT = path.resolve(__dirname, "..");
  const CLI = path.join(ROOT, "bin", "meta-harness.js");
  const targetRoot = tempDir();

  // 1. Run templates install command (requires init first)
  const resultInit = spawnSync(process.execPath, [CLI, "init", "Roundtrip test"], { cwd: targetRoot });
  assert.equal(resultInit.status, 0);

  const resultInstall = spawnSync(process.execPath, [CLI, "templates", "install", "--allow-dirty"], { cwd: targetRoot });
  assert.equal(resultInstall.status, 0);

  // 2. Run sync check --target <temp>
  const resultCheck1 = spawnSync(process.execPath, [CLI, "sync", "check", "--target", targetRoot], { cwd: targetRoot });
  assert.equal(resultCheck1.status, 0);

  // 3. Modify one installed template
  const targetTemplatePath = path.join(targetRoot, ".meta-harness", "templates", "skills", "scope-selector.md");
  fs.writeFileSync(targetTemplatePath, "modified-content\n", "utf8");

  // 4. Run sync check --target <temp>, verify DRIFT detected
  const resultCheck2 = spawnSync(process.execPath, [CLI, "sync", "check", "--target", targetRoot], { cwd: targetRoot });
  assert.notEqual(resultCheck2.status, 0);
  assert.match(resultCheck2.stdout.toString("utf8"), /DRIFT/);

  // 5. Re-install with overwrite
  const resultReinstall = spawnSync(process.execPath, [CLI, "templates", "install", "--overwrite", "--allow-dirty"], { cwd: targetRoot });
  assert.equal(resultReinstall.status, 0);

  // 6. Verify PASS restored
  const resultCheck3 = spawnSync(process.execPath, [CLI, "sync", "check", "--target", targetRoot], { cwd: targetRoot });
  assert.equal(resultCheck3.status, 0);

  // 7. Confirms no local state leaks
  const eventsContent = fs.readFileSync(path.join(targetRoot, ".meta-harness", "events.jsonl"), "utf8");
  assert.ok(eventsContent.includes("initialized harness"));
});

test("templates install failure rollback test", () => {
  const ROOT = path.resolve(__dirname, "..");
  const CLI = path.join(ROOT, "bin", "meta-harness.js");
  const targetRoot = tempDir();

  const resultInit = spawnSync(process.execPath, [CLI, "init", "Rollback test"], { cwd: targetRoot });
  assert.equal(resultInit.status, 0);

  const resultInstall = spawnSync(process.execPath, [CLI, "templates", "install", "--allow-dirty"], { cwd: targetRoot });
  assert.equal(resultInstall.status, 0);
  
  const initialManifest = fs.readFileSync(path.join(targetRoot, ".meta-harness", "templates", "manifest.json"), "utf8");

  const originalWriteFileSync = fs.writeFileSync;
  let writeCount = 0;
  fs.writeFileSync = function(filePath, content, options) {
    const normPath = filePath.split(path.sep).join("/");
    if (normPath.includes(".meta-harness/templates") && !normPath.includes("manifest.json") && ++writeCount > 5) {
      throw new Error("Simulated templates write failure");
    }
    return originalWriteFileSync.call(fs, filePath, content, options);
  };

  const { copyPackagedTemplates } = require("../lib/templates");
  
  assert.throws(() => {
    copyPackagedTemplates(path.join(targetRoot, ".meta-harness", "templates"), true);
  }, /Simulated templates write failure/);

  fs.writeFileSync = originalWriteFileSync;

  const restoredManifest = fs.readFileSync(path.join(targetRoot, ".meta-harness", "templates", "manifest.json"), "utf8");
  assert.equal(restoredManifest, initialManifest);
});
