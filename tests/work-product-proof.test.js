"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { compileProductProofSpec } = require("../lib/work-proof-compiler");
const {
  gapProductProofSpec,
  productProofContract,
  readBaseOwnedProductProofDraft,
  sealProductProofSpec,
} = require("../lib/work-product-proof-spec");
const { tempDir } = require("./helpers/cli");
const { directionFromContent } = require("./helpers/product-direction");

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

function contract(root, commit = git(root, ["rev-parse", "HEAD"])) {
  return productProofContract({
    productDirectionDigest: `sha256:${"1".repeat(64)}`,
    baseCommit: commit,
    productResult: "Add the delivered result.",
    newlyTrueBehavior: "The delivered result becomes observable.",
    doneWhen: "The delivered result is correct.",
  });
}

function installPolicy(root, { runtime = "node", programPath = "proof/check.js" } = {}) {
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(programPath)), { recursive: true });
  fs.writeFileSync(path.join(root, programPath), [
    '"use strict";',
    'process.exit(process.env.META_HARNESS_PROOF_CLAIM_ID === "result" ? 1 : 2);',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v2",
    programPath,
    runtime,
    timeoutSeconds: 30,
    claims: [{
      id: "result",
      statement: "The requested result is observable.",
      baselineExpectation: "FAIL",
      covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
    }],
  }, null, 2)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "product proof policy"]);
  return git(root, ["rev-parse", "HEAD"]);
}

test("proof-compiler result stays disposable when drain wins before compiled spec durableization", async (t) => {
  const root = repository(t);
  const controller = new AbortController();
  const base = { commit: git(root, ["rev-parse", "HEAD"]) };
  const productDirection = directionFromContent();
  const modelRunner = async () => {
    controller.abort();
    return {
      model: "test-proof-compiler",
      result: {
        claims: [{
          id: "result",
          statement: "The requested result is represented.",
          disposition: "UNVERIFIABLE",
          baselineExpectation: "NONE",
          covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
          reason: "test result",
        }],
        program: null,
      },
      stdout: "",
      stderr: "",
    };
  };

  await assert.rejects(
    Promise.resolve(compileProductProofSpec({
      repositoryPath: root,
      productDirection,
      base,
      productResult: "Add the delivered result.",
      newlyTrueBehavior: "The delivered result becomes observable.",
      doneWhen: "The delivered result is correct.",
      signal: controller.signal,
      modelRunner,
    })),
    (error) => error.code === "MH_DRAIN_REQUESTED",
  );
});

test("ordinary proof-compiler failure still degrades to an explicit GAP", async (t) => {
  const root = repository(t);
  const spec = await Promise.resolve(compileProductProofSpec({
    repositoryPath: root,
    productDirection: directionFromContent(),
    base: { commit: git(root, ["rev-parse", "HEAD"]) },
    productResult: "Add the delivered result.",
    newlyTrueBehavior: "The delivered result becomes observable.",
    doneWhen: "The delivered result is correct.",
    modelRunner: async () => {
      throw new Error("compiler unavailable");
    },
  }));
  assert.equal(spec.source.type, "GAP");
  assert.match(spec.source.reason, /compiler unavailable/u);
});

test("absence is represented by an explicit canonical GAP spec rather than UNAVAILABLE runtime state", (t) => {
  const root = repository(t);
  const proofContract = contract(root);
  assert.equal(readBaseOwnedProductProofDraft(root, proofContract), null);
  const spec = gapProductProofSpec(proofContract, "No independent executable oracle could be established.");
  assert.equal(spec.schemaVersion, "product-proof-spec/v1");
  assert.equal(spec.source.type, "GAP");
  assert.equal(spec.program, null);
  assert.equal(spec.claims.every((claim) => claim.disposition === "UNVERIFIABLE"), true);
  assert.deepEqual(new Set(spec.claims.flatMap((claim) => claim.covers)), new Set(["productResult", "newlyTrueBehavior", "doneWhen"]));
});

test("base-owned v2 proof input binds policy/program blobs and normalizes claims without creating a second runtime path", (t) => {
  const root = repository(t);
  const head = installPolicy(root);
  const proofContract = contract(root, head);
  const expectedPolicy = git(root, ["rev-parse", `${head}:.meta-harness/product-proof.json`]);
  const expectedProgram = git(root, ["rev-parse", `${head}:proof/check.js`]);
  fs.writeFileSync(path.join(root, "proof", "check.js"), "process.exit(0);\n", "utf8");

  const draft = readBaseOwnedProductProofDraft(root, proofContract);
  assert.equal(draft.source.type, "BASE_OWNED");
  assert.equal(draft.source.policyBlobOid, expectedPolicy);
  assert.equal(draft.source.programBlobOid, expectedProgram);
  assert.match(draft.program.content, /META_HARNESS_PROOF_CLAIM_ID/);
  assert.equal(draft.claims[0].disposition, "EXECUTABLE");

  const spec = sealProductProofSpec({
    ...draft,
    calibration: [{ claimId: "result", expected: "FAIL", observed: "FAIL" }],
  });
  assert.equal(spec.source.type, "BASE_OWNED");
  assert.match(spec.specDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("product-proof runtime cannot be delegated to candidate-controlled paths", (t) => {
  const root = repository(t);
  const head = installPolicy(root, { runtime: "/candidate/runtime" });
  assert.throws(
    () => readBaseOwnedProductProofDraft(root, contract(root, head)),
    (error) => error.code === "MH_WORK_PRODUCT_PROOF_POLICY" && /safe system PATH/u.test(error.message),
  );
});

test("sealed proof spec rejects silent material-clause loss", (t) => {
  const root = repository(t);
  const proofContract = contract(root);
  assert.throws(
    () => sealProductProofSpec({
      source: { type: "GAP", reason: "test" },
      contract: proofContract,
      claims: [{
        id: "partial",
        statement: "Only the product result was represented.",
        disposition: "UNVERIFIABLE",
        baselineExpectation: "NONE",
        covers: ["productResult"],
        reason: "test",
      }],
      program: null,
      calibration: [],
    }),
    (error) => error.code === "MH_WORK_PRODUCT_PROOF_SPEC" && /does not cover material contract clause/u.test(error.message),
  );
});
