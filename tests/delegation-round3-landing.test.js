"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { landDelegationLaneResult } = require("../lib/delegation-round3-landing");
const { readCurrentWorldState } = require("../lib/world-transition");
const { contractFor, laneOutcome, resultCard, snapshot } = require("./helpers/delegation-round3");
const { fakeInterpretation, legacySession, monotonicNow, persistInitial, repository } = require("./helpers/linear-product-head");

test("compact lane learning advances World without moving canonical product code and replay is idempotent", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "a");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  const compact = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") } });
  const now = monotonicNow();
  const productCommit = current.head.productCommit;

  const landed = landDelegationLaneResult({
    repositoryPath: root,
    contract,
    snapshot: compact,
    laneKey: "A",
    interpret: fakeInterpretation,
    now,
  });
  const after = readCurrentWorldState(root);
  assert.equal(landed.state, "LANDED");
  assert.equal(after.head.productCommit, productCommit);
  assert.deepEqual(after.world.payload.learned, ["a"]);
  assert.equal(after.head.lastTransitionDigest, landed.transitionDigest);

  const replay = landDelegationLaneResult({
    repositoryPath: root,
    contract,
    snapshot: compact,
    laneKey: "A",
    interpret: fakeInterpretation,
    now,
  });
  assert.equal(replay.status, "ALREADY_LANDED");
  assert.equal(readCurrentWorldState(root).head.headDigest, after.head.headDigest);
});

test("Claim-bound coding PASS cannot become delegation World learning before controller integration", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "a");
  const current = readCurrentWorldState(root);
  legacySession(root, outcome, current.head.headDigest, "a");
  const contract = contractFor(root, current, [outcome]);
  const compact = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "a") } });

  assert.throws(
    () => landDelegationLaneResult({
      repositoryPath: root,
      contract,
      snapshot: compact,
      laneKey: "A",
      interpret: fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error?.code === "MH_DELEGATION_R3_CODE_AUTHORITY",
  );
  const after = readCurrentWorldState(root);
  assert.equal(after.head.headDigest, current.head.headDigest);
  assert.equal(after.head.productCommit, current.head.productCommit);
  assert.deepEqual(after.world.payload.learned, []);
});

test("pre-fix writable r3 refill lanes cannot be reinterpreted as evidence learning", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "legacy-code");
  const current = readCurrentWorldState(root);
  const legacyLaneKey = `r3-1-${outcome.outcomeDigest.slice(-10)}`;
  const contract = contractFor(
    root,
    current,
    [outcome],
    "Legacy Round-3 coding refill remains retained only for safe reconciliation.",
    [legacyLaneKey],
  );
  const compact = snapshot(contract, { results: { [legacyLaneKey]: resultCard(contract.lanes[0], "c") } });

  assert.throws(
    () => landDelegationLaneResult({
      repositoryPath: root,
      contract,
      snapshot: compact,
      laneKey: legacyLaneKey,
      interpret: fakeInterpretation,
      now: monotonicNow(),
    }),
    (error) => error?.code === "MH_DELEGATION_R3_CODE_AUTHORITY"
      && error?.details?.legacyWritableRefill === true,
  );
  const after = readCurrentWorldState(root);
  assert.equal(after.head.headDigest, current.head.headDigest);
  assert.deepEqual(after.world.payload.learned, []);
});

test("compact delegation learning executes through the fixed repository interpreter seam", (t) => {
  const { root } = repository(t);
  persistInitial(root, "world-transition/v2");
  const outcome = laneOutcome(root, "b");
  const current = readCurrentWorldState(root);
  const contract = contractFor(root, current, [outcome]);
  const compact = snapshot(contract, { results: { A: resultCard(contract.lanes[0], "b") } });

  const landed = landDelegationLaneResult({
    repositoryPath: root,
    contract,
    snapshot: compact,
    laneKey: "A",
    now: monotonicNow(),
  });
  const after = readCurrentWorldState(root);
  assert.equal(landed.state, "LANDED");
  assert.deepEqual(after.world.payload.learned, ["b"]);
  assert.equal(after.head.productCommit, current.head.productCommit);
});
