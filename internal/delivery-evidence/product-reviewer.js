"use strict";

const REQUIRED_PREDICATES = Object.freeze(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);

function readInput() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(input));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function exactOperatorFlow(manifest) {
  const expected = manifest.sliceAcceptance.operatorUserFlow;
  const observed = manifest.blackBoxProof.operatorActions.map((entry) => entry.action);
  return JSON.stringify(observed) === JSON.stringify(expected);
}

function completePredicateSet(manifest) {
  const evaluations = new Map(
    manifest.blackBoxProof.quantitativeEvaluations.map((entry) => [entry.predicateId, entry]),
  );
  return REQUIRED_PREDICATES.every((predicateId) => evaluations.get(predicateId)?.passed === true);
}

readInput().then((manifest) => {
  const productResult = manifest.sliceAcceptance.productResult;
  const passed = manifest.schemaVersion === "reviewer-input/v1"
    && typeof productResult === "string"
    && productResult.includes("Meta-Harness 0.4")
    && productResult.includes("installed package")
    && exactOperatorFlow(manifest)
    && completePredicateSet(manifest);
  process.stdout.write(JSON.stringify({
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Product review confirms the exact installed Meta-Harness 0.4 operator flow and all D1-D10 predicates."
      : "Product review rejected an incomplete operator flow, product result, or D1-D10 predicate set.",
  }));
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
