"use strict";

const REQUIRED_PREDICATES = Object.freeze([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7",
  "D8", "D9", "D10", "D11", "D12", "D13", "D14",
]);

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

function review(manifest) {
  const evaluations = manifest?.blackBoxProof?.quantitativeEvaluations;
  const byId = new Map(Array.isArray(evaluations) ? evaluations.map((entry) => [entry.predicateId, entry]) : []);
  const sameOracle = manifest?.blackBoxProof?.evaluatorExecutableDigest
    === manifest?.sliceAcceptance?.proofOracle?.evaluatorArtifactDigest;
  const exactSet = Array.isArray(evaluations)
    && evaluations.length === REQUIRED_PREDICATES.length
    && byId.size === REQUIRED_PREDICATES.length
    && REQUIRED_PREDICATES.every((predicateId) => byId.get(predicateId)?.passed === true);
  const passed = manifest?.schemaVersion === "reviewer-input/v1"
    && manifest.packageCandidate?.packageName === "@nkgss/meta-harness"
    && manifest.packageCandidate?.version === "0.4.0"
    && manifest.releaseCandidate?.packageCandidateDigest === manifest.packageCandidate?.packageCandidateDigest
    && sameOracle
    && exactSet;
  return {
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Domain review confirms one DELIVERY package, the pre-bound oracle, and complete D1-D14 outcome-first discrimination."
      : "Domain review rejected package identity, oracle identity, or D1-D14 semantic predicate coverage.",
  };
}

function syntheticManifest(predicateIds = REQUIRED_PREDICATES, evaluatorDigest = "sha256:evaluator") {
  return {
    schemaVersion: "reviewer-input/v1",
    sliceAcceptance: {
      proofOracle: { evaluatorArtifactDigest: evaluatorDigest },
    },
    packageCandidate: {
      packageName: "@nkgss/meta-harness",
      version: "0.4.0",
      packageCandidateDigest: "sha256:package",
    },
    releaseCandidate: {
      packageCandidateDigest: "sha256:package",
    },
    blackBoxProof: {
      evaluatorExecutableDigest: evaluatorDigest,
      quantitativeEvaluations: predicateIds.map((predicateId) => ({ predicateId, passed: true })),
    },
  };
}

function selfTest() {
  const positiveManifest = syntheticManifest();
  const substitutedManifest = syntheticManifest();
  substitutedManifest.blackBoxProof.evaluatorExecutableDigest = "sha256:substituted";
  const positive = review(positiveManifest);
  const oldPlanner = review(syntheticManifest(REQUIRED_PREDICATES.slice(0, 10)));
  const substitutedOracle = review(substitutedManifest);
  if (positive.result !== "PASS" || oldPlanner.result !== "FAIL" || substitutedOracle.result !== "FAIL") {
    throw new Error("domain reviewer positive/negative self-test failed");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, positive: "PASS", oldPlanner: "FAIL", substitutedOracle: "FAIL" })}\n`);
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
