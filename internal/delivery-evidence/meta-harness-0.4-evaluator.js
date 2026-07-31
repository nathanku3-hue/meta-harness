"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REQUIRED_PREDICATES = Object.freeze(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
const PROOF_PREDICATE_ORDER = Object.freeze([...REQUIRED_PREDICATES].sort());
const OPERATOR_FLOW = Object.freeze(["install", "activate", "execute", "inspect", "reject-drift", "accept-control"]);
const REQUIRED_GUIDANCE_PATHS = Object.freeze([
  ".meta-harness/status.md",
  "task.md",
  "implementation_plan.md",
  "docs/product/roadmap.md",
  "package.json",
]);
const RETIRED_EXECUTABLE_TOKENS = Object.freeze([
  "CERTIFICATION_PREPARE",
  "CERTIFICATION_ASSESS",
  "CERTIFICATION_VERIFIED",
  "certification-candidate/v1",
  "certification-proof/v1",
  "produceCertificationEvidence",
  "repository-application",
]);

function sha256Bytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function fixtureDigest(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.fixtureDigest;
  return sha256Bytes(canonicalBytes(body));
}

function fixtureMaterialDigest(value) {
  return sha256Bytes(canonicalBytes({
    originalAcceptance: value.originalAcceptance,
    weakenedDirection: value.weakenedDirection,
    quant: value.quant,
  }));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: encoding === null ? null : encoding,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitObjectExists(repoRoot, objectSpec) {
  try {
    git(repoRoot, ["cat-file", "-e", objectSpec]);
    return true;
  } catch {
    return false;
  }
}

function makeAcceptance(fixture, evaluatorDigest) {
  return {
    intent: {
      version: "meta-harness-0.4-delivery-intent/v1",
      digest: fixture.fixtureDigest,
    },
    acceptanceSource: {
      revision: fixture.originalAcceptance.revision,
      path: fixture.originalAcceptance.path,
      contentDigest: fixture.originalAcceptance.contentDigest,
    },
    acceptanceClauses: REQUIRED_PREDICATES.map((predicateId) => ({
      clauseId: predicateId,
      verbatimText: fixture.predicates[predicateId],
    })),
    quantitativeBounds: REQUIRED_PREDICATES.map((predicateId) => ({
      boundId: predicateId,
      clauseId: predicateId,
      subject: predicateId,
      measure: "binary_pass",
      distinctBy: null,
      min: 1,
      max: 1,
      coherenceKey: "meta-harness-0.4-delivery",
    })),
    productResult: fixture.productResult,
    operatorUserFlow: [...OPERATOR_FLOW],
    shippingTarget: "installed-package",
    proofOracle: {
      evaluatorKind: "initial-base-artifact",
      evaluatorArtifactIdentity: "internal/delivery-evidence/meta-harness-0.4-evaluator.js",
      evaluatorArtifactDigest: evaluatorDigest,
      evaluatorPackageDigest: null,
      predicateIds: [...PROOF_PREDICATE_ORDER],
      inputPolicyDigest: fixture.proofInputPolicyDigest,
      observationSchemaDigest: fixture.observationSchemaDigest,
    },
  };
}

function verifyFixture(fixture) {
  assert(fixture.schemaVersion === "meta-harness-delivery-fixture-manifest/v1", "unsupported fixture manifest schema");
  assert(fixture.fixtureDigest === fixtureDigest(fixture), "fixture manifest digest mismatch");
  assert(fixture.fixtureMaterialDigest === fixtureMaterialDigest(fixture), "fixture material digest mismatch");
  assert(JSON.stringify(fixture.proofPredicateOrder) === JSON.stringify(PROOF_PREDICATE_ORDER), "fixture predicate order mismatch");
  assert(REQUIRED_PREDICATES.every((id) => typeof fixture.predicates[id] === "string"), "fixture predicates incomplete");
  assert(fixture.proofInputPolicyDigest === sha256Bytes(canonicalBytes(fixture.proofInputSchema)), "proof input policy digest mismatch");
  assert(fixture.observationSchemaDigest === sha256Bytes(canonicalBytes(fixture.observationSchema)), "observation schema digest mismatch");
  for (const program of Object.values(fixture.programs)) {
    const absolute = path.join(__dirname, path.basename(program.path));
    assert(fs.existsSync(absolute), `missing program: ${program.path}`);
    assert(sha256Bytes(fs.readFileSync(absolute)) === program.digest, `program digest mismatch: ${program.path}`);
  }
}

function verifyQuantIdentities(repoRoot, fixture) {
  const negative = fixture.quant.negativeCandidate;
  const positive = fixture.quant.positiveControl;
  assert(git(repoRoot, ["rev-parse", `${negative.commit}^{commit}`]).trim() === negative.commit, "negative commit mismatch");
  assert(git(repoRoot, ["rev-parse", `${negative.commit}^{tree}`]).trim() === negative.tree, "negative tree mismatch");
  assert(git(repoRoot, ["rev-parse", `${positive.commit}^{commit}`]).trim() === positive.commit, "positive commit mismatch");
  assert(git(repoRoot, ["rev-parse", `${positive.commit}^{tree}`]).trim() === positive.tree, "positive tree mismatch");

  const acceptanceSpec = `${fixture.originalAcceptance.revision}:${fixture.originalAcceptance.path}`;
  assert(git(repoRoot, ["rev-parse", acceptanceSpec]).trim() === fixture.originalAcceptance.gitBlob, "original acceptance blob mismatch");
  const acceptanceBytes = git(repoRoot, ["show", acceptanceSpec], null);
  assert(sha256Bytes(acceptanceBytes) === fixture.originalAcceptance.contentDigest, "original acceptance content mismatch");

  for (const [relativePath, blob] of Object.entries(negative.mechanicalEvidence)) {
    assert(git(repoRoot, ["rev-parse", `${negative.commit}:${relativePath}`]).trim() === blob, `negative evidence mismatch: ${relativePath}`);
  }
  for (const relativePath of negative.expectedAbsentPaths) {
    assert(!gitObjectExists(repoRoot, `${negative.commit}:${relativePath}`), `negative fixture unexpectedly contains: ${relativePath}`);
  }
  for (const [relativePath, blob] of Object.entries(positive.requiredPaths)) {
    assert(git(repoRoot, ["rev-parse", `${positive.commit}:${relativePath}`]).trim() === blob, `positive control mismatch: ${relativePath}`);
  }
}

function verifyProofInput(proofInput, fixture) {
  assert(proofInput && proofInput.schemaVersion === "meta-harness-delivery-proof-input/v1", "unsupported proof input schema");
  assert(proofInput.fixtureDigest === fixture.fixtureDigest, "proof fixture digest mismatch");
  assert(proofInput.negativeCommit === fixture.quant.negativeCandidate.commit, "negative commit input mismatch");
  assert(proofInput.negativeTree === fixture.quant.negativeCandidate.tree, "negative tree input mismatch");
  assert(proofInput.positiveCommit === fixture.quant.positiveControl.commit, "positive commit input mismatch");
  assert(proofInput.positiveTree === fixture.quant.positiveControl.tree, "positive tree input mismatch");
}

function exactAcceptance(actual, fixture, evaluatorDigest) {
  return canonicalBytes(actual).equals(canonicalBytes(makeAcceptance(fixture, evaluatorDigest)));
}

function exactReviewerBindings(input, fixture) {
  const expected = {
    PRODUCT: fixture.programs.productReviewer.digest,
    DOMAIN: fixture.programs.domainReviewer.digest,
    CUSTODY: fixture.programs.custodyReviewer.digest,
  };
  const rows = Array.isArray(input.reviewerAssessments) ? input.reviewerAssessments : [];
  const byRole = new Map(rows.map((row) => [row.role, row]));
  return Object.entries(expected).every(([role, digest]) => (
    byRole.get(role)?.processExecutableDigest === digest
    && byRole.get(role)?.result === "PASS"
  ));
}

function mechanicsCannotClaimProduct(input) {
  const mechanics = input.mechanicsAssessment;
  if (!mechanics || mechanics.verdict !== "MECHANICS_VERIFIED") return false;
  const forbidden = ["productAccepted", "productSuccess", "terminal", "releaseAccepted"];
  return forbidden.every((key) => !Object.prototype.hasOwnProperty.call(mechanics, key));
}

function negativeIsIncomplete(fixture) {
  const positivePaths = new Set(Object.keys(fixture.quant.positiveControl.requiredPaths));
  return fixture.quant.negativeCandidate.expectedAbsentPaths.length > 0
    && fixture.quant.negativeCandidate.expectedAbsentPaths.every((entry) => positivePaths.has(entry));
}

function terminalAndPublicationBound(input) {
  const terminal = input.terminalAssessment;
  const release = input.releaseCandidate;
  const publication = input.publicationObservation;
  const closure = input.canonicalClosureProjection;
  return terminal?.verdict === "TERMINAL_SLICE_VERIFIED"
    && publication?.disposition === "PUBLISHED_EXACT"
    && release?.tarballDigest
    && publication.requestedTarballDigest === release.tarballDigest
    && closure?.publicationState === "PUBLISHED_EXACT"
    && closure.terminalAssessmentDigest === terminal.terminalAssessmentDigest
    && closure.releaseCandidateDigest === release.releaseCandidateDigest
    && closure.publicationObservationDigest === publication.observationDigest;
}

function executableFiles(root) {
  const files = [];
  for (const relativeRoot of ["bin", "lib"]) {
    const start = path.join(root, relativeRoot);
    if (!fs.existsSync(start)) continue;
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
      }
    };
    visit(start);
  }
  return files;
}

function certificationRetired(installedPackageRoot) {
  const retiredFile = path.join(installedPackageRoot, "lib", "semantic-kernel", "certification.js");
  if (fs.existsSync(retiredFile)) return false;
  return executableFiles(installedPackageRoot).every((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return RETIRED_EXECUTABLE_TOKENS.every((token) => !source.includes(token));
  });
}

function activeGuidanceIsDelivery(candidateRoot) {
  const contents = new Map();
  for (const relativePath of REQUIRED_GUIDANCE_PATHS) {
    const absolute = path.join(candidateRoot, ...relativePath.split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
    contents.set(relativePath, fs.readFileSync(absolute, "utf8"));
  }
  const all = [...contents.values()].join("\n");
  const stale = ["S-006M", "Meta-Harness 0.3", "Owner-signed Quant CERTIFICATION", '"version": "0.3.0"'];
  return contents.get("package.json").includes('"version": "0.4.0"')
    && all.includes("Meta-Harness 0.4")
    && all.includes("DELIVERY")
    && stale.every((token) => !all.includes(token));
}

function evaluate(input, fixture, evaluatorDigest) {
  verifyProofInput(input.proofInput, fixture);
  verifyQuantIdentities(input.quantRepositoryRoot, fixture);

  const originalAcceptanceBound = exactAcceptance(input.sliceAcceptance, fixture, evaluatorDigest);
  assert(originalAcceptanceBound, "owner-signed slice acceptance differs from the exact B0 fixture");
  const negativeRejected = negativeIsIncomplete(fixture)
    && input.negativeProbe?.verdict === "REJECTED"
    && input.negativeProbe?.evaluatorExecutableDigest === evaluatorDigest;
  const positiveAccepted = input.positiveControl?.verdict === "ACCEPTED"
    && input.positiveControl?.evaluatorExecutableDigest === evaluatorDigest;

  const outcomes = {
    D1: originalAcceptanceBound
      && input.sliceAcceptance.acceptanceSource.contentDigest === fixture.originalAcceptance.contentDigest
      && input.proofInput.weakenedDirectionDigest === fixture.weakenedDirection.digest,
    D2: mechanicsCannotClaimProduct(input),
    D3: negativeRejected && input.negativeProbe?.terminalVerdict !== "TERMINAL_SLICE_VERIFIED",
    D4: input.sliceAcceptance.proofOracle.evaluatorArtifactDigest === evaluatorDigest,
    D5: exactReviewerBindings(input, fixture),
    D6: negativeRejected && positiveAccepted,
    D7: terminalAndPublicationBound(input),
    D8: certificationRetired(input.installedPackageRoot),
    D9: input.proofInput.tarballBuildCount === 1
      && input.proofInput.preterminalPackCount === 0
      && input.proofInput.publicationPackCount === 0
      && input.proofInput.publishExistingTarballOnly === true,
    D10: activeGuidanceIsDelivery(input.candidateRoot),
  };

  return {
    schemaVersion: "proof-evaluator-output/v1",
    operatorActions: OPERATOR_FLOW.map((action, index) => ({
      sequence: index + 1,
      actionId: `action-${index + 1}`,
      action,
      observationId: `observation-${index + 1}`,
    })),
    quantitativeEvaluations: PROOF_PREDICATE_ORDER.map((predicateId) => ({
      predicateId,
      actual: outcomes[predicateId] ? 1 : 0,
      passed: outcomes[predicateId],
      evidenceDigest: sha256Bytes(canonicalBytes({
        predicateId,
        passed: outcomes[predicateId],
        fixtureDigest: fixture.fixtureDigest,
        negativeCommit: fixture.quant.negativeCandidate.commit,
        positiveCommit: fixture.quant.positiveControl.commit,
      })),
    })),
    passed: REQUIRED_PREDICATES.every((predicateId) => outcomes[predicateId] === true),
  };
}

function fixturePath() {
  return path.join(__dirname, "quant-fixture-manifest.json");
}

function runSelfTest() {
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture);
  process.stdout.write(`${JSON.stringify({ ok: true, fixtureDigest: fixture.fixtureDigest })}\n`);
}

function printAcceptance() {
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture);
  const evaluatorDigest = sha256Bytes(fs.readFileSync(__filename));
  process.stdout.write(`${JSON.stringify(makeAcceptance(fixture, evaluatorDigest))}\n`);
}

async function main() {
  if (process.argv.includes("--self-test")) return runSelfTest();
  if (process.argv.includes("--print-acceptance")) return printAcceptance();
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;
  const input = JSON.parse(body);
  assert(input.schemaVersion === "meta-harness-delivery-evaluation-input/v1", "unsupported evaluation input schema");
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture);
  const evaluatorDigest = sha256Bytes(fs.readFileSync(__filename));
  process.stdout.write(`${JSON.stringify(evaluate(input, fixture, evaluatorDigest))}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
