"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { automaticRequest, renderHuman } = require("../lib/commands/work");
const { pinProductDirection } = require("../lib/product-direction");
const { compileRepoDecision, loadRepoCharter } = require("../lib/repo-decision");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const { assertTerminalEndgameCovered, terminalEndgameCoverage } = require("../lib/terminal-endgame");
const { readCurrentWorldState } = require("../lib/world-transition");
const { tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const {
  fakeInterpretation,
  git,
  monotonicNow,
  persistInitial,
  proposal,
  repository,
  runner,
} = require("./helpers/linear-product-head");

function installRequiredEndgame(root) {
  const current = fs.readFileSync(path.join(root, "PRODUCT.md"), "utf8");
  const prefix = current.split("## Semantic Authority")[0].trimEnd();
  const binding = {
    state: "BOUND",
    atoms: [
      {
        id: "DESTINATION_E1",
        kind: "DESTINATION",
        identity: "Deliver e1.",
        role: "REQUIRED_DESTINATION",
      },
    ],
  };
  const content = `${prefix}\n\n## Semantic Authority\n\n\`\`\`json\n${JSON.stringify(binding, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(path.join(root, "PRODUCT.md"), content, "utf8");
  git(root, ["add", "PRODUCT.md"]);
  git(root, ["commit", "-m", "require terminal destination"]);
}

function plannerCandidate(id, productId = id) {
  const value = proposal(productId);
  return {
    id,
    productResult: value.productResult,
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: value.allowedPaths,
    continuesFromTransitionDigests: [],
  };
}

function oneOutcomePlanner(id, productId = id) {
  return async ({ plannerInput }) => {
    const learned = new Set(plannerInput.currentWorld.payload.learned || []);
    return {
      batch: {
        schemaVersion: "planner-candidate-batch/v3",
        proposals: learned.has(id) ? [] : [plannerCandidate(id, productId)],
      },
    };
  };
}

function installUseProductDecision(root, current) {
  const direction = pinProductDirection(root);
  const charter = loadRepoCharter(root);
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-decision.json"), `${JSON.stringify({
    schemaVersion: "repo-decision/v3",
    productDirectionDigest: direction.digest,
    charterDigest: charter.digest,
    worldHeadDigest: current.head.headDigest,
    ownerDirectiveDigest: null,
    decision: { type: "NO_DISPATCH", reason: "USE_PRODUCT" },
  }, null, 2)}\n`, "utf8");
}

function standaloneRepository(t) {
  const parent = tempDir("terminal-endgame-standalone-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Terminal Endgame Test"]);
  git(root, ["config", "user.email", "terminal-endgame@example.invalid"]);
  writeProductMd(root);
  git(root, ["add", "PRODUCT.md"]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

test("T7 landed local DONE does not authorize terminal completion with missing required destination coverage", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");

  const result = await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: oneOutcomePlanner("a"),
    runner: runner(),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.equal(result.outcomes.filter((entry) => entry.state === "LANDED").length, 1);

  const coverage = terminalEndgameCoverage(root);
  assert.deepEqual(coverage.requiredDestinationRefs, ["DESTINATION_E1"]);
  assert.deepEqual(coverage.coveredDestinationRefs, []);
  assert.deepEqual(coverage.missingDestinationRefs, ["DESTINATION_E1"]);
  assert.equal(coverage.complete, false);
  assert.throws(
    () => assertTerminalEndgameCovered(root),
    (error) => error.code === "MH_ENDGAME_INCOMPLETE"
      && error.details?.missingDestinationRefs?.includes("DESTINATION_E1"),
  );

  const current = readCurrentWorldState(root);
  installUseProductDecision(root, current);
  assert.throws(
    () => compileRepoDecision(root, current),
    (error) => error.code === "MH_ENDGAME_INCOMPLETE",
  );
});

test("T11 normally named Outcome covers a unique required destination by exact proved identity", async (t) => {
  const { root } = repository(t);
  installRequiredEndgame(root);
  persistInitial(root, "world-transition/v2");

  await runRepoWorkWave({
    repositoryPath: root,
    plannerRunner: oneOutcomePlanner("deliver-e1", "e1"),
    runner: runner(),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  const coverage = terminalEndgameCoverage(root);
  assert.deepEqual(coverage.coveredDestinationRefs, ["DESTINATION_E1"]);
  assert.deepEqual(coverage.missingDestinationRefs, []);
  assert.equal(coverage.complete, true);

  const current = readCurrentWorldState(root);
  installUseProductDecision(root, current);
  const terminal = compileRepoDecision(root, current);
  assert.equal(terminal.type, "NO_DISPATCH");
  assert.equal(terminal.reason, "USE_PRODUCT");
  assert.equal(terminal.endgameCoverage.complete, true);
});

test("T7 no-active-slice terminal claim is denied when required destinations have no durable World coverage", (t) => {
  const root = standaloneRepository(t);
  installRequiredEndgame(root);
  const request = automaticRequest(root, null);
  assert.equal(request.type, "ENDGAME_INCOMPLETE");
  assert.deepEqual(request.endgameCoverage.missingDestinationRefs, ["DESTINATION_E1"]);
});

test("T13 planner quiescence replans incomplete endgame and returns exact USE_PRODUCT when complete", async (t) => {
  const incompleteRepo = repository(t);
  installRequiredEndgame(incompleteRepo.root);
  persistInitial(incompleteRepo.root, "world-transition/v2");
  const incomplete = await runRepoWorkWave({
    repositoryPath: incompleteRepo.root,
    plannerRunner: async () => ({ batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [] } }),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(incomplete.outcome, "REPLAN_REQUIRED");
  assert.deepEqual(incomplete.endgameCoverage.missingDestinationRefs, ["DESTINATION_E1"]);

  const completeRepo = repository(t);
  installRequiredEndgame(completeRepo.root);
  persistInitial(completeRepo.root, "world-transition/v2");
  const complete = await runRepoWorkWave({
    repositoryPath: completeRepo.root,
    plannerRunner: oneOutcomePlanner("deliver-e1", "e1"),
    runner: runner(),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(complete.outcome, "USE_PRODUCT");
  assert.equal(complete.endgameCoverage.complete, true);
  let rendered = "";
  renderHuman({ stdout: { write: (text) => { rendered += String(text); } } }, complete);
  assert.equal(rendered, "No active slice.\nUse the product.\nWait for observed real-use friction.\n");
});
