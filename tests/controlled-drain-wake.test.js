"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const { findExecutionClosureForOrigin } = require("../lib/execution-closure");
const { listActiveOutcomeClaims } = require("../lib/outcome-claim");
const { compileRepoPlannerInput } = require("../lib/repo-planner-input");
const { runRepoWorkWave } = require("../lib/repo-work-wave");
const {
  claimWorkSessionState,
  resolveActiveWorkspaceContinuation,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const { isDrainCompleteResult, runWork } = require("../lib/work-loop");
const {
  readWorkspaceCustody,
  workspaceExecutionLeasesOwnedByPid,
} = require("../lib/workspace-custody");
const { readImmutableJson } = require("../lib/world-authority");
const { readCurrentWorldState } = require("../lib/world-transition");

const {
  createOutcome,
  fakeInterpretation,
  legacySession,
  monotonicNow,
  persistInitial,
  persistOutcome,
  proposal,
  repository,
} = require("./helpers/linear-product-head");

function admitted(root, initial, id = "a") {
  const outcome = persistOutcome(root, createOutcome({
    id,
    desiredState: `Deliver ${id}.`,
    preconditions: [`${id} is pending.`],
    evidenceRequirement: `${id} is delivered.`,
  }));
  return legacySession(root, outcome, initial.head.headDigest, id);
}

function doneRun(session) {
  const id = /^Deliver ([a-z0-9-]+)\.$/iu.exec(session.productResult)?.[1] || "a";
  return {
    worker: "controlled-drain-test-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "DONE",
      observableResult: `Prepared ${id}.`,
      operations: [{ type: "WRITE", path: `src/${id}/result.txt`, content: "delivered\n" }],
      validation: ["synthetic drain test"],
      stop: null,
    },
  };
}

function stopRun() {
  return {
    worker: "controlled-drain-stop-worker",
    stdout: "",
    stderr: "",
    result: {
      schemaVersion: "worker-result/v2",
      status: "STOP",
      observableResult: "Preferred route stopped.",
      operations: [],
      validation: ["synthetic stop"],
      stop: {
        unsatisfiedRequirement: "The preferred route is unavailable.",
        failedMeans: [{ means: "preferred route", evidence: ["synthetic unavailability"] }],
        alternativesConsidered: [],
        assertedConstraint: "The preferred route is unavailable.",
      },
    },
  };
}

function replanCandidate() {
  return {
    disposition: "REPLAN_REQUIRED",
    failedMeans: [{ means: "preferred route", evidence: ["synthetic unavailability"] }],
    alternatives: [],
    hardConstraint: null,
    ownerRequest: null,
    disprovedAssertions: [],
  };
}

function emptyPlanner() {
  return { schemaVersion: "planner-candidate-batch/v3", proposals: [] };
}

function plannerCandidate(id, paths = [`src/${id}`]) {
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

test("planner result stays disposable when drain wins before Claim admission", async (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const controller = new AbortController();
  const result = await runRepoWorkWave({
    repositoryPath: root,
    signal: controller.signal,
    plannerRunner: async () => {
      controller.abort();
      return { batch: { schemaVersion: "planner-candidate-batch/v3", proposals: [plannerCandidate("a", ["src/a"], root)] } };
    },
    runner: async () => {
      throw new Error("drain after planner return must admit no worker");
    },
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  assert.equal(isDrainCompleteResult(result), true);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
});

test("PENDING_WORKSPACE drain creates no workspace, lease, or AttemptEntry", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const active = admitted(root, initial);
  assert.equal(claimWorkSessionState(root, active.claim.claimDigest).state, "PENDING");

  const controller = new AbortController();
  controller.abort();
  const result = await runWork({
    repositoryPath: root,
    session: active.session,
    signal: controller.signal,
  });

  assert.equal(isDrainCompleteResult(result), true);
  assert.equal(claimWorkSessionState(root, active.claim.claimDigest).state, "PENDING");
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
  assert.equal(workspaceExecutionLeasesOwnedByPid(workspaceRegistryDirectory(root), process.pid).length, 0);
  assert.equal(findExecutionClosureForOrigin(root, active.session.origin), null);
});

test("mid-worker drain lands ATTEMPT_ABORTED as EXECUTION_ABORTED and releases the Claim", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const active = admitted(root, initial);
  const controller = new AbortController();
  let started;
  const workerStarted = new Promise((resolve) => { started = resolve; });

  const runner = ({ session, signal }) => new Promise((resolve) => {
    started();
    signal.addEventListener("abort", () => resolve(doneRun(session)), { once: true });
  });

  const pending = runRepoWorkWave({
    repositoryPath: root,
    signal: controller.signal,
    runner,
    plannerRunner: emptyPlanner,
    interpret: fakeInterpretation,
    now: monotonicNow(),
  });
  await workerStarted;
  controller.abort();
  const result = await pending;

  assert.equal(isDrainCompleteResult(result), true);
  assert.equal(listActiveOutcomeClaims(root).length, 0);
  assert.equal(workspaceExecutionLeasesOwnedByPid(workspaceRegistryDirectory(root), process.pid).length, 0);

  const state = claimWorkSessionState(root, active.claim.claimDigest);
  assert.equal(state.state, "TERMINAL");
  assert.equal(readWorkspaceCustody(workspaceRegistryDirectory(root), state.workspaceId).state, "TERMINAL_ABANDONED");
  const closure = findExecutionClosureForOrigin(root, active.session.origin);
  assert.equal(closure.disposition, "INTERRUPTED_AFTER_ENTRY");
  assert.equal(closure.workResultDigest, null);

  const current = readCurrentWorldState(root);
  const transition = readImmutableJson(root, "transitions", current.head.lastTransitionDigest);
  assert.equal(transition.cause.type, "ATTEMPT_ABORTED");
  const plannerInput = compileRepoPlannerInput({ repositoryPath: root, current, recovered: [] });
  assert.equal(plannerInput.unresolvedHandoffs[0]?.disposition, "EXECUTION_ABORTED");
});

test("drain after candidate seal parks exact SEALED_CANDIDATE and WAKE does not replay worker", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const active = admitted(root, initial);
  const controller = new AbortController();
  let workerCalls = 0;

  const parked = await runWork({
    repositoryPath: root,
    session: active.session,
    signal: controller.signal,
    runner: async ({ session }) => {
      workerCalls += 1;
      return doneRun(session);
    },
    onProgress: (stage) => {
      if (stage === "validating") controller.abort();
    },
  });
  assert.equal(isDrainCompleteResult(parked), true);
  assert.equal(workerCalls, 1);

  const parkedState = claimWorkSessionState(root, active.claim.claimDigest);
  assert.equal(parkedState.state, "ACTIVE");
  const parkedCustody = readWorkspaceCustody(workspaceRegistryDirectory(root), parkedState.workspaceId);
  assert.equal(parkedCustody.state, "ACTIVE");
  assert.equal(resolveActiveWorkspaceContinuation(root, parkedState.session, parkedCustody).kind, "SEALED_CANDIDATE");
  assert.equal(workspaceExecutionLeasesOwnedByPid(workspaceRegistryDirectory(root), process.pid).length, 0);

  const resumed = await runWork({
    repositoryPath: root,
    session: parkedState.session,
    runner: async () => {
      workerCalls += 1;
      throw new Error("sealed candidate recovery must not replay worker");
    },
  });
  assert.equal(resumed.outcome, "DONE");
  assert.equal(workerCalls, 1);
});

test("drain after worker STOP cancels challenger and WAKE reruns challenger without worker replay", async (t) => {
  const { root } = repository(t);
  const initial = persistInitial(root, "world-transition/v2");
  const active = admitted(root, initial);
  const controller = new AbortController();
  let workerCalls = 0;
  let challengerCalls = 0;
  let challengerStarted;
  const started = new Promise((resolve) => { challengerStarted = resolve; });

  const parkedPromise = runWork({
    repositoryPath: root,
    session: active.session,
    signal: controller.signal,
    runner: async () => {
      workerCalls += 1;
      return stopRun();
    },
    forwardMotionRunner: ({ signal }) => new Promise((resolve) => {
      challengerCalls += 1;
      challengerStarted();
      signal.addEventListener("abort", () => resolve(replanCandidate()), { once: true });
    }),
  });
  await started;
  controller.abort();
  const parked = await parkedPromise;
  assert.equal(isDrainCompleteResult(parked), true);
  assert.equal(workerCalls, 1);
  assert.equal(challengerCalls, 1);

  const parkedState = claimWorkSessionState(root, active.claim.claimDigest);
  const custody = readWorkspaceCustody(workspaceRegistryDirectory(root), parkedState.workspaceId);
  const continuation = resolveActiveWorkspaceContinuation(root, parkedState.session, custody);
  assert.equal(continuation.kind, "WORKER_STOP");
  assert.equal(continuation.forwardMotionProof, null);
  assert.equal(findExecutionClosureForOrigin(root, active.session.origin), null);

  const resumed = await runWork({
    repositoryPath: root,
    session: parkedState.session,
    runner: async () => {
      workerCalls += 1;
      throw new Error("durable STOP recovery must not replay worker");
    },
    forwardMotionRunner: async () => {
      challengerCalls += 1;
      return replanCandidate();
    },
  });
  assert.equal(resumed.outcome, "REPLAN_REQUIRED");
  assert.equal(workerCalls, 1);
  assert.equal(challengerCalls, 2);
});

test("second SIGINT is a real OS escape after first-signal drain removes cooperative handlers", { skip: process.platform === "win32" }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-drain-signal-"));
  const script = path.join(root, "signal-child.js");
  const binPath = path.resolve(__dirname, "..", "bin", "meta-harness.js");
  fs.writeFileSync(script, [
    '"use strict";',
    `const { createControlledSignalScope } = require(${JSON.stringify(binPath)});`,
    'const scope = createControlledSignalScope();',
    'scope.signal.addEventListener("abort", () => process.stdout.write("ABORTED\\n"), { once: true });',
    'process.stdout.write("READY\\n");',
    'setInterval(() => {}, 1000);',
    "",
  ].join("\n"), "utf8");
  const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });

  let stdout = "";
  const waitFor = (needle) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), 3000);
    const check = (chunk) => {
      stdout += String(chunk);
      if (!stdout.includes(needle)) return;
      clearTimeout(deadline);
      child.stdout.off("data", check);
      resolve();
    };
    child.stdout.on("data", check);
    check("");
  });

  await waitFor("READY\n");
  child.kill("SIGINT");
  await waitFor("ABORTED\n");
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);

  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.kill("SIGINT");
  const result = await closed;
  assert.equal(result.code, null);
  assert.equal(result.signal, "SIGINT");
});
