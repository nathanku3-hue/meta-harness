"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { attemptInputKey } = require("../lib/execution-identity");
const { enterRunAttempt } = require("../lib/execution-attempt");
const {
  PROPOSAL_WORKER_PACKET_SCHEMA,
  compileProposalWorkerPacket,
} = require("../lib/proposal-worker-packet");
const {
  preparePlannerCandidate,
  materializePreparedPlannerRun,
} = require("../lib/repo-planner-candidate");
const {
  captureWorkspaceBoundary,
  persistWorkSession,
  prepareWorkspace,
} = require("../lib/work-git");
const { runtimeCapabilityDigest } = require("../lib/runtime-identity");
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
    journeyState: value.journeyState,
    doNow: value.doNow,
    newlyTrueBehavior: value.newlyTrueBehavior,
    doneWhen: value.doneWhen,
    stopOnlyIf: value.stopOnlyIf,
    expectedWritePaths: paths,
  };
}

function enteredRepoRun(t) {
  const { root } = repository(t);
  persistInitial(root);
  const prepared = preparePlannerCandidate(root, null, candidate("a"));
  const materialized = materializePreparedPlannerRun(root, null, prepared);
  const session = materialized.session;
  const workspace = prepareWorkspace(root, session);
  persistWorkSession(root, session, workspace);
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
  return { root, session, workspace, boundary, runtimeDigest, inputKey, attemptEntry };
}

test("entered REPO_RUN derives one transport-only proposal worker packet", { skip: process.platform !== "linux" }, (t) => {
  const fixture = enteredRepoRun(t);
  const args = {
    repositoryPath: fixture.root,
    session: fixture.session,
    workspace: fixture.workspace,
    boundary: fixture.boundary,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
    runtimeCapabilityDigest: fixture.runtimeDigest,
  };
  const first = compileProposalWorkerPacket(args);
  const second = compileProposalWorkerPacket(args);

  assert.equal(first.packet.schemaVersion, PROPOSAL_WORKER_PACKET_SCHEMA);
  assert.equal(first.packet.attemptInputKey, fixture.inputKey);
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
  for (const retired of ["permitDigest", "claimDigest", "sessionDigest", "workspaceId"]) {
    assert.equal(Object.hasOwn(first.packet, retired), false, retired);
  }

  const after = captureWorkspaceBoundary(fixture.workspace.workspacePath, fixture.session.allowedPaths);
  assert.equal(after.head, fixture.boundary.head);
  assert.equal(after.branch, fixture.boundary.branch);
  assert.equal(after.treeOid, fixture.boundary.treeOid);
  assert.equal(after.indexDiff, fixture.boundary.indexDiff);
  assert.deepEqual(after.inspected.entries, fixture.boundary.inspected.entries);
});

test("proposal packet rejects non-repository sessions and stale workspace baselines", { skip: process.platform !== "linux" }, (t) => {
  const fixture = enteredRepoRun(t);
  const ownerSession = { ...fixture.session, origin: { type: "OWNER_GOAL" } };
  assert.throws(
    () => compileProposalWorkerPacket({
      repositoryPath: fixture.root,
      session: ownerSession,
      workspace: fixture.workspace,
      boundary: fixture.boundary,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
      runtimeCapabilityDigest: fixture.runtimeDigest,
    }),
    /current REPO_RUN session/u,
  );

  const staleBoundary = { ...fixture.boundary, head: "0".repeat(40) };
  assert.throws(
    () => compileProposalWorkerPacket({
      repositoryPath: fixture.root,
      session: fixture.session,
      workspace: fixture.workspace,
      boundary: staleBoundary,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
      runtimeCapabilityDigest: fixture.runtimeDigest,
    }),
    /exact RUN_CAPABILITY attempt and baseline/u,
  );
});
