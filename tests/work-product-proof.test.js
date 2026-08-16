"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { resolveProductProof } = require("../lib/work-product-proof");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function repository(t) {
  const root = tempDir("work-product-proof-");
  git(root, ["init"]);
  git(root, ["config", "user.name", "Product Proof Test"]);
  git(root, ["config", "user.email", "product-proof@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function installPolicy(root, { runtime = "node", programPath = "proof/check.js" } = {}) {
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(programPath)), { recursive: true });
  fs.writeFileSync(path.join(root, programPath), "process.exit(0);\n", "utf8");
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v1",
    programPath,
    runtime,
    timeoutSeconds: 30,
  }, null, 2)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "product proof policy"]);
  return git(root, ["rev-parse", "HEAD"]);
}

test("absent product-proof policy resolves to UNAVAILABLE evidence input", (t) => {
  const root = repository(t);
  const head = git(root, ["rev-parse", "HEAD"]);
  const resolution = resolveProductProof(root, head);
  assert.equal(resolution.available, false);
  assert.equal(resolution.baseCommit, head);
  assert.equal(resolution.policyPath, ".meta-harness/product-proof.json");
});

test("product-proof resolution binds policy and program blobs from the sealed base, not mutable working bytes", (t) => {
  const root = repository(t);
  const head = installPolicy(root);
  const expectedPolicy = git(root, ["rev-parse", `${head}:.meta-harness/product-proof.json`]);
  const expectedProgram = git(root, ["rev-parse", `${head}:proof/check.js`]);
  fs.writeFileSync(path.join(root, "proof", "check.js"), "process.exit(99);\n", "utf8");

  const resolution = resolveProductProof(root, head);
  assert.equal(resolution.available, true);
  assert.equal(resolution.policy.blobOid, expectedPolicy);
  assert.equal(resolution.program.blobOid, expectedProgram);
  assert.equal(resolution.runtime, "node");
});

test("product-proof runtime cannot be delegated to candidate-controlled paths", (t) => {
  const root = repository(t);
  const head = installPolicy(root, { runtime: "/candidate/runtime" });
  assert.throws(
    () => resolveProductProof(root, head),
    (error) => error.code === "MH_WORK_PRODUCT_PROOF_POLICY" && /safe system PATH/u.test(error.message),
  );
});
