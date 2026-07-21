"use strict";

const assert = require("node:assert/strict");
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
  assert.match(roadmap, /active D085 direction under canonical D086 acceptance/i);
  assert.match(roadmap, /ROADMAP_PROOF_SCORE = 30 \/ 100/);
  assert.match(roadmap, /R1[\s\S]*DONE — INDEPENDENTLY ACCEPTED UNDER D086/i);
  assert.match(roadmap, /R2[\s\S]*CURRENT — HUMAN TARGET DECISION REQUIRED/i);

  const decisionLog = read("docs/product/decision-log.md");
  const d086 = decisionLog.indexOf("## D086: Accept R1, Bank 30/100, and Activate D085 for R2 Target Lock");
  const d085 = decisionLog.indexOf("## D085 (candidate): Propose the R0–R6 External Product-Proof Roadmap");
  assert.ok(d086 !== -1 && d085 !== -1 && d086 < d085, "D086 must be added without rewriting historical D085");
});

test("D085 keeps R2 prerequisites out of R1 and repair out of R6", () => {
  const roadmap = read("docs/product/roadmap.md");
  const r1 = phase(roadmap, "R1", "R2");
  const r2 = phase(roadmap, "R2", "R3");
  const r3 = phase(roadmap, "R3", "R4");
  const r6 = phase(roadmap, "R6", null);

  assert.match(r1, /target-independent Meta-Harness execution base/i);
  assert.match(r1, /external repository, target commit, target worktree, and product behavior remain intentionally unset/i);
  assert.doesNotMatch(r1, /named non-Meta-Harness target repository and exact base commit/i);
  assert.doesNotMatch(r1, /clean isolated target worktree/i);
  assert.doesNotMatch(r1, /four-line user \/ job/i);
  assert.doesNotMatch(r1, /bounded RunSpec bound to `intent-v1`/i);

  assert.match(r2, /named non-Meta-Harness product repository/i);
  assert.match(r2, /exact target base commit and one clean isolated target worktree/i);
  assert.match(r2, /four-line user \/ job \/ specialist judgment \/ observable result lock/i);
  assert.match(r2, /bounded RunSpec bound to `intent-v1`/i);

  assert.match(r3, /implement only the smallest proven harness repair/i);
  assert.match(r3, /resume the same external slice/i);
  assert.match(r3, /independent acceptance/i);

  assert.match(r6, /exclusively post-shipment domain validation or replication/i);
  assert.doesNotMatch(r6, /observed-blocker path|smallest harness repair|resume and merge\/package/i);
});
