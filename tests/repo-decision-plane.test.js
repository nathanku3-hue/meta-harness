"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const { pinProductDirection } = require("../lib/product-direction");
const {
  REPO_CHARTER_DOMAIN,
  REPO_WORLD_DOMAIN,
  REQUIRED_FACTUAL_PRECEDENCE,
  REQUIRED_STRATEGIC_PRECEDENCE,
  assertRepoDecisionSessionCurrent,
  compileRepoDecisionSession,
  ownerDirectiveDigest,
  recordRepoDecisionAttempt,
  recordRepoDecisionResult,
  repositoryExecutionBaseDigest,
  validateRepoCharter,
  validateRepoWorld,
} = require("../lib/repo-decision-plane");
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

function baseCharter(productDirectionDigest, overrides = {}) {
  return {
    schemaVersion: "repo-charter/v1",
    version: "quant-charter-v1",
    productDirectionDigest,
    objectiveHierarchy: [
      "PROVE_OR_FALSIFY_REPRODUCIBLE_NET_ALPHA",
      "MINIMIZE_FALSE_CLAIMS_AND_WASTED_TRIALS",
    ],
    factualTruthPrecedence: [...REQUIRED_FACTUAL_PRECEDENCE],
    strategicAuthorityPrecedence: [...REQUIRED_STRATEGIC_PRECEDENCE],
    falsificationLayers: ["D6", "D7", "D8"],
    resurrectionLaw: ["A terminal route may return only when new evidence invalidates the retained failure basis."],
    externalStateRequirements: ["market-data"],
    allocationPolicy: ["Choose the current legal action with the highest declared alpha-proof discrimination value."],
    ...overrides,
  };
}

function baseWorld(productDirectionDigest, charterDigest, executionBaseDigest, overrides = {}) {
  return {
    schemaVersion: "repo-world/v1",
    productDirectionDigest,
    charterDigest,
    executionBaseDigest,
    truth: {
      facts: [{ id: "fact-a", statement: "Sector historical evidence is already admitted.", evidenceRef: "receipt:sector-a" }],
      supportedClaims: [],
      contradictedClaims: [{ id: "claim-old", statement: "The old selector produces durable alpha.", evidenceRef: "receipt:selector-fail" }],
      notEstablishedClaims: [{ id: "claim-alpha", statement: "The current family has reproducible net alpha.", evidenceRef: "receipt:not-established" }],
      positiveKnowledge: [{ id: "knowledge-positive", statement: "Prospective data plumbing is operational.", evidenceRef: "receipt:plumbing" }],
      negativeKnowledge: [{
        id: "knowledge-negative",
        statement: "The old selector failed a powered valid discrimination test.",
        evidenceRef: "receipt:selector-fail",
        resurrectionCondition: "Representation or data regime changes materially.",
      }],
      terminalRoutes: [{
        id: "old-selector",
        reason: "Powered valid test contradicted the selector claim.",
        evidenceRef: "receipt:selector-fail",
        validity: { verdict: "PASS", evidenceRef: "receipt:selector-validity" },
        resurrectionCondition: "New evidence invalidates the prior test basis.",
      }],
      externalInputIdentities: [{ name: "market-data", identity: "snapshot:2026-08-12" }],
      activeTracks: ["family-c"],
      blockedTracks: ["family-q:data"],
      currentBottleneck: "No decisive D7 result exists for family-c.",
    },
    recommendation: {
      candidateActions: [
        {
          id: "family-c-d7",
          routeId: "family-c",
          result: "Run the cheapest valid family-c D7 discrimination slice.",
          status: "LEGAL",
          reason: "It directly resolves the current alpha-proof bottleneck.",
          priorBasisInvalidatedByEvidenceRef: null,
        },
        {
          id: "sector-fresh-clock",
          routeId: "sector",
          result: "Start another Sector freshness clock.",
          status: "LEGAL",
          reason: "It is executable but lower-value under the primary objective.",
          priorBasisInvalidatedByEvidenceRef: null,
        },
      ],
      recommendedNextActionId: "family-c-d7",
    },
    ...overrides,
  };
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

function baseDecision({
  productDirectionDigest,
  charterDigest,
  worldDigest,
  directiveDigest = null,
  objective = "PROVE_OR_FALSIFY_REPRODUCIBLE_NET_ALPHA",
  selectedAction = {},
  rejectedAlternatives = [{ id: "sector-fresh-clock", reason: "Lower alpha-proof discrimination value under the current objective." }],
} = {}) {
  return {
    schemaVersion: "repo-decision/v1",
    productDirectionDigest,
    charterDigest,
    worldDigest,
    ownerDirectiveDigest: directiveDigest,
    objective,
    selectedAction: {
      id: "family-c-d7",
      result: "Run the cheapest valid family-c D7 discrimination slice.",
      doNow: "Implement the bounded family-c D7 discrimination slice.",
      newlyTrueBehavior: "The repository can execute the declared family-c D7 discrimination slice reproducibly.",
      doneWhen: "The exact controller validation passes and the selected slice produces its declared observable repository behavior.",
      whyNow: "It is the nearest legal step that can resolve the current alpha-proof bottleneck.",
      claimLayer: "D7",
      stopOnlyIf: ["Repository evidence invalidates the current D7 test design or requires scope expansion."],
      allowedPaths: ["src", "tests"],
      validation: [validationCommand()],
      maxAttempts: 2,
      delivery: { commit: false, push: false },
      ...selectedAction,
    },
    rejectedAlternatives,
  };
}

function installDecisionPlane(root, { directiveText = null } = {}) {
  const direction = pinProductDirection(root);
  const charter = baseCharter(direction.digest);
  writeJson(root, ".meta-harness/repo-charter.json", charter);
  const charterDigest = domainDigest(REPO_CHARTER_DOMAIN, charter);
  const executionBaseDigest = repositoryExecutionBaseDigest(root);
  const world = baseWorld(direction.digest, charterDigest, executionBaseDigest);
  writeJson(root, ".meta-harness/repo-world.json", world);
  const worldDigest = domainDigest(REPO_WORLD_DOMAIN, world);
  if (directiveText !== null) {
    fs.writeFileSync(path.join(root, ".meta-harness", "owner-directive.md"), directiveText, "utf8");
  }
  const directiveDigest = ownerDirectiveDigest(root);
  const decision = baseDecision({
    productDirectionDigest: direction.digest,
    charterDigest,
    worldDigest,
    directiveDigest,
  });
  writeJson(root, ".meta-harness/repo-decision.json", decision);
  return { direction, charter, charterDigest, executionBaseDigest, world, worldDigest, decision, directiveDigest };
}

function repository(t, { decisionPlane = false, directiveText = null } = {}) {
  const parent = tempDir("repo-decision-plane-");
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Decision Plane Test"]);
  git(root, ["config", "user.email", "decision-plane@example.invalid"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "decision-plane-fixture",
    private: true,
    scripts: { test: "node -e \"process.exit(0)\"" },
  }, null, 2), "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src", "baseline.txt"), "baseline\n", "utf8");
  writeProductMd(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  const installed = decisionPlane ? installDecisionPlane(root, { directiveText }) : null;
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, installed };
}

test("repo charter preserves factual and strategic authority order while allowing repo-specific policy", () => {
  const charter = baseCharter("sha256:" + "1".repeat(64), {
    factualTruthPrecedence: [
      "validated_observation",
      "point_in_time_data",
      "canonical_factual_state",
      "derived_status",
      "prose_history",
    ],
  });
  assert.equal(validateRepoCharter(charter).objectiveHierarchy[0], "PROVE_OR_FALSIFY_REPRODUCIBLE_NET_ALPHA");

  assert.throws(
    () => validateRepoCharter({
      ...charter,
      strategicAuthorityPrecedence: [
        "derived_recommendation",
        "current_owner_directive",
        "product_direction",
        "repo_charter",
        "stale_history",
      ],
    }),
    (error) => error.code === "MH_REPO_CHARTER_PRECEDENCE",
  );
});

test("repo world keeps epistemic truth separate from recommendation and claim states exclusive", () => {
  const world = baseWorld(
    "sha256:" + "1".repeat(64),
    "sha256:" + "2".repeat(64),
    "sha256:" + "3".repeat(64),
  );
  const validated = validateRepoWorld(world);
  assert.equal(validated.truth.currentBottleneck, "No decisive D7 result exists for family-c.");
  assert.equal(validated.recommendation.recommendedNextActionId, "family-c-d7");
  assert.equal(validated.truth.recommendedNextActionId, undefined);

  const duplicateClaim = baseWorld(
    "sha256:" + "1".repeat(64),
    "sha256:" + "2".repeat(64),
    "sha256:" + "3".repeat(64),
  );
  duplicateClaim.truth.supportedClaims.push({
    id: "claim-alpha",
    statement: "Incorrect duplicate state.",
    evidenceRef: "receipt:duplicate",
  });
  assert.throws(
    () => validateRepoWorld(duplicateClaim),
    (error) => error.code === "MH_REPO_WORLD_CLAIM_STATE",
  );
});

test("terminal route requires PASS validity evidence before it can be banked", () => {
  const world = baseWorld(
    "sha256:" + "1".repeat(64),
    "sha256:" + "2".repeat(64),
    "sha256:" + "3".repeat(64),
  );
  world.truth.terminalRoutes[0].validity.verdict = "UNKNOWN";
  assert.throws(
    () => validateRepoWorld(world),
    (error) => error.code === "MH_REPO_WORLD_TERMINAL_VALIDITY",
  );
});

test("terminal route cannot become LEGAL without explicit new invalidating truth evidence", () => {
  const world = baseWorld(
    "sha256:" + "1".repeat(64),
    "sha256:" + "2".repeat(64),
    "sha256:" + "3".repeat(64),
  );
  world.recommendation.candidateActions.push({
    id: "old-selector-probation",
    routeId: "old-selector",
    result: "Run one probationary test after a real basis change.",
    status: "LEGAL",
    reason: "A resurrection attempt is being proposed.",
    priorBasisInvalidatedByEvidenceRef: null,
  });
  world.recommendation.recommendedNextActionId = "old-selector-probation";
  assert.throws(
    () => validateRepoWorld(world),
    (error) => error.code === "MH_REPO_WORLD_RESURRECTION",
  );

  world.truth.facts.push({
    id: "fact-resurrection-basis",
    statement: "A new measurement advance invalidates the prior route-kill basis.",
    evidenceRef: "receipt:new-measurement",
  });
  world.recommendation.candidateActions.at(-1).priorBasisInvalidatedByEvidenceRef = "receipt:new-measurement";
  assert.doesNotThrow(() => validateRepoWorld(world));
});

test("current repo decision compiles deterministically into existing work-session/v2", (t) => {
  const { root } = repository(t, { decisionPlane: true, directiveText: "Prioritize alpha proof over freshness.\n" });
  const session = compileRepoDecisionSession(root);
  const same = compileRepoDecisionSession(root);

  assert.equal(session.schemaVersion, "work-session/v2");
  assert.equal(session.sessionDigest, same.sessionDigest);
  assert.equal(session.productResult, "Run the cheapest valid family-c D7 discrimination slice.");
  assert.deepEqual(session.allowedPaths, ["src", "tests"]);
  assert.match(session.journeyState, /Decision Plane selected family-c-d7/);
  assert.match(session.journeyState, /Current bottleneck:/);
  assert.match(session.stopOnlyIf.at(-1), /^The bound repo-decision identity sha256:[a-f0-9]{64} changes before completion\.$/);
  assert.equal(session.decisionBinding, undefined);
});

test("a current owner directive may override charter strategy and derived recommendation without changing factual world state", (t) => {
  const { root, installed } = repository(t, {
    decisionPlane: true,
    directiveText: "For the current strategic round, run the legal Sector clock instead of the derived recommendation.\n",
  });
  writeJson(root, ".meta-harness/repo-decision.json", baseDecision({
    productDirectionDigest: installed.direction.digest,
    charterDigest: installed.charterDigest,
    worldDigest: installed.worldDigest,
    directiveDigest: installed.directiveDigest,
    objective: "OWNER_DIRECTIVE_CURRENT_STRATEGY",
    selectedAction: {
      id: "sector-fresh-clock",
      result: "Start another Sector freshness clock.",
      doNow: "Implement the bounded Sector clock slice selected by the current owner directive.",
      newlyTrueBehavior: "The selected Sector freshness clock can run under the current repository contract.",
      doneWhen: "The selected Sector clock slice is implemented and controller validation passes.",
      whyNow: "The current owner directive explicitly overrides the derived recommendation for this round.",
      claimLayer: null,
    },
    rejectedAlternatives: [{
      id: "family-c-d7",
      reason: "The current owner directive overrides the derived recommendation for this round.",
    }],
  }));

  const session = compileRepoDecisionSession(root);
  assert.equal(session.productResult, "Start another Sector freshness clock.");
  assert.match(session.journeyState, /OWNER_DIRECTIVE_CURRENT_STRATEGY/);
  assert.equal(installed.world.recommendation.recommendedNextActionId, "family-c-d7");
});

test("without a current owner directive, a repo decision cannot silently replace the charter primary objective", (t) => {
  const { root, installed } = repository(t, { decisionPlane: true });
  writeJson(root, ".meta-harness/repo-decision.json", baseDecision({
    productDirectionDigest: installed.direction.digest,
    charterDigest: installed.charterDigest,
    worldDigest: installed.worldDigest,
    directiveDigest: null,
    objective: "STALE_OR_UNAUTHORIZED_OBJECTIVE",
  }));
  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_DECISION_OBJECTIVE" && /without a current owner directive/i.test(error.message),
  );
});

test("repo world is stale when the committed execution substrate changes", (t) => {
  const { root } = repository(t, { decisionPlane: true });
  assert.doesNotThrow(() => compileRepoDecisionSession(root));
  fs.writeFileSync(path.join(root, "src", "baseline.txt"), "new committed substrate\n", "utf8");
  git(root, ["add", "src/baseline.txt"]);
  git(root, ["commit", "-m", "change execution substrate"]);
  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_WORLD_STALE" && /execution-base/i.test(error.message),
  );
});

test("charter external-state requirements must be present as immutable world identities", (t) => {
  const { root, installed } = repository(t, { decisionPlane: true });
  const missingExternal = {
    ...installed.world,
    truth: { ...installed.world.truth, externalInputIdentities: [] },
  };
  writeJson(root, ".meta-harness/repo-world.json", missingExternal);
  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_WORLD_EXTERNAL_STATE" && /market-data/.test(error.message),
  );
});

test("an entered repo decision is single-use until the result is banked into a new world and decision", (t) => {
  const { root, installed } = repository(t, { decisionPlane: true });
  const session = compileRepoDecisionSession(root);
  recordRepoDecisionAttempt(root, session, {
    executionPermit: {
      attemptId: "attempt-1",
      permitDigest: "sha256:" + "a".repeat(64),
    },
  });
  recordRepoDecisionResult(root, session, {
    outcome: "DONE",
    attempts: 1,
    observableResult: "The selected slice executed and produced a result for interpretation.",
  });

  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_DECISION_CONSUMED" && /repo-world/i.test(error.message),
  );

  const learnedWorld = {
    ...installed.world,
    truth: {
      ...installed.world.truth,
      facts: [
        ...installed.world.truth.facts,
        {
          id: "fact-result-1",
          statement: "The prior decision result was interpreted and banked into current truth.",
          evidenceRef: "work-result:session-1",
        },
      ],
      currentBottleneck: "The prior result is banked; a new decision may now be selected.",
    },
  };
  writeJson(root, ".meta-harness/repo-world.json", learnedWorld);
  const learnedWorldDigest = domainDigest(REPO_WORLD_DOMAIN, learnedWorld);
  writeJson(root, ".meta-harness/repo-decision.json", baseDecision({
    productDirectionDigest: installed.direction.digest,
    charterDigest: installed.charterDigest,
    worldDigest: learnedWorldDigest,
    directiveDigest: null,
  }));
  assert.doesNotThrow(() => compileRepoDecisionSession(root));
});

test("an actual worker attempt consumes the repo decision even when execution later throws", (t) => {
  const { root } = repository(t, { decisionPlane: true });
  const failed = runRaw(root, ["work", root, "--json"], {
    env: workerEnv({ FAKE_WORKER_DIRECT_WRITE: "1" }),
  });
  assert.notEqual(failed.status, 0);
  assert.match(String(failed.stdout || failed.stderr), /MH_EXECUTION_PERMIT_STALE|stale/i);

  const replay = runRaw(root, ["work", root, "--dry-run", "--json"]);
  assert.notEqual(replay.status, 0);
  assert.match(String(replay.stdout || replay.stderr), /MH_REPO_DECISION_CONSUMED|already entered a worker attempt/i);
});

test("bounded repair attempts remain legal inside the same consumed repo decision run", (t) => {
  const { root } = repository(t, { decisionPlane: true });
  const result = runRaw(root, ["work", root, "--json"], {
    env: workerEnv({ FAKE_WORKER_RETRY: "1" }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.attempts, 2);
  assert.deepEqual(parsed.executionPermits.map((permit) => permit.generation), [1, 2]);

  const replay = runRaw(root, ["work", root, "--dry-run", "--json"]);
  assert.notEqual(replay.status, 0);
  assert.match(String(replay.stdout || replay.stderr), /MH_REPO_DECISION_CONSUMED|already entered a worker attempt/i);
});

test("owner directive or world drift makes the current decision non-executable", (t) => {
  const { root, installed } = repository(t, { decisionPlane: true, directiveText: "Prioritize alpha proof.\n" });
  assert.doesNotThrow(() => compileRepoDecisionSession(root));

  fs.writeFileSync(path.join(root, ".meta-harness", "owner-directive.md"), "Prioritize freshness instead.\n", "utf8");
  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_DECISION_STALE" && /owner directive/i.test(error.message),
  );

  fs.writeFileSync(path.join(root, ".meta-harness", "owner-directive.md"), "Prioritize alpha proof.\n", "utf8");
  const changedWorld = {
    ...installed.world,
    truth: { ...installed.world.truth, currentBottleneck: "A new material bottleneck is now authoritative." },
  };
  writeJson(root, ".meta-harness/repo-world.json", changedWorld);
  assert.throws(
    () => compileRepoDecisionSession(root),
    (error) => error.code === "MH_REPO_DECISION_STALE" && /world binding/i.test(error.message),
  );
});

test("a new current decision cannot silently resume an old decision-bound session", (t) => {
  const { root, installed } = repository(t, { decisionPlane: true });
  const oldSession = compileRepoDecisionSession(root);

  const nextWorld = {
    ...installed.world,
    truth: { ...installed.world.truth, currentBottleneck: "The same action remains legal under newly banked evidence." },
  };
  writeJson(root, ".meta-harness/repo-world.json", nextWorld);
  const nextWorldDigest = domainDigest(REPO_WORLD_DOMAIN, nextWorld);
  writeJson(root, ".meta-harness/repo-decision.json", baseDecision({
    productDirectionDigest: installed.direction.digest,
    charterDigest: installed.charterDigest,
    worldDigest: nextWorldDigest,
    directiveDigest: null,
  }));

  assert.throws(
    () => assertRepoDecisionSessionCurrent(root, oldSession),
    (error) => error.code === "MH_REPO_DECISION_STALE" && /no longer matches/i.test(error.message),
  );
});

test("Decision Plane opt-in hard-blocks --goal bypass and compiles current repo-decision by default", (t) => {
  const { root } = repository(t, { decisionPlane: true });
  const bypass = runRaw(root, ["work", root, "--goal", "Bypass the repo decision.", "--dry-run", "--json"]);
  assert.notEqual(bypass.status, 0);
  assert.match(String(bypass.stdout || bypass.stderr), /MH_REPO_DECISION_REQUIRED|Decision Plane/i);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);

  const current = runRaw(root, ["work", root, "--dry-run", "--json"]);
  assert.equal(current.status, 0, current.stderr || current.stdout);
  const result = JSON.parse(current.stdout);
  assert.equal(result.outcome, "READY");
  assert.equal(result.productResult, "Run the cheapest valid family-c D7 discrimination slice.");
  assert.equal(result.workspace.wouldCreate, true);
  assert.equal(fs.existsSync(path.join(root, ".worktrees")), false);
});

test("repositories without repo-charter keep the existing --goal path", (t) => {
  const { root } = repository(t, { decisionPlane: false });
  const result = runRaw(root, ["work", root, "--goal", "Keep the existing direct coding path.", "--allow", "src", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "READY");
  assert.equal(parsed.productResult, "Keep the existing direct coding path.");
});
