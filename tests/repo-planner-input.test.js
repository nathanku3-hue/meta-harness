"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const { landOutcomeClosure } = require("../lib/repo-outcome-landing");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { runWork } = require("../lib/work-loop");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  createOutcome,
  fakeInterpretation,
  legacySession,
  monotonicNow,
  persistInitial,
  persistOutcome,
  repository,
  runner,
} = require("./helpers/linear-product-head");

function stoppedWorker() {
  return {
    worker: "handoff-test-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "STOP",
      observableResult: "The preferred API exposed only partial coverage.",
      operations: [],
      validation: [],
      stop: {
        unsatisfiedRequirement: "Implementation validity still requires a complete source route.",
        failedMeans: [{
          means: "preferred API/source",
          evidence: ["The preferred route exposed only partial coverage."],
        }],
        alternativesConsidered: [{
          means: "in-repository evidence route",
          disposition: "RULED_OUT",
          evidence: ["The current session decomposition did not include that route."],
        }],
        assertedConstraint: "A fictional librarian approval is required.",
      },
    },
  };
}

function replanProof() {
  return {
    disposition: "REPLAN_REQUIRED",
    failedMeans: [{
      means: "preferred API/source",
      evidence: ["The preferred route exposed only partial coverage."],
    }],
    alternatives: [{
      means: "Use a different bounded evidence route in a new Outcome decomposition.",
      disposition: "AVAILABLE",
      evidence: ["The failure is route-specific, not an Outcome-level impossibility."],
      requiredPaths: [],
    }],
    hardConstraint: null,
    ownerRequest: null,
    disprovedAssertions: ["Rejected fictional librarian authority; it is not constitutional owner authority."],
  };
}

function outcome(root) {
  return persistOutcome(root, createOutcome({
    id: "a",
    desiredState: "Deliver a.",
    preconditions: ["Outcome a is not delivered yet."],
    evidenceRequirement: "src/a/result.txt exists and controller validation passes.",
  }));
}

test("local running Claims are not double-counted while durable custody still looks executable", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const durableOutcome = outcome(root);
  const admitted = legacySession(root, durableOutcome, initial.head.headDigest, "a");
  const recovered = [{
    type: "EXECUTABLE",
    claim: admitted.claim,
    session: admitted.session,
    continuation: "PENDING_WORKSPACE",
  }];
  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({
    repositoryPath: root,
    current,
    recovered,
    localBound: 3,
    localRunningCount: 1,
    localRunningClaimDigests: [admitted.claim.claimDigest],
  });
  assert.equal(input.capacity.occupiedSlots, 1);
  assert.equal(input.capacity.availableSlots, 2);
  assert.equal(input.activeCommitments.length, 1);
});

test("fresh planner input reconstructs unresolved durable handoff without chat or execution internals", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const durableOutcome = outcome(root);
  const admitted = legacySession(root, durableOutcome, initial.head.headDigest, "a");
  const workResult = await runWork({
    repositoryPath: root,
    session: admitted.session,
    runner: async () => stoppedWorker(),
    forwardMotionRunner: async () => replanProof(),
  });
  assert.equal(workResult.outcome, "REPLAN_REQUIRED");
  const closure = findExecutionClosureForOrigin(root, admitted.session.origin);
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: admitted.claim,
    closure,
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(landing.state, "REPLAN_REQUIRED");

  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [], localBound: 3 });
  assert.equal(input.unresolvedHandoffs.length, 1);
  const handoff = input.unresolvedHandoffs[0];
  assert.equal(handoff.outcomeDigest, durableOutcome.outcomeDigest);
  assert.equal(handoff.disposition, "REPLAN_REQUIRED");
  assert.equal(handoff.unsatisfiedRequirement, "Implementation validity still requires a complete source route.");
  assert.equal(handoff.failedMeans[0].means, "preferred API/source");
  assert.match(handoff.closureDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(handoff.workResultDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(handoff.forwardMotionProofDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(handoff.transitionDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(handoff.disprovedAssertions.join("\n"), /librarian authority/u);
  const serialized = JSON.stringify(input);
  for (const forbidden of ["workspaceId", "executionPermit", "attemptEntry", "candidateSeal", "workerPrompt"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("later authoritative success supersedes older unresolved handoff", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const durableOutcome = outcome(root);
  const first = legacySession(root, durableOutcome, initial.head.headDigest, "a");
  const stopped = await runWork({
    repositoryPath: root,
    session: first.session,
    runner: async () => stoppedWorker(),
    forwardMotionRunner: async () => replanProof(),
  });
  assert.equal(stopped.outcome, "REPLAN_REQUIRED");
  landOutcomeClosure({
    repositoryPath: root,
    claim: first.claim,
    closure: findExecutionClosureForOrigin(root, first.session.origin),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });

  const afterReplan = readCurrentWorldState(root);
  const second = legacySession(root, durableOutcome, afterReplan.head.headDigest, "a");
  const done = await runWork({ repositoryPath: root, session: second.session, runner: runner() });
  assert.equal(done.outcome, "DONE");
  const landing = landOutcomeClosure({
    repositoryPath: root,
    claim: second.claim,
    closure: findExecutionClosureForOrigin(root, second.session.origin),
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(landing.state, "LANDED");

  const current = readCurrentWorldState(root);
  const input = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [], localBound: 3 });
  assert.equal(input.unresolvedHandoffs.some((entry) => entry.outcomeDigest === durableOutcome.outcomeDigest), false);
});
