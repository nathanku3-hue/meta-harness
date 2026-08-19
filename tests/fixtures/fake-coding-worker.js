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

if (prompt.includes("LOGICAL_PLANNER_AUTODISPATCH_V2")) {
  let proposals = [];
  if (process.env.FAKE_PLANNER_CANDIDATES_JSON) {
    try {
      proposals = JSON.parse(process.env.FAKE_PLANNER_CANDIDATES_JSON);
    } catch (error) {
      process.stderr.write(`invalid FAKE_PLANNER_CANDIDATES_JSON: ${error.message}\n`);
      process.exit(3);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: "planner-candidate-batch/v1", proposals })}\n`, "utf8");
  process.exit(0);
}

if (prompt.includes("FORWARD_MOTION_CHALLENGE_V1")) {
  const disposition = String(process.env.FAKE_FORWARD_MOTION_DISPOSITION || "REPLAN_REQUIRED").toUpperCase();
  const failedMeans = [{ means: "preferred API/source", evidence: ["The worker observed that the preferred route was unavailable."] }];
  const alternatives = disposition === "CONTINUE_WITH_ALTERNATIVE"
    ? [{
        means: process.env.FAKE_FORWARD_MOTION_ALTERNATIVE || "Use the in-repository substitute instead of the preferred external route.",
        disposition: "AVAILABLE",
        evidence: ["The substitute stays within the sealed product result."],
        requiredPaths: [process.env.FAKE_FORWARD_MOTION_PATH || "src"],
      }]
    : [];
  const ownerRequest = disposition === "OWNER_REQUIRED" ? {
    kind: process.env.FAKE_FORWARD_MOTION_OWNER_KIND || "CREDENTIALS",
    question: process.env.FAKE_FORWARD_MOTION_QUESTION || "Provide the credential required by the sealed Outcome?",
    evidence: ["The required credential is not available to autonomous execution."],
  } : null;
  const result = {
    disposition,
    failedMeans,
    alternatives,
    hardConstraint: disposition === "HARD_BLOCKED" ? "A demonstrated Outcome-level constraint prevents every known autonomous route." : null,
    ownerRequest,
    disprovedAssertions: process.env.FAKE_FORWARD_MOTION_DISPROVE
      ? [process.env.FAKE_FORWARD_MOTION_DISPROVE]
      : [],
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
  ? "PARTIAL"
  : String(process.env.FAKE_WORKER_STATUS || "DONE").toUpperCase();
const result = {
  schemaVersion: "worker-result/v2",
  status,
  observableResult: `Prepared ${relativePath} on attempt ${attempt}.`,
  operations: status === "STOP" ? [] : [{ type: "WRITE", path: relativePath, content }],
  validation: ["fake worker completed"],
  stop: status === "STOP" ? {
    unsatisfiedRequirement: process.env.FAKE_WORKER_STOP_REQUIREMENT || "The preferred execution means is unavailable.",
    failedMeans: [{
      means: process.env.FAKE_WORKER_STOP_MEANS || "preferred API/source",
      evidence: [process.env.FAKE_WORKER_STOP_EVIDENCE || "The preferred route returned no usable result."],
    }],
    alternativesConsidered: [],
    assertedConstraint: process.env.FAKE_WORKER_STOP_CONSTRAINT || "The worker observed a constraint on its preferred route.",
  } : null,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
