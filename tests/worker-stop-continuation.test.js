"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { attemptInputKey } = require("../lib/execution-identity");
const { enterRunAttempt } = require("../lib/execution-attempt");
const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const { runtimeCapabilityDigest } = require("../lib/runtime-identity");
const { captureWorkspaceBoundary, persistWorkSession, prepareWorkspace } = require("../lib/work-git");
const {
  assertWorkerStopBoundaryCurrent,
  findWorkerStopForGeneration,
  recordWorkerStop,
  stopBoundaryEvidence,
} = require("../lib/work-forward-motion-record");
const {
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id = "a") {
  const value = proposal(id);
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

function stoppedFixture(t) {
  const { root } = repository(t);
  persistInitial(root);
  const materialized = materializePreparedPlannerRun(
    root,
    null,
    preparePlannerCandidate(root, null, candidate()),
  );
  const session = materialized.session;
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, session.allowedPaths);
  const entry = enterRunAttempt({
    repositoryPath: root,
    session,
    workspaceId: workspace.workspaceId,
    generation: 1,
    attemptInputKey: attemptInputKey({
      session,
      snapshotTreeOid: boundary.treeOid,
      runtimeCapabilityDigest: runtimeCapabilityDigest({}),
      workspaceMode: workspace.mode,
    }),
  });
  const workerResult = {
    schemaVersion: "worker-result/v2",
    status: "STOP",
    observableResult: "Preferred route did not produce the result.",
    operations: [],
    validation: [],
    stop: {
      unsatisfiedRequirement: "A different in-scope means is required.",
      failedMeans: [{ means: "preferred route", evidence: ["No usable result."] }],
      alternativesConsidered: [{
        means: "local substitute",
        disposition: "AVAILABLE",
        evidence: ["It stays inside the sealed scope."],
      }],
      assertedConstraint: "Preferred route unavailable.",
    },
  };
  const stop = recordWorkerStop({
    repositoryPath: root,
    session,
    workspace,
    attemptEntry: entry,
    startBoundary: stopBoundaryEvidence(boundary),
    endBoundary: stopBoundaryEvidence(boundary),
    workerResult,
  });
  return { root, session, workspace, boundary, stop };
}

test("worker STOP is durable failed-means evidence bound to one unchanged generation boundary", (t) => {
  const fixture = stoppedFixture(t);
  const recovered = findWorkerStopForGeneration(
    fixture.root,
    fixture.session.sessionDigest,
    fixture.workspace.workspaceId,
    1,
  );
  assert.equal(recovered.stopDigest, fixture.stop.stopDigest);
  assert.deepEqual(assertWorkerStopBoundaryCurrent(recovered, stopBoundaryEvidence(fixture.boundary)), recovered);
});

test("worker STOP continuity rejects later workspace drift", (t) => {
  const fixture = stoppedFixture(t);
  const changed = {
    ...stopBoundaryEvidence(fixture.boundary),
    treeOid: "f".repeat(40),
  };
  assert.throws(
    () => assertWorkerStopBoundaryCurrent(fixture.stop, changed),
    (error) => error.code === "MH_WORKER_STOP_STALE",
  );
});

test("worker STOP cannot carry mutations or become a terminal product conclusion", (t) => {
  const fixture = stoppedFixture(t);
  const invalid = {
    ...fixture.stop.workerResult,
    operations: [{ type: "WRITE", path: "src/a/result.txt", content: "delivered\n" }],
  };
  assert.throws(
    () => recordWorkerStop({
      repositoryPath: fixture.root,
      session: fixture.session,
      workspace: fixture.workspace,
      attemptEntry: {
        sessionDigest: fixture.stop.sessionDigest,
        workspaceId: fixture.stop.workspaceId,
        generation: fixture.stop.generation,
        entryDigest: fixture.stop.attemptEntryDigest,
      },
      startBoundary: fixture.stop.startBoundary,
      endBoundary: fixture.stop.endBoundary,
      workerResult: invalid,
    }),
    (error) => error.code === "MH_WORKER_RESULT",
  );
});
