"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const { recordExecutionClosure } = require("../lib/execution-closure");
const { enterExecutionAttempt, issueExecutionPermit } = require("../lib/execution-permit");
const { createOutcome, persistOutcome } = require("../lib/outcome");
const {
  acquireOutcomeClaim,
  ensureOutcomeClaim,
  findActiveOutcomeClaimForOutcome,
  listActiveOutcomeClaims,
  REPOSITORY_ACTIVE_CLAIM_BOUND,
} = require("../lib/outcome-claim");
const { pinProductDirection } = require("../lib/product-direction");
const { validateRepoDecision } = require("../lib/repo-decision");
const {
  commitTransition,
  computeInterpretationDigest,
  computeWorldProjectionDigest,
  computeWorldTransitionDigest,
  readCurrentWorldHead,
  validateWorldTransition,
} = require("../lib/world-transition");
const {
  computeRepoWorldDigest,
  computeWorldAttestationDigest,
  rawDigest,
} = require("../lib/world-attestation");
const { persistImmutableBytes, persistImmutableJson } = require("../lib/world-authority");
const {
  claimWorkSessionState,
  persistWorkSession,
  prepareWorkspace,
  stateDirectory,
  workspaceRegistryDirectory,
} = require("../lib/work-git");
const { captureBoundary } = require("../lib/work-loop");
const { WORK_SESSION_SCHEMA, sealWorkSession } = require("../lib/work-session");
const {
  acquireWorkspaceExecutionLease,
  releaseWorkspaceExecutionLease,
} = require("../lib/workspace-custody");
const { tempDir } = require("./helpers/cli");
const { writeProductMd } = require("./helpers/product-direction");
const { gapProofSpec } = require("./helpers/product-proof");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("../lib/semantic-authority");

const CLAIM_RACE = path.join(__dirname, "fixtures", "outcome-claim-race.js");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const parent = tempDir("outcome-claim-authority-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Outcome Claim Test"]);
  git(root, ["config", "user.email", "outcome-claim@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a", "baseline.txt"), "a\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "b", "baseline.txt"), "b\n", "utf8");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function sourceObservation(root) {
  return {
    type: "LOCAL_FILE",
    sourceId: "claim-baseline",
    path: "src/a/baseline.txt",
    digest: rawDigest(fs.readFileSync(path.join(root, "src", "a", "baseline.txt"))),
    observedAt: "2026-08-18T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  };
}

function projectionObjects(root, payload) {
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
    generatedAt: "2026-08-18T00:00:00.000Z",
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

function outcomeLearningTransition(root, predecessorHeadDigest, closure, successor) {
  const interpretationBytes = Buffer.from(`Outcome ${closure.origin.outcomeDigest} learned.\n`, "utf8");
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

function persistWorld(root, payload, predecessorHeadDigest = null) {
  const successor = projectionObjects(root, payload);
  const applied = commitTransition(root, realityTransition(predecessorHeadDigest, successor));
  return { ...successor, head: applied.head };
}

function outcome(root, id, desiredState, precondition) {
  return persistOutcome(root, createOutcome({
    id,
    desiredState,
    preconditions: [precondition],
    evidenceRequirement: `${desiredState} is controller-verified.`,
  }));
}

function claim(root, headDigest, value, writePaths) {
  return acquireOutcomeClaim({
    repositoryPath: root,
    outcomeDigest: value.outcomeDigest,
    originWorldHeadDigest: headDigest,
    executionBoundary: { writePaths },
  });
}

function workSession(root, value, claimed, allowedPaths) {
  const productDirection = pinProductDirection(root);
  const base = { type: "EXACT_COMMIT", commit: git(root, ["rev-parse", "HEAD"]) };
  const semanticAuthority = compileSemanticAuthority({ productDirection });
  const productResult = value.desiredState;
  const newlyTrueBehavior = value.desiredState;
  const doneWhen = value.evidenceRequirement;
  return sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection,
    semanticState: semanticAuthority.semanticState,
    semanticProjection: semanticProjection(semanticAuthority),
    endgameProjection: endgameProjection(semanticAuthority),
    origin: {
      type: "REPO_OUTCOME",
      outcomeDigest: value.outcomeDigest,
      claimDigest: claimed.claimDigest,
    },
    base,
    productResult,
    journeyState: value.preconditions[0],
    doNow: `Implement ${value.id}.`,
    newlyTrueBehavior,
    doneWhen,
    productProofSpec: gapProofSpec({ productDirection, base, productResult, newlyTrueBehavior, doneWhen }),
    stopOnlyIf: ["The sealed write boundary is genuinely insufficient."],
    authorizedReversibleActions: ["Edit only the claimed write boundary.", "Run validation."],
    ownerOnlyActions: ["Expand product scope."],
    allowedPaths,
    validation: [{ argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", timeoutSeconds: 30 }],
    maxAttempts: 2,
    delivery: { commit: false, push: false },
  });
}

function enterClaimedAttempt(t, root, session) {
  const workspace = prepareWorkspace(root, session);
  const state = persistWorkSession(root, session, workspace);
  const registryDir = workspaceRegistryDirectory(root);
  const lease = acquireWorkspaceExecutionLease({ registryDir, workspaceId: workspace.workspaceId });
  t.after(() => releaseWorkspaceExecutionLease({ registryDir, lease }));
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
  const entry = enterExecutionAttempt({ stateDirectory: state.directory, permit, session });
  return { workspace, state, permit, entry };
}

function waitForFile(filePath, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${filePath}`));
      setTimeout(poll, 5);
    }
    poll();
  });
}

function childJson(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || stdout || `child exited ${code}`));
      try {
        resolve(JSON.parse(stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1)));
      } catch (error) {
        reject(new Error(`invalid child output: ${stdout || stderr}: ${error.message}`));
      }
    });
  });
}

test("same World admits disjoint Outcome claims, attempts, and claim-addressed sessions without global latest authority", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { revision: 1 });
  const a = outcome(root, "dashboard", "Dashboard intelligence exists.", "Dashboard source remains available.");
  const b = outcome(root, "cascade", "Cascade analysis exists.", "Cascade source remains available.");
  const c = outcome(root, "dashboard-rewrite", "Dashboard architecture is rewritten.", "Dashboard source remains available.");

  const claimA = claim(root, initial.head.headDigest, a, ["src/a"]);
  const claimB = claim(root, initial.head.headDigest, b, ["src/b"]);
  assert.throws(
    () => claim(root, initial.head.headDigest, c, ["src/a/nested"]),
    (error) => error.code === "MH_OUTCOME_CLAIM_CONFLICT",
  );
  assert.throws(
    () => claim(root, initial.head.headDigest, a, ["src/a"]),
    (error) => error.code === "MH_OUTCOME_ALREADY_CLAIMED",
  );

  const enteredA = enterClaimedAttempt(t, root, workSession(root, a, claimA, ["src/a"]));
  const enteredB = enterClaimedAttempt(t, root, workSession(root, b, claimB, ["src/b"]));
  assert.equal(enteredA.entry.origin.type, "REPO_OUTCOME");
  assert.equal(enteredB.entry.origin.type, "REPO_OUTCOME");
  assert.notEqual(enteredA.entry.workspaceId, enteredB.entry.workspaceId);
  assert.equal(readCurrentWorldHead(root).head.headDigest, initial.head.headDigest);
  assert.equal(fs.existsSync(path.join(enteredA.state.directory, "latest.json")), false);
  assert.equal(claimWorkSessionState(root, claimA.claimDigest).state, "ACTIVE");
  assert.equal(claimWorkSessionState(root, claimB.claimDigest).state, "ACTIVE");

  const child = spawnSync(process.execPath, ["-e", [
    `const claims=require(${JSON.stringify(require.resolve("../lib/outcome-claim"))});`,
    `const work=require(${JSON.stringify(require.resolve("../lib/work-git"))});`,
    `const active=claims.listActiveOutcomeClaims(${JSON.stringify(root)});`,
    `const state=work.claimWorkSessionState(${JSON.stringify(root)},${JSON.stringify(claimB.claimDigest)});`,
    "process.stdout.write(JSON.stringify({count:active.length,state:state.state,sessionDigest:state.session.sessionDigest}));",
  ].join("")], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const recovered = JSON.parse(child.stdout);
  assert.equal(recovered.count, 2);
  assert.equal(recovered.state, "ACTIVE");
  assert.equal(recovered.sessionDigest, enteredB.entry.sessionDigest);
});

test("two fresh processes racing the same Outcome produce exactly one Claim winner", async (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { revision: 1 });
  const value = outcome(root, "race", "Race result exists.", "Race input remains available.");
  const barrier = path.join(root, "claim-race.barrier");
  const readyA = path.join(root, "claim-race-a.ready");
  const readyB = path.join(root, "claim-race-b.ready");
  fs.writeFileSync(barrier, "hold\n", "utf8");

  const spawnClaim = (ready) => spawn(process.execPath, [CLAIM_RACE], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MH_CLAIM_REPOSITORY: root,
      MH_CLAIM_OUTCOME: value.outcomeDigest,
      MH_CLAIM_HEAD: initial.head.headDigest,
      MH_CLAIM_PATHS: JSON.stringify(["src/a"]),
      MH_CLAIM_BARRIER: barrier,
      MH_CLAIM_READY: ready,
    },
  });
  const childA = spawnClaim(readyA);
  const childB = spawnClaim(readyB);
  t.after(() => {
    if (childA.exitCode === null) childA.kill();
    if (childB.exitCode === null) childB.kill();
  });
  await Promise.all([waitForFile(readyA), waitForFile(readyB)]);
  const resultA = childJson(childA);
  const resultB = childJson(childB);
  fs.unlinkSync(barrier);
  const results = await Promise.all([resultA, resultB]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.code === "MH_OUTCOME_ALREADY_CLAIMED").length, 1);
  assert.equal(listActiveOutcomeClaims(root).length, 1);
  assert.equal(findActiveOutcomeClaimForOutcome(root, value.outcomeDigest).outcomeDigest, value.outcomeDigest);
});

test("fresh processes racing disjoint Outcomes cannot exceed repository active Claim capacity", async (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { revision: 1 });
  const contenderCount = REPOSITORY_ACTIVE_CLAIM_BOUND + 2;
  const values = Array.from({ length: contenderCount }, (_, index) => outcome(
    root,
    `capacity-${index}`,
    `Capacity result ${index} exists.`,
    `Capacity input ${index} remains available.`,
  ));
  const barrier = path.join(root, "claim-capacity-race.barrier");
  fs.writeFileSync(barrier, "hold\n", "utf8");

  const children = values.map((value, index) => {
    const ready = path.join(root, `claim-capacity-race-${index}.ready`);
    const child = spawn(process.execPath, [CLAIM_RACE], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MH_CLAIM_REPOSITORY: root,
        MH_CLAIM_OUTCOME: value.outcomeDigest,
        MH_CLAIM_HEAD: initial.head.headDigest,
        MH_CLAIM_PATHS: JSON.stringify([`src/a/lane-${index}`]),
        MH_CLAIM_BARRIER: barrier,
        MH_CLAIM_READY: ready,
      },
    });
    return { child, ready };
  });
  t.after(() => {
    for (const { child } of children) {
      if (child.exitCode === null) child.kill();
    }
  });

  await Promise.all(children.map(({ ready }) => waitForFile(ready)));
  const resultsPromise = Promise.all(children.map(({ child }) => childJson(child)));
  fs.unlinkSync(barrier);
  const results = await resultsPromise;

  assert.equal(
    results.filter((result) => result.ok).length,
    REPOSITORY_ACTIVE_CLAIM_BOUND,
    JSON.stringify(results),
  );
  assert.equal(
    results.filter((result) => result.code === "MH_OUTCOME_CLAIM_CAPACITY").length,
    contenderCount - REPOSITORY_ACTIVE_CLAIM_BOUND,
    JSON.stringify(results),
  );
  assert.equal(listActiveOutcomeClaims(root).length, REPOSITORY_ACTIVE_CLAIM_BOUND);
});

test("full repository capacity still permits idempotent existing Claim resolution", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { revision: 1 });
  const values = Array.from({ length: REPOSITORY_ACTIVE_CLAIM_BOUND + 1 }, (_, index) => outcome(
    root,
    `ensure-capacity-${index}`,
    `Ensure capacity result ${index} exists.`,
    `Ensure capacity input ${index} remains available.`,
  ));
  const claims = values.slice(0, REPOSITORY_ACTIVE_CLAIM_BOUND).map((value, index) => claim(
    root,
    initial.head.headDigest,
    value,
    [`src/a/ensure-${index}`],
  ));

  const existing = ensureOutcomeClaim({
    repositoryPath: root,
    outcomeDigest: values[0].outcomeDigest,
    originWorldHeadDigest: initial.head.headDigest,
    executionBoundary: { writePaths: ["src/a/ensure-0"] },
  });
  assert.equal(existing.claimDigest, claims[0].claimDigest);

  assert.throws(
    () => ensureOutcomeClaim({
      repositoryPath: root,
      outcomeDigest: values.at(-1).outcomeDigest,
      originWorldHeadDigest: initial.head.headDigest,
      executionBoundary: { writePaths: ["src/b/ensure-new"] },
    }),
    (error) => error.code === "MH_OUTCOME_CLAIM_CAPACITY",
  );
  assert.equal(listActiveOutcomeClaims(root).length, REPOSITORY_ACTIVE_CLAIM_BOUND);
});

test("A can bank H to H1 while disjoint B remains executable, and stale B learning cannot commit blindly", (t) => {
  const root = repository(t);
  const initial = persistWorld(root, { revision: 1, dashboard: "same", cascade: "same" });
  const a = outcome(root, "dashboard", "Dashboard intelligence exists.", "Dashboard source remains available.");
  const b = outcome(root, "cascade", "Cascade analysis exists.", "Cascade source remains available.");
  const claimA = claim(root, initial.head.headDigest, a, ["src/a"]);
  const claimB = claim(root, initial.head.headDigest, b, ["src/b"]);

  const enteredA = enterClaimedAttempt(t, root, workSession(root, a, claimA, ["src/a"]));
  const closureA = recordExecutionClosure({
    repositoryPath: root,
    session: workSession(root, a, claimA, ["src/a"]),
    attemptEntries: [enteredA.entry],
    disposition: "COMPLETED",
    workResult: { sessionDigest: enteredA.entry.sessionDigest, outcome: "DONE" },
  });
  const worldAfterA = projectionObjects(root, { revision: 2, dashboard: "changed", cascade: "same" });
  const appliedA = commitTransition(
    root,
    outcomeLearningTransition(root, initial.head.headDigest, closureA, worldAfterA),
  );
  assert.equal(appliedA.status, "APPLIED");
  assert.equal(findActiveOutcomeClaimForOutcome(root, a.outcomeDigest), null);
  assert.equal(findActiveOutcomeClaimForOutcome(root, b.outcomeDigest).claimDigest, claimB.claimDigest);

  const sessionB = workSession(root, b, claimB, ["src/b"]);
  const enteredB = enterClaimedAttempt(t, root, sessionB);
  assert.equal(enteredB.entry.origin.claimDigest, claimB.claimDigest);
  assert.equal(readCurrentWorldHead(root).head.headDigest, appliedA.head.headDigest);

  const closureB = recordExecutionClosure({
    repositoryPath: root,
    session: sessionB,
    attemptEntries: [enteredB.entry],
    disposition: "COMPLETED",
    workResult: { sessionDigest: sessionB.sessionDigest, outcome: "DONE" },
  });
  const staleSuccessor = projectionObjects(root, { revision: 3, dashboard: "changed", cascade: "candidate" });
  assert.throws(
    () => commitTransition(root, outcomeLearningTransition(root, initial.head.headDigest, closureB, staleSuccessor)),
    (error) => error.code === "MH_WORLD_CONFLICT",
  );
});

test("unsupported owner-authority assertion is rejected instead of becoming durable OWNER_INPUT", () => {
  const digest = (character) => `sha256:${character.repeat(64)}`;
  assert.throws(
    () => validateRepoDecision({
      schemaVersion: "repo-decision/v3",
      productDirectionDigest: digest("1"),
      charterDigest: digest("2"),
      worldHeadDigest: digest("3"),
      ownerDirectiveDigest: null,
      decision: { type: "NO_DISPATCH", reason: "OWNER_DECISION_REQUIRED" },
    }),
    (error) => error.code === "MH_UNEVIDENCED_AUTHORITY_BLOCKER",
  );
});
