"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { verifyCandidate } = require("../lib/work-verifier");

test("v7 work verifier fails closed when Linux namespace isolation is unavailable", {
  skip: process.platform === "linux",
}, () => {
  assert.throws(
    () => verifyCandidate({
      workspacePath: process.cwd(),
      candidateSeal: {
        baseHead: "a".repeat(40),
        candidateTreeOid: "b".repeat(40),
      },
      commands: [],
    }),
    (error) => error.code === "MH_WORK_VERIFIER_SANDBOX_UNAVAILABLE",
  );
});
