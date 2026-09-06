"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { attemptInputKey } = require("../lib/execution-identity");
const { enterRunAttempt } = require("../lib/execution-permit");
const {
  PROPOSAL_WORKER_PACKET_SCHEMA,
  compileProposalWorkerPacket,
} = require("../lib/proposal-worker-packet");
const {
  preparePlannerCandidate,
  admitPreparedPlannerCandidate,
} = require("../lib/repo-planner-admission");
const {
  captureWorkspaceBoundary,
  persistWorkSession,
  prepareWorkspace,
} = require("../lib/work-git");
const {
  acquireWorkspaceExecutionLease,
  releaseWorkspaceExecutionLease,
} = require("../lib/workspace-custody");
const { runtimeCapabilityDigest } = require("../lib/runtime-identity");
const { readCurrentWorldState } = require("../lib/world-transition");
const {
  persistInitial,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function candidate(id, paths = [`src/${id}`]) {
  const value = proposal(id, { allowedPaths: paths });
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
    expectedWritePaths: paths,
    continuesFromTransitionDigests: [],
  };
}

function enteredRepoRun(t) {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const current = readCurrentWorldState(root);
  const prepared = preparePlannerCandidate(root, current, candidate("a"));
  const admitted = admitPreparedPlannerCandidate(root, current, prepared);
  const session = admitted.session;
  const workspace = prepareWorkspace(root, session);
  const lease = acquireWorkspaceExecutionLease({
    registryDir: workspace.registryDir,
    workspaceId: workspace.workspaceId,
  });
  t.after(() => {
    releaseWorkspaceExecutionLease({ registryDir: workspace.registryDir, lease });
  });
  const state = persistWorkSession(root, session, workspace);
  const boundary = captureWorkspaceBoundary(workspace.workspacePath, session.allowedPaths);
  const runtimeDigest = runtimeCapabilityDigest({});
  const inputKey = attemptInputKey({
    session,
    snapshotTreeOid: boundary.treeOid,
    runtimeCapabilityDigest: runtimeDigest,
    workspaceMode: workspace.mode,
  });
  const attemptEntry = enterRunAttempt({
    repositoryPath: root,
    session,
    workspaceId: workspace.workspaceId,
    generation: 1,
    attemptInputKey: inputKey,
  });
  return { root, session, workspace, lease, state, boundary, runtimeDigest, inputKey, attemptEntry };
}

test("entered claimless run derives one transport-only proposal worker packet", (t) => {
  const fixture = enteredRepoRun(t);
  const first = compileProposalWorkerPacket({
    repositoryPath: fixture.root,
    stateDirectory: fixture.state.directory,
    session: fixture.session,
    workspace: fixture.workspace,
    workspaceLease: fixture.lease,
    boundary: fixture.boundary,
    executionPermit: null,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
    runtimeCapabilityDigest: fixture.runtimeDigest,
  });
  const second = compileProposalWorkerPacket({
    repositoryPath: fixture.root,
    stateDirectory: fixture.state.directory,
    session: fixture.session,
    workspace: fixture.workspace,
    workspaceLease: fixture.lease,
    boundary: fixture.boundary,
    executionPermit: null,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
    runtimeCapabilityDigest: fixture.runtimeDigest,
  });

  assert.equal(first.packet.schemaVersion, PROPOSAL_WORKER_PACKET_SCHEMA);
  assert.equal(first.packet.attemptInputKey, fixture.inputKey);
  assert.equal(Object.hasOwn(first.packet, "permitDigest"), false);
  assert.equal(first.packet.attemptEntryDigest, fixture.attemptEntry.entryDigest);
  assert.match(first.packet.promptDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.packet.workerResultSchemaDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.packet.packetDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.packet.packetDigest, second.packet.packetDigest);
  assert.equal(first.prompt, second.prompt);
  assert.match(first.prompt, /Product result: Deliver a\./u);
  assert.match(first.prompt, /worker-result\/v2/u);
  assert.equal(first.packet.baseline.head, fixture.boundary.head);
  assert.equal(first.packet.baseline.treeOid, fixture.boundary.treeOid);
  assert.equal(Object.hasOwn(first.packet, "claimDigest"), false);
  assert.equal(Object.hasOwn(first.packet, "sessionDigest"), false);
  assert.equal(Object.hasOwn(first.packet, "workspaceId"), false);

  const after = captureWorkspaceBoundary(fixture.workspace.workspacePath, fixture.session.allowedPaths);
  assert.equal(after.head, fixture.boundary.head);
  assert.equal(after.branch, fixture.boundary.branch);
  assert.equal(after.treeOid, fixture.boundary.treeOid);
  assert.equal(after.indexDiff, fixture.boundary.indexDiff);
  assert.deepEqual(after.inspected.entries, fixture.boundary.inspected.entries);
});

test("proposal packet rejects non-repository sessions and stale workspace baselines", (t) => {
  const fixture = enteredRepoRun(t);
  const ownerSession = { ...fixture.session, origin: { type: "OWNER_GOAL" } };
  assert.throws(
    () => compileProposalWorkerPacket({
      repositoryPath: fixture.root,
      stateDirectory: fixture.state.directory,
      session: ownerSession,
      workspace: fixture.workspace,
      workspaceLease: fixture.lease,
      boundary: fixture.boundary,
      executionPermit: null,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
      runtimeCapabilityDigest: fixture.runtimeDigest,
    }),
    /repository Outcome run/u,
  );

  const staleBoundary = { ...fixture.boundary, head: "0".repeat(40) };
  assert.throws(
    () => compileProposalWorkerPacket({
      repositoryPath: fixture.root,
      stateDirectory: fixture.state.directory,
      session: fixture.session,
      workspace: fixture.workspace,
      workspaceLease: fixture.lease,
      boundary: staleBoundary,
      executionPermit: null,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
      runtimeCapabilityDigest: fixture.runtimeDigest,
    }),
    /exact RUN_CAPABILITY attempt and baseline/u,
  );
});
