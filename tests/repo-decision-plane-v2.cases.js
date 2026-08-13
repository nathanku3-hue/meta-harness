"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { findExecutionClosureForDecision } = require("../lib/execution-closure");
const { enterExecutionAttempt, issueExecutionPermit } = require("../lib/execution-permit");
const { pinProductDirection } = require("../lib/product-direction");
const {
  compileRepoDecisionWork,
  loadRepoCharter,
  prepareAuthoritativeWorld,
} = require("../lib/repo-decision-plane");
const {
  attemptEntriesRoot,
  attemptEntryPath,
  persistImmutableBytes,
  persistImmutableJson,
  objectPath,
  readCurrentWorldPointer,
} = require("../lib/world-authority");
const {
  computeRepoWorldDigest,
  computeWorldAttestationDigest,
  rawDigest,
} = require("../lib/world-attestation");
const {
  commitTransition,
  computeInterpretationDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldHead,
  validateWorldTransition,
} = require("../lib/world-transition");
const { captureBoundary, runWork } = require("../lib/work-loop");
const { prepareWorkspace, stateDirectory, workspaceRegistryDirectory } = require("../lib/work-git");
const { acquireWorkspaceExecutionLease, releaseWorkspaceExecutionLease } = require("../lib/workspace-custody");
const { runRaw, tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");

const FAKE_WORKER = path.join(__dirname, "fixtures", "fake-coding-worker.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function workerEnv(extra = {}) {
  return {
    ...process.env,
    META_HARNESS_TEST_MODE: "1",
    META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, FAKE_WORKER]),
    ...extra,
  };
}

function repository(t) {
  const parent = tempDir("repo-decision-v2-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Decision V2 Test"]);
  git(root, ["config", "user.email", "decision-v2@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "decision-v2-fixture",
    private: true,
    scripts: { test: "node -e \"process.exit(0)\"" },
  }, null, 2), "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src", "baseline.txt"), "baseline\n", "utf8");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  fs.mkdirSync(path.join(root, ".meta-harness"));
  writeJson(root, ".meta-harness/repo-charter.json", {
    ownerPolicy: "opaque-to-kernel",
    arbitraryRepoSemantics: { claims: ["repo-owned"] },
  });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function sourceObservation(root) {
  return {
    type: "LOCAL_FILE",
    sourceId: "baseline-source",
    path: "src/baseline.txt",
    digest: rawDigest(fs.readFileSync(path.join(root, "src", "baseline.txt"))),
    observedAt: "2026-08-13T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  };
}

function persistWorld(root, payload, { predecessorHeadDigest = null, cause = null } = {}) {
  const direction = pinProductDirection(root);
  const world = {
    schemaVersion: "repo-world/v2",
    productDirectionDigest: direction.digest,
    payload,
  };
  const worldDigest = computeRepoWorldDigest(world);
  const attestationBody = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: `sha256:${"7".repeat(64)}`,
    sources: [sourceObservation(root)],
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
  const attestation = {
    ...attestationBody,
    attestationDigest: computeWorldAttestationDigest(attestationBody),
  };
  persistImmutableJson(root, "worlds", worldDigest, world, "TEST_WORLD");
  persistImmutableJson(root, "attestations", attestation.attestationDigest, attestation, "TEST_ATTESTATION");
  const transitionCause = cause || {
    type: "REALITY_REFRESH",
    projectionDigest: computeWorldProjectionDigest(worldDigest, attestation.attestationDigest),
  };
  const transitionBody = {
    schemaVersion: "world-transition/v1",
    predecessorHeadDigest,
    cause: transitionCause,
    successorWorldDigest: worldDigest,
    successorAttestationDigest: attestation.attestationDigest,
  };
  const transition = validateWorldTransition({
    ...transitionBody,
    transitionDigest: computeWorldTransitionDigest(transitionBody),
  });
  const applied = commitTransition(root, transition);
  return { world, worldDigest, attestation, transition, head: applied.head, status: applied.status };
}

function validationCommand() {
  return {
    argv: [
      process.execPath,
      "-e",
      "const fs=require('fs'); if(fs.readFileSync('src/result.txt','utf8')!=='delivered\\n') process.exit(7)",
    ],
    cwd: ".",
    timeoutSeconds: 60,
  };
}

function decisionDocument(root, worldHeadDigest, decision = null) {
  const direction = pinProductDirection(root);
  const charter = loadRepoCharter(root);
  return {
    schemaVersion: "repo-decision/v2",
    productDirectionDigest: direction.digest,
    charterDigest: charter.digest,
    worldHeadDigest,
    ownerDirectiveDigest: null,
    decision: decision || {
      type: "DISPATCH",
      action: {
        id: "bounded-result",
        productResult: "Create the bounded result file.",
        journeyState: "Authoritative World permits one bounded repository result.",
        doNow: "Create src/result.txt with delivered content.",
        newlyTrueBehavior: "src/result.txt contains delivered.",
        doneWhen: "Controller validation passes.",
        stopOnlyIf: ["The allowed path is insufficient."],
        allowedPaths: ["src", "tests"],
        validation: [validationCommand()],
        maxAttempts: 2,
        delivery: { commit: false, push: false },
      },
    },
  };
}

function installDecision(root, headDigest, decision) {
  return writeJson(root, ".meta-harness/repo-decision.json", decisionDocument(root, headDigest, decision));
}

function persistProjectionObjects(root, payload) {
  const direction = pinProductDirection(root);
  const world = {
    schemaVersion: "repo-world/v2",
    productDirectionDigest: direction.digest,
    payload,
  };
  const worldDigest = computeRepoWorldDigest(world);
  const attestationBody = {
    schemaVersion: "world-attestation/v1",
    worldDigest,
    projectorDigest: `sha256:${"7".repeat(64)}`,
    sources: [sourceObservation(root)],
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
  const attestation = {
    ...attestationBody,
    attestationDigest: computeWorldAttestationDigest(attestationBody),
  };
  persistImmutableJson(root, "worlds", worldDigest, world, "TEST_WORLD");
  persistImmutableJson(root, "attestations", attestation.attestationDigest, attestation, "TEST_ATTESTATION");
  return { world, worldDigest, attestation };
}

test("authoritative WorldHead compiles minimal work-session/v3 provenance", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { claims: ["repo-owned"], hypotheses: ["opaque"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  assert.equal(compiled.type, "DISPATCH");
  assert.equal(compiled.session.schemaVersion, "work-session/v3");
  assert.deepEqual(compiled.session.origin, { type: "REPO_DECISION", decisionDigest: compiled.decisionDigest });
  assert.equal(compiled.session.origin.worldDigest, undefined);
});

test("local source drift blocks dispatch from authoritative attestation", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { missions: ["one"] });
  installDecision(root, initial.head.headDigest);
  assert.equal(compileRepoDecisionWork(root).type, "DISPATCH");
  fs.writeFileSync(path.join(root, "src", "baseline.txt"), "changed after attestation\n", "utf8");
  assert.throws(() => compileRepoDecisionWork(root), (error) => error.code === "MH_WORLD_ATTESTATION_DRIFT");
});

test("NO_DISPATCH is inert", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["current"] });
  installDecision(root, initial.head.headDigest, { type: "NO_DISPATCH", reason: "NO_VALUABLE_ACTION" });
  const result = runRaw(root, ["work", root, "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).outcome, "NO_DISPATCH");
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
  assert.deepEqual(fs.readdirSync(attemptEntriesRoot(root)), []);
});

test("opaque World payload terminology can change without kernel changes", (t) => {
  const root = repository(t);
  const first = persistWorld(root, { claims: ["c"], hypotheses: ["h"], terminalRoutes: [] });
  installDecision(root, first.head.headDigest);
  assert.equal(compileRepoDecisionWork(root).type, "DISPATCH");

  const second = persistWorld(root, { missions: ["m"], observations: ["o"], constraints: ["c"] }, {
    predecessorHeadDigest: first.head.headDigest,
  });
  installDecision(root, second.head.headDigest);
  assert.equal(compileRepoDecisionWork(root).type, "DISPATCH");
  assert.equal(second.head.generation, first.head.generation + 1);
});

test("WorldHead lineage is immutable and exact transition retry is idempotent", (t) => {
  const root = repository(t);
  const first = persistWorld(root, { generation: 1 });
  const second = persistWorld(root, { generation: 2 }, { predecessorHeadDigest: first.head.headDigest });
  assert.equal(fs.existsSync(objectPath(root, "heads", first.head.headDigest)), true);
  assert.equal(fs.existsSync(objectPath(root, "heads", second.head.headDigest)), true);
  const retry = commitTransition(root, second.transition);
  assert.equal(retry.status, "ALREADY_APPLIED");
  assert.equal(retry.head.headDigest, second.head.headDigest);
  assert.equal(readCurrentWorldHead(root).head.generation, 2);
});

test("aggregate ExecutionClosure covers every bounded repair AttemptEntry", async (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["ready"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  const result = await runWork({
    repositoryPath: root,
    session: compiled.session,
    env: workerEnv({ FAKE_WORKER_RETRY: "1" }),
    timeoutSeconds: 30,
  });
  assert.equal(result.outcome, "DONE");
  assert.equal(result.attempts, 2);
  const closure = findExecutionClosureForDecision(root, compiled.decisionDigest);
  assert.equal(closure.disposition, "COMPLETED");
  assert.equal(closure.attemptEntries.length, 2);
  assert.match(closure.workResultDigest, /^sha256:[a-f0-9]{64}$/u);
});

function enterWithoutWorker(root, session) {
  const workspace = prepareWorkspace(root, session);
  const registryDir = workspaceRegistryDirectory(root);
  const lease = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  const boundary = captureBoundary(workspace.workspacePath, session.allowedPaths);
  const permit = issueExecutionPermit({
    repositoryRoot: workspace.repositoryRoot,
    workspacePath: workspace.workspacePath,
    session,
    attempt: 1,
    boundary,
    workspaceCustody: workspace.custody,
    workspaceLease: lease,
    workspaceRegistryDir: registryDir,
    stateDirectory: stateDirectory(root),
  });
  try {
    return enterExecutionAttempt({ stateDirectory: stateDirectory(root), permit, session });
  } finally {
    releaseWorkspaceExecutionLease({ registryDir, lease });
  }
}

test("orphan first AttemptEntry recovers as interruption without replay", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["ready"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  const entry = enterWithoutWorker(root, compiled.session);
  const entryDir = path.dirname(attemptEntryPath(root, { type: "REPO_DECISION", decisionDigest: compiled.decisionDigest }, 1));
  assert.deepEqual(fs.readdirSync(entryDir), ["1.json"]);

  const recovered = prepareAuthoritativeWorld(root);
  const closure = findExecutionClosureForDecision(root, compiled.decisionDigest);
  assert.equal(closure.disposition, "INTERRUPTED_AFTER_ENTRY");
  assert.equal(closure.attemptEntries[0], entry.entryDigest);
  assert.equal(recovered.head.generation, initial.head.generation + 1);
  assert.deepEqual(fs.readdirSync(entryDir), ["1.json"]);

  installDecision(root, recovered.head.headDigest);
  assert.equal(compileRepoDecisionWork(root).type, "DISPATCH");
});

test("AttemptEntry admission freezes its predecessor WorldHead against reality refresh", (t) => {
  const root = repository(t);
  const first = persistWorld(root, { observations: ["H"] });
  installDecision(root, first.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  enterWithoutWorker(root, compiled.session);
  assert.throws(
    () => persistWorld(root, { observations: ["H1"] }, { predecessorHeadDigest: first.head.headDigest }),
    (error) => error.code === "MH_WORLD_HEAD_FROZEN",
  );
  assert.equal(readCurrentWorldHead(root).head.headDigest, first.head.headDigest);
});

test("WorldTransition winning first makes stale Decision unable to enter", (t) => {
  const root = repository(t);
  const first = persistWorld(root, { observations: ["H"] });
  installDecision(root, first.head.headDigest);
  const stale = compileRepoDecisionWork(root);
  const second = persistWorld(root, { observations: ["H1"] }, { predecessorHeadDigest: first.head.headDigest });
  assert.equal(readCurrentWorldHead(root).head.headDigest, second.head.headDigest);
  assert.throws(
    () => enterWithoutWorker(root, stale.session),
    (error) => error.code === "MH_REPO_DECISION_STALE",
  );
});

test("same Repo Decision has exactly one generation-1 admission collision point", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["ready"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  const first = enterWithoutWorker(root, compiled.session);
  assert.equal(first.ordinal, 1);
  assert.throws(
    () => enterWithoutWorker(root, compiled.session),
    (error) => error.code === "MH_REPO_DECISION_CONSUMED",
  );
  const entryDir = path.dirname(attemptEntryPath(root, { type: "REPO_DECISION", decisionDigest: compiled.decisionDigest }, 1));
  assert.deepEqual(fs.readdirSync(entryDir), ["1.json"]);
});

function learningTransition(root, predecessorHeadDigest, closure, successor) {
  const interpretationBytes = Buffer.from("repo-owned interpretation: result banked once\n", "utf8");
  const interpretationDigest = computeInterpretationDigest(interpretationBytes);
  persistImmutableBytes(root, "interpretations", interpretationDigest, interpretationBytes, "TEST_INTERPRETATION");
  const body = {
    schemaVersion: "world-transition/v1",
    predecessorHeadDigest,
    cause: { type: "ATTEMPT_LEARNING", executionClosureDigest: closure.closureDigest, interpretationDigest },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

async function completedDecisionRun(root) {
  const initial = persistWorld(root, { observations: ["before"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  const result = await runWork({ repositoryPath: root, session: compiled.session, env: workerEnv(), timeoutSeconds: 30 });
  const closure = findExecutionClosureForDecision(root, compiled.decisionDigest);
  return { initial, compiled, result, closure };
}

test("durable result freezes dispatch until it is banked", async (t) => {
  const root = repository(t);
  const run = await completedDecisionRun(root);
  assert.equal(run.result.outcome, "DONE");
  assert.match(run.closure.workResultDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.throws(() => compileRepoDecisionWork(root), (error) => error.code === "MH_WORLD_HEAD_FROZEN");
});

module.exports = {};
