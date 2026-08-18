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
  reduceJourneyState,
  sealWorkSession,
  validateWorkSession,
} = require("../lib/work-session");
const { tempDir } = require("./helpers/cli");
const { directionFromContent, SAMPLE_PRODUCT_MD, writeProductMd } = require("./helpers/product-direction");
const { gapProofSpec } = require("./helpers/product-proof");

const TEST_BASE = Object.freeze({ type: "EXACT_COMMIT", commit: "1".repeat(40) });

function explicitSession(overrides = {}) {
  const body = {
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
    authorizedReversibleActions: ["Edit allowed files.", "Run tests."],
    ownerOnlyActions: ["Publish a release."],
    allowedPaths: ["lib", "tests"],
    validation: [{ argv: ["node", "--test"], cwd: ".", timeoutSeconds: 60 }],
    maxAttempts: 2,
    delivery: { commit: true, push: false },
    ...overrides,
  };
  if (!body.productProofSpec) body.productProofSpec = gapProofSpec(body);
  return sealWorkSession(body);
}

test("journey reducer keeps automatic continuation mechanically bounded", () => {
  const active = explicitSession({ productResult: "Add CSV export." });
  assert.equal(reduceJourneyState({ ownerResult: "Add CSV export." }).next.operation, "NEW");
  assert.equal(reduceJourneyState({ activeSession: active }).next.operation, "RESUME");
  assert.equal(reduceJourneyState({ ownerResult: "Add CSV export.", activeSession: active }).next.operation, "RESUME");
  assert.equal(reduceJourneyState({ ownerResult: "Change the export format.", activeSession: active }).next.automatic, false);
  assert.equal(reduceJourneyState({ compiledDecision: { type: "NO_DISPATCH", reason: "USE_PRODUCT" } }).next.operation, "STOP");
});

test("work-session/v7 seals product direction, product-proof spec, provenance, trusted base, and exact path/validation scope", () => {
  const session = explicitSession();
  assert.equal(session.schemaVersion, "work-session/v7");
  assert.equal(session.productProofSpec.schemaVersion, "product-proof-spec/v1");
  assert.deepEqual(session.origin, { type: "OWNER_GOAL" });
  assert.deepEqual(session.base, TEST_BASE);
  assert.equal(session.sessionDigest, computeWorkSessionDigest(session));
  assert.equal(Object.isFrozen(validateWorkSession(session)), true);
  assert.equal(Object.isFrozen(session.delivery), true);
  assert.deepEqual(session.delivery, { commit: true, push: false });
  assert.deepEqual(session.allowedPaths, ["lib", "tests"]);
  assert.equal(session.productResult, "Ship one product-facing coding command.");
  assert.equal(session.productDirection.content, SAMPLE_PRODUCT_MD);
  assert.match(session.productDirection.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(session.intent, undefined);
});

test("goal shorthand pins live PRODUCT.md into a complete low-friction brief", (t) => {
  const root = tempDir("goal-session-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const direction = writeProductMd(root);
  const validation = [{ argv: ["npm", "test"], cwd: ".", timeoutSeconds: 300 }];
  const productProofSpec = gapProofSpec({
    productDirection: direction,
    base: TEST_BASE,
    productResult: "Add a visible result.",
    newlyTrueBehavior: "Add a visible result.",
    doneWhen: "The requested behavior works in the repository and relevant validation passes.",
  });
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    base: TEST_BASE,
    allowedPaths: ["src"],
    validation,
    productProofSpec,
  });
  assert.equal(session.productResult, "Add a visible result.");
  assert.equal(session.doNow, "Add a visible result.");
  assert.equal(session.newlyTrueBehavior, "Add a visible result.");
  assert.equal(session.allowedPaths[0], "src");
  assert.equal(session.maxAttempts, 2);
  assert.deepEqual(session.validation, validation);
  assert.deepEqual(session.delivery, { commit: false, push: false });
  assert.equal(session.productDirection.digest, direction.digest);
  assert.equal(session.productDirection.content, direction.content);
  const changedValidation = createGoalWorkSession({
    goal: "Add a visible result.",
    repositoryPath: root,
    base: TEST_BASE,
    allowedPaths: ["src"],
    validation: [{ argv: ["node", "--test"], cwd: ".", timeoutSeconds: 300 }],
    productProofSpec,
  });
  assert.notEqual(changedValidation.sessionDigest, session.sessionDigest);
});

test("coding prompt carries product direction before result and engineering context", () => {
  const session = explicitSession();
  const prompt = buildCodingPrompt(session, { attempt: 1, priorFailure: "", workspaceMode: "current" });
  const directionIndex = prompt.indexOf("Product direction (owner-authored; immutable for this session):");
  const resultIndex = prompt.indexOf("Product result:");
  const validationIndex = prompt.indexOf("Controller-owned validation:");
  assert.ok(directionIndex >= 0);
  assert.ok(resultIndex > directionIndex);
  assert.ok(validationIndex > resultIndex);
  assert.ok(prompt.includes(SAMPLE_PRODUCT_MD));
  assert.match(prompt, /Never propose changes to PRODUCT\.md/);
  assert.match(prompt, /Controller-owned validation:/);
  assert.match(prompt, /\{"argv":\["node","--test"\],"cwd":"\.","timeoutSeconds":60\}/);
  assert.match(prompt, /read-only.*not a blocker/i);
  assert.match(prompt, /typed operations/i);
  assert.match(prompt, /Do not ask for a writable workspace/i);
  assert.match(prompt, /Do not reconstruct or override this sealed execution brief from planner\/status prose or repository Decision Plane control files/i);
});

test("work session rejects digest drift, traversal, extra fields, and invalid attempts", () => {
  const session = explicitSession();
  assert.throws(
    () => validateWorkSession({ ...session, schemaVersion: "work-session/v5" }),
    (error) => error.code === "MH_WORK_SESSION_SCHEMA",
  );
  assert.throws(
    () => validateWorkSession({ ...session, productResult: "drifted" }),
    (error) => error.code === "MH_WORK_PRODUCT_PROOF_SPEC" && /sealed product contract/u.test(error.message),
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
    () => sealWorkSession({ ...session, maxAttempts: 4 }),
    (error) => error.code === "MH_WORK_SESSION_ATTEMPTS",
  );
  assert.throws(
    () => sealWorkSession({ ...session, delivery: { commit: false, push: true } }),
    (error) => error.code === "MH_WORK_SESSION_DELIVERY",
  );
  assert.throws(
    () => sealWorkSession({
      ...session,
      productDirection: undefined,
      intent: { version: "owner-goal/v1", digest: "sha256:" + "1".repeat(64) },
    }),
    (error) => error.code === "MH_WORK_SESSION_SHAPE" || error.code === "MH_WORK_SESSION_SCHEMA",
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
