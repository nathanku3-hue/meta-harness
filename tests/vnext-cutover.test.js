"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const LIB = path.join(ROOT, "lib");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
}

function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

test("new production code cannot mint Outcome Claims outside the historical compatibility module", () => {
  const constructors = /\b(?:ensureOutcomeClaim|acquireOutcomeClaim|acquireOutcomeClaimSession)\s*\(/gu;
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => path.basename(filePath) !== "outcome-claim.js")
    .filter((filePath) => constructors.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("public repository entry has no global INVALID execution state", () => {
  const { META_ENTRY_ACTIONS } = require("../lib/repository-entry");
  assert.deepEqual([...META_ENTRY_ACTIONS], ["CONTINUE", "IDLE"]);
});

test("new OWNER_GOAL and REPO_RUN attempts cannot issue an ExecutionPermit", () => {
  const workLoop = read("lib/work-loop.js");
  const permitCalls = workLoop.match(/\bissueExecutionPermit\s*\(/gu) || [];
  assert.equal(permitCalls.length, 1, "work loop must retain only the historical compatibility permit call");
  assert.match(workLoop, /const runCapabilityForNewAttempts = \["REPO_RUN", "OWNER_GOAL"\]\.includes\(session\.origin\.type\);/u);
  assert.match(workLoop, /if \(runCapabilityForNewAttempts\) \{[\s\S]{0,2500}?executionPermit = null;[\s\S]{0,2500}?\} else \{[\s\S]{0,1600}?executionPermit = issueExecutionPermit\(/u);
});

test("legacy INVALIDATED_REPLAN is read-compatible but new execution emits ordinary replan", () => {
  const plannerInput = read("lib/repo-planner-input.js");
  const interpreter = read("lib/repo-closure-interpreter.js");
  assert.match(plannerInput, /interpretation\?\.disposition === "INVALIDATED_REPLAN"\) return "REPLAN_REQUIRED"/u);
  assert.doesNotMatch(plannerInput, /AUTONOMOUS_CONTINUATION_DISPOSITIONS = new Set\(\[[^\]]*INVALIDATED_REPLAN/u);
  assert.match(interpreter, /value\.disposition === "INVALIDATED_REPLAN" \? "REPLAN_REQUIRED" : value\.disposition/u);

  const compatibilityFiles = javascriptFiles(LIB)
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes("INVALIDATED_REPLAN"))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(compatibilityFiles, ["lib/repo-closure-interpreter.js", "lib/repo-planner-input.js"]);
});

test("legacy repo-decision compiler and Decision Plane are absent from production source", () => {
  for (const relativePath of [
    "lib/repo-decision.js",
    "lib/repo-decision-plane-v2.js",
    "lib/repo-decision-plane.js",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), false, `${relativePath} must not remain in production`);
  }
  for (const relativePath of [
    "tests/fixtures/legacy-repo-decision.js",
    "tests/fixtures/legacy-repo-decision-plane-v2.js",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `${relativePath} preserves regression-only compatibility coverage`);
  }
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => /require\(["']\.\/repo-decision(?:-plane-v2)?["']\)/u.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("retained legacy records have demonstrated recovery or semantic-projection consumers", () => {
  const expectedConsumers = new Map([
    ["execution-closure", ["lib/repo-work-wave.js", "lib/repo-product-integration.js", "lib/work-loop.js"]],
    ["execution-permit", ["lib/work-loop.js", "lib/work-git.js"]],
    ["outcome-claim", ["lib/repo-work-wave.js", "lib/read-only-interaction.js"]],
    ["workspace-custody", ["lib/work-loop.js", "lib/work-git.js"]],
    ["world-authority", ["lib/world-transition.js", "lib/repo-work-wave.js"]],
    ["world-transition", ["lib/repo-work-wave.js", "lib/terminal-endgame.js"]],
  ]);
  for (const [moduleName, consumers] of expectedConsumers) {
    assert.equal(fs.existsSync(path.join(LIB, `${moduleName}.js`)), true, `${moduleName} must exist while its demonstrated value remains`);
    for (const consumer of consumers) {
      const text = read(consumer);
      assert.match(text, new RegExp(`require\\(["']\\./${moduleName}["']\\)`, "u"), `${consumer} must consume ${moduleName}`);
    }
  }
});

test("repository entry recovery does not treat terminal custody labels as product authority", () => {
  const repositoryEntry = read("lib/repository-entry.js");
  assert.match(repositoryEntry, /latestOwnerGoalJournalRecovery/u);
  assert.doesNotMatch(repositoryEntry, /TERMINAL_BLOCKED|TERMINAL_BLOCKED_DIRTY|TERMINAL_ABANDONED/u);
});

test("production semantic projection code does not describe World as execution authority", () => {
  const offenders = javascriptFiles(LIB)
    .filter((filePath) => /authoritative World|World authority|product authority/iu.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
  assert.deepEqual(offenders, []);
});

test("model-facing surfaces do not regress to the gate-first Round-4 vocabulary", () => {
  const surfaces = [
    "AGENTS.md",
    "lib/coding-worker.js",
    "lib/repo-logical-planner.js",
    "lib/work-forward-motion.js",
    "lib/commands/work.js",
    "lib/read-only-interaction.js",
  ];
  const forbidden = [
    /continuation authority is invalid/iu,
    /smallest lawful unblock/iu,
    /explicitly authorize committing/iu,
    /custody rules?[^\n]{0,80}(?:hard-?block|block execution)/iu,
    /Claim authority/iu,
    /ExecutionPermit topology/iu,
    /constitutional owner authority/iu,
  ];
  const hits = [];
  for (const relativePath of surfaces) {
    const text = read(relativePath);
    for (const pattern of forbidden) {
      if (pattern.test(text)) hits.push(`${relativePath}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("injected agent contract leads with product and never restores an authority-first truth order", () => {
  const agents = read("AGENTS.md");
  assert.ok(agents.indexOf("## Product law") >= 0);
  assert.ok(agents.indexOf("## Coordination law") > agents.indexOf("## Product law"));
  assert.doesNotMatch(agents, /truth order/iu);
  assert.doesNotMatch(agents, /\bClaim\b|ExecutionPermit/iu);
  assert.match(agents, /Select the nearest reversible action/iu);
  assert.match(agents, /Failed means is not failed Outcome/iu);
});
