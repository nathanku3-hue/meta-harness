"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const { initializeIntegrationHead, readIntegrationHead } = require("../lib/optimistic-integration");
const {
  discardProductIntegration,
  finalizeProductIntegration,
  prepareProductIntegration,
  publishProductIntegration,
  _test: integrationTest,
} = require("../lib/repo-product-integration");
const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const { runWork } = require("../lib/work-loop");
const {
  git,
  proposal,
  repository,
  runner,
} = require("./helpers/linear-product-head");

const PRODUCT_PUBLICATION_RACE = path.join(__dirname, "fixtures", "product-publication-race.js");

function waitForFile(filePath, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timed out waiting for ${filePath}`));
      setTimeout(poll, 5);
    };
    poll();
  });
}

function childOutcome(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout || `publication race child exited ${code}`));
      const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
      try {
        resolve(JSON.parse(lines.at(-1)));
      } catch (error) {
        reject(new Error(`invalid publication race child output: ${stdout || stderr}: ${error.message}`));
      }
    });
  });
}

function raceCandidate(candidate) {
  return {
    status: candidate.status,
    root: candidate.root,
    receipt: candidate.receipt,
    banked: { closure: candidate.banked.closure },
  };
}

async function racePublications(root, candidates) {
  const barrier = path.join(root, "product-publication-race.barrier");
  const readyPaths = candidates.map((_, index) => path.join(root, `product-publication-race.${index}.ready`));
  fs.writeFileSync(barrier, "hold\n", "utf8");
  const children = candidates.map((candidate, index) => spawn(process.execPath, [PRODUCT_PUBLICATION_RACE], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MH_PRODUCT_PUBLICATION_BARRIER: barrier,
      MH_PRODUCT_PUBLICATION_READY: readyPaths[index],
      MH_PRODUCT_PUBLICATION_CANDIDATE: JSON.stringify(raceCandidate(candidate)),
    },
  }));
  try {
    await Promise.all(readyPaths.map((readyPath) => waitForFile(readyPath)));
    const outcomes = children.map(childOutcome);
    fs.unlinkSync(barrier);
    return await Promise.all(outcomes);
  } finally {
    if (fs.existsSync(barrier)) fs.unlinkSync(barrier);
    children.forEach((child) => {
      if (child.exitCode === null) child.kill();
    });
  }
}

function candidateFromProposal(value) {
  return {
    id: value.id,
    productResult: value.productResult,
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: value.allowedPaths,
  };
}

function materializeRun(root, value, productCommit) {
  const prepared = preparePlannerCandidate(root, null, candidateFromProposal(value), {
    expectedProductCommit: productCommit,
  });
  return materializePreparedPlannerRun(root, null, prepared, { objectiveRevision: 0 });
}

async function completedPublishers(root, productCommit, values, runners) {
  const materializedRuns = values.map((value) => materializeRun(root, value, productCommit));
  await Promise.all(materializedRuns.map((entry, index) => runWork({
    repositoryPath: root,
    session: entry.session,
    runner: runners[index],
  })));
  const closures = materializedRuns.map((entry) => findExecutionClosureForOrigin(root, entry.session.origin));
  closures.forEach((closure) => assert.ok(closure));
  return { materializedRuns, closures };
}

function prepare(root, closure, predecessorProductCommit, now) {
  return prepareProductIntegration({
    repositoryPath: root,
    predecessorProductCommit,
    currentHead: null,
    closure,
    now,
  });
}

test("T3 two publishers validate from H0, CAS one winner, rebuild the loser, and preserve both behaviors", { skip: process.platform !== "linux" }, async (t) => {
  const { root, baseline } = repository(t);
  initializeIntegrationHead({ repositoryPath: root, baseCommit: baseline });
  const h0 = readIntegrationHead(root);
  const values = [proposal("a"), proposal("b")];
  const { closures } = await completedPublishers(root, h0, values, [runner(), runner()]);

  const candidateA = prepare(root, closures[0], h0, new Date("2026-08-18T06:00:00.000Z"));
  const candidateB0 = prepare(root, closures[1], h0, new Date("2026-08-18T06:00:01.000Z"));
  assert.equal(candidateA.status, "ACCEPTED");
  assert.equal(candidateB0.status, "ACCEPTED");

  const raced = await racePublications(root, [candidateA, candidateB0]);
  assert.equal(raced.filter((outcome) => outcome.ok && outcome.state === "LANDED").length, 1);
  assert.equal(raced.filter((outcome) => outcome.ok && outcome.state === "CONFLICT").length, 1);
  const winnerIndex = raced.findIndex((outcome) => outcome.state === "LANDED");
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const winnerCandidate = [candidateA, candidateB0][winnerIndex];
  const loserCandidate = [candidateA, candidateB0][loserIndex];
  const winnerCommit = winnerCandidate.receipt.integratedCommit;

  assert.equal(publishProductIntegration(winnerCandidate).state, "ALREADY_LANDED");
  finalizeProductIntegration(winnerCandidate, winnerCommit);
  discardProductIntegration(loserCandidate);

  const replayedLoser = prepare(
    root,
    closures[loserIndex],
    winnerCommit,
    new Date("2026-08-18T06:00:02.000Z"),
  );
  assert.equal(replayedLoser.status, "ACCEPTED");
  assert.equal(replayedLoser.receipt.predecessorProductCommit, winnerCommit);
  assert.equal(Object.hasOwn(replayedLoser.receipt, "retainedObligations"), false);
  assert.equal(Object.hasOwn(replayedLoser.receipt, "claimDigest"), false);
  assert.equal(integrationTest.integrationLineage(root, winnerCommit).length, 1);

  assert.equal(publishProductIntegration(replayedLoser).state, "LANDED");
  const hab = replayedLoser.receipt.integratedCommit;
  finalizeProductIntegration(replayedLoser, hab);

  assert.equal(readIntegrationHead(root), hab);
  assert.equal(git(root, ["rev-parse", `${winnerCommit}^`]), h0);
  assert.equal(git(root, ["rev-parse", `${hab}^`]), winnerCommit);
  assert.equal(git(root, ["show", `${hab}:src/a/result.txt`]), "delivered");
  assert.equal(git(root, ["show", `${hab}:src/b/result.txt`]), "delivered");
});

test("T4 stale publisher revalidates retained validation and rejects a cumulative regression before CAS", { skip: process.platform !== "linux" }, async (t) => {
  const { root, baseline } = repository(t);
  initializeIntegrationHead({ repositoryPath: root, baseCommit: baseline });
  const h0 = readIntegrationHead(root);
  const valueA = proposal("a");
  const valueB = proposal("b", { allowedPaths: ["src/b", "src/shared"] });
  const { closures } = await completedPublishers(
    root,
    h0,
    [valueA, valueB],
    [runner(), runner({ breakSharedId: "b" })],
  );

  const candidateA = prepare(root, closures[0], h0, new Date("2026-08-18T07:00:00.000Z"));
  const candidateB0 = prepare(root, closures[1], h0, new Date("2026-08-18T07:00:01.000Z"));
  assert.equal(candidateA.status, "ACCEPTED");
  assert.equal(candidateB0.status, "ACCEPTED");

  assert.equal(publishProductIntegration(candidateA).state, "LANDED");
  const ha = candidateA.receipt.integratedCommit;
  finalizeProductIntegration(candidateA, ha);

  const staleB = publishProductIntegration(candidateB0);
  assert.equal(staleB.state, "CONFLICT");
  assert.equal(staleB.observedHead, ha);
  discardProductIntegration(candidateB0);

  const replayedB = prepare(root, closures[1], ha, new Date("2026-08-18T07:00:02.000Z"));
  try {
    assert.equal(replayedB.status, "REJECTED");
    assert.equal(replayedB.reason, "RETAINED_VALIDATION_FAILED");
    assert.equal(readIntegrationHead(root), ha, "failed cumulative validation must prevent the second CAS");
    assert.equal(git(root, ["show", `${ha}:src/a/result.txt`]), "delivered");
    assert.equal(git(root, ["show", `${ha}:src/shared/invariant.txt`]), "safe");
  } finally {
    discardProductIntegration(replayedB);
  }
});
