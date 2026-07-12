"use strict";

/** D070/D071 active roadmap, status, and product-direction truth. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const D068_SQUASH_SHORT = "be82763";
const D069_SQUASH_SHORT = "e8e7713";
const D071_IMPL_SHORT = "74f8ac1";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function section(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `(?:^|\\n)##[ \\t]+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)`,
      "i",
    ),
    new RegExp(
      `(?:^|\\n)${escaped}:?\\s*\\n([\\s\\S]*?)(?=\\n(?:[A-Z][A-Za-z0-9 /-]{2,40}):?\\s*\\n|\\n##[ \\t]|$)`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[1];
  }
  assert.fail(`missing section: ${heading}`);
}

function roadmapTableRows() {
  const summary = section(read("docs/product/roadmap.md"), "Phase Summary");
  const rows = [];
  for (const line of summary.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*Phase\s*\|/i.test(line) || /^\|\s*-+/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length >= 4) {
      rows.push({ id: cells[0], name: cells[1], state: cells[2], detail: cells[3] });
    }
  }
  return rows;
}

function findRoadmapRow(rows, idPattern) {
  const row = rows.find((candidate) => idPattern.test(candidate.id));
  assert.ok(row, `missing roadmap row matching ${idPattern}`);
  return row;
}

test("status records D071 closed and R1A next", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");

  assert.match(goal, /R1A/i);
  assert.match(currentTruth, new RegExp(D068_SQUASH_SHORT));
  assert.match(currentTruth, new RegExp(D069_SQUASH_SHORT));
  assert.match(currentTruth, /D070-A1 transport\/custody slice closed/i);
  assert.match(currentTruth, /D071 closed under/i);
  assert.match(currentTruth, new RegExp(D071_IMPL_SHORT));
  assert.match(currentTruth, /ToolLauncher/i);
  assert.match(currentTruth, /CheckShortcut\.ps1/i);
  assert.match(currentTruth, /missing\+valid\+corrupt|missing\/valid\/corrupt/i);
  assert.match(currentTruth, /d071-toollauncher-dogfood-evidence\.json/i);
  assert.match(lastVerified, /74f8ac1|implementation commit/i);
  assert.match(lastVerified, /PASS/i);
  assert.match(lastVerified, /9f41bbbb/i);
  assert.match(nextAction, /R1A/i);
  assert.doesNotMatch(currentTruth, /d070-ao-verified-marker/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);

  const contractIndexSource = read("lib/contracts/index.js");
  assert.doesNotMatch(contractIndexSource, /under review/i);
  assert.match(contractIndexSource, /frozen|closed/i);
});

test("roadmap schedules D070 custody → D071 closed → R1A next", () => {
  const rows = roadmapTableRows();
  const d068 = findRoadmapRow(rows, /23A-PR1R|D068/);
  assert.match(d068.state + d068.detail, /closed under/i);
  assert.match(d068.state + d068.detail, new RegExp(D068_SQUASH_SHORT));

  const d069 = findRoadmapRow(rows, /D069|23A-PR2/);
  assert.match(d069.state + d069.detail, /closed under/i);
  assert.match(d069.state + d069.detail, new RegExp(D069_SQUASH_SHORT));

  const d070 = findRoadmapRow(rows, /D070|23A-PR3/);
  assert.match(d070.state + d070.detail, /transport\/custody closed/i);

  const dogfood = findRoadmapRow(rows, /D071|23A-PR4/);
  assert.match(dogfood.name, /Meaningful Single-File Child Dogfood/i);
  assert.match(dogfood.state + dogfood.detail, /closed under/i);
  assert.match(dogfood.state + dogfood.detail, new RegExp(D071_IMPL_SHORT));
  assert.match(dogfood.detail, /ToolLauncher/i);
  assert.match(dogfood.detail, /7fab419f20ba/i);
  assert.match(dogfood.detail, /CheckShortcut\.ps1/i);
  assert.match(dogfood.detail, /d071-toollauncher-dogfood-evidence\.json/i);

  const r1a = findRoadmapRow(rows, /^R1A$/);
  assert.match(r1a.state + r1a.detail, /next|immediately after D071/i);

  const controls = findRoadmapRow(rows, /23A-PR4B/);
  assert.match(controls.state + controls.detail, /only if D071 requires|observed requirement/i);
});

test("post-MVP product re-charter is explicit across primary truth surfaces", () => {
  const readme = read("README.md");
  const prd = read("docs/product/prd.md");
  const spec = read("docs/product/product-spec.md");
  for (const text of [readme, prd, spec]) {
    assert.match(text, /authority-bound agent execution-custody harness/i);
    assert.match(text, /original|historical|MVP/i);
    assert.match(text, /intentional|deviation|moved beyond/i);
  }
  assert.match(readme, /D071/i);
  assert.match(prd, /D071/i);
  assert.match(spec, /meaningful child-repository dogfood/i);
});

test("vendored baseline and tracked D071 evidence envelope exist", () => {
  const { spawnSync } = require("node:child_process");
  const fixture = path.join(
    root,
    "tests/fixtures/d071/toollauncher-checkshortcut-7fab419f.ps1",
  );
  assert.ok(fs.existsSync(fixture));
  const hash = String(
    spawnSync("git", ["hash-object", fixture], { encoding: "utf8", windowsHide: true }).stdout || "",
  ).trim();
  assert.equal(hash, "aa1d3b7c71761b9a50139f828e7c154bc9693b66");
  assert.ok(fs.existsSync(path.join(root, "internal/d069/programs/validate-toollauncher-shortcut.ps1")));
  assert.equal(
    fs.existsSync(path.join(root, "internal/d069/programs/validation-program.js")),
    false,
  );
  const evidence = JSON.parse(
    read("docs/ops/audits/d071-toollauncher-dogfood-evidence.json"),
  );
  assert.equal(evidence.kind, "d071-toollauncher-dogfood-evidence");
  assert.match(evidence.metaHarnessImplementationCommit, /^74f8ac1/);
  assert.equal(evidence.childBaseRevision, "7fab419f20ba5c7a4008d6a6071d5aad10ba534c");
  assert.equal(evidence.allowedPath, "scripts/utils/CheckShortcut.ps1");
  assert.equal(evidence.aoSpawnCount, 1);
  assert.equal(evidence.replayDisposition, "REPLAY");
  assert.equal(evidence.trackedWorktreeClean, true);
  assert.match(evidence.verifiedChildHeadRevision, /^9f41bbbb/);
});
