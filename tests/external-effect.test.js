"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  descriptor,
  effectState,
  persistEffectIntent,
  persistEffectObservation,
  replayDecision,
} = require("../lib/external-effect");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-external-effect-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, runId: `run-${"a".repeat(64)}` };
}

test("external effect intent is durable before observation and exact retries reuse identity", (t) => {
  const { root, runId } = fixture(t);
  const effect = descriptor({
    kind: "DEPLOY",
    exactInput: { target: "staging", artifact: "abc" },
    replayClass: "KEYED_IDEMPOTENT",
    idempotencyKey: "deploy-abc",
  });

  const intended = persistEffectIntent({ gitCommonDirectory: root, runId, effect });
  assert.equal(intended.pending, true);
  assert.equal(replayDecision(intended).action, "RETRY_EXACT");

  const duplicate = persistEffectIntent({ gitCommonDirectory: root, runId, effect });
  assert.equal(duplicate.intended.eventDigest, intended.intended.eventDigest);

  const observed = persistEffectObservation({
    gitCommonDirectory: root,
    runId,
    effect,
    result: { status: "deployed" },
  });
  assert.equal(observed.pending, false);
  assert.deepEqual(observed.observed.data.result, { status: "deployed" });
  assert.equal(replayDecision(observed).action, "USE_OBSERVED");
});

test("observable and non-replayable effects produce distinct crash recovery decisions", (t) => {
  const { root, runId } = fixture(t);
  const observable = descriptor({
    kind: "GIT_PUSH",
    exactInput: { remote: "origin", branch: "work/a", sha: "abc" },
    replayClass: "OBSERVABLE",
  });
  const uncertain = descriptor({
    kind: "SEND_ONE_SHOT",
    exactInput: { destination: "external" },
    replayClass: "NON_REPLAYABLE",
  });

  const observableState = persistEffectIntent({ gitCommonDirectory: root, runId, effect: observable });
  assert.deepEqual(replayDecision(observableState), { action: "RECONCILE_REMOTE", ownerRequired: false });

  const uncertainState = persistEffectIntent({ gitCommonDirectory: root, runId, effect: uncertain });
  assert.deepEqual(replayDecision(uncertainState), { action: "RECONCILE_OR_ESCALATE", ownerRequired: true });
  assert.equal(effectState({ gitCommonDirectory: root, runId, effect: uncertain }).pending, true);
});

test("keyed idempotent effects require a stable key", () => {
  assert.throws(
    () => descriptor({ kind: "DEPLOY", exactInput: {}, replayClass: "KEYED_IDEMPOTENT" }),
    (error) => error.code === "MH_EXTERNAL_EFFECT_IDEMPOTENCY",
  );
});
