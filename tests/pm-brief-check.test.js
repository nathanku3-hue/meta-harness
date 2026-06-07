"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanPmBrief } = require("../lib/pm-brief-check");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-brief-"));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function validBrief(prefix = "") {
  return [
    `${prefix}# PM Brief`,
    "",
    "## Decisions",
    "",
    "- ship the bounded checker",
    "",
    "## Blockers",
    "",
    "- none",
    "",
    "## Evidence",
    "",
    "- tests",
    "",
  ].join("\n");
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

function rejectedDetails(result) {
  return result.items
    .filter((item) => item.status !== "PASS")
    .map((item) => item.detail);
}

test("pm brief scan passes when no brief surfaces exist", () => {
  const targetRoot = tempDir();

  const result = scanPmBrief({ targetRoot });

  assert.deepEqual(result, { status: "PASS", checked: 0, items: [] });
});

test("pm brief scan passes with target-form PM brief sections", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", validBrief());

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, [{ status: "PASS", path: ".meta-harness/pm-brief.md" }]);
});

test("pm brief scan strips UTF-8 BOM before checking title", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", validBrief("\uFEFF"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("pm brief scan rejects unexpected level-2 headings", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "## Raw Logs",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /unexpected heading: ## Raw Logs/);
});

test("pm brief scan rejects unexpected lower-level headings outside fences", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "### Raw Logs",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /unexpected heading: ### Raw Logs/);
});

test("pm brief scan rejects unexpected setext headings outside fences", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "Raw Logs",
    "--------",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /unexpected heading: Raw Logs/);
});

test("pm brief scan reports missing required sections", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "## Blockers",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /missing required section: ## Evidence/);
});

test("pm brief scan is read-only by before and after tree snapshot", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
    "#### Transcript",
    "",
  ].join("\n"));
  const before = snapshotTree(targetRoot);

  const result = scanPmBrief({ targetRoot });
  const after = snapshotTree(targetRoot);

  assert.equal(result.status, "FAIL");
  assert.deepEqual(after, before);
});

test("pm brief scan rejects a first non-empty line other than title", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "",
    "## Decisions",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /first non-empty line must be # PM Brief/);
});

test("pm brief scan rejects later H1 headings", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "# PM Brief",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /duplicate or misplaced H1/);
});

test("pm brief scan ignores forbidden heading examples inside fenced code blocks", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "```md",
    "## Raw Logs",
    "### Transcript",
    "# PM Brief",
    "```",
    "",
    "## Blockers",
    "",
    "~~~text",
    "#### Worker Chatter",
    "~~~",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("pm brief scan rejects unclosed fenced code blocks", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "```md",
    "## Raw Logs",
    "## Blockers",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.items.some((item) => item.status === "MALFORMED"), true);
  assert.match(rejectedDetails(result).join("\n"), /unclosed fenced code block/);
});

test("pm brief scan rejects duplicate required sections", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Decisions",
    "",
    "## Decisions",
    "",
    "## Blockers",
    "",
    "## Evidence",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /duplicate required section: ## Decisions/);
});

test("pm brief scan rejects required sections out of order", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/pm-brief.md", [
    "# PM Brief",
    "",
    "## Evidence",
    "",
    "## Decisions",
    "",
    "## Blockers",
    "",
  ].join("\n"));

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /required sections out of order/);
});

test("pm brief scan rejects pm-brief.md when it is a directory", () => {
  const targetRoot = tempDir();
  fs.mkdirSync(path.join(targetRoot, ".meta-harness", "pm-brief.md"), { recursive: true });

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, [{
    status: "REJECTED",
    path: ".meta-harness/pm-brief.md",
    detail: "brief surface is not a regular file",
  }]);
});

test("pm brief scan scans only direct briefs markdown files", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/briefs/valid.md", validBrief());
  writeFile(targetRoot, ".meta-harness/briefs/ignored.txt", "# Transcript\n\n## Raw Logs\n");
  writeFile(targetRoot, ".meta-harness/briefs/nested/bad.md", "# Transcript\n\n## Raw Logs\n");

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, [{ status: "PASS", path: ".meta-harness/briefs/valid.md" }]);
});

test("pm brief scan rejects direct markdown directories under briefs", () => {
  const targetRoot = tempDir();
  fs.mkdirSync(path.join(targetRoot, ".meta-harness", "briefs", "archive.md"), { recursive: true });

  const result = scanPmBrief({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items, [{
    status: "REJECTED",
    path: ".meta-harness/briefs/archive.md",
    detail: "brief surface is not a regular file",
  }]);
});
