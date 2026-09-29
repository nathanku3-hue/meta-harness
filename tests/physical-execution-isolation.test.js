"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { enterRunAttempt } = require("../lib/execution-attempt");
const {
  findExecutionClosureForOrigin,
  findExecutionClosureForWorkspace,
  findExecutionClosuresForOrigin,
  findExecutionWorkResultForWorkspace,
  recordExecutionClosure,
} = require("../lib/execution-closure");
const { pinProductDirection } = require("../lib/product-direction");
const { appendRunEvent, readRunJournal, runIdForExecution } = require("../lib/run-journal");
const {
  captureWorkspaceBoundary,
  commonGitDirectory,
  createImmutableRunSnapshot,
  createReplacementWorkspaceFromJournal,
  prepareWorkspace,
} = require("../lib/work-git");
const { WORK_SESSION_SCHEMA, sealWorkSession } = require("../lib/work-session");
const {
  createOutcome,
  persistInitial,
  repository,
} = require("./helpers/linear-product-head");

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

test("same logical REPO_RUN can persist independent physical execution facts", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const outcome = createOutcome({
    id: "physical-execution-isolation",
    desiredState: "One logical run can execute through independent physical workspaces.",
    preconditions: ["The product outcome is not yet integrated."],
    evidenceRequirement: "Each physical execution retains independent durable facts.",
  });
  const productResult = "Deliver a.";
  const newlyTrueBehavior = "src/a/result.txt contains delivered.";
  const doneWhen = "The delivered file exists and validation passes.";
  const productDirection = pinProductDirection(root);
  const base = { type: "EXACT_COMMIT", commit: initial.head.productCommit };
  const session = sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection,
    origin: {
      type: "REPO_RUN",
      outcomeDigest: outcome.outcomeDigest,
      objectiveRevision: 0,
    },
    base,
    productResult,
    journeyState: "The result is not delivered yet.",
    doNow: "Create src/a/result.txt.",
    newlyTrueBehavior,
    doneWhen,
    stopOnlyIf: ["The write boundary is genuinely insufficient."],
    allowedPaths: ["src/a"],
    validation: [{ argv: ["node", "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 2,
    delivery: { push: false },
  });

  const workspaceA = prepareWorkspace(root, session);
  const workspaceB = prepareWorkspace(root, session);
  assert.notEqual(workspaceA.workspaceId, workspaceB.workspaceId);

  const attemptA = enterRunAttempt({
    repositoryPath: root,
    session,
    workspaceId: workspaceA.workspaceId,
    generation: 1,
    attemptInputKey: digest("a"),
  });
  const attemptB = enterRunAttempt({
    repositoryPath: root,
    session,
    workspaceId: workspaceB.workspaceId,
    generation: 1,
    attemptInputKey: digest("b"),
  });

  const closureA = recordExecutionClosure({
    repositoryPath: root,
    session,
    attemptEntries: [attemptA],
    disposition: "INCOMPLETE",
    workResult: {
      sessionDigest: session.sessionDigest,
      outcome: "REPLAN_REQUIRED",
      workspace: { workspaceId: workspaceA.workspaceId },
    },
    now: new Date("2026-09-24T01:00:00.000Z"),
  });
  const closureB = recordExecutionClosure({
    repositoryPath: root,
    session,
    attemptEntries: [attemptB],
    disposition: "COMPLETED",
    workResult: {
      sessionDigest: session.sessionDigest,
      outcome: "DONE",
      workspace: { workspaceId: workspaceB.workspaceId },
    },
    now: new Date("2026-09-24T01:00:01.000Z"),
  });

  assert.notEqual(closureA.closureDigest, closureB.closureDigest);
  assert.equal(
    findExecutionClosureForWorkspace(root, session.origin, session.sessionDigest, workspaceA.workspaceId).closureDigest,
    closureA.closureDigest,
  );
  assert.equal(
    findExecutionClosureForWorkspace(root, session.origin, session.sessionDigest, workspaceB.workspaceId).closureDigest,
    closureB.closureDigest,
  );
  assert.equal(findExecutionClosuresForOrigin(root, session.origin).length, 2);
  assert.equal(
    findExecutionWorkResultForWorkspace(root, session.origin, session.sessionDigest, workspaceA.workspaceId).result.outcome,
    "REPLAN_REQUIRED",
  );
  assert.equal(
    findExecutionWorkResultForWorkspace(root, session.origin, session.sessionDigest, workspaceB.workspaceId).result.outcome,
    "DONE",
  );
  assert.equal(findExecutionClosureForOrigin(root, session.origin).closureDigest, closureB.closureDigest);
});

test("crash recovery reconstructs a durable snapshot into a fresh physical execution", (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const outcome = createOutcome({
    id: "fresh-recovery-workspace",
    desiredState: "Interrupted work resumes from durable Git facts in a new worktree.",
    preconditions: ["A prior physical execution may disappear."],
    evidenceRequirement: "Recovered bytes appear under a different workspaceId.",
  });
  const productResult = "Deliver a.";
  const newlyTrueBehavior = "src/a/result.txt contains checkpointed work.";
  const doneWhen = "The checkpointed candidate is recoverable.";
  const productDirection = pinProductDirection(root);
  const base = { type: "EXACT_COMMIT", commit: initial.head.productCommit };
  const session = sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection,
    origin: {
      type: "REPO_RUN",
      outcomeDigest: outcome.outcomeDigest,
      objectiveRevision: 0,
    },
    base,
    productResult,
    journeyState: "The result is not delivered yet.",
    doNow: "Recover the checkpointed candidate.",
    newlyTrueBehavior,
    doneWhen,
    stopOnlyIf: ["The durable snapshot cannot be reconstructed."],
    allowedPaths: ["src/a"],
    validation: [{ argv: ["node", "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 2,
    delivery: { push: false },
  });

  const workspaceA = prepareWorkspace(root, session);
  const targetA = path.join(workspaceA.workspacePath, "src", "a", "result.txt");
  fs.writeFileSync(targetA, "checkpointed\n", "utf8");
  const boundaryA = captureWorkspaceBoundary(workspaceA.workspacePath, session.allowedPaths);
  const snapshot = createImmutableRunSnapshot({
    repositoryPath: root,
    workspacePath: workspaceA.workspacePath,
    sessionDigest: session.sessionDigest,
    workspaceId: workspaceA.workspaceId,
    generation: 1,
    treeOid: boundaryA.treeOid,
    parentOid: session.base.commit,
    env: {},
  });
  appendRunEvent({
    gitCommonDirectory: commonGitDirectory(root),
    runId: runIdForExecution(session.sessionDigest, workspaceA.workspaceId),
    type: "mutation/result",
    data: {
      sessionDigest: session.sessionDigest,
      workspaceId: workspaceA.workspaceId,
      generation: 1,
      source: "test-checkpoint",
      materializedPaths: ["src/a/result.txt"],
      snapshotOid: snapshot.snapshotOid,
      snapshotDigest: snapshot.snapshotDigest,
      treeOid: snapshot.treeOid,
    },
  });

  const workspaceB = createReplacementWorkspaceFromJournal(
    root,
    session,
    workspaceA.workspaceId,
    "test-crash-recovery",
  );

  assert.notEqual(workspaceB.workspaceId, workspaceA.workspaceId);
  assert.notEqual(workspaceB.workspacePath, workspaceA.workspacePath);
  assert.equal(
    fs.readFileSync(path.join(workspaceB.workspacePath, "src", "a", "result.txt"), "utf8").replace(/\r\n/gu, "\n"),
    "checkpointed\n",
  );

  const journalA = readRunJournal({
    gitCommonDirectory: commonGitDirectory(root),
    runId: runIdForExecution(session.sessionDigest, workspaceA.workspaceId),
  });
  const journalB = readRunJournal({
    gitCommonDirectory: commonGitDirectory(root),
    runId: runIdForExecution(session.sessionDigest, workspaceB.workspaceId),
  });
  assert.equal(journalA[0].sequence, 1);
  assert.equal(journalB[0].sequence, 1);
  assert.equal(journalB[0].type, "workspace/restored");
  assert.equal(journalB[0].data.previousWorkspaceId, workspaceA.workspaceId);
});
