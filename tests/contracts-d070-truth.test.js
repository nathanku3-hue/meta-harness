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

test("status records the D072 live failure and D073 replacement custody gate", () => {
  const status = read(".meta-harness/status.md");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");

  assert.match(goal, /D073/i);
  assert.match(goal, /REPLACE\+CLOSE/i);
  assert.match(goal, /host-neutral functional slice/i);
  assert.match(goal, /PROVE\s*→\s*DELETE\s*→\s*DECIDE/i);
  assert.match(currentTruth, new RegExp(D068_SQUASH_SHORT));
  assert.match(currentTruth, new RegExp(D069_SQUASH_SHORT));
  assert.match(currentTruth, /D070-A1 transport\/custody slice closed/i);
  assert.match(currentTruth, /D071 functional execution passed/i);
  assert.match(currentTruth, new RegExp(D071_IMPL_SHORT));
  assert.match(currentTruth, /ToolLauncher/i);
  assert.match(currentTruth, /CheckShortcut\.ps1/i);
  assert.match(currentTruth, /d071-post-close-custody-audit\.json/i);
  assert.match(currentTruth, /D072 custody mechanics are implemented offline/i);
  assert.match(currentTruth, /5d677a8/i);
  assert.match(currentTruth, /116 files with zero failures/i);
  assert.match(currentTruth, /one successful AO spawn/i);
  assert.match(currentTruth, /failed trusted validation before terminal publication/i);
  assert.match(currentTruth, /d072-exact-commit-live-gate-audit\.json/i);
  assert.match(currentTruth, /D073 now combines REPLACE with custody closure/i);
  assert.match(currentTruth, /canonical receipt-first replay/i);
  assert.match(currentTruth, /lazy execution-tool binding/i);
  assert.match(currentTruth, /manifest-last terminal publication/i);
  assert.match(currentTruth, /fresh-process zero-spawn replay/i);
  assert.match(currentTruth, /No ToolLauncher retry or compatibility bridge/i);
  assert.match(lastVerified, /74f8ac1|implementation commit/i);
  assert.match(lastVerified, /9f41bbbb/i);
  assert.match(lastVerified, /absent/i);
  assert.match(lastVerified, /graceful process restart proof/i);
  assert.match(lastVerified, /AO count zero/i);
  assert.match(lastVerified, /portable verifier/i);
  assert.match(nextAction, /D073/i);
  assert.match(nextAction, /real non-ToolLauncher child/i);
  assert.match(nextAction, /host-neutral validation-command capsule/i);
  assert.match(nextAction, /AO count one/i);
  assert.match(nextAction, /VERIFIED/i);
  assert.match(nextAction, /second process/i);
  assert.match(nextAction, /REPLAY/i);
  assert.match(nextAction, /AO count zero/i);
  assert.match(nextAction, /independent portable verification/i);
  assert.match(nextAction, /delete ToolLauncher\/PowerShell\/CheckShortcut/i);
  assert.match(nextAction, /D074 PROVE/i);
  assert.match(nextAction, /DELETE/i);
  assert.match(nextAction, /DECIDE/i);
  assert.doesNotMatch(currentTruth, /d070-ao-verified-marker/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?with(?:-|\s)?lease|force-push|force push/i);

  const contractIndexSource = read("lib/contracts/index.js");
  assert.doesNotMatch(contractIndexSource, /under review/i);
  assert.match(contractIndexSource, /frozen|closed/i);
});

test("CI runs one complete suite per platform and preserves the Windows check identity", () => {
  const ci = read(".github/workflows/ci.yml");

  assert.match(ci, /runs-on:\s*ubuntu-latest[\s\S]*?run:\s*npm test/i);
  assert.match(
    ci,
    /name:\s*D069 Windows integration[\s\S]*?runs-on:\s*windows-latest[\s\S]*?run:\s*npm test/i,
  );
  assert.doesNotMatch(
    ci,
    /node --test\s+tests\/runtime-d070-[^\n]+tests\/runtime-d072-/i,
  );
});

test("roadmap schedules D072 substrate → D073 REPLACE+CLOSE → D074 PROVE → DELETE → DECIDE", () => {
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
  assert.match(dogfood.state + dogfood.detail, /functional PASS/i);
  assert.match(dogfood.state + dogfood.detail, /custody closure superseded/i);
  assert.match(dogfood.detail, /ToolLauncher/i);
  assert.match(dogfood.detail, /7fab419f20ba/i);
  assert.match(dogfood.detail, /CheckShortcut\.ps1/i);
  assert.match(dogfood.detail, /d071-post-close-custody-audit\.json/i);

  const d072 = findRoadmapRow(rows, /D072|23A-PR4R/);
  assert.match(d072.name, /Persistent Child Result Custody/i);
  assert.match(d072.state + d072.detail, /custody substrate implemented/i);
  assert.match(d072.state + d072.detail, /live closure failed|closure failed/i);
  assert.match(d072.detail, /5d677a8/i);
  assert.match(d072.detail, /116 files, zero failures/i);
  assert.match(d072.detail, /one successful AO spawn/i);
  assert.match(d072.detail, /before terminal publication/i);
  assert.match(d072.detail, /receipt-first replay/i);
  assert.match(d072.detail, /lazy execution-tool binding/i);
  assert.match(d072.detail, /manifest-last evidence/i);
  assert.match(d072.detail, /tool-canary replay/i);
  assert.match(d072.detail, /prerequisite thin-bundle verification/i);
  assert.match(d072.detail, /d072-exact-commit-live-gate-audit\.json/i);
  assert.match(d072.detail, /No further ToolLauncher prompt-only repair/i);

  const replace = findRoadmapRow(rows, /D073|REPLACE\+CLOSE/);
  assert.match(replace.name, /Functional Custody Replacement Slice/i);
  assert.match(replace.state + replace.detail, /next/i);
  assert.match(replace.detail, /bounded-repository-change skill/i);
  assert.match(replace.detail, /host-neutral validation-command capsule/i);
  assert.match(replace.detail, /sole production custody path/i);
  assert.match(replace.detail, /AO count one.*VERIFIED/i);
  assert.match(replace.detail, /REPLAY with AO count zero/i);
  assert.match(replace.detail, /independent portable verification/i);
  assert.match(replace.detail, /delete ToolLauncher, PowerShell, CheckShortcut\.ps1/i);
  assert.match(replace.detail, /No compatibility pair or dual runtime/i);

  const prove = findRoadmapRow(rows, /D074|PROVE/);
  assert.match(prove.state + prove.detail, /after D073/i);
  assert.match(prove.detail, /existing bounded-repository-change skill/i);
  assert.match(prove.detail, /generic `SKILL\.md`.*unchanged/i);
  assert.match(prove.detail, /VERIFIED/i);
  assert.match(prove.detail, /REPLAY/i);
  assert.match(prove.detail, /portable verification/i);

  const deletion = findRoadmapRow(rows, /^DELETE$/);
  assert.match(deletion.state + deletion.detail, /after PROVE/i);
  assert.match(deletion.detail, /supported user jobs/i);
  assert.match(deletion.detail, /record/i);
  assert.match(deletion.detail, /No aliases|No compatibility|compatibility path/i);

  const replaceIndex = rows.indexOf(replace);
  const proveIndex = rows.indexOf(prove);
  const deletionIndex = rows.indexOf(deletion);
  assert.ok(replaceIndex < proveIndex && proveIndex < deletionIndex);

  const decide = findRoadmapRow(rows, /^DECIDE$/);
  assert.match(decide.state + decide.detail, /only after repeated real use/i);
  assert.match(decide.detail, /public execution command/i);
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
  assert.match(spec, /D071[\s\S]*ToolLauncher/i);
  assert.match(spec, /D072[\s\S]*receipt-first replay/i);
  assert.match(spec, /D073[\s\S]*host-neutral replacement functional slice/i);
});

test("vendored baseline plus D071 historical evidence and custody correction exist", () => {
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

  const audit = JSON.parse(
    read("docs/ops/audits/d071-post-close-custody-audit.json"),
  );
  assert.equal(audit.kind, "d071-post-close-custody-audit");
  assert.equal(audit.verdict, "FUNCTIONAL_PASS_CUSTODY_NOT_CLOSED");
  assert.equal(audit.supersedesClosureClaim, true);
  assert.equal(audit.nextDecision, "D072");
  assert.equal(audit.findings.functionalLiveExecutionObserved, true);
  assert.equal(audit.findings.verifiedChildObjectRetained, false);
  assert.equal(audit.findings.durableRefRetained, false);
  assert.equal(audit.findings.aoProcessMetaRetained, false);
  assert.equal(audit.findings.authorizationReceiptDigestRetained, false);
  assert.equal(audit.findings.freshControllerReplayImplemented, false);
  assert.equal(audit.findings.stableTerminalLookupBeforeReauthorization, false);
  assert.equal(audit.findings.terminalReplayIndependentOfCurrentExecutionTools, false);
  assert.equal(audit.findings.defaultOptionalStartupPathBranchValidated, false);
});
