"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function phase(text, id, nextId) {
  const start = text.indexOf(`### ${id} —`);
  assert.notEqual(start, -1, `missing ${id} section`);
  const end = nextId ? text.indexOf(`### ${nextId} —`, start + 1) : text.indexOf("\n## ", start + 1);
  assert.notEqual(end, -1, `missing end of ${id} section`);
  return text.slice(start, end);
}

function events() {
  return read(".meta-harness/events.jsonl")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

test("D089 canonical event activates D088 and opens only R3", () => {
  const allEvents = events();
  const activation = allEvents.findLast(
    (event) => event.authority_receipt?.receipt_id === "D089-D088-R2-ACCEPTANCE",
  );
  assert.ok(activation, "missing D089 activation receipt");
  assert.equal(activation.decision, "D089");
  assert.equal(activation.truth_snapshot, true);
  assert.match(activation.result, /D088 is active/);
  assert.match(activation.result, /D087 is historical candidate reasoning/);
  assert.match(activation.result, /R2A, R2B, and R2C are accepted/);
  assert.match(activation.result, /ROADMAP_PROOF_SCORE = 40 \/ 100/);
  assert.match(activation.result, /S-006M_EXTERNAL_LOOPS_SHIPPED = 0 \/ 1/);
  assert.match(activation.next_action, /^Implement and independently accept ENTRY_AUTHORITY_INVARIANT/);

  const status = read(".meta-harness/status.md");
  assert.match(status, /ROADMAP_PROOF_SCORE = 40 \/ 100/);
  assert.match(status, /S-006M_EXTERNAL_LOOPS_SHIPPED = 0 \/ 1/);
  assert.match(status, /D088 is active/);
  assert.match(status, /Next action:\r?\nImplement and independently accept ENTRY_AUTHORITY_INVARIANT/);
  assert.ok(status.includes(activation.goal));
  assert.ok(status.includes(activation.stop_criteria));
  assert.ok(status.includes(activation.ts));

  const decisionLog = read("docs/product/decision-log.md");
  const d089r3 = decisionLog.indexOf("## D089-R3 (candidate): Enforce Entry Authority Before Product Planning");
  const d089 = decisionLog.indexOf("## D089: Accept D088 R2, Bank 40/100, and Open R3 Entry Authority");
  const d088r1 = decisionLog.indexOf("## D088-R1 (candidate repair): Bind Entry Authority Externally and Correct Execution Truth");
  const d088 = decisionLog.indexOf("## D088 (candidate): Make Thin Cross-Repository Usefulness the Next Product Proof");
  const d087 = decisionLog.indexOf("## D087 (candidate): Make Product Proof per Time the Selection Rule");
  const d086 = decisionLog.indexOf("## D086: Accept R1, Bank 30/100, and Activate D085 for R2 Target Lock");
  assert.ok(
    d089r3 !== -1 && d089 !== -1 && d088r1 !== -1 && d088 !== -1 && d087 !== -1 && d086 !== -1
      && d089r3 < d089 && d089 < d088r1 && d088r1 < d088 && d088 < d087 && d087 < d086,
    "D089-R3 candidate evidence must be appended above canonical D089 and preserved history",
  );
});

test("D089 banks the complete R2 exit and keeps R3 thin", () => {
  const roadmap = read("docs/product/roadmap.md");
  const r1 = phase(roadmap, "R1", "R2");
  const r2 = phase(roadmap, "R2", "R3");
  const r3 = phase(roadmap, "R3", "R4");
  const r4 = phase(roadmap, "R4", "R5");
  const r6 = phase(roadmap, "R6", null);

  assert.match(r1, /target-independent Meta-Harness execution base/i);
  assert.match(r1, /external repositories and product work remain unset/i);

  assert.match(r2, /DONE — INDEPENDENTLY ACCEPTED AND BANKED UNDER D089/i);
  assert.match(r2, /R2A[\s\S]*Accepted evidence: COMPLETE UNDER D089/i);
  assert.match(r2, /R2B[\s\S]*Meta-Harness, Quant, and Leningrad/i);
  assert.match(r2, /R2C[\s\S]*Accepted response: SELECTED UNDER D089/i);
  assert.match(r2, /ENTRY_AUTHORITY_AMBIGUITY/i);
  assert.match(r2, /ENTRY_AUTHORITY_INVARIANT/i);
  assert.match(r2, /NO_BUILD[\s\S]*guidance-only responses were compared and rejected/i);
  assert.match(r2, /ROADMAP_PROOF_SCORE = 40 \/ 100/i);

  assert.match(r3, /CANDIDATE COMPLETE — INDEPENDENT EXACT-COMMIT ACCEPTANCE REQUIRED/i);
  assert.match(r3, /existing repository identity comparison/i);
  assert.match(r3, /pure four-result evaluator/i);
  assert.match(r3, /tracked read-only collector/i);
  assert.match(r3, /No second authority architecture or public command/i);
  assert.match(r3, /six of six proof cases correct through the tracked collector/i);
  assert.match(r3, /Leningrad custody derived from 30 Alpha 0 product files/i);
  assert.match(r3, /clear deletion or shrink path/i);

  assert.match(r4, /BLOCKED ON R3/i);
  assert.match(r6, /Compare Benefit and Remove Obsolete Layers/i);
  assert.match(r6, /delete, shrink, or demote/i);
  assert.match(r6, /Independent domain validation remains a separate later gate/i);
});

test("D088 proof remains exact and authority stays external", () => {
  const decisionLog = read("docs/product/decision-log.md");
  const roadmap = read("docs/product/roadmap.md");
  const productSpec = read("docs/product/product-spec.md");
  const sop = read("docs/sop/meta-harness-sop.md");
  const implementationPlan = read("implementation_plan.md");
  const task = read("task.md");

  for (const surface of [decisionLog, roadmap, productSpec, sop, implementationPlan, task]) {
    assert.match(surface, /ENTRY_AUTHORITY_INVARIANT/i);
    assert.match(surface, /PASS_CURRENT/i);
    assert.match(surface, /REDIRECT/i);
    assert.match(surface, /CUSTODY_REQUIRED/i);
    assert.match(surface, /BLOCK/i);
  }

  for (const surface of [decisionLog, roadmap, productSpec, sop, implementationPlan]) {
    assert.match(surface, /checkout under evaluation cannot declare itself authoritative/i);
    assert.match(surface, /controller-authorized RunSpec/i);
    assert.match(surface, /signed canonical event or receipt/i);
    assert.match(surface, /independently anchored immutable evidence/i);
  }

  const gate0aBytes = read("docs/ops/audits/d088-gate0a-evidence.json");
  assert.equal(
    sha256(gate0aBytes),
    "3f13c3aa7a951ed77b26b3745dafdaba5b8acc47460464a88bb35345fad4d99c",
    "tracked Gate 0A evidence must remain byte-exact",
  );

  const proof = JSON.parse(read("docs/ops/audits/d088-cross-repository-proof.json"));
  assert.deepEqual(proof.repositories.map((repo) => repo.name), ["Meta-Harness", "Quant", "Leningrad"]);
  assert.equal(proof.comparison.recommendationsMateriallyDifferent, true);
  assert.deepEqual(proof.comparison.commonObservedBottleneck.observedIn, ["Meta-Harness", "Quant", "Leningrad"]);
  assert.equal(proof.responseSelection.selectedResponse, "ENTRY_AUTHORITY_INVARIANT");
  assert.match(proof.boundedR3Contract.objective, /cannot declare itself authoritative/i);
  assert.deepEqual(proof.boundedR3Contract.authorityInput.trustedSources, [
    "controller-authorized RunSpec",
    "explicit trusted operator input",
    "signed canonical event or receipt",
    "independently anchored immutable evidence",
  ]);
  assert.deepEqual(proof.boundedR3Contract.results, [
    "PASS_CURRENT",
    "REDIRECT",
    "CUSTODY_REQUIRED",
    "BLOCK",
  ]);
  assert.equal(proof.comparison.measurement.exactElapsedSeconds, null);
  assert.equal(proof.scoreRecommendation.afterExactCandidateAcceptance, "40 / 100");

  const r3Proof = JSON.parse(read("docs/ops/audits/d089-r3-entry-authority-proof.json"));
  assert.equal(r3Proof.status, "candidate-proof-complete-pending-independent-exact-commit-audit");
  assert.equal(r3Proof.canonicalAuthority.roadmapProofScore, "40 / 100");
  assert.equal(r3Proof.measurement.casesPassed, 6);
  assert.equal(r3Proof.measurement.casesFailed, 0);
  assert.equal(r3Proof.measurement.humanQuestions, 0);
  assert.equal(r3Proof.measurement.totalInputContextBytes, 4452);
  assert.equal(r3Proof.implementation.collectorCommit, "a80ebd3bc9ebb2d04be89f2e76301f32e4543f95");
  assert.equal(r3Proof.implementation.safety.publicCommandAdded, false);
  assert.equal(r3Proof.implementation.safety.evaluatorExecutesChildCommands, false);
  assert.equal(r3Proof.implementation.safety.collectorExecutesReadOnlyGitCommands, true);
  assert.equal(r3Proof.validation.focusedEvaluatorCollectorRollup.passed, 62);
  assert.equal(r3Proof.validation.completeSuite.testFiles, 125);
  assert.equal(r3Proof.validation.completeSuite.failed, 0);
  assert.equal(r3Proof.validation.completeSuite.durationSeconds, 212.9);
  assert.deepEqual(r3Proof.proofCases.map((item) => item.result), [
    "REDIRECT",
    "PASS_CURRENT",
    "BLOCK",
    "REDIRECT",
    "PASS_CURRENT",
    "CUSTODY_REQUIRED",
  ]);
  assert.equal(r3Proof.proofCases.at(-1).productFileCount, 30);
  assert.equal(r3Proof.proofCases.at(-1).unreachableProductFileCount, 30);
  assert.equal(r3Proof.exit.trackedLiveCollectorComplete, true);
  assert.equal(r3Proof.exit.independentAcceptance, false);
});

test("R3 scope excludes repository management and external product work", () => {
  const activePlan = read("implementation_plan.md").split("# Historical Plan:")[0];
  const task = read("task.md");
  const status = read(".meta-harness/status.md");

  for (const surface of [activePlan, task, status]) {
    assert.match(surface, /repository registry/i);
    assert.match(surface, /worktree creation/i);
    assert.match(surface, /cleanup|migration/i);
    assert.match(surface, /external product implementation/i);
  }

  assert.doesNotMatch(activePlan, /exact-commit re-audit is the current gate/i);
  assert.doesNotMatch(activePlan, /BLOCKED ONLY ON EXACT-COMMIT D088-R1 AUDIT ACCEPTANCE AND D089 ACTIVATION/i);
  assert.match(activePlan, /D089 remains canonical at `40 \/ 100`/i);
  assert.match(task, /After a clean pushed R3 candidate, stop for independent exact-commit audit/i);
});
