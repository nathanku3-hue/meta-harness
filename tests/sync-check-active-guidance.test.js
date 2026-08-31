"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  gateFirstGuidanceConflicts,
  scanContracts,
  scanHostGuidanceActionLawConflicts,
} = require("../lib/sync-check");
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

test("contract scan rejects gate-first active guidance", () => {
  const cases = [
    ["audit before plan", "active guidance requires audit before planning"],
    ["audit after the worker plan", "active guidance requires audit after the worker plan"],
    ["wait for audit", "active guidance waits for audit before execution"],
    ["pending audit approval", "active guidance makes audit a pending gate"],
    ["audit approval before coding", "active guidance requires audit approval before execution"],
    ["implementation hold until audit approval", "active guidance holds implementation for audit"],
    ["show a detailed plan and wait", "active guidance requires a detailed plan and wait"],
    ["ambiguity confirmation before go", "active guidance requires blanket ambiguity confirmation"],
    ["first-round audit", "active guidance requires a first-round audit"],
    ["second-round audit after the worker plan", "active guidance requires a second audit round"],
    ["do not begin implementation until audit", "active guidance forbids execution until audit"],
  ];

  for (const [line, detail] of cases) {
    const targetRoot = tempDir();
    writeFile(targetRoot, "AGENTS.md", `# Agent Guidance\n\n${line}\n`);
    const result = scanContracts({ targetRoot });
    assert.equal(result.status, "FAIL", line);
    assert.equal(result.items.some((item) => item.detail === detail), true, line);
  }
});

test("adversarial operator wording is detected as gate-first input", () => {
  const prompt = [
    "first-round audit",
    "show a detailed plan and wait",
    "wait for audit",
    "audit after the worker plan",
    "ambiguity confirmation before go",
  ].join("\n");
  const details = gateFirstGuidanceConflicts(prompt);
  assert.equal(details.includes("active guidance requires a first-round audit"), true);
  assert.equal(details.includes("active guidance requires a detailed plan and wait"), true);
  assert.equal(details.includes("active guidance waits for audit before execution"), true);
  assert.equal(details.includes("active guidance requires audit after the worker plan"), true);
  assert.equal(details.includes("active guidance requires blanket ambiguity confirmation"), true);
});

test("action-law detector catches the demonstrated universal review and routine approval conflicts", () => {
  const prompt = [
    "MANDATORY REVIEW BEFORE ALL NEW WORK.",
    "SAW AFTER EVERY ROUND.",
    "Decision needed: authorize the next packet.",
    "Ask GO before reversible work.",
  ].join("\n");
  assert.deepEqual(gateFirstGuidanceConflicts(prompt), [
    "active guidance requires universal review before new work",
    "active guidance requires review or SAW after every round",
    "active guidance requires routine owner approval before ordinary continuation",
    "active guidance requires routine owner approval before ordinary continuation",
  ]);
});

test("action-law detector catches fixed architecture-to-GO review lifecycle capture", () => {
  assert.deepEqual(gateFirstGuidanceConflicts([
    "BIG CHANGE → Architecture → pause → GO.",
    "After Architecture, pause and wait for approval.",
  ].join("\n")), [
    "active guidance turns big-change architecture review into a routine owner gate",
    "active guidance pauses after architecture review for routine owner approval",
  ]);
});

test("action-law detector preserves explicit safe negations", () => {
  assert.deepEqual(gateFirstGuidanceConflicts([
    "Do not require review before all new work.",
    "Never require SAW after every round.",
    "Do not ask for GO before reversible work.",
    "Do not pause after Architecture for GO.",
  ].join("\n")), []);
});

test("host action-law scan ignores inactive guidance bundles", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, "AGENTS.md", [
    "# Agent Guidance",
    "",
    "MANDATORY REVIEW BEFORE ALL NEW WORK.",
    "SAW AFTER EVERY ROUND.",
    "Decision needed: authorize the next packet.",
  ].join("\n"));
  writeFile(targetRoot, ".agents/prototypes/old/SKILL.md", "MANDATORY REVIEW BEFORE ALL NEW WORK.\n");

  const result = scanHostGuidanceActionLawConflicts({ targetRoot });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.every((item) => item.path === "AGENTS.md"), true);
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

test("contract scan accepts zero-gate outcome-first guidance and explicit prohibitions", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, "AGENTS.md", [
    "# Meta-Harness 0.4 Agent Contract",
    "",
    "Read locked product intent and owner authority before status.",
    "Default pre-execution audit count: zero.",
    "Begin the nearest reversible action in the same round.",
    "A request to audit, review, or plan does not imply a pause.",
    "Do not wait for audit or request ambiguity confirmation.",
    "One audit is the absolute ceiling. It is not a route, phase, approval, gate, or pause.",
    "After shipped completion return NO_BUILD and USE_PRODUCT unless owner scope change or a complete observed supported-use defect warrant exists.",
    "Worker reports begin with product fields; normal final chat remains concise.",
  ].join("\n"));

  const result = scanContracts({ targetRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, []);
});
