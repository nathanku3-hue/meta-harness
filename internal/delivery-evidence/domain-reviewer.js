"use strict";

const REQUIRED_PREDICATES = Object.freeze([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7",
  "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15",
]);
const REQUIRED_SEMANTIC_DISCRIMINATORS = Object.freeze([
  "terminalDecisionDerivedFromScenarioAndResponse",
  "noQueuedFollowUpAfterNoBuild",
  "staleStatusCannotCreateSlice",
  "invalidObservedDefectWarrantRejected",
  "optionalFindingsRemainNonBlocking",
  "successorActivationNotClaimed",
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

function completeSemanticDiscrimination(manifest) {
  const actual = manifest?.blackBoxProof?.semanticDiscriminators;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const keys = Object.keys(actual).sort();
  return JSON.stringify(keys) === JSON.stringify([...REQUIRED_SEMANTIC_DISCRIMINATORS].sort())
    && REQUIRED_SEMANTIC_DISCRIMINATORS.every((key) => actual[key] === true);
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
    && exactSet
    && completeSemanticDiscrimination(manifest);
  return {
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Domain review confirms one DELIVERY package, the pre-bound oracle, complete D1-D15 coverage, and derived terminal/continuation discrimination."
      : "Domain review rejected package identity, oracle identity, D1-D15 coverage, or terminal/continuation semantics.",
  };
}

function syntheticManifest(
  predicateIds = REQUIRED_PREDICATES,
  evaluatorDigest = "sha256:evaluator",
  discriminatorOverrides = {},
) {
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
      semanticDiscriminators: Object.fromEntries(REQUIRED_SEMANTIC_DISCRIMINATORS.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(discriminatorOverrides, key)
          ? discriminatorOverrides[key]
          : true,
      ])),
    },
  };
}

function selfTest() {
  const positive = review(syntheticManifest());
  const missingD15 = review(syntheticManifest(REQUIRED_PREDICATES.filter((predicateId) => predicateId !== "D15")));
  const booleanOnlyTerminal = review(syntheticManifest(REQUIRED_PREDICATES, "sha256:evaluator", {
    terminalDecisionDerivedFromScenarioAndResponse: false,
  }));
  const invalidWarrant = review(syntheticManifest(REQUIRED_PREDICATES, "sha256:evaluator", {
    invalidObservedDefectWarrantRejected: false,
  }));
  if (
    positive.result !== "PASS"
    || missingD15.result !== "FAIL"
    || booleanOnlyTerminal.result !== "FAIL"
    || invalidWarrant.result !== "FAIL"
  ) {
    throw new Error("domain reviewer positive/negative self-test failed");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    positive: "PASS",
    missingD15: "FAIL",
    booleanOnlyTerminal: "FAIL",
    invalidWarrant: "FAIL",
  })}\n`);
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
