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

test("status records the signed D078 S-001R cutover while D077 and D076 remain historical evidence", () => {
  const status = read(".meta-harness/status.md");
  const goal = section(status, "Goal");
  const phase = section(status, "Phase");
  const currentTruth = section(status, "Current truth");
  const nextAction = section(status, "Next action");
  const stopCriteria = section(status, "Stop criteria");
  const decisionLog = read("docs/product/decision-log.md");
  const runtimeHistory = read("docs/product/runtime-authority-architecture.md");
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const d077Snapshot = events.findLast((event) => event.truth_snapshot === true && event.authority === "D077");
  const d078Snapshot = events.findLast((event) => event.truth_snapshot === true && event.authority === "D078");
  const signedCutover = events.findLast((event) => event.authority_receipt?.receipt_id === "D078-S001R-SIGNED-CUTOVER");

  assert.match(goal, /Close S-001R/i);
  assert.match(goal, /ship one real non-fixture coding loop/i);
  assert.match(phase, /verify/i);
  assert.match(currentTruth, /S-001R is implemented in the authorized dirty worktree and remains under verification/i);
  assert.match(currentTruth, /Signed reconciliation rejects the legacy unsigned canonical snapshots/i);
  assert.match(currentTruth, /exact status projection/i);
  assert.doesNotMatch(status, /Last verified:/i);
  assert.ok(d077Snapshot);
  assert.ok(d078Snapshot);
  assert.match(d078Snapshot.evidence, /s001-independent-audit\.json/i);
  assert.match(d078Snapshot.evidence, /intent-v1 sha256/i);
  assert.ok(signedCutover);
  assert.equal(signedCutover.truth_reconciliation, true);
  assert.equal(signedCutover.authority_receipt.capability, "canonical_truth_mutation");
  assert.equal(signedCutover.authority_receipt.proposal.decision, "D078");
  assert.equal(signedCutover.rejected_event_digests.length, 4);
  assert.match(nextAction, /complete supported-runtime suite and independent adversarial audit/i);
  assert.match(nextAction, /do not integrate or start S-006M before acceptance/i);
  assert.match(stopCriteria, /every critical and high D078 finding passes independent review/i);
  assert.doesNotMatch(nextAction, /create a new exact `0\.2\.0` candidate/i);

  assert.match(decisionLog, /## D078: Reject S-001 Closure and Restore Functional-First Order/i);
  assert.match(decisionLog, /## D077: Lock Solo Developer\/Researcher Endgame/i);
  assert.match(decisionLog, /D068–D076 execution-authority and custody results remain frozen lower-layer evidence/i);
  assert.match(runtimeHistory, /D076/i);
  assert.match(runtimeHistory, /ce02548/i);
});

test("CI and active runtime identities are phase-neutral", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /runs-on:\s*ubuntu-latest[\s\S]*?run:\s*npm test/i);
  assert.match(ci, /name:\s*Windows complete suite[\s\S]*?runs-on:\s*windows-latest[\s\S]*?run:\s*npm test/i);
  assert.doesNotMatch(ci, /d0(?:69|70|71|72)-windows|D0(?:69|70|71|72) Windows/i);
  assert.doesNotMatch(read("scripts/run-tests.js"), /runtime-d0(?:70|71|72)/i);

  const activeRuntime = fs.readdirSync(path.join(root, "lib/execution-custody"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => read(`lib/execution-custody/${name}`))
    .join("\n");
  assert.doesNotMatch(activeRuntime, /internal\/d069|ToolLauncher|CheckShortcut|Windows PowerShell|powershell\.exe|validate-toollauncher/i);
  assert.doesNotMatch(activeRuntime, /D0(?:69|70|71|72)|d0(?:69|70|71|72)/);
});

test("roadmap orders closed D073 before D074, D075, closed D076 SHIP, release, and DELETE", () => {
  const rows = roadmapRows();
  const d073 = findRow(rows, /D073|REPLACE\+CLOSE/);
  const d074 = findRow(rows, /D074|PROVE/);
  const operate = findRow(rows, /D075|OPERATE/);
  const ship = findRow(rows, /D076|SHIP/);
  const release = findRow(rows, /^RELEASE$/);
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
  assert.match(d074.state, /closed under `4ad92f0`/i);
  assert.match(d074.detail, /candidate `4ad92f0`/i);
  assert.match(d074.detail, /tree `064689e9`/i);
  assert.match(d074.detail, /112 files with zero failures/i);
  assert.match(d074.detail, /one-revision shallow authority/i);
  assert.match(d074.detail, /child `30ad240b`/i);
  assert.match(d074.detail, /60 seconds after receipt expiry/i);
  assert.match(d074.detail, /unusable tools and zero spawns/i);
  assert.match(d074.detail, /both Node validations exit 0/i);
  assert.match(d074.detail, /leakage PASS across 16 files/i);
  assert.match(d074.detail, /failed candidate `87472e1`/i);
  assert.match(d074.detail, /d074-cross-ecosystem-custody-closure-audit\.json/i);

  assert.match(operate.name, /Private Operator Use Gate/i);
  assert.match(operate.state, /closed under `cd63e52`/i);
  assert.match(operate.detail, /candidate `cd63e52`/i);
  assert.match(operate.detail, /tree `5b15623e`/i);
  assert.match(operate.detail, /113 files with zero failures/i);
  assert.match(operate.detail, /d075-devspace-01/i);
  assert.match(operate.detail, /d075-fluxara-01/i);
  assert.match(operate.detail, /one authenticated spawn/i);
  assert.match(operate.detail, /expiry\+60s zero-spawn REPLAY/i);
  assert.match(operate.detail, /leakage PASS across 16 files/i);
  assert.match(operate.detail, /d075-private-operator-closure-audit\.json/i);
  assert.match(ship.name, /Installed-Package Execution Surface/i);
  assert.match(ship.state, /closed under `ce02548`/i);
  assert.match(ship.detail, /candidate one `5a41b52`/i);
  assert.match(ship.detail, /115 native files/i);
  assert.match(ship.detail, /234-entry package equality/i);
  assert.match(ship.detail, /VERIFIED child `350bf855`/i);
  assert.match(ship.detail, /leakage PASS across 18 portable files/i);
  assert.match(ship.detail, /d076-installed-package-execution-closure-audit\.json/i);
  assert.match(release.name, /Exact-Commit `0\.2\.0` Publication/i);
  assert.match(release.state, /Hosted-Windows repository-containment repair active; new candidate required/i);
  assert.match(release.detail, /D076 closure commit `6893280`/i);
  assert.match(release.detail, /Failed immutable candidates `2a190dd`, `8676afd`, pushed `be6eb58`, pushed `a05fcc5`, and pushed `3482db0` remain preserved/i);
  assert.match(release.detail, /all 116 local native files/i);
  assert.match(release.detail, /remote Linux Node tests, Semgrep, CodeQL/i);
  assert.match(release.detail, /hosted-Windows installed execution custody/i);
  assert.match(release.detail, /reached production judge Git discovery/i);
  assert.match(release.detail, /long `runneradmin` and 8\.3 `RUNNER~1`/i);
  assert.match(release.detail, /existing-directory ancestors for repository containment/i);
  assert.match(release.detail, /9 focused tests on Windows and Linux/i);
  assert.match(release.detail, /116-file native Windows worktree suite in 212\.5 seconds/i);
  assert.match(release.detail, /branch protection/i);
  assert.match(deletion.state + deletion.detail, /unauthorized until post-release consumer evidence/i);
  assert.ok(rows.indexOf(d073) < rows.indexOf(d074));
  assert.ok(rows.indexOf(d074) < rows.indexOf(operate));
  assert.ok(rows.indexOf(operate) < rows.indexOf(ship));
  assert.ok(rows.indexOf(ship) < rows.indexOf(release));
  assert.ok(rows.indexOf(release) < rows.indexOf(deletion));
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
    assert.match(text, /D076/i);
  }
  assert.match(spec, /internal\/execution-custody/i);
  assert.match(architecture, /D073 REPLACE\+CLOSE closed/i);
  assert.match(decisionLog, /D073 closure record/i);
  assert.match(decisionLog, /D073 post-close forward audit/i);
  assert.match(decisionLog, /D074 pre-candidate functional-slice audit/i);
  assert.match(decisionLog, /D074 first immutable candidate live-failure audit/i);
  assert.match(decisionLog, /D074 cross-ecosystem custody closure/i);
  assert.match(decisionLog, /D075 private-operator functional-slice audit/i);
  assert.match(decisionLog, /D075 private-operator repeated-use closure/i);
  assert.match(decisionLog, /D076: Authorize One Installed-Package Execution Surface/i);
  assert.match(prd, /D074 closed under exact candidate `4ad92f0`/i);
  assert.match(spec, /D074 closed under exact candidate `4ad92f0`/i);
  assert.match(architecture, /D074 cross-ecosystem custody proof closed under `4ad92f0`/i);
  assert.match(architecture, /D075 private-operator use closed under `cd63e52`/i);
  assert.match(architecture, /D076 installed-package execution closed under exact repair candidate `ce02548`/i);
  assert.match(architecture, /VERIFIED child `350bf855`/i);
  assert.match(architecture, /RELEASE after D076 closure/i);
  assert.match(decisionLog, /Implementation checkpoint — 2026-07-15/i);
  assert.match(decisionLog, /Closure checkpoint — 2026-07-15/i);
  assert.match(decisionLog, /D076 is closed under exact repair candidate `ce02548/i);
  assert.match(decisionLog, /3f54e3ec4c5aabfd494d5c999de02087a26ce8c4fe2e49a6067416167d6c6b95/i);
  assert.match(decisionLog, /Feature development stops at D076 closure/i);
  assert.match(decisionLog, /Release-preparation checkpoint — 2026-07-15/i);
  assert.match(decisionLog, /68932804fb2563dc849d701aca44f8988385c2bb/i);
  assert.match(decisionLog, /selected pre-1\.0 release version is `0\.2\.0`/i);
  assert.match(decisionLog, /eaf7ed9409e11662f1f4c3cced8a37ae4d251038/i);
  assert.match(decisionLog, /4fedec9dd728114018a6518356833537cfc128bc/i);
  assert.match(decisionLog, /2fc3206628500383d8a61d01b58f8d52fd07f184/i);
  assert.match(decisionLog, /d076-release-preparation-audit\.json/i);
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
    "lib/execution-custody/controller.js",
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

test("D074 first immutable candidate failure audit preserves evidence and authorizes only the verifier repair", () => {
  const audit = JSON.parse(read("docs/ops/audits/d074-candidate-87472e1-live-failure-audit.json"));
  assert.equal(audit.kind, "d074-candidate-live-failure-audit");
  assert.equal(audit.verdict, "IMMUTABLE_CANDIDATE_FAILED_PORTABLE_VERIFIER_REPAIR_AUTHORIZED");
  assert.equal(audit.candidate.commit, "87472e187a8d228bbf0a5b51167bb5969aa4dfb5");
  assert.equal(audit.candidate.tree, "7a447d810905f1ff28b6bf676c602f8b4d3c1cc8");
  assert.equal(audit.nativeSuite.nodeVersion, "v25.2.1");
  assert.equal(audit.nativeSuite.testFiles, 112);
  assert.equal(audit.nativeSuite.failed, 0);
  assert.equal(audit.nativeSuite.exitCode, 0);

  assert.equal(audit.liveGate.exitCode, 1);
  assert.equal(audit.liveGate.failureStage, "independent_portable_verifier_bundle_verify");
  assert.equal(
    audit.liveGate.retainedCustodyRoot,
    ".meta-harness/local/custody/custody-devspace-87472e187a8d-5c3362472026",
  );
  assert.equal(audit.retainedEvidence.childAuthority.headAtPinnedBase, true);
  assert.equal(audit.retainedEvidence.childAuthority.trackedWorktreeClean, true);
  assert.equal(audit.retainedEvidence.childAuthority.visibleRevisionCount, 1);
  assert.equal(audit.retainedEvidence.childAuthority.remoteCount, 0);
  assert.equal(audit.retainedEvidence.process1.agentSpawnOrdinal, 1);
  assert.equal(audit.retainedEvidence.process1.agentExitCode, 0);
  assert.equal(audit.retainedEvidence.process1.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(
    audit.retainedEvidence.process1.verifiedHeadRevision,
    "b821c48548a0ce7faeb1ccbdb97c85af0b44a270",
  );
  assert.deepEqual(audit.retainedEvidence.process1.changedPaths, ["scripts/dev-server.mjs"]);
  assert.equal(audit.retainedEvidence.process2.laterThanAuthorizationExpiry, true);
  assert.equal(audit.retainedEvidence.process2.executionToolPathsUsable, false);
  assert.equal(audit.retainedEvidence.process2.requiredDisposition, "REPLAY");
  assert.equal(audit.retainedEvidence.process2.requiredAgentSpawns, 0);
  assert.equal(audit.retainedEvidence.process2.assertionsPassedBeforeFailure, true);
  assert.equal(audit.retainedEvidence.portableExport.leakageScanPassed, true);
  assert.equal(audit.retainedEvidence.portableExport.scannedFiles, 16);

  assert.equal(audit.rootCause.classification, "test_verifier_portability_defect");
  assert.equal(audit.rootCause.productionRuntimeDefect, false);
  assert.equal(audit.rootCause.modelOutputDefect, false);
  assert.equal(audit.rootCause.validationCapsuleDefect, false);
  assert.equal(audit.diagnostic.sameRetainedBundleBeforeBaseRef.bundleVerifyExitCode, 1);
  assert.equal(audit.diagnostic.sameRetainedBundleAfterBaseRef.bundleVerifyExitCode, 0);
  assert.equal(audit.boundedRepair.files.length, 2);
  assert.equal(audit.boundedRepair.productionFilesChanged, false);
  assert.equal(audit.boundedRepair.validatorChanged, false);
  assert.equal(audit.repairVerification.focusedRegression.failed, 0);
  assert.equal(audit.repairVerification.retainedExportReverification.agentRerun, false);
  assert.equal(audit.repairVerification.retainedExportReverification.controllerRerun, false);
  assert.deepEqual(audit.repairVerification.retainedExportReverification.validationExitCodes, [0, 0]);
  assert.equal(audit.repairVerification.retainedExportReverification.leakage, "PASS");
  assert.equal(audit.repairVerification.completeNativeSuite.status, "PASS");
  assert.equal(audit.repairVerification.completeNativeSuite.nodeVersion, "v25.2.1");
  assert.equal(audit.repairVerification.completeNativeSuite.testFiles, 112);
  assert.equal(audit.repairVerification.completeNativeSuite.failed, 0);
  assert.equal(audit.repairVerification.completeNativeSuite.exitCode, 0);
  assert.equal(audit.repairVerification.completeNativeSuite.worktreeStatusUnchanged, true);
  assert.equal(audit.claims.endToEndLiveGatePassed, false);
  assert.equal(audit.claims.d074Closed, false);
  assert.equal(audit.claims.newCandidateRequired, true);
  assert.equal(audit.decision.rerunFailedCandidateAuthorized, false);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.afterClosure, "D075_OPERATE");
});

test("D074 closure audit binds the exact repair candidate, live replay, and portable evidence", () => {
  const audit = JSON.parse(read("docs/ops/audits/d074-cross-ecosystem-custody-closure-audit.json"));
  assert.equal(audit.kind, "d074-cross-ecosystem-custody-closure-audit");
  assert.equal(audit.verdict, "CROSS_ECOSYSTEM_CUSTODY_PROOF_CLOSED");
  assert.equal(audit.decision.id, "D074");
  assert.equal(audit.decision.status, "closed");
  assert.equal(
    audit.decision.closedUnderCandidate,
    "4ad92f0bf0643a48bb90ab86ee3fe7f9fd31184b",
  );
  assert.equal(audit.decision.candidateTree, "064689e945889c1ee2d5b4a132d6c7a12cf2d706");
  assert.equal(audit.decision.next, "D075_OPERATE");
  assert.equal(audit.decision.publicExecutionSurfaceAuthorized, false);
  assert.equal(audit.decision.compatibilityAuthorized, false);
  assert.equal(audit.decision.providerRegistryAuthorized, false);
  assert.equal(audit.decision.broadDeletionAuthorized, false);

  assert.equal(audit.failedCandidateHistory.candidate, "87472e187a8d228bbf0a5b51167bb5969aa4dfb5");
  assert.equal(audit.failedCandidateHistory.immutable, true);
  assert.equal(audit.failedCandidateHistory.rerun, false);
  assert.equal(audit.failedCandidateHistory.amended, false);
  assert.equal(audit.implementationCandidate.pathCount, 9);
  assert.equal(audit.implementationCandidate.trackedWorktreeCleanAfterSuite, true);
  assert.equal(audit.implementationCandidate.trackedWorktreeCleanAfterLiveGate, true);
  assert.equal(audit.implementationCandidate.productionRuntimeChanged, false);
  assert.equal(audit.implementationCandidate.publicSurfaceChanged, false);

  assert.equal(audit.candidateSuite.nodeVersion, "v25.2.1");
  assert.equal(audit.candidateSuite.testFiles, 112);
  assert.equal(audit.candidateSuite.failed, 0);
  assert.equal(audit.candidateSuite.exitCode, 0);
  assert.equal(audit.liveGate.exitCode, 0);
  assert.equal(audit.liveGate.environment.CUSTODY_LIVE, "unset");
  assert.equal(audit.liveGate.environment.CUSTODY_LIVE_DEVSPACE, "1");
  assert.equal(audit.liveGate.environment.CUSTODY_LIVE_FLUXARA, "unset");

  assert.equal(audit.childAuthority.baseRevision, "00952c05f01248773a90cd293aed528672eb6f1b");
  assert.equal(audit.childAuthority.baseTree, "65e249664f7146e7bff6c36d530f3de1cd0068e4");
  assert.equal(audit.childAuthority.primaryCloneTrackedWorktreeClean, true);
  assert.equal(audit.childAuthority.visibleRevisionCount, 1);
  assert.equal(audit.childAuthority.remoteCount, 0);
  assert.equal(audit.childAuthority.workingTreeBytesUsedAsAuthority, false);

  assert.equal(audit.process1.processExitCode, 0);
  assert.equal(audit.process1.controllerClosedAndProcessExited, true);
  assert.equal(audit.process1.disposition, "VERIFIED");
  assert.equal(audit.process1.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(audit.process1.agentSpawnCount, 1);
  assert.equal(audit.process1.agentExitCode, 0);
  assert.equal(audit.process1.agentTimedOut, false);
  assert.equal(
    audit.process1.verifiedHeadRevision,
    "30ad240b0b709cd330132b978e096ccbc7620c1a",
  );
  assert.equal(audit.process1.resultParent, "00952c05f01248773a90cd293aed528672eb6f1b");
  assert.deepEqual(audit.process1.changedPaths, ["scripts/dev-server.mjs"]);
  assert.equal(
    audit.process1.durableRefTarget,
    "30ad240b0b709cd330132b978e096ccbc7620c1a",
  );

  assert.equal(audit.process2.secondsAfterAuthorizationExpiry, 60);
  assert.equal(audit.process2.laterThanAuthorizationExpiry, true);
  assert.equal(audit.process2.processExitCode, 0);
  assert.equal(audit.process2.controllerClosedAndProcessExited, true);
  assert.equal(audit.process2.disposition, "REPLAY");
  assert.equal(audit.process2.agentSpawnCount, 0);
  assert.equal(audit.process2.executionToolPathsUsable, false);
  assert.equal(audit.process2.validationToolPathUsable, false);
  assert.equal(audit.process2.verifiedHeadUnchanged, true);
  assert.equal(audit.process2.terminalManifestUnchanged, true);

  assert.equal(audit.portable.independentVerificationPassed, true);
  assert.equal(audit.portable.independentResultCommit, "30ad240b0b709cd330132b978e096ccbc7620c1a");
  assert.equal(audit.portable.independentParent, "00952c05f01248773a90cd293aed528672eb6f1b");
  assert.deepEqual(audit.portable.independentChangedPaths, ["scripts/dev-server.mjs"]);
  assert.deepEqual(audit.portable.validation.map((entry) => entry.exitCode), [0, 0]);
  assert.equal(audit.portable.leakageScanPassed, true);
  assert.equal(audit.portable.scannedFiles, 16);
  assert.deepEqual(audit.portable.findings, []);

  assert.equal(audit.repairConfirmation.shallowPrerequisiteAnchoredAt, "refs/verify/base");
  assert.equal(audit.repairConfirmation.failedCandidateRetainedExportReverifiedBeforeNewCandidate, true);
  assert.equal(audit.repairConfirmation.newCandidateIndependentVerificationPassed, true);
  assert.equal(audit.repairConfirmation.sameFailureDidNotRecur, true);
  assert.equal(audit.repairConfirmation.validatorWeakened, false);
  assert.equal(audit.claims.crossEcosystemReuseProved, true);
  assert.equal(audit.claims.expiredFreshProcessReplayProved, true);
  assert.equal(audit.claims.zeroSpawnReplayProved, true);
  assert.equal(audit.claims.portableNodeValidationProved, true);
  assert.equal(audit.claims.leakagePassProved, true);
  assert.equal(audit.claims.exhaustiveDevServerLifecycleCertification, false);
  assert.equal(audit.claims.d074Closed, true);
});

test("D075 audit binds the private operator boundary and repeated-use closure gate", () => {
  const audit = JSON.parse(read("docs/ops/audits/d075-private-operator-functional-slice-audit.json"));
  assert.equal(audit.kind, "d075-private-operator-functional-slice-audit");
  assert.equal(
    audit.verdict,
    "IMPLEMENTATION_ACCEPTED_IMMUTABLE_CANDIDATE_AND_REPEATED_OPERATOR_USE_REQUIRED",
  );
  assert.equal(audit.decision.id, "D075");
  assert.equal(audit.decision.status, "open_implementation_accepted");
  assert.equal(audit.decision.next, "CREATE_IMMUTABLE_OPERATOR_CANDIDATE");
  assert.equal(audit.decision.afterClosure, "DECIDE_PUBLIC_EXECUTION_SURFACE");
  assert.equal(audit.decision.deleteBlockedUntilDecision, true);

  assert.equal(audit.intent.functionalSliceFirst, true);
  assert.equal(audit.intent.minimalGovernance, true);
  assert.equal(audit.intent.publicCliAuthorized, false);
  assert.equal(audit.intent.packageScriptAuthorized, false);
  assert.equal(audit.intent.providerRegistryAuthorized, false);
  assert.equal(audit.intent.compatibilityAuthorized, false);
  assert.equal(audit.intent.concurrencyFrameworkAuthorized, false);
  assert.equal(audit.intent.broadDeletionAuthorized, false);

  assert.equal(audit.base.commit, "8d0ee959d4de8b70ffca86189db22e87f84e9947");
  assert.equal(audit.base.tree, "faa7746f77facb90cc99f44b586b5478271bb794");
  assert.equal(audit.implementation.pathCountBeforeTruthAlignment, 10);
  assert.equal(audit.implementation.productionOwned.length, 4);
  assert.equal(audit.implementation.testAdapters.length, 3);
  assert.equal(audit.implementation.testAdapters[0].linesBefore, 542);
  assert.equal(audit.implementation.testAdapters[0].linesAfter, 220);

  assert.equal(audit.operatorContract.requestSchema, "execution-custody-operator-request/v1");
  assert.equal(audit.operatorContract.receiptSchema, "execution-custody-operator-receipt/v1");
  assert.equal(audit.operatorContract.requestIsPortableAuthority, false);
  assert.equal(audit.operatorContract.requestByteDigestBoundAtStart, true);
  assert.equal(audit.operatorContract.cleanImmutableCandidateRequiredBeforeRootCreation, true);
  assert.equal(audit.operatorContract.candidateCommitTreeAndCleanlinessRecheckedAfterOperation, true);
  assert.equal(audit.operatorContract.registeredInBin, false);
  assert.equal(audit.operatorContract.registeredInPackageScripts, false);
  assert.equal(audit.operatorContract.exportedAsPackageApi, false);

  assert.equal(audit.focusedVerification.nodeVersion, "v25.2.1");
  assert.equal(audit.focusedVerification.passed, 17);
  assert.equal(audit.focusedVerification.skipped, 2);
  assert.equal(audit.focusedVerification.failed, 0);
  assert.equal(audit.baselineCompleteSuite.testFiles, 113);
  assert.equal(audit.baselineCompleteSuite.failed, 0);
  assert.equal(audit.baselineCompleteSuite.exitCode, 0);
  assert.equal(audit.baselineCompleteSuite.closureCredit, false);

  assert.equal(audit.bindingReadiness.devspace.readyForCandidateOperation, true);
  assert.equal(audit.bindingReadiness.fluxara.pythonVersion, "3.14.4");
  assert.equal(audit.bindingReadiness.fluxara.sealedImportProbe, "PASS");
  assert.equal(audit.bindingReadiness.fluxara.readyForCandidateOperation, true);
  assert.equal(audit.operatorFrictionObservedBeforeCandidate[0].operatorSeamDefect, false);
  assert.equal(audit.operatorFrictionObservedBeforeCandidate[0].correctedResult, "PASS");

  assert.equal(audit.frozenSurfaces.bin, true);
  assert.equal(audit.frozenSurfaces.packageJson, true);
  assert.equal(audit.frozenSurfaces.contractKernel, true);
  assert.equal(audit.frozenSurfaces.skill, true);
  assert.equal(audit.remainingGate.finalTruthAlignedSuiteRequired, true);
  assert.equal(audit.remainingGate.immutableCandidateRequired, true);
  assert.equal(audit.remainingGate.candidateMustNotBeAmended, true);
  assert.equal(audit.remainingGate.candidateSuiteExpectedFiles, 113);
  assert.deepEqual(
    audit.remainingGate.operations.map((entry) => entry.operationId),
    ["d075-devspace-01", "d075-fluxara-01"],
  );
  assert.equal(audit.claims.privateOperatorImplementationAccepted, true);
  assert.equal(audit.claims.operatorUsableOutsideTests, true);
  assert.equal(audit.claims.testsUseSameProductionOperatorWorkflow, true);
  assert.equal(audit.claims.publicExecutionSurfaceExists, false);
  assert.equal(audit.claims.repeatedRealOperatorUseProved, false);
  assert.equal(audit.claims.d075Closed, false);
});

test("D075 closure audit binds the exact candidate and both retained operator receipts", () => {
  const audit = JSON.parse(read("docs/ops/audits/d075-private-operator-closure-audit.json"));
  assert.equal(audit.kind, "d075-private-operator-closure-audit");
  assert.equal(audit.verdict, "PRIVATE_OPERATOR_REPEATED_USE_CLOSED");
  assert.equal(audit.decision.id, "D075");
  assert.equal(audit.decision.status, "closed");
  assert.equal(audit.decision.closedUnderCandidate, "cd63e5295b8bbde1afaf1ab5d991aadc13cc0442");
  assert.equal(audit.decision.candidateTree, "5b15623e7646da18e2417bd38767ff3f5be54547");
  assert.equal(audit.decision.next, "DECIDE_PUBLIC_EXECUTION_SURFACE");
  assert.equal(audit.decision.publicExecutionSurfaceAuthorized, false);
  assert.equal(audit.decision.broadDeletionAuthorized, false);
  assert.equal(audit.decision.deleteBlockedUntilDecision, true);

  assert.equal(audit.candidateSuite.nodeVersion, "v25.2.1");
  assert.equal(audit.candidateSuite.testFiles, 113);
  assert.equal(audit.candidateSuite.failed, 0);
  assert.equal(audit.candidateSuite.exitCode, 0);
  assert.equal(audit.closureVerification.focused.nodeVersion, "v25.2.1");
  assert.equal(audit.closureVerification.focused.tests, 21);
  assert.equal(audit.closureVerification.focused.passed, 19);
  assert.equal(audit.closureVerification.focused.skipped, 2);
  assert.equal(audit.closureVerification.focused.failed, 0);
  assert.equal(audit.closureVerification.focused.eventsJsonlRecords, 59);
  assert.equal(audit.closureVerification.focused.gitDiffCheck, "PASS");
  assert.equal(audit.closureVerification.completeNativeSuite.testFiles, 113);
  assert.equal(audit.closureVerification.completeNativeSuite.failed, 0);
  assert.equal(audit.closureVerification.completeNativeSuite.exitCode, 0);
  assert.equal(audit.closureVerification.completeNativeSuite.worktreeStatusUnchanged, true);
  assert.equal(audit.closureVerification.completeNativeSuite.candidateIdentityUnchanged, true);
  assert.equal(audit.closureVerification.finalDurableResultUsed, true);
  assert.equal(audit.candidate.trackedWorktreeCleanBeforeBothOperations, true);
  assert.equal(audit.candidate.trackedWorktreeCleanAfterBothOperations, true);
  assert.equal(audit.candidate.identityUnchangedAcrossSuiteAndOperations, true);

  assert.deepEqual(audit.operations.map((entry) => entry.operationId), [
    "d075-devspace-01",
    "d075-fluxara-01",
  ]);
  const [devspace, fluxara] = audit.operations;
  assert.equal(devspace.ecosystem, "DevSpace/Node");
  assert.equal(devspace.authority.visibleRevisionCount, 1);
  assert.equal(devspace.authority.remoteCount, 0);
  assert.equal(devspace.process1.disposition, "VERIFIED");
  assert.equal(devspace.process1.agentSpawnCount, 1);
  assert.equal(devspace.process1.verifiedHeadRevision, "47c0d01671d6d69a9a9cc3f097f99ce9300fb74e");
  assert.equal(devspace.process2.disposition, "REPLAY");
  assert.equal(devspace.process2.secondsAfterAuthorizationExpiry, 60);
  assert.equal(devspace.process2.agentSpawnCount, 0);
  assert.equal(devspace.portable.independentVerificationPassed, true);
  assert.deepEqual(devspace.portable.validationExitCodes, [0, 0]);
  assert.equal(devspace.portable.leakageScanPassed, true);
  assert.equal(devspace.portable.scannedFiles, 16);

  assert.equal(fluxara.ecosystem, "Fluxara/Python");
  assert.equal(fluxara.authority.visibleRevisionCount, 1);
  assert.equal(fluxara.authority.remoteCount, 0);
  assert.equal(fluxara.process1.disposition, "VERIFIED");
  assert.equal(fluxara.process1.agentSpawnCount, 1);
  assert.equal(fluxara.process1.verifiedHeadRevision, "c00326698c19e7cc096f45eca78ea0b54bb8e535");
  assert.equal(fluxara.process2.disposition, "REPLAY");
  assert.equal(fluxara.process2.secondsAfterAuthorizationExpiry, 60);
  assert.equal(fluxara.process2.agentSpawnCount, 0);
  assert.equal(fluxara.portable.independentVerificationPassed, true);
  assert.deepEqual(fluxara.portable.validationExitCodes, [0, 0]);
  assert.equal(fluxara.portable.leakageScanPassed, true);
  assert.equal(fluxara.portable.scannedFiles, 16);

  assert.equal(audit.operatorFriction.every((entry) => entry.operatorSeamDefect === false), true);
  assert.equal(audit.claims.repeatedRealOperatorUseProved, true);
  assert.equal(audit.claims.twoValidationEcosystemsProved, true);
  assert.equal(audit.claims.publicExecutionSurfaceExists, false);
  assert.equal(audit.claims.providerRegistryExists, false);
  assert.equal(audit.claims.compatibilityPathExists, false);
  assert.equal(audit.claims.d075Closed, true);
});

test("D076 decision audit rejects wrapper-only closure and binds the installed-package slice", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-public-execution-surface-decision-audit.json"));
  assert.equal(audit.kind, "d076-public-execution-surface-decision-audit");
  assert.equal(audit.verdict, "AUTHORIZE_INSTALLED_PACKAGE_EXECUTION_SLICE");
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.status, "authorized");
  assert.equal(audit.decision.replacesGate, "DECIDE_PUBLIC_EXECUTION_SURFACE");
  assert.equal(audit.decision.publicCommand, "meta-harness execute --request <absolute-path> [--json]");
  assert.equal(audit.decision.sourceCheckoutWrapperAcceptedAsClosure, false);
  assert.equal(audit.decision.installedPackageFunctionalSliceRequired, true);
  assert.equal(audit.decision.publicImplementationAuthorized, true);
  assert.equal(audit.decision.broadDeletionAuthorized, false);
  assert.equal(audit.decision.compatibilityAuthorized, false);
  assert.equal(audit.decision.providerRegistryAuthorized, false);
  assert.equal(audit.closureAudit.d075ClosureValid, true);
  assert.equal(audit.closureAudit.closureCommit, "9e42b750fdac11f2747a5e81749056db5bae65ed");
  assert.equal(audit.closureAudit.candidate, "cd63e5295b8bbde1afaf1ab5d991aadc13cc0442");
  assert.equal(audit.closureAudit.operatorReceiptHashesMatch, true);
  assert.equal(audit.forwardAudit.publicCommandCountBeforeD076, 27);
  assert.equal(audit.forwardAudit.fixtureOnlyBoundary.present, true);
  assert.equal(audit.forwardAudit.sourceCheckoutBoundary.present, true);
  assert.equal(audit.forwardAudit.packageBoundary.present, true);
  assert.deepEqual(audit.forwardAudit.packageBoundary.excludedRequiredRoots, [
    "internal/", "scripts/", ".agents/",
  ]);
  assert.equal(audit.d076FunctionalSlice.publicSurface.additionalTopLevelCommandsBeyondExecute, 0);
  assert.equal(audit.d076FunctionalSlice.publicSurface.aliases.length, 0);
  assert.equal(audit.d076FunctionalSlice.closureGate.isolatedPackInstallRequired, true);
  assert.equal(audit.d076FunctionalSlice.closureGate.authenticatedLiveOperationRequired, true);
  assert.equal(audit.d076FunctionalSlice.closureGate.novelRequestRequired, true);
  assert.equal(audit.d076FunctionalSlice.closureGate.separateClosureCommitRequired, true);
  assert.equal(audit.roadmapDecision.aggressiveChange, true);
  assert.equal(audit.currentScore.installedPublicExecutionUsability, 2.0);
  assert.equal(audit.intentDeviation.silentDrift, false);
  assert.match(audit.nextAction, /Implement D076/i);
});

test("D076 installed functional-slice audit binds the candidate-ready package and remaining live gate", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-installed-execution-functional-slice-audit.json"));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => entry.phase === "D076-installed-execution-functional-slice");
  assert.ok(event);

  assert.equal(audit.kind, "d076-installed-execution-functional-slice-audit");
  assert.equal(
    audit.verdict,
    "IMPLEMENTATION_AUDIT_ACCEPTED_CANDIDATE_AND_AUTHENTICATED_CLOSURE_PENDING",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.authorizationCommit, "1c5f4fb5b2275f51fa9c84491f17b6bf539bdbb3");
  assert.equal(audit.decision.authorizationTree, "82e18fd203d75624d11bee6f3efab2cf4029e69a");
  assert.equal(audit.decision.publicCommand, "meta-harness execute --request <absolute-path> [--json]");
  assert.equal(audit.decision.additionalTopLevelCommandsBeyondExecute, 0);
  assert.deepEqual(audit.decision.aliases, []);
  assert.equal(audit.decision.compatibilityAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.candidateCreated, false);
  assert.equal(audit.decision.authenticatedClosureComplete, false);

  assert.equal(audit.implementation.runtimeRoot, "lib/execution-custody");
  assert.equal(audit.implementation.requestSchema, "meta-harness-execution-request/v1");
  assert.equal(audit.implementation.receiptSchema, "meta-harness-execution-receipt/v1");
  assert.equal(audit.implementation.resultSchema, "meta-harness-execute-result/v1");
  assert.equal(audit.implementation.privateSchemasAccepted, false);
  assert.equal(audit.implementation.forwardingModulesPresent, false);
  assert.equal(audit.implementation.exampleAdaptersPresent, false);
  assert.equal(audit.implementation.sourceCheckoutRuntimeDependency, false);
  assert.equal(audit.implementation.metaHarnessGitDependency, false);
  assert.equal(audit.implementation.requestBindings.expectedNodeSha256, true);
  assert.equal(audit.implementation.requestBindings.expectedLauncherSha256, true);
  assert.equal(audit.implementation.requestBindings.expectedNativeSha256, true);
  assert.equal(audit.implementation.requestBindings.expectedValidationExecutableSha256, true);
  assert.equal(audit.implementation.preMutationValidation.onlyFinalCustodyRootCreated, true);
  assert.equal(audit.implementation.runtimeChain.independentVerifierRechecksValidationExecutableHash, true);
  assert.equal(audit.implementation.runtimeChain.receiptPublicationNoReplace, true);

  assert.equal(audit.installedFunctionalProof.result, "PASS");
  assert.equal(audit.installedFunctionalProof.nodeVersion, "v25.2.1");
  assert.equal(
    audit.installedFunctionalProof.sourceRepository.baseRevision,
    "50a43744eaeab5c911c7da64ca57be82467e4517",
  );
  assert.equal(
    audit.installedFunctionalProof.sourceRepository.baseTree,
    "3182da2658678d973bad253d3a95cdd66185e006",
  );
  assert.equal(audit.installedFunctionalProof.sourceRepository.allowedPath, "src/message.js");
  assert.equal(audit.installedFunctionalProof.sourceRepository.workingTreeDirtyBeforeExecution, true);
  assert.equal(audit.installedFunctionalProof.sourceRepository.headAndDirtyStatusUnchangedAfterExecution, true);
  assert.equal(
    audit.installedFunctionalProof.fakeToolIdentities.nodeSha256,
    "91ec09dda8f20556f366110859f106ab189d45f8f6a2bd092e6785174ad4a0fa",
  );
  assert.equal(
    audit.installedFunctionalProof.fakeToolIdentities.launcherSha256,
    "38cad8e8c89aae8a4aace2fa7c5291975d2198c8b3e509665ed28e4079385d8d",
  );
  assert.equal(
    audit.installedFunctionalProof.fakeToolIdentities.nativeSha256,
    "8424ff7254f131dd085898e89ef9c8f09d033b48aee7d661fbbf87f9aeabc448",
  );
  assert.equal(audit.installedFunctionalProof.outcome.processOneDisposition, "VERIFIED");
  assert.equal(audit.installedFunctionalProof.outcome.processOneAgentSpawnCount, 1);
  assert.equal(audit.installedFunctionalProof.outcome.processTwoDisposition, "REPLAY");
  assert.equal(audit.installedFunctionalProof.outcome.processTwoAgentSpawnCount, 0);
  assert.equal(audit.installedFunctionalProof.outcome.processTwoSecondsAfterAuthorizationExpiry, 60);
  assert.equal(audit.installedFunctionalProof.outcome.leakage, "PASS");

  assert.equal(audit.testEvidence.discoveredTestFiles, 115);
  assert.equal(audit.testEvidence.failedTestFiles, 0);
  assert.equal(audit.testEvidence.exitCode, 0);
  assert.equal(audit.packageEvidence.dryRunEntries, 234);
  assert.equal(audit.packageEvidence.actualTarballEntries, 234);
  assert.equal(audit.packageEvidence.dryRunActualEquality, true);
  assert.equal(audit.packageEvidence.releasePackageChecks.tarballSmoke, "PASS");
  assert.equal(audit.packageEvidence.releasePackageChecks.installedOnlyModuleResolution, "PASS");
  assert.equal(audit.packageEvidence.releasePackageChecks.executeUsageCount, 1);
  assert.equal(audit.remainingGate.immutableCandidateRequired, true);
  assert.equal(audit.remainingGate.authenticatedNovelInstalledOperationRequired, true);
  assert.equal(audit.remainingGate.separateClosureCommitRequired, true);
  assert.equal(audit.remainingGate.featureExpansionAuthorized, false);
  assert.equal(audit.remainingGate.deleteAuthorized, false);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /create the immutable candidate once/i);
});

test("D076 first immutable candidate failure preserves exact evidence and authorizes only Windows long-path repair", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-candidate-5a41b52-live-failure-audit.json"));
  assert.equal(audit.kind, "d076-candidate-live-failure-audit");
  assert.equal(audit.verdict, "IMMUTABLE_CANDIDATE_FAILED_WINDOWS_LONG_PATH_REPAIR_AUTHORIZED");
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.status, "open_new_candidate_required");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.rerunFailedCustodyRootAuthorized, false);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);

  assert.equal(audit.candidate.commit, "5a41b52a114a47cf1269ae274ab55688ac81fc05");
  assert.equal(audit.candidate.tree, "d8840242b3cedc700af413ce232f53d892eda3f8");
  assert.equal(audit.candidate.trackedWorktreeCleanBeforeValidation, true);
  assert.equal(audit.candidate.trackedWorktreeCleanAfterFailure, true);
  assert.equal(audit.candidateValidation.testFiles, 115);
  assert.equal(audit.candidateValidation.failedTestFiles, 0);
  assert.equal(audit.candidateValidation.packlistsEqual, true);
  assert.equal(
    audit.candidateValidation.tarballSha256,
    "8dd768c797349b1fec20cdf54ca823f733e7d2e2c6fb59c28d18be8895521d92",
  );

  assert.equal(
    audit.liveGate.requestSha256,
    "ecb57575ba1eb548f917f973bc9a2837cb1d803303ab5f3d26d2d4e89bb0a72a",
  );
  assert.equal(audit.liveGate.sourceRepository.repositoryId, "leningrad-d076-installed-live");
  assert.equal(
    audit.liveGate.sourceRepository.baseRevision,
    "56797f45367b7b8fa115f1e874c5d618edaf9226",
  );
  assert.equal(
    audit.liveGate.sourceRepository.baseTree,
    "f4108436d2be59383efb216777afe3b92cbf375d",
  );
  assert.equal(audit.liveGate.sourceRepository.allowedPath, "README.md");
  assert.equal(
    audit.liveGate.sourceRepository.statusSha256After,
    audit.liveGate.sourceRepository.statusSha256Before,
  );
  assert.equal(audit.liveGate.sourceRepository.headUnchanged, true);
  assert.equal(audit.liveGate.sourceRepository.treeUnchanged, true);
  assert.equal(audit.liveGate.failure.exitCode, 1);
  assert.equal(audit.liveGate.failure.errorCode, "CUSTODY_GIT_FAILED");
  assert.equal(audit.liveGate.failure.stage, "create_custody_authority_reset_hard");
  assert.equal(
    audit.liveGate.failure.classification,
    "windows_committed_long_path_materialization_failure",
  );
  assert.equal(audit.liveGate.retainedFailureEvidence.failedCustodyRootExists, true);
  assert.equal(audit.liveGate.retainedFailureEvidence.publicReceiptExists, false);
  assert.equal(audit.liveGate.retainedFailureEvidence.rootMustNotBeReused, true);

  assert.equal(audit.rootCause.classification, "packaged_runtime_windows_git_configuration_defect");
  assert.equal(audit.rootCause.productionRuntimeDefect, true);
  assert.equal(audit.rootCause.modelOutputDefect, false);
  assert.equal(audit.rootCause.requestDefect, false);
  assert.equal(audit.boundedRepair.files.length, 3);
  assert.equal(audit.boundedRepair.requestContractChanged, false);
  assert.equal(audit.boundedRepair.receiptContractChanged, false);
  assert.equal(audit.boundedRepair.publicCliChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.repairVerification.installedLongPathRegression.failed, 0);
  assert.equal(audit.repairVerification.installedLongPathRegression.authorityLongPathMaterialized, true);
  assert.equal(audit.repairVerification.installedLongPathRegression.independentVerifierLongPathMaterialized, true);
  assert.equal(audit.repairVerification.completeNativeSuite.testFiles, 115);
  assert.equal(audit.repairVerification.completeNativeSuite.failedTestFiles, 0);
  assert.equal(audit.claims.candidateOneLiveGatePassed, false);
  assert.equal(audit.claims.sourceRepositoryMutated, false);
  assert.equal(audit.claims.failedRootPreserved, true);
  assert.equal(audit.claims.newCandidateRequired, true);
  assert.equal(audit.claims.d076Closed, false);
});

test("D076 closure audit binds the repaired candidate, installed live chain, and release freeze", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-installed-package-execution-closure-audit.json"));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => entry.phase === "D076-installed-package-execution-closure");
  assert.ok(event);

  assert.equal(audit.kind, "d076-installed-package-execution-closure-audit");
  assert.equal(audit.verdict, "D076_INSTALLED_PACKAGE_EXECUTION_CLOSED");
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.status, "closed");
  assert.equal(
    audit.decision.closedUnderCandidate,
    "ce02548b9db9ed6fea904e0e146906fab6cba773",
  );
  assert.equal(audit.decision.candidateTree, "9dbd5dd7d8075ce1b037171ea886c722b013fbc7");
  assert.equal(audit.decision.featureDevelopmentFrozenAfterClosure, true);
  assert.equal(audit.decision.publishBeforeDelete, true);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.compatibilityAuthorized, false);
  assert.equal(audit.decision.providerOrWorkflowFrameworkAuthorized, false);

  assert.equal(
    audit.candidateHistory.firstImplementationCandidate.commit,
    "5a41b52a114a47cf1269ae274ab55688ac81fc05",
  );
  assert.equal(audit.candidateHistory.firstImplementationCandidate.immutable, true);
  assert.equal(audit.candidateHistory.firstImplementationCandidate.liveGatePassed, false);
  assert.equal(audit.candidateHistory.firstImplementationCandidate.failedRootPreserved, true);
  assert.equal(
    audit.candidateHistory.repairCandidate.commit,
    "ce02548b9db9ed6fea904e0e146906fab6cba773",
  );
  assert.equal(audit.candidateHistory.repairCandidate.parent, "5a41b52a114a47cf1269ae274ab55688ac81fc05");
  assert.equal(audit.candidateHistory.repairCandidate.immutable, true);

  assert.equal(audit.candidateValidation.nodeVersion, "v25.2.1");
  assert.equal(audit.candidateValidation.testFiles, 115);
  assert.equal(audit.candidateValidation.failedTestFiles, 0);
  assert.equal(audit.candidateValidation.exitCode, 0);
  assert.equal(audit.candidateValidation.installedLongPathRegressionPassed, true);
  assert.equal(audit.candidateValidation.gitDiffCheck, "PASS");

  assert.equal(
    audit.packageEvidence.tarballSha256,
    "3f54e3ec4c5aabfd494d5c999de02087a26ce8c4fe2e49a6067416167d6c6b95",
  );
  assert.equal(audit.packageEvidence.tarballBytes, 476616);
  assert.equal(audit.packageEvidence.dryRunEntries, 234);
  assert.equal(audit.packageEvidence.actualTarballEntries, 234);
  assert.equal(audit.packageEvidence.dryRunActualEquality, true);
  assert.equal(audit.packageEvidence.installedWithIgnoreScripts, true);
  assert.equal(audit.packageEvidence.installedGitDirectoryPresent, false);
  assert.equal(audit.packageEvidence.installedInternalRootPresent, false);
  assert.equal(audit.packageEvidence.installedScriptsRootPresent, false);
  assert.equal(audit.packageEvidence.installedAgentsRootPresent, false);
  assert.equal(audit.packageEvidence.executeUsageCount, 1);
  assert.equal(audit.packageEvidence.runtimeResolvedFromInstalledPackage, true);
  assert.equal(audit.packageEvidence.metaHarnessCheckoutPathObservedInCustodyEvidence, false);

  assert.equal(audit.liveRequest.executionId, "d076-leningrad-ce02548-live");
  assert.equal(
    audit.liveRequest.requestSha256,
    "aa98fdf14f5800e7413e2094d6767421db62af76fbc700526b6060f0b7091073",
  );
  assert.equal(
    audit.liveRequest.runSpecDigest,
    "sha256:a9b961c2009ac3e6ef0a69ce2aa7567b76256f871da2d63e456344b012fe6397",
  );
  assert.equal(
    audit.liveRequest.repository.baseRevision,
    "56797f45367b7b8fa115f1e874c5d618edaf9226",
  );
  assert.equal(
    audit.liveRequest.repository.baseTree,
    "f4108436d2be59383efb216777afe3b92cbf375d",
  );
  assert.equal(audit.liveRequest.repository.allowedPath, "README.md");
  assert.equal(audit.liveRequest.repository.dirtyStatusLinesBeforeAndAfter, 141);
  assert.equal(
    audit.liveRequest.repository.dirtyStatusSha256After,
    audit.liveRequest.repository.dirtyStatusSha256Before,
  );
  assert.equal(audit.liveRequest.repository.headTreeAndDirtyStatusUnchanged, true);
  assert.equal(audit.liveRequest.toolIdentities.observedAgentVersion, "0.144.1");

  assert.equal(
    audit.liveOutcome.resultSha256,
    "214c9fae2245629287673d0231317ddbf7257eed9831e8985e742d9d4c6881c2",
  );
  assert.equal(
    audit.liveOutcome.receiptSha256,
    "2687b4ef286827defe4899c67ab35e0b814d77e3ef4b2c22c1450ea0827c1c07",
  );
  assert.equal(audit.liveOutcome.authority.trackedWorktreeClean, true);
  assert.equal(audit.liveOutcome.authority.visibleRevisionCount, 1);
  assert.equal(audit.liveOutcome.authority.remoteCount, 0);
  assert.equal(audit.liveOutcome.process1.disposition, "VERIFIED");
  assert.equal(audit.liveOutcome.process1.verdict, "IMPLEMENTATION_VERIFIED");
  assert.equal(audit.liveOutcome.process1.agentSpawnCount, 1);
  assert.equal(
    audit.liveOutcome.process1.verifiedHeadRevision,
    "350bf8559beaf2639d2941072569d6fe54e94c26",
  );
  assert.equal(
    audit.liveOutcome.process1.resultParent,
    "56797f45367b7b8fa115f1e874c5d618edaf9226",
  );
  assert.deepEqual(audit.liveOutcome.process1.changedPaths, ["README.md"]);
  assert.equal(audit.liveOutcome.process1.durableRefTargetMatchesVerifiedHead, true);
  assert.equal(audit.liveOutcome.process1.objectiveContentVerified, true);
  assert.equal(audit.liveOutcome.process2.disposition, "REPLAY");
  assert.equal(audit.liveOutcome.process2.agentSpawnCount, 0);
  assert.equal(audit.liveOutcome.process2.secondsAfterAuthorizationExpiry, 60);
  assert.equal(audit.liveOutcome.process2.unusableToolCanaryPassed, true);
  assert.equal(audit.liveOutcome.process2.verifiedHeadAndTerminalEvidenceUnchanged, true);
  assert.equal(
    audit.liveOutcome.portable.exportManifestDigest,
    "sha256:4961d4937699be204987540a852542090cda60fe46e9eea50d91629408902d23",
  );
  assert.equal(audit.liveOutcome.portable.exportedFiles, 18);
  assert.deepEqual(audit.liveOutcome.portable.validationExitCodes, [0]);
  assert.equal(audit.liveOutcome.portable.leakage, "PASS");

  assert.equal(audit.leakageAudit.publicReceiptForbiddenValueFindings, 0);
  assert.equal(audit.leakageAudit.portableExportForbiddenValueFindings, 0);
  assert.equal(audit.leakageAudit.metaHarnessCheckoutFindingsAcrossCustodyFiles, 0);
  assert.equal(audit.leakageAudit.metaHarnessCheckoutFindingsInRequest, 0);
  assert.equal(audit.leakageAudit.runtimeLeakageBoundaryPassed, true);
  assert.equal(audit.operationalFriction.duplicateRejectedByCreateOnlyRoot, true);
  assert.equal(audit.operationalFriction.duplicateAgentSpawnObserved, false);
  assert.equal(audit.operationalFriction.originalInvocationCompleted, true);
  assert.equal(audit.operationalFriction.candidateMutationObserved, false);

  assert.equal(audit.releaseBoundary.productCodingStopsAtD076Closure, true);
  assert.equal(audit.releaseBoundary.releasePolicySatisfied, false);
  assert.equal(audit.releaseBoundary.nextFunctionalPhaseAuthorized, false);
  assert.equal(audit.claims.exactCandidateSuitePassed, true);
  assert.equal(audit.claims.exactCandidateTarballInstalled, true);
  assert.equal(audit.claims.authenticatedAgentSpawnObserved, true);
  assert.equal(audit.claims.d076Closed, true);
  assert.equal(audit.claims.deleteAuthorized, false);
  assert.equal(audit.claims.publishAuthorizedBeforeReleasePolicyPass, false);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /exact-closure-commit repository security/i);
  assert.match(event.next_action, /no feature phase or DELETE/i);
});

test("D076 release-preparation audit binds 0.2.0, security hardening, and the remaining remote gate", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-release-preparation-audit.json"));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => entry.phase === "D076-release-preparation");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-preparation-audit");
  assert.equal(audit.verdict, "RELEASE_PREPARATION_ACCEPTED_REMOTE_EVIDENCE_PENDING");
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.featureDevelopmentFrozen, true);
  assert.equal(audit.decision.releasePreparationAuthorized, true);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.publishAuthorizedNow, false);

  assert.equal(audit.closure.commit, "68932804fb2563dc849d701aca44f8988385c2bb");
  assert.equal(audit.closure.tree, "4d94eaa82a652e37e6fe4601c47a256d1615c7a6");
  assert.equal(audit.closure.candidate, "ce02548b9db9ed6fea904e0e146906fab6cba773");
  assert.equal(audit.closure.testFiles, 115);
  assert.equal(audit.closure.failedTestFiles, 0);
  assert.equal(
    audit.closure.tarballSha256,
    "7a28690d7227d669178f939eb87f1de0754f2d70e450a490873f6b528d4bd9d0",
  );
  assert.equal(audit.closure.tarballBytes, 478138);
  assert.equal(audit.closure.packageEntries, 234);

  assert.equal(audit.version.registryResult, "E404_NO_PUBLIC_RECORD_OBSERVED");
  assert.equal(audit.version.nameAvailabilityGuaranteed, false);
  assert.equal(audit.version.previous, "0.1.0");
  assert.equal(audit.version.selected, "0.2.0");

  assert.equal(
    audit.releaseCommits.mechanics.commit,
    "eaf7ed9409e11662f1f4c3cced8a37ae4d251038",
  );
  assert.equal(audit.releaseCommits.mechanics.testTimeoutSeconds, 300);
  assert.equal(
    audit.releaseCommits.qualityBaseline.commit,
    "4fedec9dd728114018a6518356833537cfc128bc",
  );
  assert.equal(audit.releaseCommits.qualityBaseline.decision, "D076");
  assert.equal(audit.releaseCommits.qualityBaseline.qualityPass, true);
  assert.equal(
    audit.releaseCommits.codeScanningRepair.commit,
    "2fc3206628500383d8a61d01b58f8d52fd07f184",
  );
  assert.equal(audit.releaseCommits.codeScanningRepair.focusedTestsPassed, 35);
  assert.equal(audit.releaseCommits.codeScanningRepair.focusedTestsFailed, 0);
  assert.equal(audit.releaseCommits.codeScanningRepair.remoteClosurePending, true);

  assert.equal(audit.githubSecurity.visibility, "public");
  assert.equal(audit.githubSecurity.secretScanning, "enabled");
  assert.equal(audit.githubSecurity.pushProtection, "enabled");
  assert.equal(audit.githubSecurity.openSecretAlerts, 0);
  assert.equal(audit.githubSecurity.openDependabotAlerts, 0);
  assert.equal(audit.githubSecurity.codeQlSetupRunId, 29359631210);
  assert.equal(audit.githubSecurity.codeQlSetupConclusion, "success");
  assert.equal(audit.githubSecurity.openCodeScanningAlerts, 1);
  assert.equal(audit.githubSecurity.branchProtectionEnabled, false);

  assert.equal(audit.remainingGate.exactReleaseCommitCreated, false);
  assert.equal(audit.remainingGate.pushRequired, true);
  assert.equal(audit.remainingGate.remoteCiRequired, true);
  assert.equal(audit.remainingGate.codeScanningAlertClosureRequired, true);
  assert.equal(audit.remainingGate.branchProtectionRequired, true);
  assert.equal(audit.remainingGate.tagRequired, true);
  assert.equal(audit.remainingGate.publishModeCheckRequired, true);
  assert.equal(audit.remainingGate.npmPublicationRequired, true);
  assert.equal(audit.remainingGate.featureExpansionAuthorized, false);
  assert.equal(audit.remainingGate.deleteAuthorized, false);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /exact 0\.2\.0 release commit/i);
  assert.match(event.next_action, /no feature phase or DELETE/i);
});

test("D076 failed release candidate preserves immutable evidence and authorizes only version-fixture repair", () => {
  const audit = JSON.parse(read("docs/ops/audits/d076-release-candidate-2a190dd-failure-audit.json"));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => entry.phase === "D076-release-candidate-fixture-failure");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-candidate-failure-audit");
  assert.equal(
    audit.verdict,
    "IMMUTABLE_RELEASE_CANDIDATE_FAILED_STALE_VERSION_FIXTURE_REPAIR_AUTHORIZED",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.newReleaseCandidateRequired, true);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);

  assert.equal(
    audit.candidate.commit,
    "2a190dd60a3db87660dbaf5b54cbbece5a3121ed",
  );
  assert.equal(audit.candidate.tree, "a851cb806f390b324b420c78760babe09c7fc2c2");
  assert.equal(audit.candidate.parent, "996c06a129f551b0e25449e45ed2f3c29bb28730");
  assert.equal(audit.candidate.packageVersion, "0.2.0");
  assert.equal(audit.candidate.pushed, false);
  assert.equal(audit.candidate.tagged, false);
  assert.equal(audit.candidate.published, false);

  assert.equal(audit.suiteFailure.platform, "win32");
  assert.equal(audit.suiteFailure.nodeVersion, "v25.2.1");
  assert.equal(audit.suiteFailure.discoveredTestFiles, 116);
  assert.equal(audit.suiteFailure.completedRange, "1-25");
  assert.equal(audit.suiteFailure.failedTestFiles, 2);
  assert.deepEqual(audit.suiteFailure.failedFiles, [
    "tests/cli-governance-migration.test.js",
    "tests/cli-governance-release.test.js",
  ]);
  assert.equal(audit.suiteFailure.runtimeOrPackageDefect, false);
  assert.equal(audit.suiteFailure.testFixtureDefect, true);

  assert.equal(audit.boundedRepair.scope, "tests only");
  assert.equal(audit.boundedRepair.files.length, 7);
  assert.equal(audit.boundedRepair.productionRuntimeChanged, false);
  assert.equal(audit.boundedRepair.packageMetadataChanged, false);
  assert.equal(audit.boundedRepair.publicSurfaceChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.repairVerification.focusedTestFiles, 6);
  assert.equal(audit.repairVerification.testsPassed, 26);
  assert.equal(audit.repairVerification.testsFailed, 0);
  assert.equal(audit.repairVerification.result, "PASS");

  assert.equal(audit.remainingGate.newCandidateCommitRequired, true);
  assert.equal(audit.remainingGate.finalQualityBaselineRefreshRequired, true);
  assert.equal(audit.remainingGate.completeNativeSuiteRequired, true);
  assert.equal(audit.remainingGate.exactPackageProofRequired, true);
  assert.equal(audit.remainingGate.pushRequired, true);
  assert.equal(audit.remainingGate.remoteCiAndSecurityRequired, true);
  assert.equal(audit.remainingGate.branchProtectionRequired, true);
  assert.equal(audit.remainingGate.tagAndPublishRequired, true);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /test-only fixture repair/i);
  assert.match(event.next_action, /all 116 native Windows files/i);
  assert.match(event.next_action, /no feature phase or DELETE/i);
});

test("D076 pushed release candidate preserves Windows CI failure and authorizes only test-boundary repair", () => {
  const audit = JSON.parse(read(
    "docs/ops/audits/d076-release-candidate-8676afd-windows-ci-failure-audit.json",
  ));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => entry.phase === "D076-release-candidate-windows-ci-failure");
  const runner = read("scripts/run-tests.js");
  const installedTest = read("tests/installed-execution-custody.test.js");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-candidate-windows-ci-failure-audit");
  assert.equal(
    audit.verdict,
    "IMMUTABLE_RELEASE_CANDIDATE_FAILED_WINDOWS_TEST_BOUNDARY_REPAIR_AUTHORIZED",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.newReleaseCandidateRequired, true);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.tagAuthorizedForFailedCandidate, false);
  assert.equal(audit.decision.publishAuthorizedForFailedCandidate, false);

  assert.equal(audit.candidate.commit, "8676afdbfdcab867957ef54cd0c4d5589566aa5a");
  assert.equal(audit.candidate.tree, "930b0ecc32d0888a9a656045fcc8d8aed17d60e9");
  assert.equal(audit.candidate.parent, "0a2647c9a70143ad8b564ec0995ea9fb2659c2d2");
  assert.equal(audit.candidate.packageVersion, "0.2.0");
  assert.equal(audit.candidate.pushedToMain, true);
  assert.equal(audit.candidate.tagged, false);
  assert.equal(audit.candidate.published, false);

  assert.equal(audit.localValidation.discoveredTestFiles, 116);
  assert.equal(audit.localValidation.failedTestFiles, 0);
  assert.equal(
    audit.localValidation.package.tarballSha256,
    "98da57b61c0f19d7cd1911ef0c334923b0bbf556d5eca1bbaf2f023cfd410b65",
  );
  assert.equal(audit.localValidation.package.dryRunEntries, 234);
  assert.equal(audit.localValidation.package.actualEntries, 234);
  assert.equal(audit.localValidation.package.dryRunActualEquality, true);
  assert.equal(audit.localValidation.package.executeUsageCount, 1);

  assert.equal(audit.remoteEvidence.semgrep.runId, 29363367535);
  assert.equal(audit.remoteEvidence.semgrep.conclusion, "success");
  assert.equal(audit.remoteEvidence.codeQl.runId, 29363366888);
  assert.equal(audit.remoteEvidence.codeQl.conclusion, "success");
  assert.equal(audit.remoteEvidence.ci.runId, 29363368012);
  assert.equal(audit.remoteEvidence.ci.nodeTestsConclusion, "success");
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteConclusion, "failure");
  assert.equal(audit.remoteEvidence.ci.failedTestFiles, 2);
  assert.deepEqual(audit.remoteEvidence.ci.failedFiles, [
    "tests/judge.test.js",
    "tests/installed-execution-custody.test.js",
  ]);

  assert.equal(audit.rootCause.productionExecutionRuntimeDefect, false);
  assert.equal(audit.rootCause.packageBoundaryDefect, false);
  assert.equal(audit.rootCause.publicRequestContractDefect, false);
  assert.equal(audit.boundedRepair.files.length, 2);
  assert.equal(audit.boundedRepair.productionRuntimeChanged, false);
  assert.equal(audit.boundedRepair.packageMetadataChanged, false);
  assert.equal(audit.boundedRepair.publicSurfaceChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.boundedRepair.leakageAssertionWeakened, false);
  assert.equal(audit.repairVerification.testsPassed, 9);
  assert.equal(audit.repairVerification.testsFailed, 0);
  assert.equal(audit.repairVerification.installedVerifiedReplayPortableReceiptChainPassed, true);
  assert.equal(audit.repairVerification.judgeSerialTestsPassed, 8);

  assert.match(runner, /cli-ready-repro\|judge\|release-check/);
  assert.match(installedTest, /function consumerEnvironment/);
  assert.match(installedTest, /sourceCheckoutSentinel/);
  assert.match(installedTest, /assertTextAbsent/);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /two-file Windows test-boundary repair/i);
  assert.match(event.next_action, /literal native Windows npm test/i);
  assert.match(event.next_action, /all remote checks green/i);
});

test("D076 be6eb58 candidate preserves hosted-Windows Git discovery failure and authorizes only the path repair", () => {
  const audit = JSON.parse(read(
    "docs/ops/audits/d076-release-candidate-be6eb58-windows-ci-failure-audit.json",
  ));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => (
    entry.phase === "D076-release-candidate-hosted-windows-git-discovery-failure"
  ));
  const judge = read("lib/judge.js");
  const judgeTest = read("tests/judge.test.js");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-candidate-windows-ci-failure-audit");
  assert.equal(
    audit.verdict,
    "IMMUTABLE_RELEASE_CANDIDATE_FAILED_HOSTED_WINDOWS_GIT_DISCOVERY_REPAIR_AUTHORIZED",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.newReleaseCandidateRequired, true);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.tagAuthorizedForFailedCandidate, false);
  assert.equal(audit.decision.publishAuthorizedForFailedCandidate, false);

  assert.equal(audit.candidate.commit, "be6eb5801a802564b856b01dcd0d6d2b4ac10bce");
  assert.equal(audit.candidate.tree, "0639cc64cd020a3c950e68dac82f61cc3161dd24");
  assert.equal(audit.candidate.parent, "76080be1e72d1ac8097573ebe6f52fde34ebdb7c");
  assert.equal(audit.candidate.packageVersion, "0.2.0");
  assert.equal(audit.candidate.pushedToMain, true);
  assert.equal(audit.candidate.tagged, false);
  assert.equal(audit.candidate.published, false);

  assert.equal(audit.localValidation.discoveredTestFiles, 116);
  assert.equal(audit.localValidation.failedTestFiles, 0);
  assert.equal(audit.localValidation.durationSeconds, 207.8);
  assert.equal(
    audit.localValidation.package.tarballSha256,
    "53cca518b6268335ce37ff374af52afc467ddc79c87c321fb0119a0011caaa5d",
  );
  assert.equal(audit.localValidation.package.dryRunEntries, 234);
  assert.equal(audit.localValidation.package.actualEntries, 234);
  assert.equal(audit.localValidation.package.dryRunActualEquality, true);
  assert.equal(audit.localValidation.package.executeUsageCount, 1);

  assert.equal(audit.remoteEvidence.semgrep.runId, 29365479555);
  assert.equal(audit.remoteEvidence.semgrep.conclusion, "success");
  assert.equal(audit.remoteEvidence.codeQl.runId, 29365479099);
  assert.equal(audit.remoteEvidence.codeQl.conclusion, "success");
  assert.equal(audit.remoteEvidence.ci.runId, 29365479563);
  assert.equal(audit.remoteEvidence.ci.nodeTestsJobId, 87195842394);
  assert.equal(audit.remoteEvidence.ci.nodeTestsConclusion, "success");
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteJobId, 87195842327);
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteConclusion, "failure");
  assert.equal(audit.remoteEvidence.ci.failedTestFiles, 1);
  assert.deepEqual(audit.remoteEvidence.ci.failedFiles, ["tests/judge.test.js"]);
  assert.equal(audit.remoteEvidence.ci.installedExecutionCustodyConclusion, "pass");
  assert.match(audit.remoteEvidence.ci.judgeObservedPattern, /JUDGE_INPUT_TARGET_NOT_GIT/i);

  assert.equal(audit.rootCause.classification, "hosted_windows_git_repository_discovery_path_boundary");
  assert.equal(audit.rootCause.productionExecutionRuntimeDefect, false);
  assert.equal(audit.rootCause.packageBoundaryDefect, false);
  assert.equal(audit.rootCause.publicRequestContractDefect, false);
  assert.equal(audit.rootCause.concurrencyDefect, false);
  assert.match(audit.rootCause.diagnosis, /fs\.realpathSync/i);
  assert.match(audit.rootCause.repair, /caller-resolved target path for Git cwd/i);

  assert.deepEqual(audit.boundedRepair.files, ["lib/judge.js", "tests/judge.test.js"]);
  assert.equal(audit.boundedRepair.productionExecutionRuntimeChanged, false);
  assert.equal(audit.boundedRepair.packageMetadataChanged, false);
  assert.equal(audit.boundedRepair.publicSurfaceChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.boundedRepair.securityContainmentWeakened, false);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsPassed, 8);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsFailed, 0);
  assert.equal(audit.repairVerification.focusedLinux.testsPassed, 8);
  assert.equal(audit.repairVerification.focusedLinux.testsFailed, 0);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.discoveredTestFiles, 116);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.failedTestFiles, 0);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.durationSeconds, 204.5);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.exitCode, 0);

  assert.match(judge, /function gitContext\(gitTargetRoot, canonicalTargetRoot, input\)/);
  assert.match(judge, /gitOutput\(gitTargetRoot, \["rev-parse", "--show-toplevel"\]\)/);
  assert.match(judge, /targetRoot: targetPath/);
  assert.match(judgeTest, /const discovered = run\(root, "git", \["rev-parse", "--show-toplevel"\]\)/);
  assert.match(judgeTest, /JSON\.stringify\(result, null, 2\)/);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /path-boundary repair/i);
  assert.match(event.next_action, /literal native Windows npm test/i);
  assert.match(event.next_action, /all remote checks green/i);
});

test("D076 a05fcc5 candidate preserves hosted-Windows path-alias failure and authorizes only the test repair", () => {
  const audit = JSON.parse(read(
    "docs/ops/audits/d076-release-candidate-a05fcc5-windows-ci-failure-audit.json",
  ));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => (
    entry.phase === "D076-release-candidate-hosted-windows-path-alias-failure"
  ));
  const judgeTest = read("tests/judge.test.js");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-candidate-windows-ci-failure-audit");
  assert.equal(
    audit.verdict,
    "IMMUTABLE_RELEASE_CANDIDATE_FAILED_HOSTED_WINDOWS_PATH_ALIAS_ASSERTION_REPAIR_AUTHORIZED",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.newReleaseCandidateRequired, true);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.tagAuthorizedForFailedCandidate, false);
  assert.equal(audit.decision.publishAuthorizedForFailedCandidate, false);

  assert.equal(audit.candidate.commit, "a05fcc5336dfcc16375f09d6d419de7c2ea3816b");
  assert.equal(audit.candidate.tree, "73d9b8fc0da8201100125f2fd0ce49d473a430b8");
  assert.equal(audit.candidate.parent, "d320e4d6cf397659879f19f14f5ba2fd8cce7b77");
  assert.equal(audit.candidate.packageVersion, "0.2.0");
  assert.equal(audit.candidate.pushedToMain, true);
  assert.equal(audit.candidate.tagged, false);
  assert.equal(audit.candidate.published, false);

  assert.equal(audit.localValidation.discoveredTestFiles, 116);
  assert.equal(audit.localValidation.failedTestFiles, 0);
  assert.equal(audit.localValidation.durationSeconds, 208.4);
  assert.equal(
    audit.localValidation.package.tarballSha256,
    "0bffbdc980c373ae037729b46aece3202d2d861964b081b7bf0ee03f7ad6d946",
  );
  assert.equal(audit.localValidation.package.tarballBytes, 480929);
  assert.equal(audit.localValidation.package.dryRunEntries, 234);
  assert.equal(audit.localValidation.package.actualEntries, 234);
  assert.equal(audit.localValidation.package.dryRunActualEquality, true);
  assert.equal(audit.localValidation.package.executeUsageCount, 1);
  assert.equal(audit.localValidation.package.candidateCleanAfter, true);

  assert.equal(audit.remoteEvidence.semgrep.runId, 29392819532);
  assert.equal(audit.remoteEvidence.semgrep.conclusion, "success");
  assert.equal(audit.remoteEvidence.codeQl.runId, 29392819021);
  assert.equal(audit.remoteEvidence.codeQl.conclusion, "success");
  assert.equal(audit.remoteEvidence.ci.runId, 29392819570);
  assert.equal(audit.remoteEvidence.ci.nodeTestsJobId, 87279783156);
  assert.equal(audit.remoteEvidence.ci.nodeTestsConclusion, "success");
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteJobId, 87279783131);
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteConclusion, "failure");
  assert.equal(audit.remoteEvidence.ci.failedTestFiles, 1);
  assert.deepEqual(audit.remoteEvidence.ci.failedFiles, ["tests/judge.test.js"]);
  assert.equal(audit.remoteEvidence.ci.installedExecutionCustodyConclusion, "pass");
  assert.equal(audit.remoteEvidence.ci.judgeProductionPathReached, false);

  assert.equal(audit.rootCause.classification, "hosted_windows_test_path_alias_identity_assertion");
  assert.equal(audit.rootCause.productionExecutionRuntimeDefect, false);
  assert.equal(audit.rootCause.packageBoundaryDefect, false);
  assert.equal(audit.rootCause.publicRequestContractDefect, false);
  assert.equal(audit.rootCause.judgeProductionRepairDisproved, false);
  assert.equal(audit.rootCause.judgeProductionRepairExercisedRemotely, false);
  assert.match(audit.rootCause.diagnosis, /RUNNER~1/i);
  assert.match(audit.rootCause.repair, /filesystem object identity/i);

  assert.deepEqual(audit.boundedRepair.files, ["tests/judge.test.js"]);
  assert.equal(audit.boundedRepair.productionRuntimeChanged, false);
  assert.equal(audit.boundedRepair.judgeProductionCodeChanged, false);
  assert.equal(audit.boundedRepair.packageMetadataChanged, false);
  assert.equal(audit.boundedRepair.publicSurfaceChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.boundedRepair.securityContainmentWeakened, false);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsPassed, 8);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsFailed, 0);
  assert.equal(audit.repairVerification.focusedLinux.testsPassed, 8);
  assert.equal(audit.repairVerification.focusedLinux.testsFailed, 0);
  assert.equal(audit.repairVerification.filesystemIdentity.pathStringEqualityRequired, false);

  assert.match(judgeTest, /fs\.statSync\(discovered, \{ bigint: true \}\)/);
  assert.match(judgeTest, /fs\.statSync\(root, \{ bigint: true \}\)/);
  assert.match(judgeTest, /assert\.equal\(discoveredStat\.dev, rootStat\.dev\)/);
  assert.match(judgeTest, /assert\.equal\(discoveredStat\.ino, rootStat\.ino\)/);
  assert.doesNotMatch(judgeTest, /assert\.equal\(fs\.realpathSync\(discovered\), fs\.realpathSync\(root\)\)/);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /test-only path-alias identity repair/i);
  assert.match(event.next_action, /literal native Windows npm test/i);
  assert.match(event.next_action, /all remote checks green/i);
});

test("D076 3482db0 candidate preserves hosted-Windows alias-containment failure and authorizes only the bounded repair", () => {
  const audit = JSON.parse(read(
    "docs/ops/audits/d076-release-candidate-3482db0-windows-ci-failure-audit.json",
  ));
  const events = read(".meta-harness/events.jsonl").trim().split(/\r?\n/).map(JSON.parse);
  const event = events.find((entry) => (
    entry.phase === "D076-release-candidate-hosted-windows-alias-containment-failure"
  ));
  const judge = read("lib/judge.js");
  const judgeTest = read("tests/judge.test.js");
  assert.ok(event);

  assert.equal(audit.kind, "d076-release-candidate-windows-ci-failure-audit");
  assert.equal(
    audit.verdict,
    "IMMUTABLE_RELEASE_CANDIDATE_FAILED_HOSTED_WINDOWS_ALIAS_CONTAINMENT_REPAIR_AUTHORIZED",
  );
  assert.equal(audit.decision.id, "D076");
  assert.equal(audit.decision.d076Status, "closed");
  assert.equal(audit.decision.failedCandidateMustRemainImmutable, true);
  assert.equal(audit.decision.amendFailedCandidateAuthorized, false);
  assert.equal(audit.decision.newReleaseCandidateRequired, true);
  assert.equal(audit.decision.featureExpansionAuthorized, false);
  assert.equal(audit.decision.deleteAuthorized, false);
  assert.equal(audit.decision.tagAuthorizedForFailedCandidate, false);
  assert.equal(audit.decision.publishAuthorizedForFailedCandidate, false);

  assert.equal(audit.candidate.commit, "3482db00186e85fa9508668d19a27888b53a3c4b");
  assert.equal(audit.candidate.tree, "a7db207cd0ca972b64df4b804b21d5310cc8b680");
  assert.equal(audit.candidate.parent, "c5ef282b7d1df12b0cd377b72c9be54ddf24f48b");
  assert.equal(audit.candidate.packageVersion, "0.2.0");
  assert.equal(audit.candidate.pushedToMain, true);
  assert.equal(audit.candidate.tagged, false);
  assert.equal(audit.candidate.published, false);

  assert.equal(audit.localValidation.discoveredTestFiles, 116);
  assert.equal(audit.localValidation.failedTestFiles, 0);
  assert.equal(audit.localValidation.durationSeconds, 224.9);
  assert.equal(
    audit.localValidation.package.tarballSha256,
    "acdb0577c114045623845ab1ab6f7fb717c47041558c2474fbc19035bf7ac9f3",
  );
  assert.equal(audit.localValidation.package.tarballBytes, 481252);
  assert.equal(audit.localValidation.package.dryRunEntries, 234);
  assert.equal(audit.localValidation.package.actualEntries, 234);
  assert.equal(audit.localValidation.package.dryRunActualEquality, true);
  assert.equal(audit.localValidation.package.executeUsageCount, 1);
  assert.equal(audit.localValidation.package.candidateCleanAfter, true);

  assert.equal(audit.remoteEvidence.semgrep.runId, 29393721755);
  assert.equal(audit.remoteEvidence.semgrep.conclusion, "success");
  assert.equal(audit.remoteEvidence.codeQl.runId, 29393721231);
  assert.equal(audit.remoteEvidence.codeQl.conclusion, "success");
  assert.equal(audit.remoteEvidence.ci.runId, 29393721701);
  assert.equal(audit.remoteEvidence.ci.nodeTestsJobId, 87282458156);
  assert.equal(audit.remoteEvidence.ci.nodeTestsConclusion, "success");
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteJobId, 87282458170);
  assert.equal(audit.remoteEvidence.ci.windowsCompleteSuiteConclusion, "failure");
  assert.equal(audit.remoteEvidence.ci.failedTestFiles, 1);
  assert.deepEqual(audit.remoteEvidence.ci.failedFiles, ["tests/judge.test.js"]);
  assert.equal(audit.remoteEvidence.ci.installedExecutionCustodyConclusion, "pass");
  assert.equal(audit.remoteEvidence.ci.judgeProductionPathReached, true);
  assert.equal(audit.remoteEvidence.ci.failureCode, "JUDGE_INPUT_TARGET_NOT_GIT");

  assert.equal(audit.rootCause.classification, "hosted_windows_alias_sensitive_repository_containment");
  assert.equal(audit.rootCause.productionExecutionRuntimeDefect, false);
  assert.equal(audit.rootCause.packageBoundaryDefect, false);
  assert.equal(audit.rootCause.publicRequestContractDefect, false);
  assert.equal(audit.rootCause.judgeProductionDefect, true);
  assert.match(audit.rootCause.diagnosis, /path\.relative containment check/i);
  assert.match(audit.rootCause.repair, /ancestor chain/i);

  assert.deepEqual(audit.boundedRepair.files, ["lib/judge.js", "tests/judge.test.js"]);
  assert.equal(audit.boundedRepair.productionExecutionRuntimeChanged, false);
  assert.equal(audit.boundedRepair.judgeProductionCodeChanged, true);
  assert.equal(audit.boundedRepair.packageMetadataChanged, false);
  assert.equal(audit.boundedRepair.publicSurfaceChanged, false);
  assert.equal(audit.boundedRepair.compatibilityAdded, false);
  assert.equal(audit.boundedRepair.inputPathLexicalContainmentChanged, false);
  assert.equal(audit.boundedRepair.securityContainmentWeakened, false);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsPassed, 9);
  assert.equal(audit.repairVerification.focusedNativeWindows.testsFailed, 0);
  assert.equal(audit.repairVerification.focusedLinux.testsPassed, 9);
  assert.equal(audit.repairVerification.focusedLinux.testsFailed, 0);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.discoveredTestFiles, 116);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.failedTestFiles, 0);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.durationSeconds, 212.5);
  assert.equal(audit.repairVerification.completeNativeWindowsWorktree.exitCode, 0);

  assert.match(judge, /function isInsideExistingDirectory\(root, child\)/);
  assert.match(judge, /fs\.statSync\(root, \{ bigint: true \}\)/);
  assert.match(judge, /currentStat\.dev === rootStat\.dev/);
  assert.match(judge, /isInsideExistingDirectory\(gitRoot, canonicalTargetRoot\)/);
  assert.match(judgeTest, /existing-directory containment uses filesystem identity across ancestors/);
  assert.match(judgeTest, /isInsideExistingDirectory\(root, outside\), false/);

  assert.equal(events.indexOf(event) < 68, true);
  assert.equal(event.ts, audit.auditedAt);
  assert.equal(event.time, audit.auditedAt);
  assert.equal(event.decision, "D076");
  assert.match(event.next_action, /alias-safe repository-containment repair/i);
  assert.match(event.next_action, /literal native Windows npm test/i);
  assert.match(event.next_action, /all remote checks green/i);
});

test("historical D074/D075 examples remain test-only while D076 uses one packaged public runtime", () => {
  const execute = read("lib/execution-custody/execute.js");
  const helper = read("tests/helpers/execution-custody-live.js");
  const fluxaraLive = read("tests/runtime-execution-custody-live.test.js");
  const devspaceLive = read("tests/runtime-execution-custody-devspace-live.test.js");
  const genericRuntime = read("tests/runtime-execution-custody.test.js");
  const installedRuntime = read("tests/installed-execution-custody.test.js");
  const testRunner = read("scripts/run-tests.js");
  const packageJson = JSON.parse(read("package.json"));
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

  assert.equal(fs.existsSync(path.join(root, "internal/execution-custody/operator.js")), false);
  assert.equal(fs.existsSync(path.join(root, "internal/execution-custody/example.js")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts/operate-execution-custody.js")), false);
  assert.match(execute, /meta-harness-execution-request\/v1/);
  assert.match(execute, /meta-harness-execution-receipt\/v1/);
  assert.match(execute, /expectedNodeSha256/);
  assert.match(execute, /expectedLauncherSha256/);
  assert.match(execute, /expectedNativeSha256/);
  assert.match(execute, /expectedExecutableSha256/);
  assert.match(execute, /controller-process\.js/);
  assert.match(execute, /portable-verifier\.js/);
  assert.match(execute, /REPLAY_EXPIRY_MARGIN_MS = 60_000/);
  assert.match(execute, /controllerClosedAndProcessExited: true/);
  assert.match(execute, /processExitCode: 0/);
  assert.doesNotMatch(execute, /bounded-repository-change-example|\.agents\/skills|Fluxara|Python|D073|D076/);

  assert.match(helper, /function runLiveCustodyProof/);
  assert.match(helper, /executeRequest/);
  assert.doesNotMatch(helper, /operateBoundedRepositoryChange/);
  assert.doesNotMatch(helper, /Fluxara|Python|D073/i);
  assert.equal(packageJson.bin["meta-harness"], "bin/meta-harness.js");
  assert.equal(
    Object.values(packageJson.bin || {}).some((value) => /operate|execution-custody/i.test(String(value))),
    false,
  );
  assert.equal(
    Object.keys(packageJson.scripts || {}).some((name) => /operate|execution-custody/i.test(name)),
    false,
  );

  assert.match(fluxaraLive, /runLiveCustodyProof/);
  assert.match(devspaceLive, /runLiveCustodyProof/);
  assert.match(devspaceLive, /CUSTODY_LIVE_DEVSPACE/);
  assert.match(devspaceLive, /CUSTODY_NODE_VALIDATION_PATH/);
  assert.match(testRunner, /runtime-execution-custody\(\?:-devspace-live\|-live\|-process-tree\)/);
  assert.match(genericRuntime, /authorization-receipt\.json/);
  assert.match(genericRuntime, /expiresAt/);
  assert.match(genericRuntime, /60_000/);
  assert.match(installedRuntime, /npmCliPath/);
  assert.match(installedRuntime, /--ignore-scripts/);
  assert.match(installedRuntime, /node_modules.*\.bin.*meta-harness\.cmd/);
  assert.match(installedRuntime, /dirty source/i);
  assert.match(installedRuntime, /REPLAY/);
  assert.match(installedRuntime, /leakage/);
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
