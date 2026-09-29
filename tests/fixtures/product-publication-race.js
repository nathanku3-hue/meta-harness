"use strict";

const fs = require("node:fs");

const { compareAndSwapIntegrationHead } = require("../../lib/optimistic-integration");

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(sleeper, 0, 0, milliseconds);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const candidate = JSON.parse(process.env.MH_PRODUCT_PUBLICATION_CANDIDATE);
fs.writeFileSync(process.env.MH_PRODUCT_PUBLICATION_READY, "ready\n", "utf8");
while (fs.existsSync(process.env.MH_PRODUCT_PUBLICATION_BARRIER)) sleep(2);

try {
  const result = compareAndSwapIntegrationHead({
    repositoryPath: candidate.root,
    expectedHead: candidate.receipt.predecessorProductCommit,
    candidateHead: candidate.receipt.integratedCommit,
  });
  emit({ ok: true, ...result });
} catch (error) {
  emit({
    ok: false,
    code: error?.code || "ERROR",
    message: String(error?.message || error),
  });
}
