"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { descriptor, recordMeansFailure, state } = require("../lib/means-circuit");
const { readRunJournal } = require("../lib/run-journal");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-means-circuit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    runId: `run-${"a".repeat(64)}`,
    runtimeCapabilityDigest: `sha256:${"b".repeat(64)}`,
  };
}

test("same failed means opens a durable circuit without blocking different inputs", (t) => {
  const value = fixture(t);
  const inputA = { candidateTreeOid: "1".repeat(40), validation: [["node", "test-a.js"]] };
  const inputB = { candidateTreeOid: "2".repeat(40), validation: [["node", "test-a.js"]] };

  const first = recordMeansFailure({
    gitCommonDirectory: value.root,
    runId: value.runId,
    meansKind: "VALIDATE_CANDIDATE",
    exactInput: inputA,
    runtimeCapabilityDigest: value.runtimeCapabilityDigest,
    failureClass: "VALIDATION_FAILED",
  });
  assert.equal(first.open, false);
  assert.equal(first.failureCount, 1);

  const second = recordMeansFailure({
    gitCommonDirectory: value.root,
    runId: value.runId,
    meansKind: "VALIDATE_CANDIDATE",
    exactInput: inputA,
    runtimeCapabilityDigest: value.runtimeCapabilityDigest,
    failureClass: "VALIDATION_FAILED",
  });
  assert.equal(second.open, true);
  assert.equal(second.failureCount, 2);
  assert.match(second.circuitEventDigest, /^sha256:[a-f0-9]{64}$/u);

  const changed = descriptor({
    meansKind: "VALIDATE_CANDIDATE",
    exactInput: inputB,
    runtimeCapabilityDigest: value.runtimeCapabilityDigest,
    failureClass: "VALIDATION_FAILED",
  });
  assert.equal(state({ gitCommonDirectory: value.root, runId: value.runId, value: changed }).open, false);

  const events = readRunJournal({ gitCommonDirectory: value.root, runId: value.runId });
  assert.equal(events.filter((event) => event.type === "means/failure").length, 2);
  assert.equal(events.filter((event) => event.type === "means/circuit-open").length, 1);
});

test("runtime capability changes create a different failure fingerprint", (t) => {
  const value = fixture(t);
  const exactInput = { candidateTreeOid: "1".repeat(40) };
  const first = descriptor({
    meansKind: "PRODUCT_PROOF",
    exactInput,
    runtimeCapabilityDigest: value.runtimeCapabilityDigest,
    failureClass: "PRODUCT_PROOF_FAILED",
  });
  const second = descriptor({
    meansKind: "PRODUCT_PROOF",
    exactInput,
    runtimeCapabilityDigest: `sha256:${"c".repeat(64)}`,
    failureClass: "PRODUCT_PROOF_FAILED",
  });
  assert.notEqual(first.fingerprint, second.fingerprint);
});
