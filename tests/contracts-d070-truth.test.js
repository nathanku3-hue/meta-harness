"use strict";

/** D070/D071 active roadmap, status, and product-direction truth. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const D068_SQUASH_SHORT = "be82763";
const D069_SQUASH_SHORT = "e8e7713";

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

test("status records D071 implementation pending live ToolLauncher proof", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");

  assert.match(goal, /D071/i);
  assert.match(goal, /child-repositor/i);
  assert.match(currentTruth, /closed under/i);
  assert.match(currentTruth, new RegExp(D068_SQUASH_SHORT));
  assert.match(currentTruth, new RegExp(D069_SQUASH_SHORT));
  assert.match(currentTruth, /A0\.1 NO-GO/i);
  assert.match(currentTruth, /A0\.2 GO|A0\.2/i);
  assert.match(currentTruth, /D070-A1 transport\/custody slice closed/i);
  assert.match(currentTruth, /D071 implementation is present and pending live proof/i);
  assert.match(currentTruth, /marker prompt\/validator deleted|marker deleted/i);
  assert.match(currentTruth, /Windows PowerShell/i);
  assert.match(currentTruth, /validate-toollauncher-shortcut\.ps1/i);
  assert.match(currentTruth, /missing\/valid\/corrupt/i);
  assert.match(currentTruth, /not yet proven|pending live/i);
  assert.match(lastVerified, /19\/19|offline D071/i);
  assert.match(lastVerified, /pending/i);
  assert.match(nextAction, /D071/i);
  assert.match(nextAction, /ToolLauncher/i);
  assert.match(nextAction, /7fab419f20ba/i);
  assert.match(nextAction, /scripts\/utils\/CheckShortcut\.ps1/i);
  assert.match(nextAction, /sealed `?RunSpec\.objective`?|Sealed `RunSpec\.objective`/i);
  assert.match(nextAction, /PowerShell/i);
  assert.match(nextAction, /No push until D071 closes/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);
  assert.doesNotMatch(currentTruth, /d070-ao-verified-marker/i);

  const contractIndexSource = read("lib/contracts/index.js");
  assert.doesNotMatch(contractIndexSource, /under review/i);
  assert.match(contractIndexSource, /frozen|closed/i);
});

test("roadmap schedules D070 custody → D071 child slice → R1A → observed controls", () => {
  const rows = roadmapTableRows();
  const d068 = findRoadmapRow(rows, /23A-PR1R|D068/);
  assert.match(d068.state + d068.detail, /closed under/i);
  assert.match(d068.state + d068.detail, new RegExp(D068_SQUASH_SHORT));

  const d069 = findRoadmapRow(rows, /D069|23A-PR2/);
  assert.match(d069.name, /Local Controller Walking Slice/i);
  assert.match(d069.state + d069.detail, /closed under/i);
  assert.match(d069.state + d069.detail, new RegExp(D069_SQUASH_SHORT));

  const d070 = findRoadmapRow(rows, /D070|23A-PR3/);
  assert.match(d070.state + d070.detail, /transport\/custody closed/i);
  assert.match(d070.detail, /NO-GO/i);
  assert.match(d070.detail, /observed version|replay-bound|SHA-256/i);

  const dogfood = findRoadmapRow(rows, /D071|23A-PR4/);
  assert.match(dogfood.name, /Meaningful Single-File Child Dogfood/i);
  assert.match(dogfood.state + dogfood.detail, /next/i);
  assert.match(dogfood.detail, /sealed `RunSpec\.objective`|sealed.*objective/i);
  assert.match(dogfood.detail, /No compatibility mode|no compatibility/i);
  assert.match(dogfood.detail, /ToolLauncher/i);
  assert.match(dogfood.detail, /7fab419f20ba/i);
  assert.match(dogfood.detail, /CheckShortcut\.ps1/i);
  assert.match(dogfood.detail, /Quant is excluded/i);

  const r1a = findRoadmapRow(rows, /^R1A$/);
  assert.match(r1a.state + r1a.detail, /immediately after D071/i);
  assert.doesNotMatch(r1a.state + r1a.detail, /parallel after merge/i);

  const controls = findRoadmapRow(rows, /23A-PR4B/);
  assert.match(controls.name + controls.detail, /Concurrency|cancellation/i);
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

test("vendored ToolLauncher baseline blob matches pinned identity", () => {
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
});
