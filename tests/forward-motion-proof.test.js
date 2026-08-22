"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { enterExecutionAttempt, issueExecutionPermit } = require("../lib/execution-permit");
const {
  loadLatestWorkSession,
  persistWorkSession,
  prepareWorkspace,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const { captureBoundary, runWork } = require("../lib/work-loop");
const {
  findForwardMotionProofForStop,
  findWorkerStopForGeneration,
  recordForwardMotionProof,
  recordWorkerStop,
  stopBoundaryEvidence,
} = require("../lib/work-forward-motion-record");
const { sealWorkSession } = require("../lib/work-session");
const { compileProductProofSpec } = require("../lib/work-proof-compiler");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("../lib/semantic-authority");
const {
  acquireWorkspaceExecutionLease,
  releaseWorkspaceExecutionLease,
} = require("../lib/workspace-custody");
const { ROOT, tempDir } = require("./helpers/cli");
const { directionFromContent, writeProductMd } = require("./helpers/product-direction");
const { writePassingProductProof } = require("./helpers/product-proof");

const FAKE_WORKER = path.join(ROOT, "tests", "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const parent = tempDir("forward-motion-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Forward Motion Test"]);
  git(root, ["config", "user.email", "forward-motion@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  writeProductMd(root);
  writePassingProductProof(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function session(root, maxAttempts = 2) {
  const productDirection = directionFromContent();
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const productResult = "Create the delivered result file.";
  const newlyTrueBehavior = "src/result.txt contains delivered.";
  const doneWhen = "The exact file exists and validation passes.";
  const productProofSpec = compileProductProofSpec({
    repositoryPath: root,
    productDirection,
    base,
    productResult,
    newlyTrueBehavior,
    doneWhen,
    allowModel: false,
  });
  const semanticAuthority = compileSemanticAuthority({ productDirection });
  return sealWorkSession({
    schemaVersion: "work-session/v8",
    productDirection,
    semanticState: semanticAuthority.semanticState,
    semanticProjection: semanticProjection(semanticAuthority),
    endgameProjection: endgameProjection(semanticAuthority),
    origin: { type: "OWNER_GOAL" },
    base,
    productResult,
    journeyState: "The preferred route has not delivered the result yet.",
    doNow: "Create src/result.txt with delivered content using any in-scope means.",
    newlyTrueBehavior,
    doneWhen,
    productProofSpec,
    stopOnlyIf: ["No in-scope means can produce the result."],
    authorizedReversibleActions: ["Edit src.", "Run validation."],
    ownerOnlyActions: ["Provide credentials.", "Publish the repository."],
    allowedPaths: ["src"],
    validation: [{
      argv: [process.execPath, "-e", "const fs=require('fs');if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n')process.exit(7)"],
      cwd: ".",
      timeoutSeconds: 30,
    }],
    maxAttempts,
    delivery: { commit: false, push: false },
  });
}

function workerResult(status, operations = []) {
  return {
    worker: "forward-motion-test-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status,
      observableResult: status === "STOP" ? "The preferred route stopped." : "Prepared the delivered result.",
      operations,
      validation: [],
      stop: status === "STOP" ? {
        unsatisfiedRequirement: "The preferred API/source did not yield the required result.",
        failedMeans: [{ means: "preferred API/source", evidence: ["The preferred route returned no usable result."] }],
        alternativesConsidered: [],
        assertedConstraint: "The preferred route is unavailable in this environment.",
      } : null,
    },
  };
}

function proofCandidate(disposition, overrides = {}) {
  const base = {
    disposition,
    failedMeans: [{ means: "preferred API/source", evidence: ["The preferred route returned no usable result."] }],
    alternatives: [],
    hardConstraint: null,
    ownerRequest: null,
    disprovedAssertions: [],
  };
  if (disposition === "CONTINUE_WITH_ALTERNATIVE") {
    base.alternatives = [{
      means: "Use the in-repository substitute.",
      disposition: "AVAILABLE",
      evidence: ["The substitute can write the same sealed result."],
      requiredPaths: ["src"],
    }];
  } else if (disposition === "HARD_BLOCKED") {
    base.hardConstraint = "Every in-scope route requires a resource that does not exist.";
  } else if (disposition === "OWNER_REQUIRED") {
    base.ownerRequest = {
      kind: "CREDENTIALS",
      question: "Provide the credential required by the sealed Outcome?",
      evidence: ["No credential is available to autonomous execution."],
    };
  }
  return { ...base, ...overrides };
}

function env() {
  return {
    ...process.env,
    META_HARNESS_TEST_MODE: "1",
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
  };
}

function durableStop(root, workSession, { proof = null } = {}) {
  const workspace = prepareWorkspace(root, workSession);
  const state = persistWorkSession(root, workSession, workspace);
  const registryDir = workspaceRegistryDirectory(root);
  const lease = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  const boundary = captureBoundary(workspace.workspacePath, workSession.allowedPaths);
  const permit = issueExecutionPermit({
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    session: workSession,
    attempt: workspace.generation,
    boundary,
    workspaceCustody: workspace.custody,
    workspaceLease: lease,
    workspaceRegistryDir: registryDir,
    stateDirectory: state.directory,
  });
  const attemptEntry = enterExecutionAttempt({ stateDirectory: state.directory, permit, session: workSession });
  const stopResult = workerResult("STOP").result;
  const workerStop = recordWorkerStop({
    repositoryPath: root,
    session: workSession,
    workspace,
    attemptEntry,
    startBoundary: stopBoundaryEvidence(boundary),
    endBoundary: stopBoundaryEvidence(boundary),
    workerResult: stopResult,
  });
  const forwardMotionProof = proof
    ? recordForwardMotionProof({ repositoryPath: root, workerStop, session: workSession, candidate: proof })
    : null;
  releaseWorkspaceExecutionLease({ registryDir, lease });
  return { workspace, workerStop, forwardMotionProof };
}

test("ordinary successful work pays zero challenger tax", async (t) => {
  const root = repository(t);
  let challenges = 0;
  const result = await runWork({
    repositoryPath: root,
    session: session(root),
    runner: async () => workerResult("DONE", [{ type: "WRITE", path: "src/result.txt", content: "delivered\n" }]),
    forwardMotionRunner: async () => { challenges += 1; throw new Error("must not run"); },
    env: env(),
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(challenges, 0);
  assert.equal(result.forwardMotionProofDigest, null);
});

test("STOP can continue the same session and workspace with a fresh coding generation", async (t) => {
  const root = repository(t);
  const workSession = session(root, 2);
  let challengeCalls = 0;
  const result = await runWork({
    repositoryPath: root,
    session: workSession,
    runner: async ({ attempt }) => attempt === 1
      ? workerResult("STOP")
      : workerResult("DONE", [{ type: "WRITE", path: "src/result.txt", content: "delivered\n" }]),
    forwardMotionRunner: async () => { challengeCalls += 1; return proofCandidate("CONTINUE_WITH_ALTERNATIVE"); },
    env: env(),
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.executionPermits.map((permit) => permit.generation), [1, 2]);
  assert.equal(challengeCalls, 1);
  const workerStop = findWorkerStopForGeneration(root, workSession.sessionDigest, result.workspace.workspaceId, 1);
  const proof = findForwardMotionProofForStop(root, workerStop.stopDigest);
  assert.equal(proof.disposition, "CONTINUE_WITH_ALTERNATIVE");
});

test("arbitrary human roles cannot manufacture OWNER_REQUIRED", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, 1),
    runner: async () => workerResult("STOP"),
    forwardMotionRunner: async () => proofCandidate("OWNER_REQUIRED", {
      ownerRequest: {
        kind: "LIBRARIAN_AUTHORITY",
        question: "Ask the librarian?",
        evidence: ["The worker invented this organizational role."],
      },
    }),
    env: env(),
  });
  assert.equal(result.outcome, "REPLAN_REQUIRED");
  assert.match(result.forwardMotionProofDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(result.nextAction, "Ask the librarian?");
});

test("only typed constitutional authority reaches OWNER_REQUIRED", async (t) => {
  const root = repository(t);
  const result = await runWork({
    repositoryPath: root,
    session: session(root, 1),
    runner: async () => workerResult("STOP"),
    forwardMotionRunner: async () => proofCandidate("OWNER_REQUIRED"),
    env: env(),
  });
  assert.equal(result.outcome, "OWNER_REQUIRED");
  assert.equal(result.nextAction, "Provide the credential required by the sealed Outcome?");
  assert.match(result.forwardMotionProofDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("durable STOP recovers after interruption without replaying the worker", async (t) => {
  const root = repository(t);
  const original = session(root, 2);
  durableStop(root, original);
  const resumed = loadLatestWorkSession(root);
  let workerCalls = 0;
  const result = await runWork({
    repositoryPath: root,
    session: resumed,
    runner: async () => { workerCalls += 1; throw new Error("worker replay is forbidden"); },
    forwardMotionRunner: async () => proofCandidate("REPLAN_REQUIRED"),
    env: env(),
  });
  assert.equal(workerCalls, 0);
  assert.equal(result.outcome, "REPLAN_REQUIRED");
});

test("durable CONTINUE proof recovers by advancing once, not by replaying the stopped generation", async (t) => {
  const root = repository(t);
  const original = session(root, 2);
  durableStop(root, original, { proof: proofCandidate("CONTINUE_WITH_ALTERNATIVE") });
  const resumed = loadLatestWorkSession(root);
  const workerAttempts = [];
  let challengeCalls = 0;
  const result = await runWork({
    repositoryPath: root,
    session: resumed,
    runner: async ({ attempt }) => {
      workerAttempts.push(attempt);
      return workerResult("DONE", [{ type: "WRITE", path: "src/result.txt", content: "delivered\n" }]);
    },
    forwardMotionRunner: async () => { challengeCalls += 1; return proofCandidate("REPLAN_REQUIRED"); },
    env: env(),
  });
  assert.equal(result.outcome, "DONE");
  assert.deepEqual(workerAttempts, [2]);
  assert.equal(challengeCalls, 0);
  assert.deepEqual(result.executionPermits.map((permit) => permit.generation), [1, 2]);
});
