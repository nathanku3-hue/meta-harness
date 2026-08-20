"use strict";

const fs = require("node:fs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const schemaPath = argument("--output-schema");
const outputPath = argument("-o");
const markerPath = process.env.META_HARNESS_PROOF_COMPILER_MARKER;
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

if (Array.isArray(schema.required) && schema.required.includes("claims")) {
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(markerPath, String(process.pid), "utf8");
    setInterval(() => {}, 1000);
  } else {
    fs.writeFileSync(outputPath, JSON.stringify({
      claims: [{
        id: "owner-goal",
        statement: "The requested owner goal is represented.",
        disposition: "EXECUTABLE",
        baselineExpectation: "FAIL",
        covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
        reason: "The requested result is directly observable in the candidate workspace.",
      }],
      program: {
        runtime: "node",
        timeoutSeconds: 30,
        content: "const fs=require('node:fs'); if(!fs.existsSync(process.env.META_HARNESS_CANDIDATE_ROOT+'/src/result.txt')||fs.readFileSync(process.env.META_HARNESS_CANDIDATE_ROOT+'/src/result.txt','utf8')!=='delivered\\n')process.exit(1);",
      },
    }), "utf8");
  }
} else {
  fs.writeFileSync(outputPath, JSON.stringify({
    schemaVersion: "worker-result/v2",
    status: "DONE",
    observableResult: "Created the requested result.",
    operations: [{ type: "WRITE", path: "src/result.txt", content: "delivered\n" }],
    validation: ["owner-goal continuity regression"],
    stop: null,
  }), "utf8");
}
