"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  findExecutionClosureForOrigin,
} = require("../lib/execution-closure");
const { domainDigest } = require("../lib/contracts/digest");
const { enterExecutionAttempt, issueExecutionPermit } = require("../lib/execution-permit");
const { pinProductDirection } = require("../lib/product-direction");
const {
  compileRepoDecisionWork,
  loadRepoCharter,
  prepareAuthoritativeWorld,
} = require("../lib/repo-decision-plane-v2");
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
const { persistProductProof } = require("../lib/work-product-proof");
const { verifyProductProof } = require("../lib/work-verifier");
const {
  acceptCandidate,
  deliverValidatedChanges,
  persistWorkSession,
  prepareWorkspace,
  sealCandidate,
  stateDirectory,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const {
  acquireWorkspaceExecutionLease,
  readWorkspaceCustody,
  releaseWorkspaceExecutionLease,
} = require("../lib/workspace-custody");
const { runRaw, tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const { writePassingProductProof } = require("./helpers/product-proof");

const FAKE_WORKER = path.join(__dirname, "fixtures", "fake-coding-worker.js");
const AUTHORITY_RACE = path.join(__dirname, "fixtures", "world-authority-race.js");

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

function acceptedCandidate(session, seal) {
  const body = {
    schemaVersion: "candidate-verification/v1",
    isolation: "linux-user-mount-net-pid-chroot/v1",
    candidateTreeOid: seal.candidateTreeOid,
    commands: session.validation.map((command) => ({
      argv: command.argv,
      cwd: command.cwd,
      passed: true,
      exitCode: 0,
      durationMs: 1,
      output: "",
    })),
  };
  return acceptCandidate({
    session,
    candidateSeal: seal,
    verification: {
      ...body,
      verificationDigest: domainDigest("meta-harness-candidate-verification/v1", body),
    },
  });
}

function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${filePath}`));
      setTimeout(poll, 5);
    }
    poll();
  });
}

function childOutcome(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout || `race child exited ${code}`));
      const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
      try {
        resolve(JSON.parse(lines.at(-1)));
      } catch (error) {
        reject(new Error(`invalid race child output: ${stdout || stderr}: ${error.message}`));
      }
    });
  });
}

function spawnAuthorityRace(root, role, readyPath, extraEnv) {
  return spawn(process.execPath, [AUTHORITY_RACE], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MH_RACE_ROLE: role,
      MH_RACE_READY: readyPath,
      MH_RACE_REPOSITORY: root,
      ...extraEnv,
    },
  });
}

function assertRaceWinner(current, first, successor, admissionOutcome, transitionOutcome) {
  if (admissionOutcome.ok) {
    assert.equal(admissionOutcome.status, "ENTERED");
    assert.equal(transitionOutcome.code, "MH_WORLD_HEAD_FROZEN");
    assert.equal(current.headDigest, first.head.headDigest);
    return;
  }
  assert.equal(admissionOutcome.code, "MH_REPO_DECISION_STALE");
  assert.equal(transitionOutcome.status, "APPLIED");
  assert.equal(current.worldDigest, successor.worldDigest);
}

function assertAuthorityRaceResult(root, first, successor, admissionOutcome, transitionOutcome) {
  const current = readCurrentWorldHead(root).head;
  const admissionWon = admissionOutcome.ok === true;
  const transitionWon = transitionOutcome.ok === true;
  assert.notEqual(admissionWon, transitionWon);
  assertRaceWinner(current, first, successor, admissionOutcome, transitionOutcome);
}

async function runAuthorityRace(root, first, compiled, prepared, successor, transition) {
  const barrier = path.join(root, "authority-race.barrier");
  const admissionReady = path.join(root, "authority-race.admission.ready");
  const transitionReady = path.join(root, "authority-race.transition.ready");
  fs.writeFileSync(barrier, "hold\n", "utf8");
  const admissionChild = spawnAuthorityRace(root, "admission", admissionReady, {
    MH_RACE_BARRIER: barrier,
    MH_RACE_STATE_DIRECTORY: prepared.permitStateDirectory,
    MH_RACE_PERMIT: JSON.stringify(prepared.permit),
    MH_RACE_SESSION: JSON.stringify(compiled.session),
  });
  const transitionChild = spawnAuthorityRace(root, "transition", transitionReady, {
    MH_RACE_BARRIER: barrier,
    MH_RACE_TRANSITION: JSON.stringify(transition),
  });
  try {
    await Promise.all([waitForFile(admissionReady), waitForFile(transitionReady)]);
    const admissionOutcomePromise = childOutcome(admissionChild);
    const transitionOutcomePromise = childOutcome(transitionChild);
    fs.unlinkSync(barrier);
    const [admissionOutcome, transitionOutcome] = await Promise.all([
      admissionOutcomePromise,
      transitionOutcomePromise,
    ]);
    assert.equal(Number(admissionOutcome.ok) + Number(transitionOutcome.ok), 1);
    assertAuthorityRaceResult(root, first, successor, admissionOutcome, transitionOutcome);
  } finally {
    if (fs.existsSync(barrier)) fs.unlinkSync(barrier);
    if (admissionChild.exitCode === null) admissionChild.kill();
    if (transitionChild.exitCode === null) transitionChild.kill();
    releaseWorkspaceExecutionLease({ registryDir: prepared.registryDir, lease: prepared.lease });
  }
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
  writePassingProductProof(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
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
    schemaVersion: "repo-decision/v3",
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
        base: { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) },
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

function realityTransition(predecessorHeadDigest, successor) {
  const body = {
    schemaVersion: "world-transition/v1",
    predecessorHeadDigest,
    cause: {
      type: "REALITY_REFRESH",
      projectionDigest: computeWorldProjectionDigest(successor.worldDigest, successor.attestation.attestationDigest),
    },
    successorWorldDigest: successor.worldDigest,
    successorAttestationDigest: successor.attestation.attestationDigest,
  };
  return validateWorldTransition({ ...body, transitionDigest: computeWorldTransitionDigest(body) });
}

test("authoritative WorldHead compiles minimal work-session/v7 with Outcome claim provenance and sealed product proof", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { claims: ["repo-owned"], hypotheses: ["opaque"] });
  installDecision(root, initial.head.headDigest);
  const compiled = compileRepoDecisionWork(root);
  assert.equal(compiled.type, "DISPATCH");
  assert.equal(compiled.session.schemaVersion, "work-session/v7");
  assert.equal(compiled.session.productProofSpec.schemaVersion, "product-proof-spec/v1");
  assert.equal(compiled.session.base.commit, git(root, ["rev-parse", "HEAD"]));
  assert.deepEqual(compiled.session.origin, {
    type: "REPO_OUTCOME",
    outcomeDigest: compiled.outcomeDigest,
    claimDigest: compiled.claimDigest,
  });
  assert.equal(compiled.session.origin.decisionDigest, undefined);
  assert.equal(compiled.session.origin.worldDigest, undefined);
});

test("authoritative World product direction must still match live owner direction", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["projected-under-v1"] });
  const originalDirection = pinProductDirection(root);
  const changedDirection = originalDirection.content
    .replace("product-direction-v1", "product-direction-v2")
    .replace("Deliver one clear product result", "Deliver the revised product result");
  writeProductMd(root, changedDirection);
  installDecision(root, initial.head.headDigest);

  assert.throws(
    () => compileRepoDecisionWork(root),
    (error) => error.code === "MH_REPO_DECISION_STALE" && /authoritative World product direction/.test(error.message),
  );
});

test("mutable candidate repo-world overwrite is inert to authoritative WorldHead", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["authoritative"] });
  installDecision(root, initial.head.headDigest);
  const candidate = persistProjectionObjects(root, { observations: ["candidate-only"] });
  writeJson(root, ".meta-harness/repo-world.json", candidate.world);

  const compiled = compileRepoDecisionWork(root);
  assert.equal(compiled.type, "DISPATCH");
  assert.equal(compiled.worldHeadDigest, initial.head.headDigest);
  assert.equal(readCurrentWorldHead(root).head.worldDigest, initial.worldDigest);
  assert.notEqual(candidate.worldDigest, initial.worldDigest);
});

test("local source drift blocks dispatch from authoritative attestation", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { missions: ["one"] });
  installDecision(root, initial.head.headDigest);
  assert.equal(compileRepoDecisionWork(root).type, "DISPATCH");
  fs.writeFileSync(path.join(root, "src", "baseline.txt"), "changed after attestation\n", "utf8");
  assert.throws(() => compileRepoDecisionWork(root), (error) => error.code === "MH_WORLD_ATTESTATION_DRIFT");
});

test("legacy NO_DISPATCH remains historical evidence and is not active mutable work authority", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { observations: ["current"] });
  installDecision(root, initial.head.headDigest, { type: "NO_DISPATCH", reason: "NO_VALUABLE_ACTION" });
  const result = runRaw(root, ["work", root, "--json"], { env: workerEnv() });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).outcome, "REPLAN_REQUIRED");
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

test("two competing transitions from the same predecessor have exactly one CAS winner", (t) => {
  const root = repository(t);
  const first = persistWorld(root, { observations: ["H"] });
  const left = persistProjectionObjects(root, { observations: ["left"] });
  const right = persistProjectionObjects(root, { observations: ["right"] });
  const leftTransition = realityTransition(first.head.headDigest, left);
  const rightTransition = realityTransition(first.head.headDigest, right);

  const applied = commitTransition(root, leftTransition);
  assert.equal(applied.status, "APPLIED");
  assert.throws(() => commitTransition(root, rightTransition), (error) => error.code === "MH_WORLD_CONFLICT");
  assert.equal(readCurrentWorldHead(root).head.headDigest, applied.head.headDigest);
  assert.equal(readCurrentWorldHead(root).head.worldDigest, left.worldDigest);
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
  const closure = findExecutionClosureForOrigin(root, compiled.session.origin);
  assert.equal(closure.disposition, "COMPLETED");
  assert.equal(closure.attemptEntries.length, 2);
  assert.match(closure.workResultDigest, /^sha256:[a-f0-9]{64}$/u);
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
  const closure = findExecutionClosureForOrigin(root, compiled.session.origin);
  return { initial, compiled, result, closure };
}

test("completed Outcome execution does not freeze World refresh, but stale learning cannot commit blindly", async (t) => {
  const root = repository(t);
  const run = await completedDecisionRun(root);
  assert.equal(run.result.outcome, "DONE");
  assert.match(run.closure.workResultDigest, /^sha256:[a-f0-9]{64}$/u);
  const refreshed = persistWorld(root, { observations: ["independent-refresh"] }, {
    predecessorHeadDigest: run.initial.head.headDigest,
  });
  assert.equal(readCurrentWorldHead(root).head.headDigest, refreshed.head.headDigest);
  const learnedWorld = persistProjectionObjects(root, { observations: ["stale-learning"] });
  const staleLearning = learningTransition(root, run.initial.head.headDigest, run.closure, learnedWorld);
  assert.throws(() => commitTransition(root, staleLearning), (error) => error.code === "MH_WORLD_CONFLICT");
});

test("ATTEMPT_LEARNING banks the admitted execution once and rejects wrong-predecessor or double banking", async (t) => {
  const root = repository(t);
  const run = await completedDecisionRun(root);
  const successor = persistProjectionObjects(root, { observations: ["learned"] });
  const transition = learningTransition(root, run.initial.head.headDigest, run.closure, successor);

  const applied = commitTransition(root, transition);
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.head.worldDigest, successor.worldDigest);
  assert.equal(applied.head.generation, run.initial.head.generation + 1);
  assert.equal(require("../lib/outcome-claim").findActiveOutcomeClaimForOutcome(root, run.compiled.outcomeDigest), null);
  assert.equal(commitTransition(root, transition).status, "ALREADY_APPLIED");

  const wrongSuccessor = persistProjectionObjects(root, { observations: ["wrong-predecessor"] });
  const wrongPredecessor = learningTransition(root, run.initial.head.headDigest, run.closure, wrongSuccessor);
  assert.throws(() => commitTransition(root, wrongPredecessor), (error) => error.code === "MH_WORLD_CONFLICT");

  const duplicateSuccessor = persistProjectionObjects(root, { observations: ["double-bank"] });
  const doubleBank = learningTransition(root, applied.head.headDigest, run.closure, duplicateSuccessor);
  assert.throws(() => commitTransition(root, doubleBank), (error) => error.code === "MH_OUTCOME_CLAIM_RELEASED");
});

test("ATTEMPT_LEARNING fails closed when the referenced immutable work result is missing", async (t) => {
  const root = repository(t);
  const run = await completedDecisionRun(root);
  const successor = persistProjectionObjects(root, { observations: ["must-not-bank"] });
  const transition = learningTransition(root, run.initial.head.headDigest, run.closure, successor);
  fs.unlinkSync(objectPath(root, "work-results", run.closure.workResultDigest));

  assert.throws(() => commitTransition(root, transition), (error) => error.code === "MH_WORLD_AUTHORITY_MISSING");
  assert.equal(readCurrentWorldHead(root).head.headDigest, run.initial.head.headDigest);
});

test("ATTEMPT_LEARNING fails closed when a referenced AttemptEntry is corrupted", async (t) => {
  const root = repository(t);
  const run = await completedDecisionRun(root);
  const entryPath = attemptEntryPath(root, run.compiled.session.origin, 1);
  const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  entry.enteredAt = new Date(Date.parse(entry.enteredAt) + 1000).toISOString();
  fs.writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  const successor = persistProjectionObjects(root, { observations: ["must-not-bank"] });
  const transition = learningTransition(root, run.initial.head.headDigest, run.closure, successor);

  assert.throws(() => commitTransition(root, transition), (error) => error.code === "MH_ATTEMPT_ENTRY_DIGEST");
  assert.equal(readCurrentWorldHead(root).head.headDigest, run.initial.head.headDigest);
});

module.exports = {};
