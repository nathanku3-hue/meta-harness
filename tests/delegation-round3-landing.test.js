"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { landDelegationLaneResult } = require("../lib/delegation-round3-landing");
const { readCurrentWorldState } = require("../lib/world-transition");
const { contractFor, laneOutcome, resultCard, snapshot } = require("./helpers/delegation-round3");
const { fakeInterpretation, monotonicNow, persistInitial, repository } = require("./helpers/linear-product-head");

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
