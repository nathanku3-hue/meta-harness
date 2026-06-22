"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { scanContracts } = require("../lib/sync-check");
const { tempDir, writeFile } = require("./helpers/cli");

test("contract scan allows warning text mentioning old headings", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/templates/contracts/worker-done-contract.md", [
    "# Worker Done Contract",
    "",
    "Do not use # Worker Report as the primary report heading.",
    "Do not use ## Result or ## Human Summary as section names.",
    "## Worker Report Artifact",
    "",
  ].join("\n"));

  const result = scanContracts({ targetRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, []);
});

test("contract scan rejects active guidance that pastes worker artifacts into final chat", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, "AGENTS.md", [
    "# Agent Guidance",
    "",
    "Final responses must use the Ship-Fast PM Brief.",
    "The final answer must start with `Outcome`, `Round`, `Progress`, and `Confidence`.",
  ].join("\n"));

  const result = scanContracts({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items.map((item) => item.detail), [
    "active guidance requires the worker-report artifact as the final chat response",
    "active guidance requires artifact metadata at the start of final chat",
  ]);
});

test("contract scan rejects internal closure labels in installed and active guidance", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".agents/skills/leaky.md", [
    "# Leaky Skill",
    "",
    "```text",
    "Artifact: PM_CLOSURE | Route: REVIEW | Outcome: DECISION_NEEDED",
    "Route: BLOCK | Outcome: BLOCKED",
    "```",
  ].join("\n"));

  const result = scanContracts({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items.map((item) => item.detail), [
    "active guidance exposes internal closure labels as user output",
    "active guidance exposes internal route and outcome labels as user output",
  ]);
});

test("contract scan allows active guidance that separates artifacts from chat closure", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, "AGENTS.md", [
    "# Agent Guidance",
    "",
    "Worker reports are saved as evidence artifacts.",
    "Final chat answers use a concise adaptive closure and omit empty items.",
  ].join("\n"));

  const result = scanContracts({ targetRoot });

  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, []);
});
