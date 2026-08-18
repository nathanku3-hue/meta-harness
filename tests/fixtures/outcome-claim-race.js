"use strict";

const fs = require("node:fs");

const { acquireOutcomeClaim } = require("../../lib/outcome-claim");

function waitForRelease(filePath) {
  while (fs.existsSync(filePath)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

const readyPath = process.env.MH_CLAIM_READY;
const barrierPath = process.env.MH_CLAIM_BARRIER;
fs.writeFileSync(readyPath, "ready\n", "utf8");
waitForRelease(barrierPath);

try {
  const claim = acquireOutcomeClaim({
    repositoryPath: process.env.MH_CLAIM_REPOSITORY,
    outcomeDigest: process.env.MH_CLAIM_OUTCOME,
    originWorldHeadDigest: process.env.MH_CLAIM_HEAD,
    executionBoundary: { writePaths: JSON.parse(process.env.MH_CLAIM_PATHS) },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, claimDigest: claim.claimDigest })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error.code, message: error.message })}\n`);
}
