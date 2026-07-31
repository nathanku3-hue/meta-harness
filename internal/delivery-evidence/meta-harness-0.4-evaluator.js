"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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

function digest(label) {
  return sha256Bytes(Buffer.from(String(label), "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
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

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable canonical JSON: ${error.message}`);
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedFailure(fn, acceptedCodes) {
  try {
    fn();
    return false;
  } catch (error) {
    return acceptedCodes.includes(error?.code);
  }
}

function packagePath(installedRoot, packageName) {
  return path.join(installedRoot, "node_modules", ...packageName.split("/"));
}

function loadKernel(manifest) {
  const root = packagePath(manifest.installedRoot, manifest.packageCandidate.packageName);
  const load = (relativePath) => require(path.join(root, relativePath));
  return {
    root,
    domainDigest: load("lib/contracts/digest.js").domainDigest,
    slice: load("lib/semantic-kernel/slice-authorization.js"),
    runSpec: load("lib/semantic-kernel/run-spec-v2.js"),
    mechanics: load("lib/semantic-kernel/mechanics-assessment.js"),
    integrated: load("lib/semantic-kernel/integrated-candidate.js"),
    release: load("lib/semantic-kernel/release-candidate.js"),
    proof: load("lib/semantic-kernel/black-box-proof.js"),
    review: load("lib/semantic-kernel/reviewer-assessment.js"),
    terminal: load("lib/semantic-kernel/terminal-slice-assessment.js"),
    publication: load("lib/semantic-kernel/publication.js"),
  };
}

function makeAcceptance(fixture, selfDigest) {
  return {
    intent: {
      version: "meta-harness-0.4-delivery-intent/v1",
      digest: fixture.intentDigest,
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
      evaluatorArtifactDigest: selfDigest,
      evaluatorPackageDigest: null,
      predicateIds: [...PROOF_PREDICATE_ORDER],
      inputPolicyDigest: fixture.proofInputPolicyDigest,
      observationSchemaDigest: fixture.observationSchemaDigest,
    },
  };
}

function makeAuthorization(kernel, fixture, acceptance) {
  const body = {
    schemaVersion: "slice-authorization/v1",
    repositoryId: digest("meta-harness-repository-fixture"),
    sliceId: "S-SEMANTIC-KERNEL-1",
    initialBaseRevision: fixture.quant.negativeCandidate.parentRevision,
    sliceMode: "DELIVERY",
    authorityExecutionPlatform: "linux",
    sliceAcceptance: acceptance,
    controllerBinding: {
      controllerProgramDigest: digest("meta-harness-controller-program"),
      controllerPolicyDigest: digest("meta-harness-controller-policy"),
      launcherDigest: digest("meta-harness-controller-launcher"),
      custodyRootPolicyDigest: digest("meta-harness-global-custody-root-policy"),
      clockPolicyDigest: digest("meta-harness-system-clock-policy"),
      allowedCapabilities: [
        "CANONICAL_PROJECT",
        "INTEGRATE",
        "MECHANICS_ASSESS",
        "PACKAGE_FREEZE",
        "PROOF_EXECUTE",
        "REVIEW_ORCHESTRATE",
        "RUN_SPEC_SEAL",
        "SLICE_ACTIVATE",
        "TERMINAL_ASSESS",
      ],
    },
    reviewPolicy: {
      product: {
        executableIdentity: "internal/delivery-evidence/product-reviewer.js",
        executableDigest: fixture.programs.productReviewer.digest,
        policyDigest: digest("product-review-policy"),
        environmentPolicyDigest: digest("product-review-environment"),
        networkPolicy: "none",
      },
      domain: {
        executableIdentity: "internal/delivery-evidence/domain-reviewer.js",
        executableDigest: fixture.programs.domainReviewer.digest,
        policyDigest: digest("domain-review-policy"),
        environmentPolicyDigest: digest("domain-review-environment"),
        networkPolicy: "none",
      },
      custody: {
        executableIdentity: "internal/delivery-evidence/custody-reviewer.js",
        executableDigest: fixture.programs.custodyReviewer.digest,
        policyDigest: digest("custody-review-policy"),
        environmentPolicyDigest: digest("custody-review-environment"),
        networkPolicy: "none",
      },
    },
    executionLimits: {
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-02T00:00:00.000Z",
      mustCompleteBy: "2099-01-01T00:00:00.000Z",
      maxAttempts: 2,
      maxRunSpecs: 2,
      aggregatePathBoundary: [".meta-harness", "README.md", "bin", "docs", "implementation_plan.md", "lib", "package-lock.json", "package.json", "task.md", "templates", "tests"],
      allowedWorkerProfiles: ["meta-harness-delivery-worker"],
    },
    publicationPolicy: {
      packageName: "@nkgss/meta-harness",
      version: "0.4.0",
      registry: "https://registry.npmjs.org/",
      access: "public",
      distTag: "latest",
      gitTag: "v0.4.0",
      provenanceRequired: true,
      publishExactTerminalTarballOnly: true,
      maxPublicationAttempts: 1,
      publishBy: "2099-01-02T00:00:00.000Z",
      canonicalUpdatePolicyDigest: digest("meta-harness-canonical-update-policy"),
    },
    ownerKeyId: digest("fixture-owner-key"),
    authorizationDigest: "pending",
    ownerSignature: "fixture-only-not-an-owner-signature",
  };
  body.authorizationDigest = kernel.slice.computeSliceAuthorizationDigest(body);
  return body;
}

function makeRunSpec(kernel, authorization, fixtureRecord, suffix) {
  const commandBody = {
    argv: ["node", "--test", "tests/semantic-kernel-contract-chain.test.js"],
    cwd: ".",
    timeoutSeconds: 600,
    network: "none",
  };
  const commandId = kernel.domainDigest("meta-harness-run-spec-command/v2", commandBody);
  const draft = {
    schemaVersion: "run-spec/v2",
    runId: `RUN-${suffix}`,
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    repository: {
      repositoryId: authorization.repositoryId,
      expectedParentRevision: authorization.initialBaseRevision,
      objectFormat: "sha1",
    },
    workerProfile: "meta-harness-delivery-worker",
    mechanicalTask: {
      acceptanceClauseIds: [...PROOF_PREDICATE_ORDER],
      targetPaths: ["lib/semantic-kernel/slice-authorization.js"],
      operation: "modify",
      expectedArtifactKind: "source",
      validationIds: [commandId],
    },
    validation: {
      commands: [{ commandId, ...commandBody }],
    },
    changePolicy: {
      maxFiles: 1,
      allowDeletes: false,
      allowRenames: false,
    },
    workerGuidance: fixtureRecord.workerDirection,
    runSpecDigest: "pending",
  };
  draft.runSpecDigest = kernel.runSpec.computeRunSpecDigest(draft);
  return draft;
}

function makeMechanics(kernel, authorization, runSpec, fixtureRecord, suffix) {
  const draft = {
    schemaVersion: "mechanics-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    runSpecDigest: runSpec.runSpecDigest,
    repositoryId: authorization.repositoryId,
    parentRevision: authorization.initialBaseRevision,
    contributedRevision: fixtureRecord.commit,
    resultingTree: fixtureRecord.tree,
    changedPaths: [...runSpec.mechanicalTask.targetPaths],
    validationResults: [{
      commandId: runSpec.validation.commands[0].commandId,
      exitStatus: 0,
      timedOut: false,
      networkUsed: false,
      stdoutDigest: digest(`${suffix}-validation-stdout`),
      stderrDigest: digest(`${suffix}-validation-stderr`),
      startedAt: "2026-08-01T01:00:00.000Z",
      finishedAt: "2026-08-01T01:00:10.000Z",
    }],
    cleanStateProof: {
      statusPorcelainDigest: sha256Bytes(Buffer.alloc(0)),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-08-01T01:00:11.000Z",
    },
    assessedAt: "2026-08-01T01:00:12.000Z",
    verdict: "MECHANICS_VERIFIED",
    assessmentDigest: "pending",
  };
  draft.assessmentDigest = kernel.mechanics.computeMechanicsAssessmentDigest(draft);
  return draft;
}

function makeIntegrated(kernel, authorization, runSpec, mechanics) {
  const draft = {
    schemaVersion: "integrated-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    repositoryId: authorization.repositoryId,
    initialBaseRevision: authorization.initialBaseRevision,
    contributions: [{
      order: 1,
      runSpecDigest: runSpec.runSpecDigest,
      mechanicsAssessmentDigest: mechanics.assessmentDigest,
      parentRevision: mechanics.parentRevision,
      contributedRevision: mechanics.contributedRevision,
      operation: "fast-forward",
      resultingRevision: mechanics.contributedRevision,
      resultingTree: mechanics.resultingTree,
      changedPaths: mechanics.changedPaths,
    }],
    integrationControllerBindingDigest: kernel.domainDigest("meta-harness-controller-binding/v1", authorization.controllerBinding),
    changedPathUnion: mechanics.changedPaths,
    rejectedAttempts: [],
    supersededAttempts: [],
    finalHeadRevision: mechanics.contributedRevision,
    finalTreeDigest: mechanics.resultingTree,
    cleanStateProof: {
      statusPorcelainDigest: sha256Bytes(Buffer.alloc(0)),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-08-01T01:05:00.000Z",
    },
    integratedAt: "2026-08-01T01:05:01.000Z",
    candidateDigest: "pending",
  };
  draft.candidateDigest = kernel.integrated.computeIntegratedCandidateDigest(draft);
  return draft;
}

function makePackageAndRelease(kernel, authorization, integrated, suffix) {
  const tarballBytes = Buffer.from(`fixture-tarball-${suffix}`, "utf8");
  const tarballIntegrity = `sha512-${crypto.createHash("sha512").update(tarballBytes).digest("base64")}`;
  const packageCandidate = {
    schemaVersion: "package-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    integratedCandidateDigest: integrated.candidateDigest,
    candidateHead: integrated.finalHeadRevision,
    candidateTree: integrated.finalTreeDigest,
    tarballDigest: sha256Bytes(tarballBytes),
    tarballIntegrity,
    tarballByteLength: tarballBytes.length,
    packlistDigest: digest(`${suffix}-packlist`),
    packageMetadataDigest: digest(`${suffix}-package-metadata`),
    packageName: authorization.publicationPolicy.packageName,
    version: authorization.publicationPolicy.version,
    builtAt: "2026-08-01T01:10:00.000Z",
    builderProgramDigest: digest("exact-package-builder"),
    packageCandidateDigest: "pending",
  };
  packageCandidate.packageCandidateDigest = kernel.release.computePackageCandidateDigest(packageCandidate);
  const releaseCandidate = {
    schemaVersion: "release-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    tarballDigest: packageCandidate.tarballDigest,
    tarballIntegrity,
    packageName: authorization.publicationPolicy.packageName,
    version: authorization.publicationPolicy.version,
    registry: authorization.publicationPolicy.registry,
    access: authorization.publicationPolicy.access,
    distTag: authorization.publicationPolicy.distTag,
    gitTag: authorization.publicationPolicy.gitTag,
    gitTagTargetRevision: integrated.finalHeadRevision,
    provenanceRequired: authorization.publicationPolicy.provenanceRequired,
    canonicalUpdatePolicyDigest: authorization.publicationPolicy.canonicalUpdatePolicyDigest,
    releaseCandidateDigest: "pending",
  };
  releaseCandidate.releaseCandidateDigest = kernel.release.computeReleaseCandidateDigest(releaseCandidate);
  return { packageCandidate, releaseCandidate };
}

function makeProof(kernel, authorization, integrated, packageCandidate, releaseCandidate, values = {}) {
  const draft = {
    schemaVersion: "black-box-proof/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    executionSurface: {
      type: "installed-package",
      tarballDigest: packageCandidate.tarballDigest,
      installationIdentity: "fixture-isolated-install",
      freshEnvironmentProofDigest: digest("fixture-fresh-environment"),
    },
    operatorActions: OPERATOR_FLOW.map((action, index) => ({
      sequence: index + 1,
      actionId: `action-${index + 1}`,
      action,
      observationId: `observation-${index + 1}`,
    })),
    inputIdentityDigest: digest("fixture-proof-input"),
    fixtureIdentityDigest: digest("fixture-manifest"),
    observationTranscriptDigest: digest("fixture-observation-transcript"),
    exitStatus: 0,
    quantitativeEvaluations: PROOF_PREDICATE_ORDER.map((predicateId) => ({
      predicateId,
      actual: values[predicateId] ?? 1,
      passed: (values[predicateId] ?? 1) === 1,
      evidenceDigest: digest(`proof-${predicateId}-${values[predicateId] ?? 1}`),
    })),
    proofOracleDigest: kernel.proof.computeProofOracleDigest(authorization.sliceAcceptance.proofOracle),
    evaluatorExecutableDigest: authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
    evaluatorPackageDigest: null,
    noImplementationWorkerExpectedOutput: true,
    executedAt: "2026-08-01T01:20:00.000Z",
    proofDigest: "pending",
  };
  draft.proofDigest = kernel.proof.computeBlackBoxProofDigest(draft);
  return draft;
}

function makeReview(kernel, role, authorization, integrated, packageCandidate, releaseCandidate, proof) {
  const policyKey = { PRODUCT: "product", DOMAIN: "domain", CUSTODY: "custody" }[role];
  const policy = authorization.reviewPolicy[policyKey];
  const draft = {
    schemaVersion: "reviewer-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    role,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: proof.proofDigest,
    processId: `reviewer-${policyKey}-fixture-process`,
    processExecutableDigest: policy.executableDigest,
    rolePolicyDigest: policy.policyDigest,
    environmentPolicyDigest: policy.environmentPolicyDigest,
    networkPolicy: policy.networkPolicy,
    inputManifestDigest: "pending",
    readOnlyCandidateAccess: true,
    implementationProcessReuse: false,
    previousReviewerOutputsVisible: false,
    result: "PASS",
    findingsDigest: digest(`${policyKey}-review-findings`),
    reviewedAt: "2026-08-01T01:30:00.000Z",
    assessmentDigest: "pending",
  };
  draft.inputManifestDigest = kernel.review.computeReviewInputManifestDigest({
    role,
    sliceAcceptanceDigest: draft.sliceAcceptanceDigest,
    integratedCandidateDigest: draft.integratedCandidateDigest,
    packageCandidateDigest: draft.packageCandidateDigest,
    releaseCandidateDigest: draft.releaseCandidateDigest,
    blackBoxProofDigest: draft.blackBoxProofDigest,
    executableDigest: draft.processExecutableDigest,
    policyDigest: draft.rolePolicyDigest,
    environmentPolicyDigest: draft.environmentPolicyDigest,
    networkPolicy: draft.networkPolicy,
  });
  draft.assessmentDigest = kernel.review.computeReviewerAssessmentDigest(draft);
  return draft;
}

function makeTerminal(kernel, authorization, integrated, packageCandidate, releaseCandidate, proof, reviews) {
  const byRole = Object.fromEntries(reviews.map((review) => [review.role, review]));
  const draft = {
    schemaVersion: "terminal-slice-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: proof.proofDigest,
    productReviewDigest: byRole.PRODUCT.assessmentDigest,
    domainReviewDigest: byRole.DOMAIN.assessmentDigest,
    custodyReviewDigest: byRole.CUSTODY.assessmentDigest,
    controllerBindingDigest: kernel.domainDigest("meta-harness-controller-binding/v1", authorization.controllerBinding),
    assessedAt: "2026-08-01T01:40:00.000Z",
    verdict: "TERMINAL_SLICE_VERIFIED",
    terminalAssessmentDigest: "pending",
  };
  draft.terminalAssessmentDigest = kernel.terminal.computeTerminalSliceAssessmentDigest(draft);
  return draft;
}

function validatePositiveChain(kernel, fixture, authorization) {
  const runSpec = makeRunSpec(kernel, authorization, fixture.quant.positiveControl, "POSITIVE");
  const mechanics = makeMechanics(kernel, authorization, runSpec, fixture.quant.positiveControl, "positive");
  const integrated = makeIntegrated(kernel, authorization, runSpec, mechanics);
  const { packageCandidate, releaseCandidate } = makePackageAndRelease(kernel, authorization, integrated, "positive");
  const proof = makeProof(kernel, authorization, integrated, packageCandidate, releaseCandidate);
  const reviews = ["PRODUCT", "DOMAIN", "CUSTODY"].map((role) => (
    makeReview(kernel, role, authorization, integrated, packageCandidate, releaseCandidate, proof)
  ));
  const terminal = makeTerminal(kernel, authorization, integrated, packageCandidate, releaseCandidate, proof, reviews);

  const validatedRunSpec = kernel.runSpec.validateRunSpec(runSpec, authorization, {
    expectedParentRevision: authorization.initialBaseRevision,
    generation: 1,
    nowUtc: "2026-08-01T00:30:00.000Z",
  });
  const validatedMechanics = kernel.mechanics.validateMechanicsAssessment(mechanics, validatedRunSpec, authorization, {
    expectedContributedRevision: fixture.quant.positiveControl.commit,
    expectedTree: fixture.quant.positiveControl.tree,
  });
  const validatedIntegrated = kernel.integrated.validateIntegratedCandidate(
    integrated,
    authorization,
    new Map([[validatedMechanics.assessmentDigest, validatedMechanics]]),
    { generation: 1, recomputedFinalTree: fixture.quant.positiveControl.tree },
  );
  const validatedPackage = kernel.release.validatePackageCandidate(packageCandidate, validatedIntegrated, authorization, {
    observedTarballDigest: packageCandidate.tarballDigest,
    observedTarballByteLength: packageCandidate.tarballByteLength,
  });
  const validatedRelease = kernel.release.validateReleaseCandidate(releaseCandidate, validatedPackage, validatedIntegrated, authorization);
  const validatedProof = kernel.proof.validateBlackBoxProof(proof, {
    sliceAuthorization: authorization,
    integratedCandidate: validatedIntegrated,
    packageCandidate: validatedPackage,
    releaseCandidate: validatedRelease,
    observedEvaluatorDigest: authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
  });
  const validatedReviews = reviews.map((review) => kernel.review.validateReviewerAssessment(review, {
    sliceAuthorization: authorization,
    integratedCandidate: validatedIntegrated,
    packageCandidate: validatedPackage,
    releaseCandidate: validatedRelease,
    blackBoxProof: validatedProof,
    observedExecutableDigest: review.processExecutableDigest,
    implementationProcessId: "implementation-process",
  }));
  const validatedTerminal = kernel.terminal.validateTerminalSliceAssessment(terminal, {
    sliceAuthorization: authorization,
    integratedCandidate: validatedIntegrated,
    packageCandidate: validatedPackage,
    releaseCandidate: validatedRelease,
    blackBoxProof: validatedProof,
    reviewerAssessments: validatedReviews,
  });
  return {
    runSpec: validatedRunSpec,
    mechanics: validatedMechanics,
    integrated: validatedIntegrated,
    packageCandidate: validatedPackage,
    releaseCandidate: validatedRelease,
    proof: validatedProof,
    reviews: validatedReviews,
    terminal: validatedTerminal,
  };
}

function evaluateD1(kernel, fixture, authorization) {
  const runSpec = makeRunSpec(kernel, authorization, fixture.quant.negativeCandidate, "NEGATIVE");
  const originalAcceptancePreserved = kernel.runSpec.validateRunSpec(runSpec, authorization, {
    expectedParentRevision: authorization.initialBaseRevision,
    generation: 1,
    nowUtc: "2026-08-01T00:30:00.000Z",
  }).sliceAcceptanceDigest === kernel.slice.computeSliceAcceptanceDigest(authorization.sliceAcceptance);
  const substituted = JSON.parse(JSON.stringify(runSpec));
  substituted.sliceAcceptanceDigest = fixture.weakenedDirection.digest;
  substituted.runSpecDigest = kernel.runSpec.computeRunSpecDigest(substituted);
  const substitutionRejected = expectedFailure(
    () => kernel.runSpec.validateRunSpec(substituted, authorization, {
      expectedParentRevision: authorization.initialBaseRevision,
      generation: 1,
      nowUtc: "2026-08-01T00:30:00.000Z",
    }),
    ["RUN_SPEC_BINDING_MISMATCH"],
  );
  return originalAcceptancePreserved && substitutionRejected;
}

function buildNegativeMechanics(kernel, fixture, authorization) {
  const runSpec = makeRunSpec(kernel, authorization, fixture.quant.negativeCandidate, "NEGATIVE");
  const validatedRunSpec = kernel.runSpec.validateRunSpec(runSpec, authorization, {
    expectedParentRevision: authorization.initialBaseRevision,
    generation: 1,
    nowUtc: "2026-08-01T00:30:00.000Z",
  });
  const mechanics = makeMechanics(kernel, authorization, validatedRunSpec, fixture.quant.negativeCandidate, "negative");
  const validatedMechanics = kernel.mechanics.validateMechanicsAssessment(mechanics, validatedRunSpec, authorization, {
    expectedContributedRevision: fixture.quant.negativeCandidate.commit,
    expectedTree: fixture.quant.negativeCandidate.tree,
  });
  const integrated = makeIntegrated(kernel, authorization, validatedRunSpec, validatedMechanics);
  const validatedIntegrated = kernel.integrated.validateIntegratedCandidate(
    integrated,
    authorization,
    new Map([[validatedMechanics.assessmentDigest, validatedMechanics]]),
    { generation: 1, recomputedFinalTree: fixture.quant.negativeCandidate.tree },
  );
  return { runSpec: validatedRunSpec, mechanics: validatedMechanics, integrated: validatedIntegrated };
}

function evaluateD2(kernel, negative) {
  const noProductVerdict = negative.mechanics.verdict === "MECHANICS_VERIFIED"
    && !Object.prototype.hasOwnProperty.call(negative.mechanics, "productAccepted");
  const forged = JSON.parse(JSON.stringify(negative.mechanics));
  forged.verdict = "PRODUCT_ACCEPTED";
  forged.assessmentDigest = kernel.mechanics.computeMechanicsAssessmentDigest(forged);
  const forgedRejected = expectedFailure(
    () => kernel.mechanics.validateMechanicsAssessment(forged, negative.runSpec, negative.authorization),
    ["MECHANICS_VERDICT_INVALID"],
  );
  return noProductVerdict && forgedRejected;
}

function evaluateD3(kernel, fixture, authorization, negative) {
  const { packageCandidate, releaseCandidate } = makePackageAndRelease(kernel, authorization, negative.integrated, "negative");
  const validatedPackage = kernel.release.validatePackageCandidate(packageCandidate, negative.integrated, authorization, {
    observedTarballDigest: packageCandidate.tarballDigest,
    observedTarballByteLength: packageCandidate.tarballByteLength,
  });
  const validatedRelease = kernel.release.validateReleaseCandidate(releaseCandidate, validatedPackage, negative.integrated, authorization);
  const requiredPositivePaths = new Set(
    Array.isArray(fixture.quant.positiveControl.requiredPaths)
      ? fixture.quant.positiveControl.requiredPaths.map((entry) => entry.path)
      : Object.keys(fixture.quant.positiveControl.requiredPaths),
  );
  const incompleteFixture = fixture.quant.negativeCandidate.expectedAbsentPaths.every((entry) => (
    requiredPositivePaths.has(entry)
  ));
  const proof = makeProof(kernel, authorization, negative.integrated, validatedPackage, validatedRelease, { D3: 0 });
  const proofRejected = expectedFailure(
    () => kernel.proof.validateBlackBoxProof(proof, {
      sliceAuthorization: authorization,
      integratedCandidate: negative.integrated,
      packageCandidate: validatedPackage,
      releaseCandidate: validatedRelease,
      observedEvaluatorDigest: authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
    }),
    ["BLACK_BOX_PREDICATE_FAILED"],
  );
  return incompleteFixture && proofRejected;
}

function evaluateD4(kernel, authorization, positive) {
  const substituted = JSON.parse(JSON.stringify(positive.proof));
  substituted.evaluatorExecutableDigest = digest("substituted-evaluator");
  substituted.proofDigest = kernel.proof.computeBlackBoxProofDigest(substituted);
  return expectedFailure(
    () => kernel.proof.validateBlackBoxProof(substituted, {
      sliceAuthorization: authorization,
      integratedCandidate: positive.integrated,
      packageCandidate: positive.packageCandidate,
      releaseCandidate: positive.releaseCandidate,
      observedEvaluatorDigest: substituted.evaluatorExecutableDigest,
    }),
    ["BLACK_BOX_EVALUATOR_MISMATCH"],
  );
}

function evaluateD5(kernel, authorization, positive) {
  const substituted = JSON.parse(JSON.stringify(positive.reviews[0]));
  substituted.processExecutableDigest = digest("substituted-product-reviewer");
  substituted.inputManifestDigest = kernel.review.computeReviewInputManifestDigest({
    role: substituted.role,
    sliceAcceptanceDigest: substituted.sliceAcceptanceDigest,
    integratedCandidateDigest: substituted.integratedCandidateDigest,
    packageCandidateDigest: substituted.packageCandidateDigest,
    releaseCandidateDigest: substituted.releaseCandidateDigest,
    blackBoxProofDigest: substituted.blackBoxProofDigest,
    executableDigest: substituted.processExecutableDigest,
    policyDigest: substituted.rolePolicyDigest,
    environmentPolicyDigest: substituted.environmentPolicyDigest,
    networkPolicy: substituted.networkPolicy,
  });
  substituted.assessmentDigest = kernel.review.computeReviewerAssessmentDigest(substituted);
  return expectedFailure(
    () => kernel.review.validateReviewerAssessment(substituted, {
      sliceAuthorization: authorization,
      integratedCandidate: positive.integrated,
      packageCandidate: positive.packageCandidate,
      releaseCandidate: positive.releaseCandidate,
      blackBoxProof: positive.proof,
      observedExecutableDigest: substituted.processExecutableDigest,
      implementationProcessId: "implementation-process",
    }),
    ["REVIEW_BINDING_MISMATCH", "REVIEW_EXECUTABLE_MISMATCH"],
  );
}

function evaluateD7(kernel, authorization, positive) {
  const observation = {
    schemaVersion: "publication-observation/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    releaseCandidateDigest: positive.releaseCandidate.releaseCandidateDigest,
    registry: positive.releaseCandidate.registry,
    packageName: positive.releaseCandidate.packageName,
    version: positive.releaseCandidate.version,
    requestedTarballDigest: positive.releaseCandidate.tarballDigest,
    requestedTarballIntegrity: positive.releaseCandidate.tarballIntegrity,
    commandIdentityDigest: digest("publication-command"),
    requestStartedAt: "2026-08-01T02:00:00.000Z",
    processExitCode: 0,
    processTimedOut: false,
    processStdoutDigest: digest("publication-stdout"),
    processStderrDigest: digest("publication-stderr"),
    registryVersionObserved: positive.releaseCandidate.version,
    registryIntegrityObserved: positive.releaseCandidate.tarballIntegrity,
    observedAt: "2026-08-01T02:01:00.000Z",
    disposition: "PUBLISHED_EXACT",
    observationDigest: "pending",
  };
  observation.observationDigest = kernel.publication.computePublicationObservationDigest(observation);
  const validatedObservation = kernel.publication.validatePublicationObservation(observation, positive.releaseCandidate, authorization);
  const closure = {
    schemaVersion: "canonical-closure-projection/v1",
    repositoryId: authorization.repositoryId,
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAcceptanceDigest: positive.terminal.sliceAcceptanceDigest,
    terminalAssessmentDigest: positive.terminal.terminalAssessmentDigest,
    releaseCandidateDigest: positive.releaseCandidate.releaseCandidateDigest,
    finalCommit: positive.integrated.finalHeadRevision,
    finalTree: positive.integrated.finalTreeDigest,
    tarballDigest: positive.releaseCandidate.tarballDigest,
    publicationObservationDigest: validatedObservation.observationDigest,
    publicationState: "PUBLISHED_EXACT",
    closedAt: validatedObservation.observedAt,
    nextSliceState: "AWAITING_OWNER_AUTHORIZATION",
    projectionDigest: "pending",
  };
  closure.projectionDigest = kernel.publication.computeCanonicalClosureProjectionDigest(closure);
  const exactClosure = kernel.publication.validateCanonicalClosureProjection(closure, {
    sliceAuthorization: authorization,
    integratedCandidate: positive.integrated,
    releaseCandidate: positive.releaseCandidate,
    terminalAssessment: positive.terminal,
    publicationObservation: validatedObservation,
  });
  const nonTerminal = JSON.parse(JSON.stringify(positive.terminal));
  nonTerminal.verdict = "PRODUCT_REVIEW_FAILED";
  nonTerminal.terminalAssessmentDigest = kernel.terminal.computeTerminalSliceAssessmentDigest(nonTerminal);
  const nonTerminalRejected = expectedFailure(
    () => kernel.publication.validateCanonicalClosureProjection(closure, {
      sliceAuthorization: authorization,
      integratedCandidate: positive.integrated,
      releaseCandidate: positive.releaseCandidate,
      terminalAssessment: nonTerminal,
      publicationObservation: validatedObservation,
    }),
    ["CANONICAL_CLOSURE_TERMINAL_REQUIRED"],
  );
  return exactClosure.nextSliceState === "AWAITING_OWNER_AUTHORIZATION" && nonTerminalRejected;
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

function evaluateD8(kernel) {
  const retiredFile = path.join(kernel.root, "lib", "semantic-kernel", "certification.js");
  if (fs.existsSync(retiredFile)) return false;
  return executableFiles(kernel.root).every((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return RETIRED_EXECUTABLE_TOKENS.every((token) => !source.includes(token));
  });
}

function evaluateD9(proofInput) {
  return proofInput.schemaVersion === "meta-harness-delivery-proof-input/v1"
    && proofInput.tarballBuildCount === 1
    && proofInput.preterminalPackCount === 0
    && proofInput.publicationPackCount === 0
    && proofInput.publishExistingTarballOnly === true;
}

function evaluateD10(candidateRoot) {
  const contents = new Map();
  for (const relativePath of REQUIRED_GUIDANCE_PATHS) {
    const absolutePath = path.join(candidateRoot, ...relativePath.split("/"));
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return false;
    contents.set(relativePath, fs.readFileSync(absolutePath, "utf8"));
  }
  const all = [...contents.values()].join("\n");
  const stale = ["S-006M", "Meta-Harness 0.3", '"version": "0.3.0"'];
  return contents.get("package.json").includes('"version": "0.4.0"')
    && all.includes("Meta-Harness 0.4")
    && all.includes("DELIVERY")
    && stale.every((token) => !all.includes(token));
}

function evidenceDigest(predicateId, passed, details) {
  return sha256Bytes(canonicalBytes({ predicateId, passed, details }));
}

function verifyFixture(fixture) {
  assert(fixture.schemaVersion === "meta-harness-delivery-fixture-manifest/v1", "unsupported fixture manifest schema");
  assert(fixture.fixtureDigest === fixtureDigest(fixture), "fixture manifest digest mismatch");
  assert(JSON.stringify(fixture.proofPredicateOrder) === JSON.stringify(PROOF_PREDICATE_ORDER), "fixture predicate order mismatch");
  assert(REQUIRED_PREDICATES.every((predicateId) => typeof fixture.predicates[predicateId] === "string"), "fixture predicates incomplete");
}

function verifyProofInput(proofInput, fixture) {
  assert(proofInput.fixtureDigest === fixture.fixtureDigest, "proof input fixture digest mismatch");
  assert(proofInput.negativeCommit === fixture.quant.negativeCandidate.commit, "negative fixture commit mismatch");
  assert(proofInput.negativeTree === fixture.quant.negativeCandidate.tree, "negative fixture tree mismatch");
  assert(proofInput.positiveCommit === fixture.quant.positiveControl.commit, "positive fixture commit mismatch");
  assert(proofInput.positiveTree === fixture.quant.positiveControl.tree, "positive fixture tree mismatch");
}

function runEvaluation(manifest) {
  const fixture = readJson(manifest.fixturePath, "fixture manifest");
  const proofInput = readJson(manifest.inputPath, "proof input");
  verifyFixture(fixture);
  verifyProofInput(proofInput, fixture);
  const selfDigest = sha256Bytes(fs.readFileSync(__filename));
  assert(selfDigest === fixture.programs.evaluator.digest, "evaluator digest differs from fixture manifest");
  const kernel = loadKernel(manifest);
  const acceptance = makeAcceptance(fixture, selfDigest);
  kernel.slice.validateSliceAcceptance(acceptance);
  const authorization = makeAuthorization(kernel, fixture, acceptance);
  const negative = buildNegativeMechanics(kernel, fixture, authorization);
  negative.authorization = authorization;
  const positive = validatePositiveChain(kernel, fixture, authorization);

  const outcomes = {
    D1: evaluateD1(kernel, fixture, authorization),
    D2: evaluateD2(kernel, negative),
    D3: evaluateD3(kernel, fixture, authorization, negative),
    D4: evaluateD4(kernel, authorization, positive),
    D5: evaluateD5(kernel, authorization, positive),
    D6: positive.terminal.verdict === "TERMINAL_SLICE_VERIFIED",
    D7: evaluateD7(kernel, authorization, positive),
    D8: evaluateD8(kernel),
    D9: evaluateD9(proofInput),
    D10: evaluateD10(manifest.candidateRoot),
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
      evidenceDigest: evidenceDigest(predicateId, outcomes[predicateId], {
        fixtureDigest: fixture.fixtureDigest,
        negativeCommit: fixture.quant.negativeCandidate.commit,
        positiveCommit: fixture.quant.positiveControl.commit,
      }),
    })),
  };
}

function runSelfTest() {
  const fixturePath = path.join(__dirname, "fixture-manifest.json");
  const fixture = readJson(fixturePath, "fixture manifest");
  verifyFixture(fixture);
  for (const program of Object.values(fixture.programs)) {
    const programPath = path.join(__dirname, path.basename(program.path));
    assert(fs.existsSync(programPath), `missing program: ${program.path}`);
    assert(sha256Bytes(fs.readFileSync(programPath)) === program.digest, `program digest mismatch: ${program.path}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, fixtureDigest: fixture.fixtureDigest })}\n`);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const manifest = JSON.parse(input);
  process.stdout.write(JSON.stringify(runEvaluation(manifest)));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
