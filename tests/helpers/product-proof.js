"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { gapProductProofSpec, productProofContract } = require("../../lib/work-product-proof-spec");

function gapProofSpec(fields, reason = "Test fixture intentionally leaves semantic product proof unresolved.") {
  return gapProductProofSpec(productProofContract(fields), reason);
}

function writePassingProductProof(root, { programPath = ".meta-harness/product-proof.js" } = {}) {
  const metaDir = path.join(root, ".meta-harness");
  fs.mkdirSync(metaDir, { recursive: true });
  const absoluteProgram = path.join(root, ...programPath.split("/"));
  fs.mkdirSync(path.dirname(absoluteProgram), { recursive: true });
  fs.writeFileSync(absoluteProgram, [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'if (process.env.META_HARNESS_PROOF_CLAIM_ID !== "delivered-result") process.exit(41);',
    'if (!process.env.META_HARNESS_CANDIDATE_ROOT || !fs.existsSync(process.env.META_HARNESS_CANDIDATE_ROOT)) process.exit(42);',
    'if (!process.env.META_HARNESS_CONTRACT_PATH || !fs.existsSync(process.env.META_HARNESS_CONTRACT_PATH)) process.exit(43);',
    'const contract = JSON.parse(fs.readFileSync(process.env.META_HARNESS_CONTRACT_PATH, "utf8"));',
    'if (!contract.contractDigest || !contract.productResult) process.exit(44);',
    'const target = path.join(process.env.META_HARNESS_CANDIDATE_ROOT, "src", "result.txt");',
    'if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== "delivered\\n") process.exit(45);',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(metaDir, "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v2",
    programPath,
    runtime: process.execPath,
    timeoutSeconds: 30,
    claims: [{
      id: "delivered-result",
      statement: "The requested delivered result exists with the expected contents.",
      baselineExpectation: "FAIL",
      covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
    }],
  }, null, 2)}\n`, "utf8");
}

module.exports = { gapProofSpec, writePassingProductProof };
