"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { recoverClaimCommitment, recoverRepositoryCommitments } = require("../lib/repo-work-wave");
const { admitPreparedPlannerCandidate, preparePlannerCandidate } = require("../lib/repo-planner-admission");
const { listRunSessions } = require("../lib/run-journal");
const { commonGitDirectory } = require("../lib/work-git");
const { runWork } = require("../lib/work-loop");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  createOutcome,
  legacySession,
  persistInitial,
  persistOutcome,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function currentCandidate(value) {
  return {
    id: value.id,
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

function pendingLegacyCommitment(t, id = "a") {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const value = proposal(id);
  const outcome = persistOutcome(root, createOutcome({
    id: value.id,
    desiredState: value.productResult,
    preconditions: [value.journeyState],
    evidenceRequirement: value.doneWhen,
  }));
  const legacy = legacySession(root, outcome, initial.head.headDigest, id);
  return { root, outcome, legacy };
}

test("pending legacy Outcome commitment normalizes once into current REPO_RUN and releases the Claim", { skip: process.platform !== "linux" }, (t) => {
  const { root, outcome, legacy } = pendingLegacyCommitment(t);
  assert.equal(legacy.session.origin.type, "REPO_OUTCOME");
  assert.equal(listActiveOutcomeClaims(root).length, 1);

  const first = recoverClaimCommitment(root, legacy.claim);
  assert.equal(first.type, "EXECUTABLE");
  assert.equal(first.claim, null);
  assert.equal(first.session.origin.type, "REPO_RUN");
  assert.equal(first.session.origin.outcomeDigest, outcome.outcomeDigest);
  assert.equal(listActiveOutcomeClaims(root).length, 0);

  const runsAfterFirst = listRunSessions({ gitCommonDirectory: commonGitDirectory(root) });
  const currentRuns = runsAfterFirst.filter((session) => session.origin.type === "REPO_RUN"
    && session.origin.outcomeDigest === outcome.outcomeDigest);
  assert.equal(currentRuns.length, 1);

  const replay = recoverClaimCommitment(root, legacy.claim);
  assert.equal(replay.type, "EXECUTABLE");
  assert.equal(replay.session.sessionDigest, first.session.sessionDigest);
  const runsAfterReplay = listRunSessions({ gitCommonDirectory: commonGitDirectory(root) })
    .filter((session) => session.origin.type === "REPO_RUN"
      && session.origin.outcomeDigest === outcome.outcomeDigest);
  assert.equal(runsAfterReplay.length, 1, "legacy recovery replay must not create another current run");
});

test("crash after current run persistence but before Claim release recovers one current commitment", { skip: process.platform !== "linux" }, (t) => {
  const { root, outcome, legacy } = pendingLegacyCommitment(t);
  const value = proposal("a");
  const current = readCurrentWorldState(root);
  const admitted = admitPreparedPlannerCandidate(
    root,
    current,
    preparePlannerCandidate(root, current, currentCandidate(value)),
  );
  assert.equal(admitted.session.origin.type, "REPO_RUN");
  assert.equal(admitted.session.origin.outcomeDigest, outcome.outcomeDigest);
  assert.equal(listActiveOutcomeClaims(root).length, 1, "fixture represents crash before compatibility Claim release");

  const recovered = recoverRepositoryCommitments(root);
  const matching = recovered.filter((entry) => entry.session?.origin?.type === "REPO_RUN"
    && entry.session.origin.outcomeDigest === outcome.outcomeDigest);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].session.sessionDigest, admitted.session.sessionDigest);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.equal(legacy.session.origin.type, "REPO_OUTCOME");
});

test("legacy REPO_OUTCOME session cannot enter the normal work loop", { skip: process.platform !== "linux" }, async (t) => {
  const { root, legacy } = pendingLegacyCommitment(t);
  await assert.rejects(
    runWork({
      repositoryPath: root,
      session: legacy.session,
      runner: async () => { throw new Error("legacy worker must never launch"); },
    }),
    (error) => error.code === "MH_WORK_ORIGIN",
  );
  assert.equal(listActiveOutcomeClaims(root).length, 1, "rejection must leave recovery facts intact");
});
