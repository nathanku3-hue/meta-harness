"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const {
  signEd25519ForTests,
} = require("../lib/semantic-kernel/contract-utils");
const {
  CONTROLLER_CAPABILITIES,
  SLICE_AUTHORIZATION_SIGNATURE_DOMAIN,
  authorizationSigningBody,
  computeSliceAcceptanceDigest,
  computeSliceAuthorizationDigest,
  validateSliceAuthorization,
} = require("../lib/semantic-kernel/slice-authorization");
const {
  ALLOWED_CAPABILITIES,
  resolveInstalledControllerBinding,
} = require("../lib/semantic-kernel/controller-binding");
const {
  G_SCOPE_SIGNATURE_DOMAIN,
  computeGScopeDigest,
  decisionSigningBody,
  validateSliceAuthorizationReplacement,
} = require("../lib/semantic-kernel/g-scope");
const {
  createSliceActivation,
  validateSliceActivation,
} = require("../lib/semantic-kernel/slice-activation");
const {
  computeRunSpecDigest,
  validateRunSpec,
} = require("../lib/semantic-kernel/run-spec-v2");
const {
  computeMechanicsAssessmentDigest,
  validateMechanicsAssessment,
} = require("../lib/semantic-kernel/mechanics-assessment");
const {
  computeIntegratedCandidateDigest,
  validateIntegratedCandidate,
} = require("../lib/semantic-kernel/integrated-candidate");
const {
  computePackageCandidateDigest,
  computeReleaseCandidateDigest,
  validatePackageCandidate,
  validateReleaseCandidate,
} = require("../lib/semantic-kernel/release-candidate");
const {
  computeBlackBoxProofDigest,
  computeProofOracleDigest,
  validateBlackBoxProof,
} = require("../lib/semantic-kernel/black-box-proof");
const {
  computeReviewInputManifestDigest,
  computeReviewerAssessmentDigest,
  validateReviewerAssessment,
} = require("../lib/semantic-kernel/reviewer-assessment");
const {
  computeTerminalSliceAssessmentDigest,
  validateTerminalSliceAssessment,
} = require("../lib/semantic-kernel/terminal-slice-assessment");
const {
  computeCanonicalClosureProjectionDigest,
  computePublicationObservationDigest,
  validateCanonicalClosureProjection,
  validatePublicationObservation,
} = require("../lib/semantic-kernel/publication");
const {
  computePackageMetadataDigest,
  computePacklistDigest,
  verifyPreterminal,
  verifyPublication,
} = require("../lib/semantic-kernel/release-verification");
const { publishAndReconcile } = require("../lib/semantic-kernel/publication-runtime");
const {
  computeSliceStateDigest,
  validateSliceStateTransition,
} = require("../lib/semantic-kernel/slice-state");
const {
  buildOperationBundle,
  publishOperationBundle,
  validateOperationBundle,
  validateOperationEvent,
} = require("../lib/semantic-kernel/operation-bundle");

function digest(label) {
  return domainDigest("semantic-kernel-chain-test/v1", { label });
}

function objectId(character, length = 40) {
  return character.repeat(length);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createOwner() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "jwk" });
  const ownerKeyId = domainDigest("meta-harness-owner-public-key/v2", publicKey);
  const repositoryId = digest("repository");
  return {
    pair,
    pin: {
      schemaVersion: "authority-genesis-pin/v2",
      repositoryId,
      ownerKeyId,
      ownerPublicKey: publicKey,
      ownerPublicKeyDigest: ownerKeyId,
      installedByExplicitOwnerAction: true,
      installedAt: "2026-07-30T15:00:00.000Z",
      pinDigest: digest("pin-not-used-by-contract-test"),
    },
  };
}

function signAuthorization(body, owner) {
  const draft = {
    ...clone(body),
    ownerKeyId: owner.pin.ownerKeyId,
    authorizationDigest: "pending",
    ownerSignature: "pending",
  };
  draft.authorizationDigest = computeSliceAuthorizationDigest(draft);
  draft.ownerSignature = signEd25519ForTests({
    domain: SLICE_AUTHORIZATION_SIGNATURE_DOMAIN,
    body: authorizationSigningBody(draft),
    privateKey: owner.pair.privateKey,
  });
  return draft;
}

function makeAuthorization(owner, changes = {}) {
  const acceptance = {
    intent: {
      version: "intent-v1",
      digest: digest("intent"),
    },
    acceptanceSource: {
      revision: objectId("1"),
      path: "docs/product/roadmap.md",
      contentDigest: digest("roadmap-acceptance"),
    },
    acceptanceClauses: [
      { clauseId: "Q-BREADTH", verbatimText: "One portfolio run contains 25 to 50 distinct securities." },
      { clauseId: "Q-COHERENT", verbatimText: "All admitted instruments belong to one portfolio run." },
      { clauseId: "Q-COMPETE", verbatimText: "Capital competes within that portfolio run." },
      { clauseId: "Q-FLOW", verbatimText: "Operator review, confirm, persist, and reopen completes." },
    ],
    quantitativeBounds: [{
      boundId: "Q-DISTINCT",
      clauseId: "Q-BREADTH",
      subject: "securities",
      measure: "distinct_count",
      distinctBy: "instrument_id",
      min: 25,
      max: 50,
      coherenceKey: "portfolio_run_id",
    }],
    productResult: "A reopened portfolio shows one confirmed run with 25 to 50 distinct competing securities.",
    operatorUserFlow: ["review", "confirm", "persist", "reopen"],
    shippingTarget: "installed-package",
    proofOracle: {
      evaluatorKind: "initial-base-artifact",
      evaluatorArtifactIdentity: "tests/oracles/quant-terminal.js",
      evaluatorArtifactDigest: digest("quant-oracle"),
      evaluatorPackageDigest: null,
      predicateIds: ["Q-CAPITAL-COMPETITION", "Q-DISTINCT", "Q-ONE-RUN", "Q-REOPEN-MATCH"],
      inputPolicyDigest: digest("input-policy"),
      observationSchemaDigest: digest("observation-schema"),
    },
  };
  if (changes.acceptanceText) {
    acceptance.acceptanceClauses[0].verbatimText = changes.acceptanceText;
  }
  const body = {
    schemaVersion: "slice-authorization/v1",
    repositoryId: owner.pin.repositoryId,
    sliceId: "S-SEMANTIC-KERNEL-1",
    initialBaseRevision: objectId("1"),
    sliceMode: "DELIVERY",
    authorityExecutionPlatform: "linux",
    sliceAcceptance: acceptance,
    controllerBinding: {
      controllerProgramDigest: digest("controller-program"),
      controllerPolicyDigest: digest("controller-policy"),
      launcherDigest: digest("launcher"),
      custodyRootPolicyDigest: digest("custody-root-policy"),
      clockPolicyDigest: digest("clock-policy"),
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
        executableIdentity: "tests/reviewers/product-reviewer.js",
        executableDigest: digest("reviewer-product-executable"),
        policyDigest: digest("reviewer-product-policy"),
        environmentPolicyDigest: digest("reviewer-product-environment"),
        networkPolicy: "none",
      },
      domain: {
        executableIdentity: "tests/reviewers/domain-reviewer.js",
        executableDigest: digest("reviewer-domain-executable"),
        policyDigest: digest("reviewer-domain-policy"),
        environmentPolicyDigest: digest("reviewer-domain-environment"),
        networkPolicy: "none",
      },
      custody: {
        executableIdentity: "tests/reviewers/custody-reviewer.js",
        executableDigest: digest("reviewer-custody-executable"),
        policyDigest: digest("reviewer-custody-policy"),
        environmentPolicyDigest: digest("reviewer-custody-environment"),
        networkPolicy: "none",
      },
    },
    executionLimits: {
      issuedAt: "2026-07-30T15:00:00.000Z",
      expiresAt: "2026-07-30T16:00:00.000Z",
      mustCompleteBy: "2026-08-01T16:00:00.000Z",
      maxAttempts: 20,
      maxRunSpecs: 10,
      aggregatePathBoundary: ["lib", "tests"],
      allowedWorkerProfiles: ["worker-a"],
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
      publishBy: "2026-08-02T16:00:00.000Z",
      canonicalUpdatePolicyDigest: digest("canonical-update-policy"),
    },
  };
  return signAuthorization(body, owner);
}

function makeRunSpec(authorization, workerGuidance = "Implement 12 repeated slots instead.") {
  const commandBody = {
    argv: ["node", "--test", "tests/quant-terminal.test.js"],
    cwd: ".",
    timeoutSeconds: 120,
    network: "none",
  };
  const commandId = domainDigest("meta-harness-run-spec-command/v2", commandBody);
  const draft = {
    schemaVersion: "run-spec/v2",
    runId: "RUN-001",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    repository: {
      repositoryId: authorization.repositoryId,
      expectedParentRevision: authorization.initialBaseRevision,
      objectFormat: "sha1",
    },
    workerProfile: "worker-a",
    mechanicalTask: {
      acceptanceClauseIds: ["Q-BREADTH", "Q-COHERENT"],
      targetPaths: ["lib/quant.js"],
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
    workerGuidance,
    runSpecDigest: "pending",
  };
  draft.runSpecDigest = computeRunSpecDigest(draft);
  return draft;
}

function makeMechanics(runSpec, authorization) {
  const draft = {
    schemaVersion: "mechanics-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    runSpecDigest: runSpec.runSpecDigest,
    repositoryId: authorization.repositoryId,
    parentRevision: authorization.initialBaseRevision,
    contributedRevision: objectId("2"),
    resultingTree: objectId("a"),
    changedPaths: ["lib/quant.js"],
    validationResults: [{
      commandId: runSpec.validation.commands[0].commandId,
      exitStatus: 0,
      timedOut: false,
      networkUsed: false,
      stdoutDigest: digest("validation-stdout"),
      stderrDigest: digest("validation-stderr"),
      startedAt: "2026-07-30T17:00:00.000Z",
      finishedAt: "2026-07-30T17:00:10.000Z",
    }],
    cleanStateProof: {
      statusPorcelainDigest: digest("empty-status"),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-07-30T17:00:11.000Z",
    },
    assessedAt: "2026-07-30T17:00:12.000Z",
    verdict: "MECHANICS_VERIFIED",
    assessmentDigest: "pending",
  };
  draft.assessmentDigest = computeMechanicsAssessmentDigest(draft);
  return draft;
}

function makeIntegrated(authorization, runSpec, mechanics) {
  const draft = {
    schemaVersion: "integrated-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
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
    integrationControllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", authorization.controllerBinding),
    changedPathUnion: mechanics.changedPaths,
    rejectedAttempts: [],
    supersededAttempts: [],
    finalHeadRevision: mechanics.contributedRevision,
    finalTreeDigest: mechanics.resultingTree,
    cleanStateProof: {
      statusPorcelainDigest: digest("integration-empty-status"),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-07-30T17:05:00.000Z",
    },
    integratedAt: "2026-07-30T17:05:01.000Z",
    candidateDigest: "pending",
  };
  draft.candidateDigest = computeIntegratedCandidateDigest(draft);
  return draft;
}

function makePackageAndRelease(authorization, integrated) {
  const tarballIntegrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
  const packageCandidate = {
    schemaVersion: "package-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    integratedCandidateDigest: integrated.candidateDigest,
    candidateHead: integrated.finalHeadRevision,
    candidateTree: integrated.finalTreeDigest,
    tarballDigest: digest("tarball"),
    tarballIntegrity,
    tarballByteLength: 4096,
    packlistDigest: digest("packlist"),
    packageMetadataDigest: digest("package-metadata"),
    packageName: authorization.publicationPolicy.packageName,
    version: authorization.publicationPolicy.version,
    builtAt: "2026-07-30T17:10:00.000Z",
    builderProgramDigest: digest("package-builder"),
    packageCandidateDigest: "pending",
  };
  packageCandidate.packageCandidateDigest = computePackageCandidateDigest(packageCandidate);
  const releaseCandidate = {
    schemaVersion: "release-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
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
  releaseCandidate.releaseCandidateDigest = computeReleaseCandidateDigest(releaseCandidate);
  return { packageCandidate, releaseCandidate };
}

function makeProof(authorization, integrated, packageCandidate, releaseCandidate, distinctCount = 30) {
  const oracle = authorization.sliceAcceptance.proofOracle;
  const draft = {
    schemaVersion: "black-box-proof/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    executionSurface: {
      type: "installed-package",
      tarballDigest: packageCandidate.tarballDigest,
      installationIdentity: "isolated-install-001",
      freshEnvironmentProofDigest: digest("fresh-environment"),
    },
    operatorActions: authorization.sliceAcceptance.operatorUserFlow.map((action, index) => ({
      sequence: index + 1,
      actionId: `action-${index + 1}`,
      action,
      observationId: `observation-${index + 1}`,
    })),
    inputIdentityDigest: digest("quant-input"),
    fixtureIdentityDigest: digest("quant-fixture"),
    observationTranscriptDigest: digest("observation-transcript"),
    exitStatus: 0,
    quantitativeEvaluations: [
      { predicateId: "Q-CAPITAL-COMPETITION", actual: true, passed: true, evidenceDigest: digest("capital-competition") },
      { predicateId: "Q-DISTINCT", actual: distinctCount, passed: true, evidenceDigest: digest("distinct-count") },
      { predicateId: "Q-ONE-RUN", actual: true, passed: true, evidenceDigest: digest("one-run") },
      { predicateId: "Q-REOPEN-MATCH", actual: true, passed: true, evidenceDigest: digest("reopen-match") },
    ],
    proofOracleDigest: computeProofOracleDigest(oracle),
    evaluatorExecutableDigest: oracle.evaluatorArtifactDigest,
    evaluatorPackageDigest: null,
    noImplementationWorkerExpectedOutput: true,
    executedAt: "2026-07-30T17:20:00.000Z",
    proofDigest: "pending",
  };
  draft.proofDigest = computeBlackBoxProofDigest(draft);
  return draft;
}

function makeReview(role, authorization, integrated, packageCandidate, releaseCandidate, proof, result = "PASS") {
  const policyKey = { PRODUCT: "product", DOMAIN: "domain", CUSTODY: "custody" }[role];
  const policy = authorization.reviewPolicy[policyKey];
  const draft = {
    schemaVersion: "reviewer-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    role,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: proof.proofDigest,
    processId: `reviewer-${role.toLowerCase()}-process`,
    processExecutableDigest: policy.executableDigest,
    rolePolicyDigest: policy.policyDigest,
    environmentPolicyDigest: policy.environmentPolicyDigest,
    networkPolicy: policy.networkPolicy,
    inputManifestDigest: "pending",
    readOnlyCandidateAccess: true,
    implementationProcessReuse: false,
    previousReviewerOutputsVisible: false,
    result,
    findingsDigest: digest(`${role}-findings-${result}`),
    reviewedAt: "2026-07-30T17:30:00.000Z",
    assessmentDigest: "pending",
  };
  draft.inputManifestDigest = computeReviewInputManifestDigest({
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
  draft.assessmentDigest = computeReviewerAssessmentDigest(draft);
  return draft;
}

function makeTerminal(authorization, integrated, packageCandidate, releaseCandidate, proof, reviews) {
  const byRole = Object.fromEntries(reviews.map((review) => [review.role, review]));
  const verdict = byRole.PRODUCT.result !== "PASS"
    ? "PRODUCT_REVIEW_FAILED"
    : byRole.DOMAIN.result !== "PASS"
      ? "DOMAIN_REVIEW_FAILED"
      : byRole.CUSTODY.result !== "PASS"
        ? "CUSTODY_REVIEW_FAILED"
        : "TERMINAL_SLICE_VERIFIED";
  const draft = {
    schemaVersion: "terminal-slice-assessment/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    blackBoxProofDigest: proof.proofDigest,
    productReviewDigest: byRole.PRODUCT.assessmentDigest,
    domainReviewDigest: byRole.DOMAIN.assessmentDigest,
    custodyReviewDigest: byRole.CUSTODY.assessmentDigest,
    controllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", authorization.controllerBinding),
    assessedAt: "2026-07-30T17:40:00.000Z",
    verdict,
    terminalAssessmentDigest: "pending",
  };
  draft.terminalAssessmentDigest = computeTerminalSliceAssessmentDigest(draft);
  return draft;
}

function buildValidChain() {
  const owner = createOwner();
  const authorization = makeAuthorization(owner);
  const runSpec = makeRunSpec(authorization);
  const mechanics = makeMechanics(runSpec, authorization);
  const integrated = makeIntegrated(authorization, runSpec, mechanics);
  const { packageCandidate, releaseCandidate } = makePackageAndRelease(authorization, integrated);
  const proof = makeProof(authorization, integrated, packageCandidate, releaseCandidate);
  const reviews = ["PRODUCT", "DOMAIN", "CUSTODY"].map((role) => (
    makeReview(role, authorization, integrated, packageCandidate, releaseCandidate, proof)
  ));
  const terminal = makeTerminal(authorization, integrated, packageCandidate, releaseCandidate, proof, reviews);
  return { owner, authorization, runSpec, mechanics, integrated, packageCandidate, releaseCandidate, proof, reviews, terminal };
}

test("one owner authorization binds the complete mechanics-to-terminal chain", () => {
  const chain = buildValidChain();
  const authorization = validateSliceAuthorization(chain.authorization, chain.owner.pin);
  const activation = createSliceActivation({
    sliceAuthorization: authorization,
    ownerPin: chain.owner.pin,
    repositoryId: chain.owner.pin.repositoryId,
    initialBaseRevision: authorization.initialBaseRevision,
    activatedAt: "2026-07-30T15:30:00.000Z",
  });
  assert.equal(validateSliceActivation(activation, authorization).activationDigest, activation.activationDigest);

  const runSpec = validateRunSpec(chain.runSpec, authorization, {
    expectedParentRevision: authorization.initialBaseRevision,
    generation: 1,
    nowUtc: "2026-07-30T16:30:00.000Z",
  });
  assert.equal(runSpec.workerGuidance, "Implement 12 repeated slots instead.");
  assert.equal(runSpec.sliceAcceptanceDigest, computeSliceAcceptanceDigest(authorization.sliceAcceptance));

  const mechanics = validateMechanicsAssessment(chain.mechanics, runSpec, authorization);
  assert.equal(mechanics.verdict, "MECHANICS_VERIFIED");
  assert.equal(Object.hasOwn(mechanics, "productAccepted"), false);

  const integrated = validateIntegratedCandidate(
    chain.integrated,
    authorization,
    new Map([[mechanics.assessmentDigest, mechanics]]),
    { generation: 1, recomputedFinalTree: mechanics.resultingTree },
  );
  const packageCandidate = validatePackageCandidate(chain.packageCandidate, integrated, authorization, {
    observedTarballDigest: chain.packageCandidate.tarballDigest,
    observedTarballByteLength: chain.packageCandidate.tarballByteLength,
  });
  const releaseCandidate = validateReleaseCandidate(chain.releaseCandidate, packageCandidate, integrated, authorization);
  const proof = validateBlackBoxProof(chain.proof, {
    sliceAuthorization: authorization,
    integratedCandidate: integrated,
    packageCandidate,
    releaseCandidate,
    observedEvaluatorDigest: authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
  });
  const reviews = chain.reviews.map((review) => validateReviewerAssessment(review, {
    sliceAuthorization: authorization,
    integratedCandidate: integrated,
    packageCandidate,
    releaseCandidate,
    blackBoxProof: proof,
    observedExecutableDigest: review.processExecutableDigest,
    implementationProcessId: "implementation-process",
  }));
  const terminal = validateTerminalSliceAssessment(chain.terminal, {
    sliceAuthorization: authorization,
    integratedCandidate: integrated,
    packageCandidate,
    releaseCandidate,
    blackBoxProof: proof,
    reviewerAssessments: reviews,
  });
  assert.equal(terminal.verdict, "TERMINAL_SLICE_VERIFIED");
});

test("installed controller binding is exactly authorizable and unknown capabilities remain rejected", () => {
  assert.deepEqual(
    [...CONTROLLER_CAPABILITIES].sort(),
    [...ALLOWED_CAPABILITIES].sort(),
  );

  const owner = createOwner();
  const delivery = makeAuthorization(owner);
  const deliveryBody = clone(delivery);
  delete deliveryBody.ownerKeyId;
  delete deliveryBody.authorizationDigest;
  delete deliveryBody.ownerSignature;
  deliveryBody.controllerBinding = resolveInstalledControllerBinding();

  const installedBindingAuthorization = signAuthorization(deliveryBody, owner);
  const validated = validateSliceAuthorization(installedBindingAuthorization, owner.pin);
  assert.deepEqual(validated.controllerBinding, resolveInstalledControllerBinding());

  const unauthorizedBody = clone(deliveryBody);
  unauthorizedBody.controllerBinding.allowedCapabilities.push("UNAUTHORIZED_CAPABILITY");
  unauthorizedBody.controllerBinding.allowedCapabilities.sort();
  const unauthorized = signAuthorization(unauthorizedBody, owner);
  assert.throws(
    () => validateSliceAuthorization(unauthorized, owner.pin),
    (error) => error.code === "SLICE_CONTROLLER_CAPABILITY_INVALID",
  );
});

test("Meta-Harness 0.4 authorizes DELIVERY only", () => {
  const owner = createOwner();
  const delivery = makeAuthorization(owner);
  const validatedDelivery = validateSliceAuthorization(delivery, owner.pin);
  assert.equal(validatedDelivery.sliceMode, "DELIVERY");
  assert.equal(validatedDelivery.authorityExecutionPlatform, "linux");
  assert.equal(validatedDelivery.sliceAcceptance.shippingTarget, "installed-package");

  const retiredModeBody = clone(delivery);
  delete retiredModeBody.ownerKeyId;
  delete retiredModeBody.authorizationDigest;
  delete retiredModeBody.ownerSignature;
  retiredModeBody.sliceMode = "CERTIFICATION";
  retiredModeBody.sliceAcceptance.shippingTarget = "repository-application";
  retiredModeBody.publicationPolicy = null;
  const retiredMode = signAuthorization(retiredModeBody, owner);
  assert.throws(
    () => validateSliceAuthorization(retiredMode, owner.pin),
    (error) => error.code === "SLICE_MODE_INVALID",
  );

  const windowsAuthorityBody = clone(delivery);
  delete windowsAuthorityBody.ownerKeyId;
  delete windowsAuthorityBody.authorizationDigest;
  delete windowsAuthorityBody.ownerSignature;
  windowsAuthorityBody.authorityExecutionPlatform = "win32";
  const windowsAuthority = signAuthorization(windowsAuthorityBody, owner);
  assert.throws(
    () => validateSliceAuthorization(windowsAuthority, owner.pin),
    (error) => error.code === "SLICE_AUTHORITY_EXECUTION_PLATFORM_INVALID",
  );

  const missingDeliveryPublicationBody = clone(delivery);
  delete missingDeliveryPublicationBody.ownerKeyId;
  delete missingDeliveryPublicationBody.authorizationDigest;
  delete missingDeliveryPublicationBody.ownerSignature;
  missingDeliveryPublicationBody.publicationPolicy = null;
  const missingDeliveryPublication = signAuthorization(missingDeliveryPublicationBody, owner);
  assert.throws(
    () => validateSliceAuthorization(missingDeliveryPublication, owner.pin),
    (error) => error.code === "CONTRACT_OBJECT_REQUIRED",
  );
});

test("any acceptance byte change requires owner-signed G-SCOPE", () => {
  const owner = createOwner();
  const prior = makeAuthorization(owner);
  const replacement = makeAuthorization(owner, {
    acceptanceText: "One portfolio run contains exactly 12 repeated slots.",
  });
  assert.throws(
    () => validateSliceAuthorizationReplacement({
      priorAuthorization: prior,
      replacementAuthorization: replacement,
      gScopeDecision: null,
      ownerPin: owner.pin,
    }),
    (error) => error.code === "G_SCOPE_REQUIRED",
  );

  const decision = {
    schemaVersion: "g-scope-acceptance-change/v1",
    repositoryId: prior.repositoryId,
    sliceId: prior.sliceId,
    priorSliceAuthorizationDigest: prior.authorizationDigest,
    priorAcceptanceDigest: computeSliceAcceptanceDigest(prior.sliceAcceptance),
    replacementSliceAuthorizationDigest: replacement.authorizationDigest,
    replacementAcceptanceDigest: computeSliceAcceptanceDigest(replacement.sliceAcceptance),
    reason: "Owner explicitly changes the product acceptance.",
    issuedAt: "2026-07-30T15:10:00.000Z",
    ownerKeyId: owner.pin.ownerKeyId,
    decisionDigest: "pending",
    ownerSignature: "pending",
  };
  decision.decisionDigest = computeGScopeDigest(decision);
  decision.ownerSignature = signEd25519ForTests({
    domain: G_SCOPE_SIGNATURE_DOMAIN,
    body: decisionSigningBody(decision),
    privateKey: owner.pair.privateKey,
  });
  const result = validateSliceAuthorizationReplacement({
    priorAuthorization: prior,
    replacementAuthorization: replacement,
    gScopeDecision: decision,
    ownerPin: owner.pin,
  });
  assert.equal(result.acceptanceChanged, true);
});

test("typed Quant breadth rejects 12 repeated slots even when passed is asserted", () => {
  const chain = buildValidChain();
  const proof = makeProof(
    chain.authorization,
    chain.integrated,
    chain.packageCandidate,
    chain.releaseCandidate,
    12,
  );
  assert.throws(
    () => validateBlackBoxProof(proof, {
      sliceAuthorization: chain.authorization,
      integratedCandidate: chain.integrated,
      packageCandidate: chain.packageCandidate,
      releaseCandidate: chain.releaseCandidate,
      observedEvaluatorDigest: chain.authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
    }),
    (error) => error.code === "BLACK_BOX_BOUND_FAILED",
  );
});

test("integration is sequential fast-forward only", () => {
  const chain = buildValidChain();
  const cherryPick = clone(chain.integrated);
  cherryPick.contributions[0].operation = "cherry-pick";
  cherryPick.candidateDigest = computeIntegratedCandidateDigest(cherryPick);
  assert.throws(
    () => validateIntegratedCandidate(
      cherryPick,
      chain.authorization,
      new Map([[chain.mechanics.assessmentDigest, chain.mechanics]]),
    ),
    (error) => error.code === "INTEGRATION_OPERATION_INVALID",
  );

  const wrongParent = clone(chain.integrated);
  wrongParent.contributions[0].parentRevision = objectId("9");
  wrongParent.candidateDigest = computeIntegratedCandidateDigest(wrongParent);
  assert.throws(
    () => validateIntegratedCandidate(
      wrongParent,
      chain.authorization,
      new Map([[chain.mechanics.assessmentDigest, chain.mechanics]]),
    ),
    (error) => error.code === "INTEGRATION_PARENT_CHAIN_BROKEN",
  );
});

test("reviewer program substitution, role reuse, and candidate mutation block terminal closure", () => {
  const chain = buildValidChain();
  const product = clone(chain.reviews[0]);
  assert.throws(
    () => validateReviewerAssessment(product, {
      sliceAuthorization: chain.authorization,
      integratedCandidate: chain.integrated,
      packageCandidate: chain.packageCandidate,
      releaseCandidate: chain.releaseCandidate,
      blackBoxProof: chain.proof,
      observedExecutableDigest: digest("substituted-reviewer"),
      implementationProcessId: "implementation-process",
    }),
    (error) => error.code === "REVIEW_EXECUTABLE_MISMATCH",
  );

  const reused = chain.reviews.map(clone);
  reused[1].processId = reused[0].processId;
  reused[1].assessmentDigest = computeReviewerAssessmentDigest(reused[1]);
  const terminal = makeTerminal(
    chain.authorization,
    chain.integrated,
    chain.packageCandidate,
    chain.releaseCandidate,
    chain.proof,
    reused,
  );
  assert.throws(
    () => validateTerminalSliceAssessment(terminal, {
      sliceAuthorization: chain.authorization,
      integratedCandidate: chain.integrated,
      packageCandidate: chain.packageCandidate,
      releaseCandidate: chain.releaseCandidate,
      blackBoxProof: chain.proof,
      reviewerAssessments: reused,
    }),
    (error) => error.code === "TERMINAL_REVIEW_PROCESS_REUSE",
  );

  const mutatedCandidate = clone(chain.integrated);
  mutatedCandidate.finalTreeDigest = objectId("b");
  mutatedCandidate.candidateDigest = computeIntegratedCandidateDigest(mutatedCandidate);
  assert.throws(
    () => validateTerminalSliceAssessment(chain.terminal, {
      sliceAuthorization: chain.authorization,
      integratedCandidate: mutatedCandidate,
      packageCandidate: chain.packageCandidate,
      releaseCandidate: chain.releaseCandidate,
      blackBoxProof: chain.proof,
      reviewerAssessments: chain.reviews,
    }),
    (error) => error.code === "TERMINAL_BINDING_MISMATCH",
  );
});

test("candidate mutation advances generation and invalidates earlier terminal evidence", () => {
  const chain = buildValidChain();
  const prior = {
    schemaVersion: "slice-state/v1",
    repositoryId: chain.authorization.repositoryId,
    sliceId: chain.authorization.sliceId,
    generation: 1,
    stage: "TERMINAL_VERIFIED",
    sliceAuthorizationDigest: chain.authorization.authorizationDigest,
    acceptanceDigest: computeSliceAcceptanceDigest(chain.authorization.sliceAcceptance),
    activationDigest: digest("activation"),
    terminalCandidateDigest: chain.integrated.candidateDigest,
    releaseCandidateDigest: chain.releaseCandidate.releaseCandidateDigest,
    certificationCandidateDigest: null,
    terminalAssessmentDigest: chain.terminal.terminalAssessmentDigest,
    publicationObservationDigest: null,
    priorStateDigest: digest("prior-state"),
    supersedesGenerationDigest: null,
    stateDigest: "pending",
  };
  prior.stateDigest = computeSliceStateDigest(prior);
  const next = {
    schemaVersion: "slice-state/v1",
    repositoryId: prior.repositoryId,
    sliceId: prior.sliceId,
    generation: 2,
    stage: "ACTIVE",
    sliceAuthorizationDigest: prior.sliceAuthorizationDigest,
    acceptanceDigest: prior.acceptanceDigest,
    activationDigest: prior.activationDigest,
    terminalCandidateDigest: null,
    releaseCandidateDigest: null,
    certificationCandidateDigest: null,
    terminalAssessmentDigest: null,
    publicationObservationDigest: null,
    priorStateDigest: prior.stateDigest,
    supersedesGenerationDigest: prior.stateDigest,
    stateDigest: "pending",
  };
  next.stateDigest = computeSliceStateDigest(next);
  assert.equal(validateSliceStateTransition(prior, next).generation, 2);

  const retiredAuthorityEvidence = clone(next);
  retiredAuthorityEvidence.certificationCandidateDigest = digest("retired-authority-evidence");
  retiredAuthorityEvidence.stateDigest = computeSliceStateDigest(retiredAuthorityEvidence);
  assert.throws(
    () => validateSliceStateTransition(prior, retiredAuthorityEvidence),
    (error) => error.code === "SLICE_STATE_RETIRED_AUTHORITY_EVIDENCE",
  );

  const illegalReuse = clone(next);
  illegalReuse.terminalAssessmentDigest = chain.terminal.terminalAssessmentDigest;
  illegalReuse.stateDigest = computeSliceStateDigest(illegalReuse);
  assert.throws(
    () => validateSliceStateTransition(prior, illegalReuse),
    (error) => error.code === "SLICE_STATE_GENERATION_EVIDENCE",
  );
});

test("operation bundles publish event and object as one manifest-committed unit", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-operation-bundle-"));
  try {
    const first = buildOperationBundle({
      repositoryId: digest("bundle-repository"),
      sliceId: "S-SEMANTIC-KERNEL-1",
      generation: 1,
      sequence: 1,
      priorEventDigest: digest("operation-genesis"),
      capability: "SLICE_ACTIVATE",
      objectType: "slice-activation/v1",
      objectId: "activation-1",
      objectRelativePath: "active/slice-activation.json",
      authoritativeObjectBody: { schemaVersion: "fixture/v1", value: "activation" },
      custodyClaimDigest: digest("custody-claim-a"),
      controllerInstanceId: "controller-instance-a",
      monotonic: "900",
      occurredAtUtc: "2026-07-30T15:30:00.000Z",
    });
    let head = first.event.priorEventDigest;
    const published = publishOperationBundle({
      stateRoot,
      bundle: first,
      compareAndSwapHead({ expectedPriorEventDigest, nextEventDigest }) {
        assert.equal(head, expectedPriorEventDigest);
        head = nextEventDigest;
      },
    });
    assert.equal(published.event.eventDigest, head);
    assert.equal(published.authoritativeObject.controllerSeal.operationEventDigest, head);
    assert.equal(validateOperationBundle({ bundlePath: published.bundlePath }).event.eventDigest, head);

    const incomplete = path.join(stateRoot, "operation-staging", "incomplete");
    fs.mkdirSync(incomplete, { recursive: true });
    fs.writeFileSync(path.join(incomplete, "operation-event.json"), "{}\n", "utf8");
    assert.throws(
      () => validateOperationBundle({ bundlePath: incomplete }),
      (error) => error.code === "OPERATION_BUNDLE_INCOMPLETE",
    );

    const second = buildOperationBundle({
      repositoryId: first.event.repositoryId,
      sliceId: first.event.sliceId,
      generation: 1,
      sequence: 2,
      priorEventDigest: first.event.eventDigest,
      capability: "RUN_SPEC_SEAL",
      objectType: "run-spec/v2",
      objectId: "run-2",
      objectRelativePath: "runs/run-2.json",
      authoritativeObjectBody: { schemaVersion: "fixture/v1", value: "run" },
      custodyClaimDigest: digest("custody-claim-b"),
      controllerInstanceId: "controller-instance-b",
      monotonic: "1",
      occurredAtUtc: "2026-07-30T15:31:00.000Z",
    });
    assert.equal(validateOperationEvent(second.event).monotonicTimeNs, "1");
    assert.notEqual(second.event.controllerInstanceId, first.event.controllerInstanceId);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("pre-terminal and publication verification perform zero npm pack operations", () => {
  const chain = buildValidChain();
  const tarballPath = path.join(os.tmpdir(), `semantic-release-${crypto.randomUUID()}.tgz`);
  const tarballBytes = Buffer.from("one immutable tarball\n", "utf8");
  fs.writeFileSync(tarballPath, tarballBytes);
  try {
    const packageJson = {
      name: chain.authorization.publicationPolicy.packageName,
      version: chain.authorization.publicationPolicy.version,
    };
    const entries = ["package/lib/index.js", "package/package.json"];
    const tarballDigest = `sha256:${crypto.createHash("sha256").update(tarballBytes).digest("hex")}`;
    const tarballIntegrity = `sha512-${crypto.createHash("sha512").update(tarballBytes).digest("base64")}`;
    const packageCandidate = clone(chain.packageCandidate);
    Object.assign(packageCandidate, {
      tarballDigest,
      tarballIntegrity,
      tarballByteLength: tarballBytes.length,
      packlistDigest: computePacklistDigest(entries),
      packageMetadataDigest: computePackageMetadataDigest(packageJson),
    });
    packageCandidate.packageCandidateDigest = computePackageCandidateDigest(packageCandidate);
    const releaseCandidate = clone(chain.releaseCandidate);
    Object.assign(releaseCandidate, {
      packageCandidateDigest: packageCandidate.packageCandidateDigest,
      tarballDigest,
      tarballIntegrity,
    });
    releaseCandidate.releaseCandidateDigest = computeReleaseCandidateDigest(releaseCandidate);
    const proof = makeProof(chain.authorization, chain.integrated, packageCandidate, releaseCandidate);
    const reviews = ["PRODUCT", "DOMAIN", "CUSTODY"].map((role) => (
      makeReview(role, chain.authorization, chain.integrated, packageCandidate, releaseCandidate, proof)
    ));
    const terminal = makeTerminal(
      chain.authorization,
      chain.integrated,
      packageCandidate,
      releaseCandidate,
      proof,
      reviews,
    );
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, ...args]);
      assert.notEqual(args[0], "pack");
      if (command === "git" && args.join(" ") === "rev-parse HEAD") {
        return { status: 0, stdout: `${chain.integrated.finalHeadRevision}\n`, stderr: "" };
      }
      if (command === "git" && args.join(" ") === "rev-parse HEAD^{tree}") {
        return { status: 0, stdout: `${chain.integrated.finalTreeDigest}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "rev-list") {
        return { status: 0, stdout: `${chain.integrated.finalHeadRevision}\n`, stderr: "" };
      }
      if (command === "tar" && args[0] === "-tf") {
        return { status: 0, stdout: `${entries.join("\n")}\n`, stderr: "" };
      }
      if (command === "tar" && args[0] === "-xOf") {
        return { status: 0, stdout: JSON.stringify(packageJson), stderr: "" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const preterminal = verifyPreterminal({
      targetRoot: process.cwd(),
      tarballPath,
      sliceAuthorization: chain.authorization,
      integratedCandidate: chain.integrated,
      packageCandidate,
      releaseCandidate,
      runner,
      verifiedAt: "2026-07-30T17:25:00.000Z",
    });
    assert.equal(preterminal.npmPackInvocationCount, 0);
    const publication = verifyPublication({
      targetRoot: process.cwd(),
      tarballPath,
      sliceAuthorization: chain.authorization,
      integratedCandidate: chain.integrated,
      packageCandidate,
      releaseCandidate,
      blackBoxProof: proof,
      reviewerAssessments: reviews,
      terminalAssessment: terminal,
      runner,
      verifiedAt: "2026-07-30T17:50:00.000Z",
    });
    assert.equal(publication.npmPackInvocationCount, 0);
    assert.equal(calls.some((call) => call[0] === "npm"), false);
  } finally {
    fs.rmSync(tarballPath, { force: true });
  }
});

test("publication command success is non-authoritative without exact registry reconciliation", () => {
  const chain = buildValidChain();
  const verification = {
    schemaVersion: "release-publication-verification/v1",
    releaseCandidateDigest: chain.releaseCandidate.releaseCandidateDigest,
    tarballDigest: chain.releaseCandidate.tarballDigest,
    tarballIntegrity: chain.releaseCandidate.tarballIntegrity,
    npmPackInvocationCount: 0,
  };
  let invocation = 0;
  const exact = publishAndReconcile({
    targetRoot: process.cwd(),
    tarballPath: "candidate.tgz",
    sliceAuthorization: chain.authorization,
    releaseCandidate: chain.releaseCandidate,
    publicationVerification: verification,
    requestStartedAt: "2026-07-30T18:00:00.000Z",
    observedAt: "2026-07-30T18:01:00.000Z",
    runner(command, args) {
      invocation += 1;
      if (args[0] === "publish") {
        return { status: 1, timedOut: true, error: new Error("timeout"), stdout: "", stderr: "timeout" };
      }
      return {
        status: 0,
        timedOut: false,
        error: null,
        stdout: JSON.stringify({
          version: chain.releaseCandidate.version,
          "dist.integrity": chain.releaseCandidate.tarballIntegrity,
        }),
        stderr: "",
      };
    },
  });
  assert.equal(exact.observation.disposition, "PUBLISHED_EXACT");
  assert.equal(exact.localPublishTimedOut, true);
  assert.equal(invocation, 2);

  const unknown = publishAndReconcile({
    targetRoot: process.cwd(),
    tarballPath: "candidate.tgz",
    sliceAuthorization: chain.authorization,
    releaseCandidate: chain.releaseCandidate,
    publicationVerification: verification,
    requestStartedAt: "2026-07-30T18:00:00.000Z",
    observedAt: "2026-07-30T18:01:00.000Z",
    runner(command, args) {
      if (args[0] === "publish") {
        return { status: 0, timedOut: false, error: null, stdout: "ok", stderr: "" };
      }
      return { status: null, timedOut: true, error: new Error("timeout"), stdout: "", stderr: "" };
    },
  });
  assert.equal(unknown.observation.disposition, "PUBLICATION_OUTCOME_UNKNOWN");
  assert.equal(unknown.localPublishExitCode, 0);
});

test("publication closure requires independently observed exact registry integrity", () => {
  const chain = buildValidChain();
  const observation = {
    schemaVersion: "publication-observation/v1",
    sliceId: chain.authorization.sliceId,
    generation: 1,
    releaseCandidateDigest: chain.releaseCandidate.releaseCandidateDigest,
    registry: chain.releaseCandidate.registry,
    packageName: chain.releaseCandidate.packageName,
    version: chain.releaseCandidate.version,
    requestedTarballDigest: chain.releaseCandidate.tarballDigest,
    requestedTarballIntegrity: chain.releaseCandidate.tarballIntegrity,
    commandIdentityDigest: digest("publish-command"),
    requestStartedAt: "2026-07-30T18:00:00.000Z",
    processExitCode: 0,
    processTimedOut: false,
    processStdoutDigest: digest("publish-stdout"),
    processStderrDigest: digest("publish-stderr"),
    registryVersionObserved: chain.releaseCandidate.version,
    registryIntegrityObserved: chain.releaseCandidate.tarballIntegrity,
    observedAt: "2026-07-30T18:01:00.000Z",
    disposition: "PUBLISHED_EXACT",
    observationDigest: "pending",
  };
  observation.observationDigest = computePublicationObservationDigest(observation);
  const validated = validatePublicationObservation(observation, chain.releaseCandidate, chain.authorization);
  assert.equal(validated.disposition, "PUBLISHED_EXACT");

  const closure = {
    schemaVersion: "canonical-closure-projection/v1",
    repositoryId: chain.authorization.repositoryId,
    sliceId: chain.authorization.sliceId,
    generation: 1,
    sliceAcceptanceDigest: chain.terminal.sliceAcceptanceDigest,
    terminalAssessmentDigest: chain.terminal.terminalAssessmentDigest,
    releaseCandidateDigest: chain.releaseCandidate.releaseCandidateDigest,
    finalCommit: chain.integrated.finalHeadRevision,
    finalTree: chain.integrated.finalTreeDigest,
    tarballDigest: chain.releaseCandidate.tarballDigest,
    publicationObservationDigest: observation.observationDigest,
    publicationState: "PUBLISHED_EXACT",
    closedAt: observation.observedAt,
    nextSliceState: "AWAITING_OWNER_AUTHORIZATION",
    projectionDigest: "pending",
  };
  closure.projectionDigest = computeCanonicalClosureProjectionDigest(closure);
  assert.equal(validateCanonicalClosureProjection(closure, {
    sliceAuthorization: chain.authorization,
    integratedCandidate: chain.integrated,
    releaseCandidate: chain.releaseCandidate,
    terminalAssessment: chain.terminal,
    publicationObservation: observation,
  }).closedAt, observation.observedAt);

  const localOnly = clone(observation);
  localOnly.registryIntegrityObserved = null;
  localOnly.observationDigest = computePublicationObservationDigest(localOnly);
  assert.throws(
    () => validatePublicationObservation(localOnly, chain.releaseCandidate, chain.authorization),
    (error) => error.code === "PUBLICATION_EXACT_UNPROVEN",
  );
});
