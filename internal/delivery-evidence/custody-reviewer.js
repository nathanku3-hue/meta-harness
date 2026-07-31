"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function candidateIsReadOnly(candidateRoot) {
  const probe = path.join(candidateRoot, `.meta-harness-custody-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "forbidden", { flag: "wx" });
    fs.rmSync(probe, { force: true });
    return false;
  } catch {
    return true;
  }
}

readInput().then((manifest) => {
  const noConclusionLeak = !Object.prototype.hasOwnProperty.call(manifest, "previousReviewerOutputs")
    && !Object.prototype.hasOwnProperty.call(manifest, "priorReviewerConclusion");
  const exactBindings = manifest.blackBoxProof.integratedCandidateDigest === manifest.integratedCandidate.candidateDigest
    && manifest.blackBoxProof.packageCandidateDigest === manifest.packageCandidate.packageCandidateDigest
    && manifest.blackBoxProof.releaseCandidateDigest === manifest.releaseCandidate.releaseCandidateDigest
    && manifest.releaseCandidate.tarballDigest === manifest.packageCandidate.tarballDigest;
  const passed = manifest.schemaVersion === "reviewer-input/v1"
    && candidateIsReadOnly(manifest.candidateRoot)
    && noConclusionLeak
    && exactBindings
    && manifest.blackBoxProof.noImplementationWorkerExpectedOutput === true;
  process.stdout.write(JSON.stringify({
    schemaVersion: "reviewer-output/v1",
    result: passed ? "PASS" : "FAIL",
    findings: passed
      ? "Custody review confirms read-only candidate access, exact release bindings, and no implementation-authored expected output."
      : "Custody review rejected writable access, conclusion leakage, or an identity mismatch.",
  }));
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
