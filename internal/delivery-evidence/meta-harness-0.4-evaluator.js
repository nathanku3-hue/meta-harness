"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PREDICATES = Object.freeze([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7",
  "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15",
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
  assert(
    fixture.outcomeFirstFixtures.leningrad.conditionDigest
      === sha256Bytes(Buffer.from(fixture.outcomeFirstFixtures.leningrad.condition, "utf8")),
    "Leningrad condition digest mismatch",
  );
  assert(
    fixture.outcomeFirstFixtures.livePlanner.scenarioDigest
      === terminalScenarioDigest(fixture.outcomeFirstFixtures.livePlanner.scenario),
    "live planner scenario digest mismatch",
  );
  verifyContinuationFixture(fixture);
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

function exactStringArray(actual, expected) {
  return Array.isArray(actual)
    && JSON.stringify(actual) === JSON.stringify(expected);
}

function validBlockingFinding(finding, expected) {
  return finding
    && typeof finding.finding === "string"
    && typeof finding.evidenceSource === "string"
    && finding.evidenceSource.trim().length > 0
    && expected.validBlockingImpacts.includes(finding.impact)
    && !expected.nonBlockingFindings.includes(finding.finding);
}

function leningradTrialPasses(input, fixture) {
  const trial = input.leningradTrial;
  const expected = fixture.outcomeFirstFixtures.leningrad;
  return trial?.conditionDigest === expected.conditionDigest
    && Number.isInteger(trial.preExecutionAuditRepairRounds)
    && trial.preExecutionAuditRepairRounds >= 0
    && trial.preExecutionAuditRepairRounds <= expected.maxPreExecutionAuditRepairRounds
    && trial.primaryAction === expected.requiredPrimaryAction
    && Array.isArray(trial.blockingFindings)
    && trial.blockingFindings.length === 0
    && trial.blockingFindings.every((finding) => validBlockingFinding(finding, expected))
    && exactStringArray(trial.nonBlockingFindings, expected.nonBlockingFindings);
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

function normalizedPlannerResponse(value) {
  if (typeof value !== "string") return null;
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function terminalScenarioDigest(value) {
  return sha256Bytes(canonicalBytes(value));
}

function deriveTerminalPlannerClassification(observation, fixture) {
  const expected = fixture.outcomeFirstFixtures.livePlanner;
  if (!observation || typeof observation !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(observation, "responseContract")) return null;
  if (Object.prototype.hasOwnProperty.call(observation, "stopsWhenProductClosed")) return null;
  if (!canonicalBytes(observation.scenario).equals(canonicalBytes(expected.scenario))) return null;
  if (observation.scenarioDigest !== expected.scenarioDigest) return null;
  if (terminalScenarioDigest(observation.scenario) !== expected.scenarioDigest) return null;
  if (normalizedPlannerResponse(observation.response) !== expected.requiredResponse) return null;
  return { ...expected.requiredClassification };
}

function terminalPlannerResponsePasses(observation, fixture) {
  const actual = deriveTerminalPlannerClassification(observation, fixture);
  const expected = fixture.outcomeFirstFixtures.livePlanner.requiredClassification;
  return actual !== null && canonicalBytes(actual).equals(canonicalBytes(expected));
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
    && terminalPlannerResponsePasses(observation, fixture);
}

function observedUseWarrantComplete(warrant, expected) {
  if (!warrant || warrant.type !== "OBSERVED_USE_DEFECT") return false;
  const actualFields = Object.keys(warrant).filter((key) => key !== "type").sort();
  const expectedFields = [...expected.observedUseWarrantRequiredFields].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) return false;
  return expected.observedUseWarrantRequiredFields.every((field) => {
    const value = warrant[field];
    return typeof value === "string"
      && value.trim().length > 0
      && value.trim().toLowerCase() !== "unspecified";
  });
}

function noBuildContinuationResult() {
  return {
    preRoute: "NO_BUILD",
    primaryAction: "USE_PRODUCT",
    recommendedRepair: null,
    activatedSuccessorSliceCount: 0,
    newReviewCount: 0,
    newEvidenceGateCount: 0,
    ownerAuthorizationRequestCount: 0,
  };
}

function ownerScopeChangeResult() {
  return {
    preRoute: "OWNER_DECISION_REQUIRED",
    primaryAction: "REQUEST_OWNER_AUTHORIZATION",
    recommendedRepair: null,
    activatedSuccessorSliceCount: 0,
    newReviewCount: 0,
    newEvidenceGateCount: 0,
    ownerAuthorizationRequestCount: 1,
  };
}

function observedDefectResult(warrant) {
  return {
    preRoute: "BUILD_RECOMMENDED",
    primaryAction: "SELECT_SMALLEST_REPAIR",
    recommendedRepair: warrant.smallestRepair,
    activatedSuccessorSliceCount: 0,
    newReviewCount: 0,
    newEvidenceGateCount: 0,
    ownerAuthorizationRequestCount: 0,
  };
}

function terminalAuthorityState(facts) {
  return facts?.shippingState === "SHIPPED"
    || facts?.valueState === "VALUE_CONFIRMED"
    || facts?.operatingState === "MAINTENANCE"
    || facts?.activeSlice === null;
}

function deriveContinuationResult(facts, expected) {
  if (!terminalAuthorityState(facts)) return null;
  const warrant = facts.continuationWarrant;
  if (warrant && typeof warrant === "object" && warrant.type === "OWNER_SCOPE_CHANGE") {
    return ownerScopeChangeResult();
  }
  if (observedUseWarrantComplete(warrant, expected)) {
    return observedDefectResult(warrant);
  }
  return noBuildContinuationResult();
}

function expectedContinuationCaseResults(fixture) {
  const expected = fixture.outcomeFirstFixtures.continuationControl;
  return expected.cases.map((entry) => ({
    caseId: entry.caseId,
    result: deriveContinuationResult(entry.facts, expected),
  }));
}

function verifyContinuationFixture(fixture) {
  const expected = fixture.outcomeFirstFixtures.continuationControl;
  const requiredPrecedence = [
    "LOCKED_INTENT_AND_OWNER_AUTHORITY",
    "IMMUTABLE_PRODUCT_OR_CLOSURE_EVIDENCE",
    "GIT_FACTS",
    "STATUS_ROADMAP_REPORTS",
  ];
  assert(JSON.stringify(expected.truthPrecedence) === JSON.stringify(requiredPrecedence), "continuation truth precedence mismatch");
  assert(expected.scopeBoundary?.plannerDecisionOnly === true, "continuation scope must be planner-only");
  assert(expected.scopeBoundary?.successorActivationClaimed === false, "continuation scope must not claim successor activation");
  assert(Array.isArray(expected.cases) && expected.cases.length === 9, "continuation case table must contain nine cases");
  assert(new Set(expected.cases.map((entry) => entry.caseId)).size === expected.cases.length, "continuation case IDs must be unique");
  for (const entry of expected.cases) {
    const derived = deriveContinuationResult(entry.facts, expected);
    assert(derived !== null, `continuation case is not terminal: ${entry.caseId}`);
    assert(canonicalBytes(derived).equals(canonicalBytes(entry.requiredResult)), `continuation case result mismatch: ${entry.caseId}`);
    assert(derived.activatedSuccessorSliceCount === 0, `continuation case claims successor activation: ${entry.caseId}`);
    assert(derived.primaryAction !== "FOLLOW_UP_QUEUED", `continuation case queues follow-up after NO_BUILD: ${entry.caseId}`);
  }
  const valid = expected.cases.find((entry) => entry.caseId === "observed-supported-use-defect");
  const invalid = expected.cases.find((entry) => entry.caseId === "incomplete-observed-defect");
  assert(observedUseWarrantComplete(valid?.facts?.continuationWarrant, expected), "valid observed-use warrant is incomplete");
  assert(!observedUseWarrantComplete(invalid?.facts?.continuationWarrant, expected), "incomplete observed-use warrant was accepted");
}

function continuationControlPasses(input, fixture) {
  const trial = input.continuationControlTrial;
  const expected = fixture.outcomeFirstFixtures.continuationControl;
  if (!trial) return false;
  return canonicalBytes(trial.truthPrecedence).equals(canonicalBytes(expected.truthPrecedence))
    && canonicalBytes(trial.caseResults).equals(canonicalBytes(expectedContinuationCaseResults(fixture)))
    && trial.successorActivationClaimed === false
    && trial.runtimeResidue === expected.scopeBoundary.nonBlockingResidue;
}

function continuationResultById(input, caseId) {
  const rows = input.continuationControlTrial?.caseResults;
  return Array.isArray(rows) ? rows.find((entry) => entry.caseId === caseId)?.result : null;
}

function semanticDiscriminators(input, fixture, outcomes) {
  const noBuildCaseIds = fixture.outcomeFirstFixtures.continuationControl.cases
    .filter((entry) => entry.requiredResult.preRoute === "NO_BUILD")
    .map((entry) => entry.caseId);
  const noBuildResults = noBuildCaseIds.map((caseId) => continuationResultById(input, caseId));
  const staleStatus = continuationResultById(input, "stale-status-optimization");
  const validDefect = continuationResultById(input, "observed-supported-use-defect");
  const invalidDefect = continuationResultById(input, "incomplete-observed-defect");
  return {
    terminalDecisionDerivedFromScenarioAndResponse: outcomes.D14,
    noQueuedFollowUpAfterNoBuild: outcomes.D15
      && noBuildResults.every((result) => result?.preRoute === "NO_BUILD" && result?.primaryAction === "USE_PRODUCT"),
    staleStatusCannotCreateSlice: outcomes.D15
      && staleStatus?.preRoute === "NO_BUILD"
      && staleStatus?.activatedSuccessorSliceCount === 0,
    invalidObservedDefectWarrantRejected: outcomes.D15
      && validDefect?.primaryAction === "SELECT_SMALLEST_REPAIR"
      && invalidDefect?.preRoute === "NO_BUILD",
    optionalFindingsRemainNonBlocking: outcomes.D11
      && input.leningradTrial?.blockingFindings?.length === 0,
    successorActivationNotClaimed: outcomes.D15
      && input.continuationControlTrial?.successorActivationClaimed === false,
  };
}

function evaluate(input, fixture, evaluatorDigest) {
  verifyProofInput(input.proofInput, fixture);

  const originalAcceptanceBound = exactAcceptance(input.sliceAcceptance, fixture, evaluatorDigest);
  assert(originalAcceptanceBound, "owner-signed slice acceptance differs from the exact B1R2 fixture");
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
    D15: continuationControlPasses(input, fixture),
  };

  return {
    schemaVersion: "proof-evaluator-output/v1",
    semanticDiscriminators: semanticDiscriminators(input, fixture, outcomes),
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
  const leningrad = fixture.outcomeFirstFixtures.leningrad;
  const negativeLeningrad = {
    conditionDigest: leningrad.conditionDigest,
    preExecutionAuditRepairRounds: 1,
    primaryAction: leningrad.rejectedOldPlannerAction,
    blockingFindings: [],
    nonBlockingFindings: leningrad.nonBlockingFindings,
  };
  const optionalBlockerLeningrad = {
    conditionDigest: leningrad.conditionDigest,
    preExecutionAuditRepairRounds: 1,
    primaryAction: leningrad.requiredPrimaryAction,
    blockingFindings: [{
      finding: "reviewer preference",
      impact: "JOURNEY_PREVENTION",
      evidenceSource: "review comment",
    }],
    nonBlockingFindings: leningrad.nonBlockingFindings,
  };
  const positiveLeningrad = {
    conditionDigest: leningrad.conditionDigest,
    preExecutionAuditRepairRounds: 1,
    primaryAction: leningrad.requiredPrimaryAction,
    blockingFindings: [],
    nonBlockingFindings: leningrad.nonBlockingFindings,
  };
  const positiveQuant = {
    conditionDigest: fixture.outcomeFirstFixtures.quant.conditionDigest,
    primaryAction: fixture.outcomeFirstFixtures.quant.requiredPrimaryAction,
    additionalBlockingGates: [],
    reusesUnaffectedEvidence: true,
    reopenedPassedGateCount: 0,
  };
  const livePlanner = fixture.outcomeFirstFixtures.livePlanner;
  const positiveTerminalObservation = {
    scenario: livePlanner.scenario,
    scenarioDigest: livePlanner.scenarioDigest,
    response: livePlanner.requiredResponse,
  };
  const booleanOnlyTerminalObservation = {
    scenario: livePlanner.scenario,
    scenarioDigest: livePlanner.scenarioDigest,
    response: "Open an optimization slice.",
    responseContract: { stopsWhenProductClosed: true },
  };
  const continuation = fixture.outcomeFirstFixtures.continuationControl;
  const positiveContinuationTrial = {
    truthPrecedence: continuation.truthPrecedence,
    caseResults: expectedContinuationCaseResults(fixture),
    successorActivationClaimed: false,
    runtimeResidue: continuation.scopeBoundary.nonBlockingResidue,
  };
  const queuedContinuationTrial = JSON.parse(JSON.stringify(positiveContinuationTrial));
  queuedContinuationTrial.caseResults.find((entry) => entry.caseId === "terminal-no-warrant").result.primaryAction = "FOLLOW_UP_QUEUED";

  assert(!leningradTrialPasses({ leningradTrial: negativeLeningrad }, fixture), "old planner fixture was not rejected");
  assert(!leningradTrialPasses({ leningradTrial: optionalBlockerLeningrad }, fixture), "optional finding was accepted as a blocker");
  assert(leningradTrialPasses({ leningradTrial: positiveLeningrad }, fixture), "outcome-first Leningrad fixture failed");
  for (const impact of leningrad.validBlockingImpacts) {
    assert(validBlockingFinding({
      finding: `demonstrated ${impact}`,
      impact,
      evidenceSource: "retained product evidence",
    }, leningrad), `valid blocker impact was rejected: ${impact}`);
  }
  assert(quantTrialPasses({ quantTrial: positiveQuant }, fixture), "outcome-first Quant fixture failed");
  assert(JSON.stringify(fixture.outcomeFirstFixtures.workerReport.leadingFields) === JSON.stringify([
    "User journey executed",
    "Observable result produced",
    "User accomplished or learned",
    "Product blocker",
    "Next executable product action",
  ]), "worker-report leading fields drifted");
  assert(terminalPlannerResponsePasses(positiveTerminalObservation, fixture), "terminal planner response fixture failed");
  assert(!terminalPlannerResponsePasses(booleanOnlyTerminalObservation, fixture), "boolean-only terminal assertion was accepted");
  assert(continuationControlPasses({ continuationControlTrial: positiveContinuationTrial }, fixture), "continuation control table failed");
  assert(!continuationControlPasses({ continuationControlTrial: queuedContinuationTrial }, fixture), "queued follow-up after NO_BUILD was accepted");
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
    optionalBlockerRejected: true,
    booleanOnlyTerminalRejected: true,
    continuationTableAccepted: true,
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
