"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  WORK_SESSION_SCHEMA,
  computeWorkSessionDigest,
  createGoalWorkSession,
  loadWorkSession,
  sealWorkSession,
  validateWorkSession,
} = require("../lib/work-session");
const { tempDir } = require("./helpers/cli");

function explicitSession() {
  return sealWorkSession({
    schemaVersion: WORK_SESSION_SCHEMA,
    intent: {
      version: "intent-v1",
      digest: "sha256:" + "1".repeat(64),
    },
    productResult: "Ship one product-facing coding command.",
    journeyState: "The product direction is accepted and implementation is ready.",
    doNow: "Implement the primary work command.",
    newlyTrueBehavior: "One command carries the brief into code and validation.",
    doneWhen: "Focused tests pass and the default help is product-facing.",
    stopOnlyIf: ["Protected access is required."],
    authorizedReversibleActions: ["Edit allowed files.", "Run tests."],
    ownerOnlyActions: ["Publish a release."],
    allowedPaths: ["lib", "tests"],
    dirtyPolicy: "continue-in-scope",
    validation: [{ argv: ["node", "--test"], cwd: ".", timeoutSeconds: 60 }],
    maxAttempts: 2,
  });
}

test("work-session/v1 seals product continuity and exact path/validation scope", () => {
  const session = explicitSession();
  assert.equal(session.schemaVersion, "work-session/v1");
  assert.equal(session.sessionDigest, computeWorkSessionDigest(session));
  assert.equal(Object.isFrozen(validateWorkSession(session)), true);
  assert.deepEqual(session.allowedPaths, ["lib", "tests"]);
  assert.equal(session.productResult, "Ship one product-facing coding command.");
});

test("goal shorthand creates a complete low-friction product brief", () => {
  const session = createGoalWorkSession({
    goal: "Add a visible result.",
    allowedPaths: ["src"],
    dirtyPolicy: "isolate",
  });
  assert.equal(session.productResult, "Add a visible result.");
  assert.equal(session.doNow, "Add a visible result.");
  assert.equal(session.newlyTrueBehavior, "Add a visible result.");
  assert.equal(session.allowedPaths[0], "src");
  assert.equal(session.maxAttempts, 2);
  assert.match(session.intent.digest, /^sha256:[a-f0-9]{64}$/);
});

test("work session rejects digest drift, traversal, extra fields, and invalid attempts", () => {
  const session = explicitSession();
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
    () => sealWorkSession({ ...session, maxAttempts: 4 }),
    (error) => error.code === "MH_WORK_SESSION_ATTEMPTS",
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
