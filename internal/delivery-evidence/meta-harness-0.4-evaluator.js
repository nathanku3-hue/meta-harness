"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PREDICATES = Object.freeze([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7",
  "D8", "D9", "D10", "D11", "D12", "D13", "D14",
]);
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
    outcomeFirstFixtures: value.outcomeFirstFixtures,
  }));
}

function outcomeFirstFixtureDigest(value) {
  return sha256Bytes(canonicalBytes(value.outcomeFirstFixtures));
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

function verifyFixture(fixture, { verifyRepositoryPrograms = false } = {}) {
  assert(fixture.schemaVersion === "meta-harness-delivery-fixture-manifest/v1", "unsupported fixture manifest schema");
  assert(fixture.fixtureDigest === fixtureDigest(fixture), "fixture manifest digest mismatch");
  assert(fixture.fixtureMaterialDigest === fixtureMaterialDigest(fixture), "fixture material digest mismatch");
  assert(fixture.outcomeFirstFixtureDigest === outcomeFirstFixtureDigest(fixture), "outcome-first fixture digest mismatch");
  assert(JSON.stringify(fixture.proofPredicateOrder) === JSON.stringify(PROOF_PREDICATE_ORDER), "fixture predicate order mismatch");
  assert(REQUIRED_PREDICATES.every((id) => typeof fixture.predicates[id] === "string"), "fixture predicates incomplete");
  assert(fixture.proofInputPolicyDigest === sha256Bytes(canonicalBytes(fixture.proofInputSchema)), "proof input policy digest mismatch");
  assert(fixture.observationSchemaDigest === sha256Bytes(canonicalBytes(fixture.observationSchema)), "observation schema digest mismatch");
  if (verifyRepositoryPrograms) {
    for (const program of Object.values(fixture.programs)) {
      const absolute = path.join(__dirname, path.basename(program.path));
      assert(fs.existsSync(absolute), `missing program: ${program.path}`);
      assert(sha256Bytes(fs.readFileSync(absolute)) === program.digest, `program digest mismatch: ${program.path}`);
    }
  }
}

function verifyProofInput(proofInput, fixture) {
  assert(proofInput && proofInput.schemaVersion === "meta-harness-delivery-proof-input/v1", "unsupported proof input schema");
  assert(proofInput.fixtureDigest === fixture.fixtureDigest, "proof fixture digest mismatch");
  assert(proofInput.outcomeFirstFixtureDigest === fixture.outcomeFirstFixtureDigest, "proof outcome-first fixture digest mismatch");
  assert(proofInput.negativeCommit === fixture.quant.negativeCandidate.commit, "negative commit input mismatch");
  assert(proofInput.negativeTree === fixture.quant.negativeCandidate.tree, "negative tree input mismatch");
  assert(proofInput.positiveCommit === fixture.quant.positiveControl.commit, "positive commit input mismatch");
  assert(proofInput.positiveTree === fixture.quant.positiveControl.tree, "positive tree input mismatch");
}

function exactAcceptance(actual, fixture, evaluatorDigest) {
  return canonicalBytes(actual).equals(canonicalBytes(makeAcceptance(fixture, evaluatorDigest)));
}

function exactReviewerBindings(input, fixture) {
  const actual = input.proofInput?.reviewerBindings;
  const expected = fixture.outcomeFirstFixtures.reviewerBindings;
  return canonicalBytes(actual).equals(canonicalBytes(expected));
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

function closurePolicyPasses(input, fixture) {
  return canonicalBytes(input.proofInput?.closurePolicy)
    .equals(canonicalBytes(fixture.outcomeFirstFixtures.closurePolicy));
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
    && all.includes("outcome-first")
    && stale.every((token) => !all.includes(token));
}

function exactDecisionTrial(trial, expected) {
  return trial?.conditionDigest === expected.conditionDigest
    && trial?.primaryAction === expected.requiredPrimaryAction
    && Array.isArray(trial?.additionalBlockingGates)
    && trial.additionalBlockingGates.length === 0;
}

function leningradTrialPasses(input, fixture) {
  return exactDecisionTrial(input.leningradTrial, fixture.outcomeFirstFixtures.leningrad);
}

function quantTrialPasses(input, fixture) {
  return exactDecisionTrial(input.quantTrial, fixture.outcomeFirstFixtures.quant)
    && input.quantTrial.reusesUnaffectedEvidence === true
    && input.quantTrial.reopenedPassedGateCount === 0;
}

function normalizedRelativePath(relativePath, label) {
  assert(typeof relativePath === "string" && relativePath.length > 0, `${label} must be non-empty`);
  assert(!relativePath.startsWith("/") && !relativePath.includes("\\"), `${label} must be repository-relative`);
  assert(relativePath.split("/").every((part) => part && part !== "." && part !== ".."), `${label} is not normalized`);
  return relativePath;
}

function readBoundRegularFile(root, relativePath, label) {
  const normalized = normalizedRelativePath(relativePath, label);
  const realRoot = fs.realpathSync(root);
  const absolute = path.resolve(realRoot, ...normalized.split("/"));
  const stat = fs.lstatSync(absolute);
  const real = fs.realpathSync(absolute);
  const contained = path.relative(realRoot, real);
  assert(contained !== ".." && !contained.startsWith(`..${path.sep}`) && !path.isAbsolute(contained), `${label} escapes root`);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  return fs.readFileSync(real);
}

function reportLeadingFields(reportText) {
  return reportText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 5)
    .map((line) => line.split(":", 1)[0].trim());
}

function workerReportTrialPasses(input, fixture) {
  const trial = input.workerReportTrial;
  if (!trial || typeof trial.reportText !== "string") return false;
  if (trial.packageTarballDigest !== input.releaseCandidate?.tarballDigest) return false;
  if (JSON.stringify(trial.commandSequence) !== JSON.stringify(fixture.outcomeFirstFixtures.workerReport.commandSequence)) return false;
  if (JSON.stringify(trial.exitCodes) !== JSON.stringify([0, 0])) return false;
  const reportBytes = Buffer.from(trial.reportText, "utf8");
  const leading = reportLeadingFields(trial.reportText);
  const expected = fixture.outcomeFirstFixtures.workerReport.leadingFields;
  const nonEmptyLines = trial.reportText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const outcomeIndex = nonEmptyLines.findIndex((line) => line.startsWith("Outcome:"));
  return trial.reportDigest === sha256Bytes(reportBytes)
    && JSON.stringify(leading) === JSON.stringify(expected)
    && outcomeIndex >= expected.length;
}

function validExactTimestamp(value) {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

function liveResponseContractPasses(observation, fixture) {
  const expected = fixture.outcomeFirstFixtures.livePlanner.requiredResponseContract;
  const actual = observation?.responseContract;
  return actual?.leadsWithProductResult === expected.leadsWithProductResult
    && actual?.executableActionCount === expected.executableActionCount
    && actual?.unsupportedGateCount === expected.unsupportedGateCount
    && actual?.newScoreOrEvidenceCategoryCount === expected.newScoreOrEvidenceCategoryCount
    && actual?.reusedUnaffectedEvidence === expected.reusedUnaffectedEvidence
    && actual?.stopsWhenProductClosed === expected.stopsWhenProductClosed;
}

function sourceTemplatePath(installedPath) {
  const prefix = ".meta-harness/";
  assert(installedPath.startsWith(prefix), `installed template path must begin with ${prefix}`);
  return installedPath.slice(prefix.length);
}

function observedTemplateHashesMatch(input, observed, requiredPaths) {
  if (!observed || typeof observed !== "object") return false;
  const observedPaths = Object.keys(observed).sort();
  if (JSON.stringify(observedPaths) !== JSON.stringify([...requiredPaths].sort())) return false;
  try {
    return requiredPaths.every((installedPath) => {
      const sourcePath = sourceTemplatePath(installedPath);
      const sourceDigest = sha256Bytes(readBoundRegularFile(input.candidateRoot, sourcePath, `source template ${sourcePath}`));
      const candidateInstalledDigest = sha256Bytes(readBoundRegularFile(input.candidateRoot, installedPath, `candidate installed template ${installedPath}`));
      const packageDigest = sha256Bytes(readBoundRegularFile(input.installedPackageRoot, sourcePath, `packaged template ${sourcePath}`));
      return observed[installedPath] === sourceDigest
        && candidateInstalledDigest === sourceDigest
        && packageDigest === sourceDigest;
    });
  } catch {
    return false;
  }
}

function livePlannerObservationPasses(input, fixture) {
  const observation = input.livePlannerObservation;
  if (!observation || !input.candidateRoot || !input.installedPackageRoot) return false;
  if (observation.classification !== fixture.outcomeFirstFixtures.livePlanner.classification) return false;
  if (observation.prompt !== fixture.outcomeFirstFixtures.livePlanner.prompt) return false;
  if (typeof observation.response !== "string" || !observation.response.trim()) return false;
  try {
    if (!validExactTimestamp(observation.freshSessionStartedAt) || !validExactTimestamp(observation.observedAt)) return false;
  } catch {
    return false;
  }
  if (Date.parse(observation.observedAt) < Date.parse(observation.freshSessionStartedAt)) return false;
  if (observation.tarballDigest !== input.releaseCandidate?.tarballDigest) return false;
  try {
    if (observation.candidateCommit !== input.integratedCandidate?.finalHeadRevision) return false;
    const agentsBytes = readBoundRegularFile(input.candidateRoot, "AGENTS.md", "root AGENTS.md");
    if (observation.agentsDigest !== sha256Bytes(agentsBytes)) return false;
  } catch {
    return false;
  }
  return observation.syncCheck?.command === "meta-harness sync check"
    && observation.syncCheck?.ok === true
    && observedTemplateHashesMatch(
      input,
      observation.installedTemplateHashes,
      fixture.outcomeFirstFixtures.livePlanner.requiredTemplatePaths,
    )
    && liveResponseContractPasses(observation, fixture);
}

function evaluate(input, fixture, evaluatorDigest) {
  verifyProofInput(input.proofInput, fixture);

  const originalAcceptanceBound = exactAcceptance(input.sliceAcceptance, fixture, evaluatorDigest);
  assert(originalAcceptanceBound, "owner-signed slice acceptance differs from the exact B1R1 fixture");
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
    D7: closurePolicyPasses(input, fixture),
    D8: certificationRetired(input.installedPackageRoot),
    D9: input.proofInput.tarballBuildCount === 1
      && input.proofInput.preterminalPackCount === 0
      && input.proofInput.publicationPackCount === 0
      && input.proofInput.publishExistingTarballOnly === true,
    D10: activeGuidanceIsDelivery(input.candidateRoot),
    D11: leningradTrialPasses(input, fixture),
    D12: quantTrialPasses(input, fixture),
    D13: workerReportTrialPasses(input, fixture),
    D14: livePlannerObservationPasses(input, fixture),
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
  };
}

function fixturePath() {
  return path.join(__dirname, "quant-fixture-manifest.json");
}

function runSelfTest() {
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture, { verifyRepositoryPrograms: true });
  const negativeLeningrad = {
    conditionDigest: fixture.outcomeFirstFixtures.leningrad.conditionDigest,
    primaryAction: fixture.outcomeFirstFixtures.leningrad.rejectedOldPlannerAction,
    additionalBlockingGates: ["another receipt"],
  };
  const positiveLeningrad = {
    conditionDigest: fixture.outcomeFirstFixtures.leningrad.conditionDigest,
    primaryAction: fixture.outcomeFirstFixtures.leningrad.requiredPrimaryAction,
    additionalBlockingGates: [],
  };
  const positiveQuant = {
    conditionDigest: fixture.outcomeFirstFixtures.quant.conditionDigest,
    primaryAction: fixture.outcomeFirstFixtures.quant.requiredPrimaryAction,
    additionalBlockingGates: [],
    reusesUnaffectedEvidence: true,
    reopenedPassedGateCount: 0,
  };
  assert(!exactDecisionTrial(negativeLeningrad, fixture.outcomeFirstFixtures.leningrad), "old planner fixture was not rejected");
  assert(exactDecisionTrial(positiveLeningrad, fixture.outcomeFirstFixtures.leningrad), "outcome-first Leningrad fixture failed");
  assert(quantTrialPasses({ quantTrial: positiveQuant }, fixture), "outcome-first Quant fixture failed");
  assert(JSON.stringify(fixture.outcomeFirstFixtures.workerReport.leadingFields) === JSON.stringify([
    "User journey executed",
    "Observable result produced",
    "User accomplished or learned",
    "Product blocker",
    "Next executable product action",
  ]), "worker-report leading fields drifted");
  assert(liveResponseContractPasses({
    responseContract: fixture.outcomeFirstFixtures.livePlanner.requiredResponseContract,
  }, fixture), "live response contract fixture failed");
  assert(exactReviewerBindings({
    proofInput: { reviewerBindings: fixture.outcomeFirstFixtures.reviewerBindings },
  }, fixture), "reviewer binding fixture failed");
  assert(closurePolicyPasses({
    proofInput: { closurePolicy: fixture.outcomeFirstFixtures.closurePolicy },
  }, fixture), "closure policy fixture failed");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    fixtureDigest: fixture.fixtureDigest,
    predicates: PROOF_PREDICATE_ORDER,
    oldPlannerRejected: true,
    outcomeFirstFixturesAccepted: true,
  })}\n`);
}

function printAcceptance() {
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture, { verifyRepositoryPrograms: true });
  const evaluatorDigest = sha256Bytes(fs.readFileSync(__filename));
  process.stdout.write(`${JSON.stringify(makeAcceptance(fixture, evaluatorDigest))}\n`);
}

function resolveInstalledPackageRoot(installRoot) {
  const packageRoot = path.join(installRoot, "node_modules", "@nkgss", "meta-harness");
  const stat = fs.lstatSync(packageRoot);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "installed package root must be a regular directory");
  return fs.realpathSync(packageRoot);
}

async function main() {
  if (process.argv.includes("--self-test")) return runSelfTest();
  if (process.argv.includes("--print-acceptance")) return printAcceptance();
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;
  const envelope = JSON.parse(body);
  const evaluatorDigest = sha256Bytes(fs.readFileSync(__filename));

  if (envelope.schemaVersion === "proof-evaluator-input/v1") {
    const fixture = readJson(envelope.fixturePath, "staged fixture manifest");
    const proofInput = readJson(envelope.inputPath, "staged proof input");
    verifyFixture(fixture);
    const input = {
      ...proofInput,
      proofInput,
      sliceAcceptance: envelope.sliceAcceptance,
      integratedCandidate: envelope.integratedCandidate,
      packageCandidate: envelope.packageCandidate,
      releaseCandidate: envelope.releaseCandidate,
      candidateRoot: envelope.candidateRoot,
      installedPackageRoot: resolveInstalledPackageRoot(envelope.installedRoot),
    };
    process.stdout.write(`${JSON.stringify(evaluate(input, fixture, evaluatorDigest))}\n`);
    return;
  }

  assert(envelope.schemaVersion === "meta-harness-delivery-evaluation-input/v1", "unsupported evaluation input schema");
  const fixture = readJson(fixturePath(), "fixture manifest");
  verifyFixture(fixture, { verifyRepositoryPrograms: true });
  process.stdout.write(`${JSON.stringify(evaluate(envelope, fixture, evaluatorDigest))}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
