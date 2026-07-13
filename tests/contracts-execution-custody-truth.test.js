"use strict";

/** Execution-custody roadmap, status, and product-direction truth. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function section(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|\\n)##[ \\t]+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)`, "i"),
    new RegExp(`(?:^|\\n)${escaped}:?\\s*\\n([\\s\\S]*?)(?=\\n(?:[A-Z][A-Za-z0-9 /-]{2,40}):?\\s*\\n|\\n##[ \\t]|$)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  assert.fail(`missing section: ${heading}`);
}

function roadmapRows() {
  const summary = section(read("docs/product/roadmap.md"), "Phase Summary");
  return summary.split(/\r?\n/)
    .filter((line) => line.startsWith("|")
      && !/^\|\s*Phase\s*\|/i.test(line)
      && !/^\|\s*-+/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
    .map(([id, name, state, detail]) => ({ id, name, state, detail }));
}

function findRow(rows, pattern) {
  const row = rows.find((candidate) => pattern.test(candidate.id));
  assert.ok(row, `missing roadmap row matching ${pattern}`);
  return row;
}

test("status closes D073 and makes D074 the bounded next action", () => {
  const status = read(".meta-harness/status.md");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");

  assert.match(goal, /D074 PROVE/i);
  assert.match(goal, /third real child/i);
  assert.match(goal, /one new example/i);
  assert.match(goal, /one end-to-end test/i);
  assert.match(currentTruth, /D073 closed under exact implementation candidate `87de018`/i);
  assert.match(currentTruth, /111-file native Windows Node 25 suite passed/i);
  assert.match(currentTruth, /Fluxara process 1.*once.*VERIFIED/i);
  assert.match(currentTruth, /process 2.*REPLAY.*zero spawns/i);
  assert.match(currentTruth, /leakage scanning across 16 files/i);
  assert.match(currentTruth, /internal\/execution-custody/i);
  assert.match(currentTruth, /production imports from `internal\/d069` are deleted/i);
  assert.match(currentTruth, /d073-functional-custody-replacement-audit\.json/i);

  assert.match(lastVerified, /87de018b06cb788eedbc8d3cf9e0737989702471/i);
  assert.match(lastVerified, /111 files, zero failures/i);
  assert.match(lastVerified, /2f2e6156b5b89726e4047a1118e2aebac5c55f27/i);
  assert.match(lastVerified, /REPLAY/i);
  assert.match(lastVerified, /leakage PASS/i);
  assert.match(lastVerified, /failed candidate roots/i);

  assert.match(nextAction, /D074 PROVE/i);
  assert.match(nextAction, /exactly one new example/i);
  assert.match(nextAction, /one end-to-end test/i);
  assert.match(nextAction, /must remain unchanged/i);
  assert.match(nextAction, /VERIFIED/i);
  assert.match(nextAction, /zero-spawn REPLAY/i);
  assert.match(nextAction, /portable verification/i);
  assert.match(nextAction, /leakage PASS/i);
  assert.doesNotMatch(nextAction, /D073.*REPLACE\+CLOSE/i);
  assert.doesNotMatch(nextAction, /force(?:-|\s)?push/i);
});

test("CI and active runtime identities are phase-neutral", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /runs-on:\s*ubuntu-latest[\s\S]*?run:\s*npm test/i);
  assert.match(ci, /name:\s*Windows complete suite[\s\S]*?runs-on:\s*windows-latest[\s\S]*?run:\s*npm test/i);
  assert.doesNotMatch(ci, /d0(?:69|70|71|72)-windows|D0(?:69|70|71|72) Windows/i);
  assert.doesNotMatch(read("scripts/run-tests.js"), /runtime-d0(?:70|71|72)/i);

  const activeRuntime = fs.readdirSync(path.join(root, "internal/execution-custody"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => read(`internal/execution-custody/${name}`))
    .join("\n");
  assert.doesNotMatch(activeRuntime, /internal\/d069|ToolLauncher|CheckShortcut|Windows PowerShell|powershell\.exe|validate-toollauncher/i);
  assert.doesNotMatch(activeRuntime, /D0(?:69|70|71|72)|d0(?:69|70|71|72)/);
});

test("roadmap orders closed D073 before next D074, DELETE, and DECIDE", () => {
  const rows = roadmapRows();
  const d073 = findRow(rows, /D073|REPLACE\+CLOSE/);
  const d074 = findRow(rows, /D074|PROVE/);
  const deletion = findRow(rows, /^DELETE$/);
  const decide = findRow(rows, /^DECIDE$/);

  assert.match(d073.name, /Functional Custody Replacement Slice/i);
  assert.match(d073.state, /closed under `87de018`/i);
  assert.match(d073.detail, /111 files, zero failures/i);
  assert.match(d073.detail, /Fluxara base `8548fe5`/i);
  assert.match(d073.detail, /verified child `2f2e615`/i);
  assert.match(d073.detail, /REPLAY with zero spawns/i);
  assert.match(d073.detail, /leakage scanning passed/i);
  assert.match(d073.detail, /internal\/execution-custody/i);
  assert.match(d073.detail, /d073-functional-custody-replacement-audit\.json/i);

  assert.match(d074.state, /next/i);
  assert.match(d074.detail, /third real child/i);
  assert.match(d074.detail, /one example/i);
  assert.match(d074.detail, /one end-to-end test/i);
  assert.match(d074.detail, /remain unchanged/i);
  assert.match(d074.detail, /VERIFIED/i);
  assert.match(d074.detail, /REPLAY/i);
  assert.match(d074.detail, /leakage PASS/i);

  assert.match(deletion.state + deletion.detail, /after PROVE/i);
  assert.match(decide.state + decide.detail, /only after repeated real use/i);
  assert.ok(rows.indexOf(d073) < rows.indexOf(d074));
  assert.ok(rows.indexOf(d074) < rows.indexOf(deletion));
  assert.ok(rows.indexOf(deletion) < rows.indexOf(decide));
});

test("product re-charter and D073 closure are explicit across primary surfaces", () => {
  const readme = read("README.md");
  const prd = read("docs/product/prd.md");
  const spec = read("docs/product/product-spec.md");
  const architecture = read("docs/product/runtime-authority-architecture.md");
  const decisionLog = read("docs/product/decision-log.md");

  for (const text of [readme, prd, spec]) {
    assert.match(text, /authority-bound agent execution-custody harness/i);
    assert.match(text, /original|historical|MVP/i);
    assert.match(text, /intentional|deviation|moved beyond/i);
  }
  for (const text of [prd, spec, architecture, decisionLog]) {
    assert.match(text, /87de018/i);
    assert.match(text, /D074/i);
  }
  assert.match(spec, /internal\/execution-custody/i);
  assert.match(architecture, /D073 REPLACE\+CLOSE closed/i);
  assert.match(decisionLog, /D073 closure record/i);
});

test("D073 audit binds exact suite, live replay, export, and deletion truth", () => {
  const audit = JSON.parse(read("docs/ops/audits/d073-functional-custody-replacement-audit.json"));
  assert.equal(audit.kind, "d073-functional-custody-replacement-audit");
  assert.equal(audit.verdict, "FUNCTIONAL_CUSTODY_REPLACEMENT_CLOSED");
  assert.equal(audit.implementation.commit, "87de018b06cb788eedbc8d3cf9e0737989702471");
  assert.equal(audit.implementation.tree, "1ecfc71dc28f67e62832aa594d4efe7a5c4548f1");
  assert.equal(audit.nativeSuite.command, "npm test");
  assert.equal(audit.nativeSuite.nodeVersion, "v25.2.1");
  assert.equal(audit.nativeSuite.testFiles, 111);
  assert.equal(audit.nativeSuite.failed, 0);
  assert.equal(audit.nativeSuite.exitCode, 0);

  assert.equal(audit.liveGate.exitCode, 0);
  assert.equal(audit.liveGate.child.repositoryId, "fluxara");
  assert.equal(audit.liveGate.child.baseRevision, "8548fe5460511c86ed312284b3712e17622134d2");
  assert.equal(audit.liveGate.child.verifiedHeadRevision, "2f2e6156b5b89726e4047a1118e2aebac5c55f27");
  assert.equal(audit.liveGate.process1.disposition, "VERIFIED");
  assert.equal(audit.liveGate.process1.agentSpawnCount, 1);
  assert.equal(audit.liveGate.process2.disposition, "REPLAY");
  assert.equal(audit.liveGate.process2.agentSpawnCount, 0);
  assert.equal(audit.liveGate.process2.executionToolPathsUsable, false);
  assert.equal(audit.liveGate.portable.independentVerificationPassed, true);
  assert.equal(audit.liveGate.portable.leakageScanPassed, true);
  assert.equal(audit.liveGate.portable.scannedFiles, 16);
  assert.deepEqual(audit.liveGate.portable.changedPaths, ["fluxara_core/demo.py"]);
  assert.deepEqual(audit.liveGate.portable.validationExitCodes, [0, 0]);

  assert.equal(audit.failedCandidatesRetained.length, 3);
  assert.equal(audit.replacement.singleProductionRuntimeRoot, true);
  assert.equal(audit.replacement.activeToolLauncherPathDeleted, true);
  assert.equal(audit.replacement.activePowerShellValidatorDeleted, true);
  assert.equal(audit.replacement.productionImportsFromInternalD069, 0);
  assert.equal(audit.replacement.compatibilityAdapterPresent, false);
  assert.equal(audit.replacement.dualRuntimePresent, false);
  assert.equal(audit.replacement.contractsKernelChanged, false);
  assert.equal(audit.decision.status, "closed");
  assert.equal(audit.decision.next, "D074");

  for (const removed of [
    "internal/d069/programs/validate-toollauncher-shortcut.ps1",
    "tests/fixtures/d071/known-good-checkshortcut.ps1",
    "tests/helpers/windows-runtime-test.js",
    "tests/helpers/toollauncher-clone.js",
    "tests/runtime-d071-toollauncher-live.test.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, removed);
  }
  for (const active of [
    ".agents/skills/bounded-repository-change/SKILL.md",
    ".agents/skills/bounded-repository-change/examples/fluxara-demo-output.json",
    "internal/execution-custody/controller.js",
    "tests/runtime-execution-custody.test.js",
    "tests/runtime-execution-custody-live.test.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, active)), true, active);
  }
});
