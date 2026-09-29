"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { attemptInputKey } = require("../lib/execution-identity");
const { enterRunAttempt } = require("../lib/execution-attempt");
const {
  createExternalProposalRunner,
  reconcileProposalDispatch,
} = require("../lib/devspace-proposal-host");
const {
  materializePreparedPlannerRun,
  preparePlannerCandidate,
} = require("../lib/repo-planner-candidate");
const {
  readProposalDispatchIntent,
  readProposalDispatchResult,
} = require("../lib/proposal-dispatch");
const { runtimeCapabilityDigest } = require("../lib/runtime-identity");
const {
  captureWorkspaceBoundary,
  persistWorkSession,
  prepareWorkspace,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
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

function enteredRun(t) {
  const { root } = repository(t);
  persistInitial(root);
  const prepared = preparePlannerCandidate(root, null, candidate());
  const materialized = materializePreparedPlannerRun(root, null, prepared);
  const session = materialized.session;
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
  const attemptBoundary = captureWorkspaceBoundary(workspace.workspacePath, session.allowedPaths);
  const runtimeDigest = runtimeCapabilityDigest({});
  const attemptEntry = enterRunAttempt({
    repositoryPath: root,
    session,
    workspaceId: workspace.workspaceId,
    generation: 1,
    attemptInputKey: attemptInputKey({
      session,
      snapshotTreeOid: attemptBoundary.treeOid,
      runtimeCapabilityDigest: runtimeDigest,
      workspaceMode: workspace.mode,
    }),
  });
  return { root, session, workspace, attemptBoundary, runtimeDigest, attemptEntry };
}

function workerResult() {
  return {
    schemaVersion: "worker-result/v2",
    status: "DONE",
    observableResult: "Prepared a.",
    operations: [{ type: "WRITE", path: "src/a/result.txt", content: "delivered\n" }],
    validation: ["external proposal"],
    stop: null,
  };
}

function hostBinding(packetDigest, state = "RUNNING") {
  return {
    schemaVersion: "meta-proposal-reconcile/v1",
    state,
    packetDigest,
    taskId: "proposal_77777777",
    taskDigest: `sha256:${"7".repeat(64)}`,
    resultDigest: state === "RESULT_READY" ? `sha256:${"e".repeat(64)}` : null,
    activationEstablished: state === "RUNNING",
  };
}

test("external proposal persists exact intent before host activation and uses run facts and carries no Claim/Permit identity", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = enteredRun(t);
  let observedIntent = null;
  const host = {
    ensureActivation: async (request) => {
      observedIntent = readProposalDispatchIntent({
        workspaceRegistryDir: fixture.workspace.registryDir,
        workspaceId: fixture.workspace.workspaceId,
        generation: 1,
      });
      assert.equal(observedIntent.request.packet.packetDigest, request.packet.packetDigest);
      return hostBinding(request.packet.packetDigest);
    },
  };
  const runner = createExternalProposalRunner(host);
  const result = await runner({
    repositoryPath: fixture.root,
    workspace: fixture.workspace,
    attemptBoundary: fixture.attemptBoundary,
    session: fixture.session,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
    runtimeCapabilityDigest: fixture.runtimeDigest,
  });

  assert.equal(result.control, "EXTERNAL_OPEN");
  assert.ok(observedIntent);
  assert.equal(observedIntent.schemaVersion, "proposal-dispatch-intent/v3");
  assert.equal(observedIntent.runBinding.sessionDigest, fixture.session.sessionDigest);
  assert.equal(observedIntent.runBinding.outcomeDigest, fixture.session.origin.outcomeDigest);
  assert.equal(observedIntent.runBinding.attemptEntryDigest, fixture.attemptEntry.entryDigest);
  assert.equal(observedIntent.runBinding.attemptInputKey, fixture.attemptEntry.attemptInputKey);
  assert.equal(Object.hasOwn(observedIntent.runBinding, "claimDigest"), false);
  assert.equal(Object.hasOwn(observedIntent.runBinding, "permitDigest"), false);
  assert.equal(Object.hasOwn(observedIntent.request.packet, "permitDigest"), false);
});

test("external proposal reconciliation persists result once and reuses retained result on replay", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = enteredRun(t);
  let ensureCalls = 0;
  let resultReads = 0;
  let releases = 0;
  const host = {
    ensureActivation: async (request) => {
      ensureCalls += 1;
      return hostBinding(request.packet.packetDigest, ensureCalls === 1 ? "RUNNING" : "RESULT_READY");
    },
    readResult: async (binding) => {
      resultReads += 1;
      return {
        schemaVersion: "meta-proposal-result/v1",
        ...binding,
        result: workerResult(),
        resultDigest: `sha256:${"e".repeat(64)}`,
        submittedAt: "2026-09-24T12:00:00.000Z",
      };
    },
    release: async (binding) => {
      releases += 1;
      return {
        schemaVersion: "meta-proposal-release-ack/v1",
        ...binding,
        released: true,
      };
    },
  };

  const runner = createExternalProposalRunner(host);
  const opened = await runner({
    repositoryPath: fixture.root,
    workspace: fixture.workspace,
    attemptBoundary: fixture.attemptBoundary,
    session: fixture.session,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
    runtimeCapabilityDigest: fixture.runtimeDigest,
  });
  assert.equal(opened.control, "EXTERNAL_OPEN");

  const intent = readProposalDispatchIntent({
    workspaceRegistryDir: fixture.workspace.registryDir,
    workspaceId: fixture.workspace.workspaceId,
    generation: 1,
  });
  const settled = await reconcileProposalDispatch({
    proposalHost: host,
    workspaceRegistryDir: fixture.workspace.registryDir,
    intent,
  });
  assert.equal(settled.state, "RESULT_READY");
  assert.equal(settled.result.workerResult.status, "DONE");
  assert.equal(resultReads, 1);

  const replayed = await reconcileProposalDispatch({
    proposalHost: host,
    workspaceRegistryDir: fixture.workspace.registryDir,
    intent,
  });
  assert.equal(replayed.state, "RESULT_READY");
  assert.equal(replayed.result.resultRecordDigest, settled.result.resultRecordDigest);
  assert.equal(resultReads, 1, "retained result must prevent a second result read");
  assert.equal(ensureCalls, 2, "replay with retained result must not re-run activation");
  assert.equal(releases, 2, "release may be retried because it is separately replay-safe");

  const durable = readProposalDispatchResult({
    workspaceRegistryDir: workspaceRegistryDirectory(fixture.root),
    workspaceId: fixture.workspace.workspaceId,
    generation: 1,
  });
  assert.equal(durable.resultRecordDigest, settled.result.resultRecordDigest);
  const dispatchDir = path.join(workspaceRegistryDirectory(fixture.root), "proposal-dispatch");
  assert.equal(fs.readdirSync(dispatchDir).filter((name) => name.endsWith(".result.json")).length, 1);
});
