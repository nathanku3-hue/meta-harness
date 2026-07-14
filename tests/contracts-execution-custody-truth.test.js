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

test("status records D074 implementation acceptance and the immutable live-closure gate", () => {
  const status = read(".meta-harness/status.md");
  const goal = section(status, "Goal");
  const currentTruth = section(status, "Current truth");
  const lastVerified = section(status, "Last verified");
  const nextAction = section(status, "Next action");

  assert.match(goal, /clean immutable D074 candidate/i);
  assert.match(goal, /authenticated DevSpace live gate/i);
  assert.match(goal, /expired zero-spawn REPLAY/i);
  assert.match(goal, /portable Node verification/i);
  assert.match(goal, /D075 OPERATE/i);
  assert.match(currentTruth, /D073 closed under exact implementation candidate `87de018`/i);
  assert.match(currentTruth, /111-file native Windows Node 25 suite passed/i);
  assert.match(currentTruth, /Fluxara process 1.*once.*VERIFIED/i);
  assert.match(currentTruth, /process 2.*REPLAY.*zero spawns/i);
  assert.match(currentTruth, /leakage scanning across 16 files/i);
  assert.match(currentTruth, /internal\/execution-custody/i);
  assert.match(currentTruth, /production imports from `internal\/d069` are deleted/i);
  assert.match(currentTruth, /d073-functional-custody-replacement-audit\.json/i);
  assert.match(currentTruth, /d073-post-close-forward-audit\.json/i);
  assert.match(currentTruth, /D074 implementation is now audit-accepted but not closed/i);
  assert.match(currentTruth, /phase-neutral shared live workflow/i);
  assert.match(currentTruth, /exact depth-one fetch/i);
  assert.match(currentTruth, /under-validation defect/i);
  assert.match(currentTruth, /lifecycle/i);
  assert.match(currentTruth, /112-file native Windows Node 25 suite pass/i);
  assert.match(currentTruth, /d074-pre-candidate-functional-slice-audit\.json/i);

  assert.match(lastVerified, /87de018b06cb788eedbc8d3cf9e0737989702471/i);
  assert.match(lastVerified, /112 files, zero failures/i);
  assert.match(lastVerified, /2f2e6156b5b89726e4047a1118e2aebac5c55f27/i);
  assert.match(lastVerified, /REPLAY/i);
  assert.match(lastVerified, /leakage PASS/i);
  assert.match(lastVerified, /failed candidate roots/i);

  assert.match(nextAction, /one implementation candidate commit/i);
  assert.match(nextAction, /112 files, zero failures/i);
  assert.match(nextAction, /only `tests\/runtime-execution-custody-devspace-live\.test\.js`/i);
  assert.match(nextAction, /CUSTODY_LIVE_DEVSPACE=1/i);
  assert.match(nextAction, /CUSTODY_LIVE_FLUXARA.*unset/i);
  assert.match(nextAction, /VERIFIED/i);
  assert.match(nextAction, /REPLAY.*zero spawns/i);
  assert.match(nextAction, /leakage PASS/i);
  assert.match(nextAction, /separate commit/i);
  assert.match(nextAction, /no amend|do not amend/i);
  assert.match(nextAction, /D075 OPERATE/i);
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

test("roadmap orders closed D073 before cross-ecosystem D074, D075 OPERATE, DECIDE, and DELETE", () => {
  const rows = roadmapRows();
  const d073 = findRow(rows, /D073|REPLACE\+CLOSE/);
  const d074 = findRow(rows, /D074|PROVE/);
  const operate = findRow(rows, /D075|OPERATE/);
  const decide = findRow(rows, /^DECIDE$/);
  const deletion = findRow(rows, /^DELETE$/);

  assert.match(d073.name, /Functional Custody Replacement Slice/i);
  assert.match(d073.state, /closed under `87de018`/i);
  assert.match(d073.detail, /111 files, zero failures/i);
  assert.match(d073.detail, /Fluxara base `8548fe5`/i);
  assert.match(d073.detail, /verified child `2f2e615`/i);
  assert.match(d073.detail, /REPLAY with zero spawns/i);
  assert.match(d073.detail, /leakage scanning passed/i);
  assert.match(d073.detail, /internal\/execution-custody/i);
  assert.match(d073.detail, /d073-functional-custody-replacement-audit\.json/i);

  assert.match(d074.name, /Cross-Ecosystem Reuse Proof/i);
  assert.match(d074.state, /implementation audit accepted/i);
  assert.match(d074.state, /candidate\/live closure pending/i);
  assert.match(d074.detail, /DevSpace `00952c05`/i);
  assert.match(d074.detail, /DevSpace `00952c05`/i);
  assert.match(d074.detail, /phase-neutral shared live workflow/i);
  assert.match(d074.detail, /exact depth-one pinned authority/i);
  assert.match(d074.detail, /later-than-expiry zero-spawn replay/i);
  assert.match(d074.detail, /lifecycle-deleting command stub/i);
  assert.match(d074.detail, /VERIFIED/i);
  assert.match(d074.detail, /zero-spawn REPLAY/i);
  assert.match(d074.detail, /leakage PASS/i);

  assert.match(operate.name, /Private Operator Use Gate/i);
  assert.match(operate.state + operate.detail, /after D074/i);
  assert.match(operate.detail, /minimal private operator seam/i);
  assert.match(decide.state + decide.detail, /after repeated D075 use/i);
  assert.match(deletion.state + deletion.detail, /after OPERATE and DECIDE/i);
  assert.ok(rows.indexOf(d073) < rows.indexOf(d074));
  assert.ok(rows.indexOf(d074) < rows.indexOf(operate));
  assert.ok(rows.indexOf(operate) < rows.indexOf(decide));
  assert.ok(rows.indexOf(decide) < rows.indexOf(deletion));
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
    assert.match(text, /D075/i);
  }
  assert.match(spec, /internal\/execution-custody/i);
  assert.match(architecture, /D073 REPLACE\+CLOSE closed/i);
  assert.match(decisionLog, /D073 closure record/i);
  assert.match(decisionLog, /D073 post-close forward audit/i);
  assert.match(decisionLog, /D074 pre-candidate functional-slice audit/i);
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

test("D073 post-close audit preserves closure and binds cross-ecosystem proof", () => {
  const audit = JSON.parse(read("docs/ops/audits/d073-post-close-forward-audit.json"));
  assert.equal(audit.kind, "d073-post-close-forward-audit");
  assert.equal(audit.verdict, "D073_CLOSED_D074_AMENDED");
  assert.equal(audit.repository.head, "7b487479da03d7add63b9568dba94aa4a35d8e88");
  assert.equal(audit.closureConfirmation.live.process1Disposition, "VERIFIED");
  assert.equal(audit.closureConfirmation.live.process1AgentSpawns, 1);
  assert.equal(audit.closureConfirmation.live.process2Disposition, "REPLAY");
  assert.equal(audit.closureConfirmation.live.process2AgentSpawns, 0);
  assert.equal(audit.closureConfirmation.replacement.productionImportsFromInternalD069, 0);

  assert.equal(audit.maximalInsights.productionRuntimeIsMeaningfullyGeneric, true);
  assert.equal(audit.maximalInsights.testIntegrationHarnessIsNotYetGeneric, true);
  assert.equal(audit.maximalInsights.expiredTerminalReplayEvidenceRegression.present, true);
  assert.equal(
    audit.maximalInsights.expiredTerminalReplayEvidenceRegression.runtimeBehaviorStillOrdersTerminalReplayBeforeExpiryCheck,
    true,
  );
  assert.equal(audit.maximalInsights.portableClaimBoundary.thirdPartyHermeticEnvironment, false);

  assert.equal(audit.roadmapDecision.d074Status, "approved_with_binding_amendments");
  assert.equal(audit.roadmapDecision.recommendedChild.repositoryId, "devspace");
  assert.equal(
    audit.roadmapDecision.recommendedChild.baseRevision,
    "00952c05f01248773a90cd293aed528672eb6f1b",
  );
  assert.equal(
    audit.roadmapDecision.recommendedChild.baseTree,
    "65e249664f7146e7bff6c36d530f3de1cd0068e4",
  );
  assert.equal(audit.roadmapDecision.recommendedChild.allowedPath, "scripts/dev-server.mjs");
  assert.equal(audit.roadmapDecision.recommendedChild.validationCommandName, "node");
  assert.match(audit.roadmapDecision.acceptance.join("\n"), /later than receipt expiry/i);
  assert.match(
    audit.roadmapDecision.allowedImplementationChanges.join("\n"),
    /test-only helper parameterization/i,
  );
  assert.match(
    audit.roadmapDecision.forbiddenImplementationChanges.join("\n"),
    /copy-pasted second live harness/i,
  );
  assert.equal(audit.roadmapDecision.afterD074.next, "D075_OPERATE");

  assert.equal(audit.scores.overallProductFlow, 8.2);
  assert.equal(audit.scores.reusableMultiChildCore, 5.8);
  assert.equal(audit.intentDeviation.fromOriginalMvp, "major_and_explicit");
  assert.equal(audit.intentDeviation.fromPriorRoadmap, "material_and_explicit");
});

test("D074 implementation slice uses one phase-neutral live harness and a Node example", () => {
  const helper = read("tests/helpers/execution-custody-live.js");
  const fluxaraLive = read("tests/runtime-execution-custody-live.test.js");
  const devspaceLive = read("tests/runtime-execution-custody-devspace-live.test.js");
  const genericRuntime = read("tests/runtime-execution-custody.test.js");
  const testRunner = read("scripts/run-tests.js");
  const example = JSON.parse(read(
    ".agents/skills/bounded-repository-change/examples/devspace-dev-server.json",
  ));

  assert.equal(example.schemaVersion, "bounded-repository-change-example/v1");
  assert.equal(example.repository.repositoryId, "devspace");
  assert.equal(example.repository.expectedBaseRevision, "00952c05f01248773a90cd293aed528672eb6f1b");
  assert.equal(example.repository.expectedBaseTree, "65e249664f7146e7bff6c36d530f3de1cd0068e4");
  assert.equal(example.allowedPath, "scripts/dev-server.mjs");
  assert.equal(example.validationCapsule.commandName, "node");
  assert.deepEqual(example.validationCapsule.commands[0].argv, [
    "node", "--check", "scripts/dev-server.mjs",
  ]);
  assert.match(example.objective, /--no-install/);
  assert.match(example.objective, /import-safe/i);
  assert.match(example.objective, /restart/i);
  assert.match(example.objective, /recursive watcher/i);
  assert.match(example.objective, /shutdown/i);
  const semanticValidator = example.validationCapsule.commands[1].argv.join("\n");
  assert.match(semanticValidator, /restartDelayMs/);
  assert.match(semanticValidator, /crashDelayMs/);
  assert.match(semanticValidator, /buildServerCommand/);
  assert.match(semanticValidator, /SIGTERM/);
  assert.match(semanticValidator, /SIGKILL/);
  assert.match(semanticValidator, /watchDirectory/);
  assert.match(semanticValidator, /shutdown/);

  assert.match(helper, /function runLiveCustodyProof/);
  assert.match(helper, /"--depth=1"/);
  assert.match(helper, /tools\.sourcePath/);
  assert.match(helper, /controllerClosedAndProcessExited: true/);
  assert.match(helper, /processExitCode: 0/);
  assert.doesNotMatch(helper, /Fluxara|Python|D073/i);
  assert.match(fluxaraLive, /runLiveCustodyProof/);
  assert.match(devspaceLive, /runLiveCustodyProof/);
  assert.match(devspaceLive, /CUSTODY_LIVE_DEVSPACE/);
  assert.match(devspaceLive, /CUSTODY_NODE_VALIDATION_PATH/);
  assert.match(testRunner, /runtime-execution-custody\(\?:-devspace-live\|-live\|-process-tree\)/);
  assert.match(genericRuntime, /authorization-receipt\.json/);
  assert.match(genericRuntime, /expiresAt/);
  assert.match(genericRuntime, /60_000/);
});

test("D074 pre-candidate audit accepts implementation without claiming live closure", () => {
  const audit = JSON.parse(read("docs/ops/audits/d074-pre-candidate-functional-slice-audit.json"));
  assert.equal(audit.kind, "d074-pre-candidate-functional-slice-audit");
  assert.equal(audit.verdict, "IMPLEMENTATION_AUDIT_ACCEPTED_CANDIDATE_AND_LIVE_PENDING");
  assert.equal(audit.base.commit, "7b487479da03d7add63b9568dba94aa4a35d8e88");
  assert.equal(audit.base.tree, "21cb91f4b03ac46325f29400da8933f79702dd54");
  assert.equal(audit.child.repositoryId, "devspace");
  assert.equal(audit.child.expectedBaseRevision, "00952c05f01248773a90cd293aed528672eb6f1b");
  assert.equal(audit.child.expectedBaseTree, "65e249664f7146e7bff6c36d530f3de1cd0068e4");
  assert.equal(audit.child.allowedPath, "scripts/dev-server.mjs");

  assert.equal(audit.implementation.sharedLiveWorkflow.phaseNeutral, true);
  assert.equal(audit.implementation.sharedLiveWorkflow.containsFluxaraIdentity, false);
  assert.equal(audit.implementation.sharedLiveWorkflow.containsPythonIdentity, false);
  assert.equal(audit.implementation.sharedLiveWorkflow.containsD073Identity, false);
  assert.equal(audit.implementation.expiredReplay.genericRuntimeTestRestored, true);
  assert.equal(audit.implementation.expiredReplay.sharedLiveWorkflowRestored, true);
  assert.equal(audit.implementation.authorityClone.expectedVisibleRevisionCount, 1);
  assert.equal(audit.implementation.authorityClone.remoteExpected, "none");

  assert.equal(audit.auditFinding.id, "D074_VALIDATOR_LIFECYCLE_GAP");
  assert.equal(audit.auditFinding.severity, "blocking_before_candidate");
  assert.equal(audit.auditFinding.resolved, true);
  assert.equal(audit.auditFinding.validatorWeakeningAuthorized, false);
  assert.equal(audit.auditFinding.representativeKnownGoodPass.nodeVersion, "v25.2.1");
  assert.equal(audit.auditFinding.representativeKnownGoodPass.result, "PASS");

  assert.equal(audit.verification.completeNativeSuite.testFiles, 112);
  assert.equal(audit.verification.completeNativeSuite.failed, 0);
  assert.equal(audit.verification.completeNativeSuite.exitCode, 0);
  assert.equal(audit.verification.focusedNative.failed, 0);
  assert.equal(audit.verification.authenticatedLive.devspace, "SKIPPED_UNTIL_CLEAN_IMMUTABLE_META_HARNESS_CANDIDATE");
  assert.equal(audit.claims.implementationAuditAccepted, true);
  assert.equal(audit.claims.candidateCreated, false);
  assert.equal(audit.claims.d074Closed, false);
  assert.equal(audit.claims.devspaceAuthenticatedArtifactObserved, false);
  assert.equal(audit.decision.status, "implementation_audit_accepted_live_pending");
  assert.equal(audit.decision.next, "CREATE_IMMUTABLE_CANDIDATE");
  assert.match(audit.decision.liveRule, /CUSTODY_LIVE_DEVSPACE=1/);
  assert.match(audit.decision.failureRule, /No rerun of the same candidate/i);
  assert.equal(audit.decision.afterClosure, "D075_OPERATE");
  assert.equal(audit.scores.reusableMultiChildCore, 7.4);
  assert.equal(audit.intentDeviation.fromPriorRoadmap, "no_new_direction_change");
});
