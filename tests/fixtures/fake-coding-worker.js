"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const workspace = option("-C");
const outputPath = option("-o");
const prompt = args.at(-1) || "";
if (!workspace || !outputPath) {
  process.stderr.write("fake worker missing -C or -o\n");
  process.exit(2);
}

if (prompt.includes("Compile independent product proof before any coding candidate exists.")) {
  const covers = ["productResult", "newlyTrueBehavior", "doneWhen"];
  const gap = process.env.FAKE_PROOF_COMPILER_GAP === "1";
  const result = gap ? {
    claims: [{
      id: "requested-result",
      statement: "The requested result is materially satisfied.",
      disposition: "UNVERIFIABLE",
      baselineExpectation: "NONE",
      covers,
      reason: "Fake compiler was configured to expose an explicit proof gap.",
    }],
    program: null,
  } : {
    claims: [{
      id: "delivered-result",
      statement: "The delivered result file exists with the expected contents.",
      disposition: "EXECUTABLE",
      baselineExpectation: process.env.FAKE_PROOF_COMPILER_BAD_CALIBRATION === "1" ? "PASS" : "FAIL",
      covers,
      reason: "The result is directly observable from repository bytes.",
    }],
    program: {
      runtime: "node",
      timeoutSeconds: 30,
      content: [
        '"use strict";',
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'if (process.env.META_HARNESS_PROOF_CLAIM_ID !== "delivered-result") process.exit(31);',
        'const target = path.join(process.env.META_HARNESS_CANDIDATE_ROOT, "src", "result.txt");',
        'if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== "delivered\\n") process.exit(32);',
        "",
      ].join("\n"),
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
  process.exit(0);
}

const attempt = Number(prompt.match(/Attempt: (\d+) of/)?.[1] || "1");
const relativePath = process.env.FAKE_WORKER_PATH || "src/result.txt";
const content = process.env.FAKE_WORKER_RETRY === "1" && attempt === 1 ? "wrong\n" : "delivered\n";

if (process.env.FAKE_WORKER_DIRECT_WRITE === "1" || process.env.FAKE_WORKER_STAGE === "1") {
  const targetPath = path.join(workspace, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
  if (process.env.FAKE_WORKER_STAGE === "1") {
    spawnSync("git", ["add", relativePath], { cwd: workspace, encoding: "utf8" });
  }
}

const status = process.env.FAKE_WORKER_PARTIAL_FIRST === "1" && attempt === 1
  ? "partial"
  : process.env.FAKE_WORKER_STATUS || "done";
const result = {
  status,
  observableResult: `Prepared ${relativePath} on attempt ${attempt}.`,
  operations: status === "blocked" ? [] : [{ type: "WRITE", path: relativePath, content }],
  validation: ["fake worker completed"],
  blocker: process.env.FAKE_WORKER_BLOCKER || "",
  nextAction: process.env.FAKE_WORKER_NEXT || "Review and bank the delivered change.",
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
