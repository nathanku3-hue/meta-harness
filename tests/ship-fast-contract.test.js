"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8").replace(/\r\n/g, "\n");
}

function assertAdaptiveClosurePolicy(text) {
  assert.match(text, /canonical user-visible closure policy/i);
  assert.match(text, /result and practical effect/i);
  assert.match(text, /nearest evidence/i);
  assert.match(text, /next action when work remains/i);
  assert.match(text, /highest-priority user decision when one is required/i);
  assert.match(text, /Omit empty or .*none.* items/i);
  assert.match(text, /four applicable semantic items/i);
  assert.match(text, /budget applies only to normal human-facing closure/i);
  assert.match(text, /separate surfaces[\s\S]+without converting .*PM_CLOSURE.* into an audit packet/i);
  for (const owner of ["human: taste/acceptance", "expert: domain knowledge", "expert: system methodology"]) {
    assert.ok(text.includes(`Decision needed (${owner}): <question>`));
  }
  assert.match(text, /Approval needed: <bounded authority, scope, and consequence, or none>/i);
  assert.match(text, /not expert-decision tags/i);
  assert.match(text, /machine_tier.*maps into .*closure_route.*user_visible_result/is);
  assert.match(text, /Tier fields may remain in .*WORKER_REPORT.*accountability and evidence/i);
  assert.doesNotMatch(text, /Artifact: PM_CLOSURE \| Route:/);
  assert.doesNotMatch(text, /Route: BLOCK \| Outcome:/);
  assert.doesNotMatch(text, /at most 3 non-empty lines/i);
  assert.doesNotMatch(text, /at most 5 non-empty lines/i);
  assert.doesNotMatch(text, /one physical line/i);
  assert.doesNotMatch(text, /Mode:\s*one-liner/i);
}

function assertCoreContract(relativePath) {
  const text = read(relativePath);
  assert.match(text, /agent contract|agent-level .*ship-fast/i);
  assert.match(text, /no Python, Node, CLI|does not add or alter Python, Node, CLI/i);
  assert.match(text, /never emit(?:s)? .*SLOW/i);
  assert.match(text, /compress[^\n]+REVIEW[^\n]+BLOCK/i);
  assert.match(text, /FAST[^\n]+owned[^\n]+approval boundary/i);
  assert.match(text, /REVIEW[^\n]+bounded[^\n]+decision/i);
  assert.match(text, /BLOCK[^\n]+authority[^\n]+evidence/i);
  for (const type of ["PM_CLOSURE", "REVIEW_SPECIMEN", "MATERIALIZED_IMPLEMENTATION"]) {
    assert.match(text, new RegExp("\\b" + type + "\\b"));
  }
  assert.match(text, /Status-only artifacts are not shipped progress/i);
  assert.match(text, /must not create another status-only packet as progress/i);
  assert.match(text, /PM closure is the chat answer, not the worker-report artifact/i);
  assert.match(text, /hide .*Outcome.*Round.*Progress.*Confidence/i);
  assert.match(text, /approval text/i);
  assert.match(text, /affirmative signal[\s\S]+closes only a pure .*HUMAN_TASTE/i);
  assert.match(text, /no authority, security, evidence, scope, safety, git, or implementation gate/i);
  assertAdaptiveClosurePolicy(text);
}

test("canonical SOP separates closure, handover, and worker evidence", () => {
  const sop = read("docs/sop/meta-harness-sop.md");
  assert.match(sop, /^Status: canonical$/m);
  assert.match(sop, /canonical contract for agent-level .*ship-fast/);
  const contract = sop.slice(sop.indexOf("### PM Output Contract"), sop.indexOf("## Status Truth Template"));
  assert.match(contract, /FAST/);
  assert.match(contract, /REVIEW/);
  assert.match(contract, /BLOCK/);
  assert.match(contract, /SLOW.*never emitted/i);
  assert.match(contract, /one canonical user-visible closure policy/i);
  assert.match(contract, /PM_CLOSURE.*adaptive human-facing status and decision surface/i);
  assert.match(contract, /ORCHESTRATOR_HANDOVER.*dense continuation state/i);
  assert.match(contract, /WORKER_REPORT.*exhaustive execution, validation, accountability, and evidence/i);
  assert.match(contract, /Requested audits, reviews, safety evidence, and orchestrator handover state are separate surfaces/i);
  assert.match(contract, /machine_tier.*maps into .*closure_route.*user_visible_result/is);
  assert.match(contract, /Tier fields may remain in .*WORKER_REPORT/i);
  assert.match(contract, /Status-only artifacts are not shipped progress/i);
  assert.match(contract, /Expert packets, approval packets, PM status, and dashboards/i);
  assert.match(contract, /PM closure is the chat answer, not the worker-report artifact/i);
  assert.match(contract, /emit only the pasteable approval block/i);
  assert.match(contract, /affirmative signal[\s\S]+closes only a pure .*HUMAN_TASTE/i);
});

test("router and decision gate are independently distributable", () => {
  assertCoreContract("templates/skills/ship-fast-decision-router.md");
  assertCoreContract("templates/contracts/ship-fast-decision-gate.md");
});

test("worker contract preserves dense handover and internal SLOW evidence", () => {
  const worker = read("templates/contracts/worker-done-contract.md");
  for (const channel of ["PM_CLOSURE", "ORCHESTRATOR_HANDOVER", "WORKER_REPORT"]) {
    assert.match(worker, new RegExp("`" + channel + "`"));
  }
  for (const field of [
    "CurrentTruth",
    "MaterialDelta",
    "Validation",
    "OpenRisks",
    "BlockedBy",
    "DecisionQueue",
    "NextExecutableAction",
    "Boundaries",
    "HumanAuditState",
    "HumanAuditScope",
    "Provenance",
  ]) {
    assert.match(worker, new RegExp("^" + field + ":", "m"));
  }
  assert.match(worker, /ORCHESTRATOR_HANDOVER.*no arbitrary line cap/i);
  assert.match(worker, /SLOW.*remain valid in worker-report accountability and evidence fields/i);
  assert.match(worker, /must not appear in normal chat or .*PM_CLOSURE.* output/i);
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
