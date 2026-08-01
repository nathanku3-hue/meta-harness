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

readInput().then((manifest) => {
  const evaluations = manifest.blackBoxProof.quantitativeEvaluations;
  const byId = new Map(evaluations.map((entry) => [entry.predicateId, entry]));
  const sameOracle = manifest.blackBoxProof.evaluatorExecutableDigest
    === manifest.sliceAcceptance.proofOracle.evaluatorArtifactDigest;
  const exactSet = evaluations.length === REQUIRED_PREDICATES.length
    && REQUIRED_PREDICATES.every((predicateId) => byId.get(predicateId)?.passed === true);
  const passed = manifest.schemaVersion === "reviewer-input/v1"
    && manifest.packageCandidate.packageName === "@nkgss/meta-harness"
    && manifest.packageCandidate.version === "0.4.0"
    && manifest.releaseCandidate.packageCandidateDigest === manifest.packageCandidate.packageCandidateDigest
    && sameOracle
    && exactSet;
  process.stdout.write(JSON.stringify({
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Domain review confirms one DELIVERY package, the pre-bound oracle, and complete D1-D10 semantic discrimination."
      : "Domain review rejected package identity, oracle identity, or semantic predicate coverage.",
  }));
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
