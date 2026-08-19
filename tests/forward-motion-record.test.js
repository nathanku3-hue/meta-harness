"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { validateWorkerResult } = require("../lib/worker-result");
const {
  assertWorkerStopBoundaryCurrent,
  computeWorkerStopDigest,
  validateWorkerStop,
} = require("../lib/work-forward-motion-record");

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const OID_A = "a".repeat(40);
const TREE_A = "b".repeat(40);

function stopResult() {
  return {
    schemaVersion: "worker-result/v2",
    status: "STOP",
    observableResult: "The preferred route stopped.",
    operations: [],
    validation: [],
    stop: {
      unsatisfiedRequirement: "The preferred route did not satisfy the requirement.",
      failedMeans: [{ means: "preferred route", evidence: ["Observed route failure."] }],
      alternativesConsidered: [],
      assertedConstraint: "The preferred route is unavailable.",
    },
  };
}

function boundary(overrides = {}) {
  return {
    head: OID_A,
    branch: "meta-harness/test",
    indexDigest: SHA_A,
    dirtyManifestDigest: SHA_B,
    treeOid: TREE_A,
    ...overrides,
  };
}

function workerStop() {
  const body = {
    schemaVersion: "worker-stop/v1",
    sessionDigest: SHA_A,
    workspaceId: "ws-test",
    generation: 1,
    attemptEntryDigest: SHA_B,
    startBoundary: boundary(),
    endBoundary: boundary(),
    workerResult: stopResult(),
    recordedAt: "2026-08-19T00:00:00.000Z",
  };
  return { ...body, stopDigest: computeWorkerStopDigest(body) };
}

test("active worker contract rejects legacy blocked routing fields", () => {
  assert.throws(() => validateWorkerResult({
    status: "blocked",
    observableResult: "Stopped.",
    operations: [],
    validation: [],
    blocker: "Ask the librarian.",
    nextAction: "Ask the librarian?",
  }), (error) => error.code === "MH_WORKER_RESULT");
});

test("worker-stop is mechanical byte continuity and rejects later drift", () => {
  const stop = validateWorkerStop(workerStop());
  assert.doesNotThrow(() => assertWorkerStopBoundaryCurrent(stop, boundary()));
  assert.throws(
    () => assertWorkerStopBoundaryCurrent(stop, boundary({ treeOid: "c".repeat(40) })),
    (error) => error.code === "MH_WORKER_STOP_STALE",
  );
  assert.throws(
    () => assertWorkerStopBoundaryCurrent(stop, boundary({ dirtyManifestDigest: SHA_A })),
    (error) => error.code === "MH_WORKER_STOP_STALE",
  );
});
