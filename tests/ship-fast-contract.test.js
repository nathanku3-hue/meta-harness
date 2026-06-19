"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8").replace(/\r\n/g, "\n");
}

function nonEmptyFenceLines(text, marker) {
  const markerIndex = text.search(marker);
  assert.notEqual(markerIndex, -1, `missing marker: ${marker}`);
  const fence = text.slice(markerIndex).match(/```text\n([\s\S]*?)\n```/);
  assert.ok(fence, `missing output fence after: ${marker}`);
  return fence[1].split("\n").filter((line) => line.trim());
}

function assertOneLinerSchema(text) {
  const lines = nonEmptyFenceLines(text, /one physical `PM_CLOSURE` line/i);
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.match(
    line,
    /^Artifact: PM_CLOSURE \| Route: <FAST\|REVIEW> \| Outcome: <SHIP\|REVIEW\|DECISION_NEEDED\|FOLLOW_UP_QUEUED> \| Verdict: <result and reason> \| Next: <action or stop>$/
  );
  assert.equal((line.match(/\bArtifact:/g) || []).length, 1);
  assert.equal((line.match(/\bRoute:/g) || []).length, 1);
  assert.equal((line.match(/\bOutcome:/g) || []).length, 1);
}

function assertCoreContract(relativePath) {
  const text = read(relativePath);
  assert.match(text, /agent contract|agent-level `ship-fast`/i);
  assert.match(text, /no Python, Node, CLI|does not add or alter Python, Node, CLI/i);
  assert.match(text, /never emit(?:s)? `SLOW`/i);
  assert.match(text, /compress[^\n]+`REVIEW`[^\n]+`BLOCK`/i);
  assert.match(text, /`FAST`:[^\n]+owned[^\n]+approval boundary/i);
  assert.match(text, /`REVIEW`:[^\n]+bounded[^\n]+decision/i);
  assert.match(text, /`BLOCK`:[^\n]+authority[^\n]+evidence/i);
  for (const type of ["PM_CLOSURE", "REVIEW_SPECIMEN", "MATERIALIZED_IMPLEMENTATION"]) {
    assert.match(text, new RegExp(`\\b${type}\\b`));
  }
  assert.match(text, /affirmative signal[\s\S]+closes only a pure `HUMAN_TASTE` gate/i);
  assert.match(text, /no authority, security, evidence, scope, safety, git, or implementation gate/i);
  assertOneLinerSchema(text);
  assert.ok(nonEmptyFenceLines(text, /at most 3 non-empty lines/i).length <= 3);
  assert.ok(nonEmptyFenceLines(text, /at most 5 non-empty lines/i).length <= 5);
}

test("canonical SOP defines only the three agent ship-fast routes", () => {
  const sop = read("docs/sop/meta-harness-sop.md");
  assert.match(sop, /^Status: canonical$/m);
  assert.match(sop, /canonical contract for agent-level `ship-fast`/);
  const contract = sop.slice(sop.indexOf("### PM Output Contract"), sop.indexOf("## Status Truth Template"));
  assert.deepEqual(
    [...contract.matchAll(/^- `([^`]+)`:/gm)].slice(0, 3).map((match) => match[1]),
    ["FAST", "REVIEW", "BLOCK"]
  );
  assert.match(contract, /`SLOW` is never emitted/);
  assert.match(contract, /`REVIEW` `PM_CLOSURE` is at most 3 non-empty lines/);
  assert.match(contract, /`BLOCK` `PM_CLOSURE` is at most 5 non-empty lines/);
  assert.match(contract, /affirmative signal[\s\S]+closes only a pure `HUMAN_TASTE` gate/i);
});

test("router and decision gate are independently distributable", () => {
  assertCoreContract("templates/skills/ship-fast-decision-router.md");
  assertCoreContract("templates/contracts/ship-fast-decision-gate.md");
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
    assert.ok(text.split("\n").length <= 30, `${relativePath} exceeds 30 lines`);
    assert.match(text, /\.\.\/sop\/meta-harness-sop\.md#pm-output-contract/);
  }
  assert.match(read(ops[0]), /Any failed hard gate emits `BLOCK`/);
  assert.doesNotMatch(read(ops[0]), /PREFLIGHT|VERIFY/);
  assert.match(read(ops[1]), /any pre-existing dirt fails the fresh implementation preflight/);
  assert.match(read(ops[1]), /Never use reset, clean, stash, checkout, or force operations/);
  assert.match(read(ops[2]), /Patch worker:[\s\S]+never owns branch selection[\s\S]+merge/i);
  assert.match(read(ops[2]), /affirmative signal closes only a pure `HUMAN_TASTE` gate/i);
});
