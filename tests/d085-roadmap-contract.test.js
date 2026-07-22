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

test("D085 is active only when D086 canonical event and status agree", () => {
  const activation = events().findLast(
    (event) => event.authority_receipt?.receipt_id === "D086-D085-R1-ACCEPTANCE",
  );
  assert.ok(activation, "missing D086 activation receipt");
  assert.equal(activation.decision, "D086");
  assert.equal(activation.truth_snapshot, true);
  assert.match(activation.result, /ROADMAP_PROOF_SCORE = 30 \/ 100/);
  assert.match(activation.result, /S-006M_EXTERNAL_LOOPS_SHIPPED = 0 \/ 1/);
  assert.match(activation.result, /D085 is active authority/);
  assert.match(activation.next_action, /^Complete the R2 four-line target lock/);

  const status = read(".meta-harness/status.md");
  assert.match(status, /ROADMAP_PROOF_SCORE = 30 \/ 100/);
  assert.match(status, /S-006M_EXTERNAL_LOOPS_SHIPPED = 0 \/ 1/);
  assert.match(status, /D085 is active authority/);
  assert.match(status, /Next action:\r?\nComplete the R2 four-line target lock/);
  assert.ok(status.includes(activation.goal));
  assert.ok(status.includes(activation.stop_criteria));
  assert.ok(status.includes(activation.ts));

  const roadmap = read("docs/product/roadmap.md");
  assert.match(roadmap, /active D085 direction under canonical D086 acceptance; D088 thin cross-repository correction is candidate-only/i);
  assert.match(roadmap, /ROADMAP_PROOF_SCORE = 30 \/ 100/);
  assert.match(roadmap, /R1[\s\S]*DONE — INDEPENDENTLY ACCEPTED UNDER D086/i);
  assert.match(roadmap, /D085 R2 REMAINS OFFICIAL; D088 R2A\/R2B\/R2C CANDIDATE EVIDENCE COMPLETE/i);

  const decisionLog = read("docs/product/decision-log.md");
  const d088 = decisionLog.indexOf("## D088 (candidate): Make Thin Cross-Repository Usefulness the Next Product Proof");
  const d087 = decisionLog.indexOf("## D087 (candidate): Make Product Proof per Time the Selection Rule");
  const d086 = decisionLog.indexOf("## D086: Accept R1, Bank 30/100, and Activate D085 for R2 Target Lock");
  const d085 = decisionLog.indexOf("## D085 (candidate): Propose the R0–R6 External Product-Proof Roadmap");
  assert.ok(
    d088 !== -1 && d087 !== -1 && d086 !== -1 && d085 !== -1
      && d088 < d087 && d087 < d086 && d086 < d085,
    "D088 and D087 must remain append-only above D086 and historical D085",
  );
});

test("D088 preserves R1 and candidate-proves the complete cross-repository R2 exit", () => {
  const roadmap = read("docs/product/roadmap.md");
  const r1 = phase(roadmap, "R1", "R2");
  const r2 = phase(roadmap, "R2", "R3");
  const r3 = phase(roadmap, "R3", "R4");
  const r6 = phase(roadmap, "R6", null);

  assert.match(r1, /target-independent Meta-Harness execution base/i);
  assert.match(r1, /external repositories and product work remain unset/i);
  assert.doesNotMatch(r1, /proving set|cross-repository|finance GodView/i);

  assert.match(r2, /R2A — Lock the Minimal Owned Layers and Deletion Rules/i);
  assert.match(r2, /R2B — Read-Only Cross-Repository Proof/i);
  assert.match(r2, /R2C — Name the Common Bottleneck and Smallest Reusable Patch/i);
  assert.match(r2, /R2A[\s\S]*Candidate evidence: COMPLETE PENDING AUDIT/i);
  assert.match(r2, /R2B[\s\S]*Meta-Harness, Quant, and Leningrad/i);
  assert.match(r2, /ENTRY_AUTHORITY_AMBIGUITY/i);
  assert.match(r2, /ENTRY_AUTHORITY_INVARIANT/i);
  assert.match(r2, /NO_BUILD[\s\S]*guidance-only responses were compared and rejected/i);
  assert.match(r2, /appropriately different recommendations/i);
  assert.match(r2, /finance GodView is evaluated as one candidate repository, not assumed as the winner/i);
  assert.doesNotMatch(r2, /recommended first external adopter/i);

  assert.match(r3, /BLOCKED ON EXACT-COMMIT D088\/R2 AUDIT AND D089 ACTIVATION/i);
  assert.match(r3, /Implement only the exact reusable capability named by R2C/i);
  assert.match(r3, /clear deletion or shrink path/i);

  assert.match(r6, /Compare Benefit and Remove Obsolete Layers/i);
  assert.match(r6, /delete, shrink, or demote/i);
  assert.match(r6, /Independent domain validation remains a separate later gate/i);
});

test("D088 proof evidence is exact, thin, differentiated, and candidate-only", () => {
  const roadmap = read("docs/product/roadmap.md");
  const decisionLog = read("docs/product/decision-log.md");
  const status = read(".meta-harness/status.md");
  const allEvents = events();

  assert.match(decisionLog, /D086 and `.meta-harness\/status.md` remain official\. D087 and D088 are documentation candidates only/i);
  assert.match(decisionLog, /Gate 0B double-prime/i);
  assert.match(decisionLog, /ENTRY_AUTHORITY_INVARIANT/i);
  assert.match(decisionLog, /ROADMAP_PROOF_SCORE = 40 \/ 100/i);
  assert.match(roadmap, /pinned Node 25 validation/i);
  assert.match(roadmap, /one immutable candidate commit and explicit branch/i);
  assert.match(roadmap, /first proof did not instrument exact elapsed time/i);

  const gate0aBytes = read("docs/ops/audits/d088-gate0a-evidence.json");
  assert.equal(
    sha256(gate0aBytes),
    "3f13c3aa7a951ed77b26b3745dafdaba5b8acc47460464a88bb35345fad4d99c",
    "tracked Gate 0A evidence must remain byte-exact",
  );
  const gate0a = JSON.parse(gate0aBytes);
  assert.equal(gate0a.authorityDecision.selectedCleanBaseForGate0B, "711ae4e53034ded102968f04ed17c44619a4d3fe");
  assert.equal(gate0a.localValue.destructiveOperationsAllowed, false);

  const proof = JSON.parse(read("docs/ops/audits/d088-cross-repository-proof.json"));
  assert.deepEqual(proof.repositories.map((repo) => repo.name), ["Meta-Harness", "Quant", "Leningrad"]);
  assert.equal(proof.comparison.recommendationsMateriallyDifferent, true);
  assert.deepEqual(proof.comparison.commonObservedBottleneck.observedIn, ["Meta-Harness", "Quant", "Leningrad"]);
  assert.equal(proof.responseSelection.selectedResponse, "ENTRY_AUTHORITY_INVARIANT");
  assert.deepEqual(
    proof.responseSelection.responsesCompared.map((response) => response.class),
    ["NO_BUILD", "COMPACT_SOP_OR_SKILL", "ONE_MINIMAL_MACHINE_CHECKABLE_INVARIANT"],
  );
  assert.equal(proof.comparison.measurement.exactElapsedSeconds, null);
  assert.equal(proof.scoreRecommendation.now, "30 / 100");
  assert.equal(proof.scoreRecommendation.afterExactCandidateAcceptance, "40 / 100");

  assert.doesNotMatch(status, /D087|D088|D089/);
  assert.equal(allEvents.some((event) => ["D087", "D088", "D089"].includes(event.decision)), false);

  for (const surface of [
    "docs/product/decision-log.md",
    "docs/product/roadmap.md",
    "docs/product/product-spec.md",
    "docs/sop/meta-harness-sop.md",
    "implementation_plan.md",
  ]) {
    assert.match(read(surface), /D088/i, `${surface} must carry authoritative D088 candidate content`);
  }

  for (const surface of [
    "README.md",
    "docs/product/README.md",
    "docs/product/prd.md",
    "docs/product/problem-questions.md",
    "docs/product/runtime-authority-architecture.md",
    "docs/architecture/map.md",
    "docs/ops/role-contracts.md",
    "docs/ops/state-machine.md",
    "task.md",
  ]) {
    assert.doesNotMatch(read(surface), /D088/i, `${surface} must not duplicate D088 phase narration`);
  }
});
