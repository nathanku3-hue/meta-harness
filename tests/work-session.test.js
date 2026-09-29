"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildCodingPrompt } = require("../lib/coding-worker");
const {
  WORK_SESSION_SCHEMA,
  computeWorkSessionDigest,
  createGoalWorkSession,
  loadWorkSession,
  sealWorkSession,
  validateWorkSession,
} = require("../lib/work-session");
const { tempDir } = require("./helpers/cli");
const { directionFromContent, SAMPLE_PRODUCT_MD, writeProductMd } = require("./helpers/product-direction");

const TEST_BASE = Object.freeze({ type: "EXACT_COMMIT", commit: "1".repeat(40) });

function explicitSession(overrides = {}) {
  return sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    productDirection: directionFromContent(),
    origin: { type: "OWNER_GOAL" },
    base: TEST_BASE,
    productResult: "Ship one product-facing coding command.",
    journeyState: "The product direction is accepted and implementation is ready.",
    doNow: "Implement the primary work command.",
    newlyTrueBehavior: "One command carries the brief into code and validation.",
    doneWhen: "Focused tests pass and the default help is product-facing.",
    stopOnlyIf: ["Protected access is required."],
    allowedPaths: ["lib", "tests"],
    validation: [{ argv: ["node", "--test"], cwd: ".", timeoutSeconds: 60 }],
    maxAttempts: 2,
    delivery: { push: false },
    ...overrides,
  });
}

test("work-session exposes execution facts without a conversational lifecycle reducer", () => {
  assert.equal(Object.hasOwn(require("../lib/work-session"), "reduceJourneyState"), false);
});

test("work-session/v10 seals only product direction, result, scoped work, validation, and external delivery effect", () => {
  const session = explicitSession();
  assert.equal(session.schemaVersion, "work-session/v10");
  assert.deepEqual(session.origin, { type: "OWNER_GOAL" });
  assert.deepEqual(session.base, TEST_BASE);
  assert.equal(session.sessionDigest, computeWorkSessionDigest(session));
  assert.equal(Object.isFrozen(validateWorkSession(session)), true);
  assert.equal(Object.isFrozen(session.delivery), true);
  assert.deepEqual(session.delivery, { push: false });
  assert.deepEqual(session.allowedPaths, ["lib", "tests"]);
  assert.equal(session.productResult, "Ship one product-facing coding command.");
  assert.equal(session.productDirection.content, SAMPLE_PRODUCT_MD);
  assert.match(session.productDirection.digest, /^sha256:[a-f0-9]{64}$/u);
  for (const obsolete of [
    "semanticState",
    "semanticProjection",
    "endgameProjection",
    "productProofSpec",
    "authorizedReversibleActions",
    "ownerOnlyActions",
    "claimDigest",
    "permitDigest",
  ]) {
    assert.equal(Object.hasOwn(session, obsolete), false, obsolete);
  }
});

test("retired work-session schemas are rejected rather than normalized", () => {
  const current = explicitSession();
  for (const schemaVersion of ["work-session/v8", "work-session/v9"]) {
    const retired = { ...current, schemaVersion };
    retired.sessionDigest = computeWorkSessionDigest(retired);
    assert.throws(
      () => validateWorkSession(retired),
      (error) => error.code === "MH_WORK_SESSION_SCHEMA",
      schemaVersion,
    );
  }
});

test("goal shorthand pins live PRODUCT.md into a complete low-friction brief", (t) => {
  const root = tempDir("goal-session-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const direction = writeProductMd(root);
  const validation = [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 300 }];
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    base: TEST_BASE,
    allowedPaths: ["src"],
    validation,
  });
  assert.equal(session.productResult, "Add a visible result.");
  assert.equal(session.doNow, "Add a visible result.");
  assert.equal(session.newlyTrueBehavior, "Add a visible result.");
  assert.equal(session.allowedPaths[0], "src");
  assert.equal(session.maxAttempts, 8);
  assert.deepEqual(session.validation, validation);
  assert.deepEqual(session.delivery, { push: false });
  assert.equal(session.productDirection.digest, direction.digest);
  assert.equal(session.productDirection.content, direction.content);
  const remoteResolved = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    base: {
      type: "REMOTE_REF",
      remote: "origin",
      ref: "refs/heads/main",
      commit: TEST_BASE.commit,
    },
    allowedPaths: ["src"],
    validation,
  });
  assert.deepEqual(remoteResolved.base, TEST_BASE);
  const changedValidation = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    base: TEST_BASE,
    allowedPaths: ["src"],
    validation: [{ argv: ["node", "--test"], cwd: ".", timeoutSeconds: 300 }],
  });
  assert.notEqual(changedValidation.sessionDigest, session.sessionDigest);
});

test("coding prompt carries product direction before result and engineering context", () => {
  const session = explicitSession();
  const prompt = buildCodingPrompt(session, { attempt: 1, priorFailure: "", workspaceMode: "current" });
  const directionIndex = prompt.indexOf("Product direction (immutable for this session):");
  const resultIndex = prompt.indexOf("Product result:");
  const validationIndex = prompt.indexOf("Validation contract:");
  assert.ok(directionIndex >= 0);
  assert.ok(resultIndex > directionIndex);
  assert.ok(validationIndex > resultIndex);
  assert.ok(prompt.includes(SAMPLE_PRODUCT_MD));
  assert.match(prompt, /Never propose changes to PRODUCT\.md/u);
  assert.match(prompt, /Validation contract:/u);
  assert.match(prompt, /\{"argv":\["node","--test"\],"cwd":"\.","timeoutSeconds":60\}/u);
  assert.match(prompt, /read-only.*not a blocker/iu);
  assert.match(prompt, /typed operations/iu);
  assert.match(prompt, /read-only workspace access as the worker execution geometry/iu);
  assert.match(prompt, /ENDGAME_LOOP_LAW/u);
  assert.match(prompt, /Outcome -> current Observation\/gap -> nearest reversible in-scope Action -> execute -> exact effect-boundary check/u);
  assert.match(prompt, /cheap, bounded, reversible, observable, and consistent with invariants/u);
  assert.doesNotMatch(prompt, /requested result -> observed gap -> nearest reversible in-scope change -> validation/iu);
  assert.match(prompt, /Do not reconstruct or override this sealed execution brief/u);
  const harnessText = prompt.replace(SAMPLE_PRODUCT_MD, "");
  assert.doesNotMatch(harnessText, /\b(?:permission|authorization|approval|approver|manager|librarian|owner\s+(?:gate|authority|question|work)|owner-escalation)\b/iu);
});

test("coding prompt carries an opaque repository contract without teaching the harness its semantics", () => {
  const session = explicitSession();
  const prompt = buildCodingPrompt(session, {
    attempt: 1,
    priorFailure: "",
    workspaceMode: "current",
    repositoryContractsProjection: "Repository contracts (repo-defined meaning; immutable for this run):\nOPAQUE_MISSION_BYTES",
  });
  assert.match(prompt, /OPAQUE_MISSION_BYTES/u);
  assert.match(prompt, /Repository contracts \(repo-defined meaning; immutable for this run\)/u);
  assert.match(prompt, /Product result:/u);
});

test("work session rejects digest drift, traversal, extra fields, invalid attempts, and retired proof fields", () => {
  const session = explicitSession();
  assert.throws(
    () => validateWorkSession({ ...session, schemaVersion: "work-session/v9" }),
    (error) => error.code === "MH_WORK_SESSION_SCHEMA",
  );
  assert.throws(
    () => validateWorkSession({ ...session, productResult: "drifted" }),
    (error) => error.code === "MH_WORK_SESSION_DIGEST",
  );
  assert.throws(
    () => sealWorkSession({ ...session, allowedPaths: ["../outside"] }),
    (error) => error.code === "MH_WORK_SESSION_PATH",
  );
  assert.throws(
    () => validateWorkSession({ ...session, compatibility: true }),
    (error) => error.code === "MH_WORK_SESSION_SHAPE",
  );
  assert.throws(
    () => validateWorkSession({ ...session, productProofSpec: {} }),
    (error) => error.code === "MH_WORK_SESSION_SHAPE",
  );
  assert.throws(
    () => sealWorkSession({ ...session, maxAttempts: 13 }),
    (error) => error.code === "MH_WORK_SESSION_ATTEMPTS",
  );
  assert.throws(
    () => sealWorkSession({ ...session, delivery: { commit: false, push: true } }),
    (error) => error.code === "MH_WORK_SESSION_SHAPE",
  );
  assert.throws(
    () => sealWorkSession({ ...session, delivery: { push: "yes" } }),
    (error) => error.code === "MH_WORK_SESSION_DELIVERY",
  );
});

test("work session loads only a regular JSON file", (t) => {
  const root = tempDir("work-session-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionPath = path.join(root, "session.json");
  fs.writeFileSync(sessionPath, `${JSON.stringify(explicitSession(), null, 2)}\n`, "utf8");
  assert.equal(loadWorkSession(sessionPath).productResult, explicitSession().productResult);
  assert.throws(() => loadWorkSession(root), (error) => error.code === "MH_WORK_SESSION_READ");
});
