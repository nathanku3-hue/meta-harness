"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  enterExecutionAttempt,
  issueExecutionPermit,
} = require("../lib/execution-permit");
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

function enteredClaimAttempt(t) {
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
  const permit = issueExecutionPermit({
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    session,
    attempt: 1,
    boundary,
    workspaceCustody: workspace.custody,
    workspaceLease: lease,
    workspaceRegistryDir: workspace.registryDir,
    stateDirectory: state.directory,
  });
  const attemptEntry = enterExecutionAttempt({
    stateDirectory: state.directory,
    permit,
    session,
    entryCapability: "CODE_PROPOSE",
  });
  return { root, session, workspace, lease, state, boundary, permit, attemptEntry };
}

test("entered Claim attempt derives one transport-only proposal worker packet", (t) => {
  const fixture = enteredClaimAttempt(t);
  const first = compileProposalWorkerPacket({
    repositoryPath: fixture.root,
    stateDirectory: fixture.state.directory,
    session: fixture.session,
    workspace: fixture.workspace,
    workspaceLease: fixture.lease,
    boundary: fixture.boundary,
    executionPermit: fixture.permit,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
  });
  const second = compileProposalWorkerPacket({
    repositoryPath: fixture.root,
    stateDirectory: fixture.state.directory,
    session: fixture.session,
    workspace: fixture.workspace,
    workspaceLease: fixture.lease,
    boundary: fixture.boundary,
    executionPermit: fixture.permit,
    attemptEntry: fixture.attemptEntry,
    attempt: 1,
  });

  assert.equal(first.packet.schemaVersion, PROPOSAL_WORKER_PACKET_SCHEMA);
  assert.equal(first.packet.permitDigest, fixture.permit.permitDigest);
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

test("proposal packet rejects non-Claim sessions and stale workspace baselines", (t) => {
  const fixture = enteredClaimAttempt(t);
  const ownerSession = { ...fixture.session, origin: { type: "OWNER_GOAL" } };
  assert.throws(
    () => compileProposalWorkerPacket({
      repositoryPath: fixture.root,
      stateDirectory: fixture.state.directory,
      session: ownerSession,
      workspace: fixture.workspace,
      workspaceLease: fixture.lease,
      boundary: fixture.boundary,
      executionPermit: fixture.permit,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
    }),
    /Claim-bound REPO_OUTCOME/u,
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
      executionPermit: fixture.permit,
      attemptEntry: fixture.attemptEntry,
      attempt: 1,
    }),
    (error) => error?.code === "MH_EXECUTION_PERMIT_STALE",
  );
});
