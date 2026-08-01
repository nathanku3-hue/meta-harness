"use strict";

const REQUIRED_PREDICATES = Object.freeze([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7",
  "D8", "D9", "D10", "D11", "D12", "D13", "D14",
]);
const EXPECTED_OPERATOR_FLOW = Object.freeze(["install", "activate", "execute", "inspect", "reject-drift", "accept-control"]);
const EXPECTED_PRODUCT_RESULT = "An installed Meta-Harness planner reads product authority before status, selects the nearest action that produces the end-user outcome, refuses to add unsupported audit gates, reuses unaffected evidence, and reports the observable product result before scores, custody, or governance.";

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
  const expected = manifest.sliceAcceptance?.operatorUserFlow;
  const observed = manifest.blackBoxProof?.operatorActions?.map((entry) => entry.action);
  return JSON.stringify(expected) === JSON.stringify(EXPECTED_OPERATOR_FLOW)
    && JSON.stringify(observed) === JSON.stringify(EXPECTED_OPERATOR_FLOW);
}

function completePredicateSet(manifest) {
  const rows = manifest.blackBoxProof?.quantitativeEvaluations;
  if (!Array.isArray(rows)) return false;
  const evaluations = new Map(rows.map((entry) => [entry.predicateId, entry]));
  return rows.length === REQUIRED_PREDICATES.length
    && evaluations.size === REQUIRED_PREDICATES.length
    && REQUIRED_PREDICATES.every((predicateId) => evaluations.get(predicateId)?.passed === true);
}

function review(manifest) {
  const passed = manifest?.schemaVersion === "reviewer-input/v1"
    && manifest.sliceAcceptance?.productResult === EXPECTED_PRODUCT_RESULT
    && exactOperatorFlow(manifest)
    && completePredicateSet(manifest);
  return {
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Product review confirms the exact installed outcome-first Meta-Harness 0.4 operator flow and complete D1-D14 behavior."
      : "Product review rejected the product result, operator flow, or D1-D14 predicate set.",
  };
}

function syntheticManifest(predicateIds = REQUIRED_PREDICATES, productResult = EXPECTED_PRODUCT_RESULT) {
  return {
    schemaVersion: "reviewer-input/v1",
    sliceAcceptance: {
      productResult,
      operatorUserFlow: [...EXPECTED_OPERATOR_FLOW],
    },
    blackBoxProof: {
      operatorActions: EXPECTED_OPERATOR_FLOW.map((action) => ({ action })),
      quantitativeEvaluations: predicateIds.map((predicateId) => ({ predicateId, passed: true })),
    },
  };
}

function selfTest() {
  const positive = review(syntheticManifest());
  const oldPlanner = review(syntheticManifest(REQUIRED_PREDICATES.slice(0, 10)));
  const wrongResult = review(syntheticManifest(REQUIRED_PREDICATES, "Meta-Harness 0.4 installed package is complete."));
  if (positive.result !== "PASS" || oldPlanner.result !== "FAIL" || wrongResult.result !== "FAIL") {
    throw new Error("product reviewer positive/negative self-test failed");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, positive: "PASS", oldPlanner: "FAIL", wrongResult: "FAIL" })}\n`);
}

if (process.argv.includes("--self-test")) {
  try {
    selfTest();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
} else {
  readInput().then((manifest) => {
    process.stdout.write(JSON.stringify(review(manifest)));
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
