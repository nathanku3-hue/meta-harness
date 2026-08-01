"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8").replace(/\r\n/g, "\n");
}

function assertOutcomeFirstPlanner(text) {
  assert.match(text, /locked product intent|locked intent/i);
  assert.match(text, /owner authority|owner-signed acceptance/i);
  assert.match(text, /status[\s\S]*(?:last|cannot create|lower-precedence)/i);
  assert.match(text, /at most one .*audit\/repair round/i);
  assert.match(text, /journey prevention/i);
  assert.match(text, /material conclusion invalidation/i);
  assert.match(text, /credible irreversible loss/i);
  assert.match(text, /supported-platform unusability/i);
  assert.match(text, /reuse.*passed (?:evidence|gate)|passed gate remains passed/i);
  assert.match(text, /NO_BUILD/);
  assert.match(text, /USE_PRODUCT/);
  assert.match(text, /owner (?:scope change|changes scope)/i);
  assert.match(text, /observed supported-use defect warrant/i);
  assert.match(text, /claim(?: post-closure)? successor activation/i);
}

test("canonical SOP defines outcome-first execution and terminal continuation", () => {
  const sop = read("docs/sop/meta-harness-sop.md");
  assert.match(sop, /Meta-Harness 0\.4 Outcome-First SOP/);
  assertOutcomeFirstPlanner(sop);
  assert.match(sop, /five product fields/i);
  assert.match(sop, /complete suite once/i);
  assert.match(sop, /one clean canary/i);
  assert.match(sop, /Never install directly into dirty checkouts/i);
});

test("router, decision gate, and scope selector preserve one complete functional slice", () => {
  for (const relativePath of [
    "templates/skills/ship-fast-decision-router.md",
    "templates/contracts/ship-fast-decision-gate.md",
    "templates/skills/scope-selector.md",
  ]) assertOutcomeFirstPlanner(read(relativePath));
  const selector = read("templates/skills/scope-selector.md");
  assert.match(selector, /one functional slice/i);
  assert.match(selector, /acceptance-only, integration-only, packaging-only, review-only, documentation-only, or evidence-refresh/i);
});

test("candidate AGENTS maps terminal classification to exact user-facing guidance", () => {
  const agents = read("AGENTS.md");
  assert.match(agents, /classify internally as `NO_BUILD` and `USE_PRODUCT`/);
  assert.match(agents, /```text\nNo active slice\.\nUse the product\.\nWait for observed real-use friction\.\n```/);
});

test("worker contract puts product evidence before internal metadata", () => {
  const worker = read("templates/contracts/worker-done-contract.md");
  const fields = [
    "User journey executed:",
    "Observable result produced:",
    "User accomplished or learned:",
    "Product blocker:",
    "Next executable product action:",
  ];
  let prior = -1;
  for (const field of fields) {
    const index = worker.indexOf(field);
    assert.ok(index > prior, `${field} must retain outcome-first order`);
    prior = index;
  }
  assert.ok(worker.indexOf("Outcome:") > prior);
  assert.match(worker, /journey prevention/i);
  assert.match(worker, /material conclusion invalidation/i);
  assert.match(worker, /credible irreversible loss/i);
  assert.match(worker, /supported-platform unusability/i);
  assert.match(worker, /Reuse passed evidence/i);
  assert.match(worker, /return `USE_PRODUCT`/);
  assert.match(worker, /observed supported-use defect warrant/i);
  assert.match(worker, /No title, hash, command log, reviewer note, or status field may precede/i);
});

test("legacy gate is migration-only", () => {
  const legacy = read("docs/templates/ship_fast_decision_gate.md");
  assert.match(legacy, /legacy template is retired/i);
  assert.match(legacy, /templates\/contracts\/ship-fast-decision-gate\.md/);
  assert.doesNotMatch(legacy, /Mode:|What is done:|Decision needed from user:/);
  assert.ok(legacy.split("\n").filter((line) => line.trim()).length <= 3);
});

test("ops contracts are short, SOP-linked, and fail closed", () => {
  const ops = ["docs/ops/state-machine.md", "docs/ops/git-preflight.md", "docs/ops/role-contracts.md"];
  for (const relativePath of ops) {
    const text = read(relativePath);
    assert.ok(text.split("\n").length <= 30, relativePath + " exceeds 30 lines");
    assert.match(text, /\.\.\/sop\/meta-harness-sop\.md#pm-output-contract/);
  }
  assert.match(read(ops[0]), /Any failed hard gate emits .*BLOCK/);
  assert.doesNotMatch(read(ops[0]), /PREFLIGHT|VERIFY/);
  assert.match(read(ops[1]), /any pre-existing dirt fails the fresh implementation preflight/);
  assert.match(read(ops[1]), /Never use reset, clean, stash, checkout, or force operations/);
  assert.match(read(ops[2]), /Patch worker:[\s\S]+never owns branch selection[\s\S]+merge/i);
  assert.match(read(ops[2]), /affirmative signal closes only a pure .*HUMAN_TASTE/i);
  assert.match(read(ops[2]), /Status-only artifacts, expert packets, and approval packets do not count as shipped progress/i);
  assert.match(read(ops[2]), /Three information channels stay distinct/i);
  assert.match(read(ops[2]), /Requested audits, reviews, and safety evidence are separate surfaces/i);
  assert.match(read(ops[2]), /Final chat answers use the adaptive closure, not the worker-report artifact or orchestrator handover/i);
});
