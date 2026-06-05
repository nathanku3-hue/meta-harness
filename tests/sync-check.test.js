"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
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
  for (const relativePath of [
    "templates/skills/scope-selector.md",
    "templates/contracts/worker-done-contract.md",
  ]) {
    const content = fs.readFileSync(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
    writeFile(targetRoot, `.meta-harness/${relativePath}`, content);
  }
}

test("sync check passes when source and installed templates match", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");
  writeFile(sourceRoot, "templates/contracts/worker-done-contract.md", "worker\n");
  installMatchingTemplates(sourceRoot, targetRoot);

  const result = checkTemplateSync({ sourceRoot, targetRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 2);
  assert.deepEqual(result.items.map((item) => item.status), ["PASS", "PASS"]);
});

test("sync check reports missing installed templates", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");

  const result = checkTemplateSync({ sourceRoot, targetRoot });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items, [{
    status: "MISSING",
    path: "skills/scope-selector.md",
    detail: "installed template is missing",
  }]);
});

test("sync check reports byte-exact drift when installed copy differs", () => {
  const sourceRoot = tempDir();
  const targetRoot = tempDir();
  writeFile(sourceRoot, "templates/skills/scope-selector.md", "scope\n");
  writeFile(targetRoot, ".meta-harness/templates/skills/scope-selector.md", "scope\r\n");

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
