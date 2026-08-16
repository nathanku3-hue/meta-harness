"use strict";

const fs = require("node:fs");
const path = require("node:path");

function writePassingProductProof(root, { programPath = ".meta-harness/product-proof.js" } = {}) {
  const metaDir = path.join(root, ".meta-harness");
  fs.mkdirSync(metaDir, { recursive: true });
  const absoluteProgram = path.join(root, ...programPath.split("/"));
  fs.mkdirSync(path.dirname(absoluteProgram), { recursive: true });
  fs.writeFileSync(absoluteProgram, [
    '"use strict";',
    'const fs = require("node:fs");',
    'if (!process.env.META_HARNESS_CANDIDATE_ROOT || !fs.existsSync(process.env.META_HARNESS_CANDIDATE_ROOT)) process.exit(41);',
    'if (!process.env.META_HARNESS_SESSION_PATH || !fs.existsSync(process.env.META_HARNESS_SESSION_PATH)) process.exit(42);',
    'const session = JSON.parse(fs.readFileSync(process.env.META_HARNESS_SESSION_PATH, "utf8"));',
    'if (!session.sessionDigest || !session.productResult) process.exit(43);',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(metaDir, "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v1",
    programPath,
    runtime: process.execPath,
    timeoutSeconds: 30,
  }, null, 2)}\n`, "utf8");
}

module.exports = { writePassingProductProof };
