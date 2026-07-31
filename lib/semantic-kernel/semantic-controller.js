"use strict";

const { spawnSync } = require("node:child_process");

const { canonicalize } = require("../contracts/canonical-json");
const { domainDigest } = require("../contracts/digest");
const {
  advanceActiveSliceIndex,
  initializeActiveSliceIndex,
  readActiveSliceIndex,
  reserveCounter,
  takeoverExpiredLease,
} = require("./active-slice-index");
const { createControllerInstanceId, exactUtcNow } = require("./clock");
const { contractError, immutable, requireDigest, requireExactKeys } = require("./contract-utils");
const { resolveInstalledControllerBinding } = require("./controller-binding");
const { validateMechanicsAssessment } = require("./mechanics-assessment");
const { validateIntegratedCandidate } = require("./integrated-candidate");
const { validatePackageCandidate, validateReleaseCandidate } = require("./release-candidate");
const { validateBlackBoxProof } = require("./black-box-proof");
const { validateReviewerAssessment } = require("./reviewer-assessment");
const { validateTerminalSliceAssessment } = require("./terminal-slice-assessment");
const {
  validateCanonicalClosureProjection,
  validatePublicationObservation,
} = require("./publication");
const {
  buildOperationBundle,
  loadCommittedOperation,
  publishOperationBundle,
} = require("./operation-bundle");
const { loadOwnerPin } = require("./owner-pin");
const { resolveRepositoryStateRoot } = require("./repository-state");
const { validateRunSpec } = require("./run-spec-v2");
const { createSliceActivation, validateSliceActivation } = require("./slice-activation");
const {
  computeSliceAcceptanceDigest,
  validateSliceAuthorization,
} = require("./slice-authorization");
const {
  computeSliceStateDigest,
  validateSliceState,
  validateSliceStateTransition,
} = require("./slice-state");

const ACTIVATION_COMMIT_SCHEMA = "slice-activation-commit/v1";
const ACTIVATION_COMMIT_DOMAIN = "meta-harness-slice-activation-commit/v1";
const OPERATION_GENESIS_DOMAIN = "meta-harness-operation-genesis/v1";
const CONTROLLER_BINDING_DOMAIN = "meta-harness-controller-binding/v1";
const CUSTODY_CLAIM_DOMAIN = "meta-harness-controller-custody-claim/v1";

function gitValue(repositoryPath, args) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw contractError(
      "SEMANTIC_CONTROLLER_GIT",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return String(result.stdout || "").trim();
}

function assertInstalledBinding(authorization, packageRoot) {
  const installed = resolveInstalledControllerBinding(packageRoot);
  if (canonicalize(authorization.controllerBinding) !== canonicalize(installed)) {
    throw contractError(
      "CONTROLLER_BINDING_MISMATCH",
      "owner-authorized controller program, launcher, policy, custody, or clock digest differs from installed runtime",
      { authorized: authorization.controllerBinding, installed },
    );
  }
  return installed;
}

function controllerBindingDigest(binding) {
  return domainDigest(CONTROLLER_BINDING_DOMAIN, binding);
}

function custodyClaimDigest({ state, binding, controllerInstanceId }) {
  return domainDigest(CUSTODY_CLAIM_DOMAIN, {
    repositoryId: state.repositoryIdentityDigest,
    stateRootKey: state.stateRootKey,
    controllerBindingDigest: controllerBindingDigest(binding),
    controllerInstanceId,
  });
}

function operationGenesisDigest(repositoryId) {
  return domainDigest(OPERATION_GENESIS_DOMAIN, { repositoryId });
}

function activationCommitBody(activation, initialState) {
  const body = {
    schemaVersion: ACTIVATION_COMMIT_SCHEMA,
    activation,
    initialState,
    activationCommitDigest: "pending",
  };
  body.activationCommitDigest = domainDigest(ACTIVATION_COMMIT_DOMAIN, {
    schemaVersion: body.schemaVersion,
    activation: body.activation,
    initialState: body.initialState,
  });
  return immutable(body);
}

function validateActivationCommit(value, authorization) {
  requireExactKeys(
    value,
    ["schemaVersion", "activation", "initialState", "activationCommitDigest"],
    "SliceActivationCommit",
  );
  if (value.schemaVersion !== ACTIVATION_COMMIT_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `SliceActivationCommit schema must be ${ACTIVATION_COMMIT_SCHEMA}`);
  }
  requireDigest(value.activationCommitDigest, "SliceActivationCommit.activationCommitDigest");
  const expected = domainDigest(ACTIVATION_COMMIT_DOMAIN, {
    schemaVersion: value.schemaVersion,
    activation: value.activation,
    initialState: value.initialState,
  });
  if (value.activationCommitDigest !== expected) {
    throw contractError("SLICE_ACTIVATION_COMMIT_DIGEST_MISMATCH", "SliceActivationCommit digest does not match");
  }
  const activation = validateSliceActivation(value.activation, authorization);
  const state = validateSliceState(value.initialState);
  const stateExpected = {
    repositoryId: authorization.repositoryId,
    sliceId: authorization.sliceId,
    generation: activation.generation,
    stage: "ACTIVE",
    sliceAuthorizationDigest: authorization.authorizationDigest,
    acceptanceDigest: activation.sliceAcceptanceDigest,
    activationDigest: activation.activationDigest,
  };
  for (const [field, expectedValue] of Object.entries(stateExpected)) {
    if (state[field] !== expectedValue) {
      throw contractError("SLICE_ACTIVATION_STATE_MISMATCH", `initial SliceState.${field} differs from activation`);
    }
  }
  return immutable({ activation, initialState: state, activationCommitDigest: value.activationCommitDigest });
}

function loadCurrentState(stateRoot, activeIndex, authorization) {
  const committed = loadCommittedOperation(stateRoot, activeIndex.activeStateEventDigest);
  const body = committed.authoritativeObject.objectBody;
  let state;
  if (committed.event.objectType === ACTIVATION_COMMIT_SCHEMA) {
    state = validateActivationCommit(body, authorization).initialState;
  } else if (committed.event.objectType === "slice-state/v1") {
    state = validateSliceState(body);
  } else {
    throw contractError(
      "ACTIVE_STATE_EVENT_INVALID",
      `activeStateEventDigest points to ${committed.event.objectType}, not an authoritative slice state`,
    );
  }
  if (state.stateDigest !== activeIndex.activeStateDigest
    || state.generation !== activeIndex.activeGeneration
    || state.stage !== activeIndex.stage
    || state.sliceId !== activeIndex.activeSliceId) {
    throw contractError("ACTIVE_STATE_INDEX_MISMATCH", "repository-global index and committed SliceState differ");
  }
  return Object.freeze({ state, committed });
}

function validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot }) {
  const state = resolveRepositoryStateRoot(repositoryPath);
  const owner = loadOwnerPin(repositoryPath);
  const head = gitValue(repositoryPath, ["rev-parse", "HEAD"]);
  const authorization = validateSliceAuthorization(sliceAuthorization, owner.pin, {
    repositoryId: state.repositoryIdentityDigest,
  });
  const binding = assertInstalledBinding(authorization, packageRoot);
  const activeIndex = readActiveSliceIndex(state.stateRoot);
  if (!activeIndex) {
    throw contractError("ACTIVE_SLICE_REQUIRED", "repository-global active slice is not activated");
  }
  if (activeIndex.activeSliceId !== authorization.sliceId
    || activeIndex.controllerBindingDigest !== controllerBindingDigest(binding)) {
    throw contractError("ACTIVE_SLICE_AUTHORIZATION_MISMATCH", "active slice does not match owner authorization or installed controller binding");
  }
  if (activeIndex.leaseControllerInstanceId !== controllerInstanceId) {
    throw contractError("ACTIVE_LEASE_OWNER_MISMATCH", "controller instance does not own the active lease");
  }
  const current = loadCurrentState(state.stateRoot, activeIndex, authorization);
  return Object.freeze({ state, owner, authorization, binding, activeIndex, currentState: current.state, head });
}

function activateSlice({
  repositoryPath,
  sliceAuthorization,
  controllerInstanceId = createControllerInstanceId(),
  leaseSeconds = 300,
  packageRoot,
  activatedAt = exactUtcNow(),
}) {
  const state = resolveRepositoryStateRoot(repositoryPath);
  const owner = loadOwnerPin(repositoryPath);
  const head = gitValue(repositoryPath, ["rev-parse", "HEAD"]);
  const authorization = validateSliceAuthorization(sliceAuthorization, owner.pin, {
    repositoryId: state.repositoryIdentityDigest,
    initialBaseRevision: head,
  });
  const binding = assertInstalledBinding(authorization, packageRoot);
  if (readActiveSliceIndex(state.stateRoot) !== null) {
    throw contractError("ACTIVE_SLICE_EXISTS", "another slice remains active in the repository-global state universe");
  }
  const activation = createSliceActivation({
    sliceAuthorization: authorization,
    ownerPin: owner.pin,
    repositoryId: state.repositoryIdentityDigest,
    initialBaseRevision: head,
    activatedAt,
  });
  const initialStateBody = {
    schemaVersion: "slice-state/v1",
    repositoryId: authorization.repositoryId,
    sliceId: authorization.sliceId,
    generation: activation.generation,
    stage: "ACTIVE",
    sliceAuthorizationDigest: authorization.authorizationDigest,
    acceptanceDigest: activation.sliceAcceptanceDigest,
    activationDigest: activation.activationDigest,
    terminalCandidateDigest: null,
    releaseCandidateDigest: null,
    terminalAssessmentDigest: null,
    publicationObservationDigest: null,
    priorStateDigest: null,
    supersedesGenerationDigest: null,
    stateDigest: "pending",
  };
  initialStateBody.stateDigest = computeSliceStateDigest(initialStateBody);
  const initialState = validateSliceState(initialStateBody);
  const commit = activationCommitBody(activation, initialState);
  const bindingDigest = controllerBindingDigest(binding);
  const bundle = buildOperationBundle({
    repositoryId: state.repositoryIdentityDigest,
    sliceId: authorization.sliceId,
    generation: activation.generation,
    sequence: 1,
    priorEventDigest: operationGenesisDigest(state.repositoryIdentityDigest),
    capability: "SLICE_ACTIVATE",
    objectType: ACTIVATION_COMMIT_SCHEMA,
    objectId: activation.activationDigest,
    objectRelativePath: "active/slice-activation-commit.json",
    authoritativeObjectBody: commit,
    custodyClaimDigest: custodyClaimDigest({ state, binding, controllerInstanceId }),
    controllerInstanceId,
    occurredAtUtc: activatedAt,
  });
  let activatedIndex;
  const published = publishOperationBundle({
    stateRoot: state.stateRoot,
    bundle,
    compareAndSwapHead({ expectedPriorEventDigest, nextEventDigest }) {
      if (expectedPriorEventDigest !== operationGenesisDigest(state.repositoryIdentityDigest)) {
        throw contractError("SLICE_ACTIVATION_GENESIS_MISMATCH", "activation event does not bind repository operation genesis");
      }
      activatedIndex = initializeActiveSliceIndex({
        stateRoot: state.stateRoot,
        repositoryId: state.repositoryIdentityDigest,
        sliceId: authorization.sliceId,
        generation: activation.generation,
        stateDigest: initialState.stateDigest,
        activeStateEventDigest: nextEventDigest,
        operationEventHead: nextEventDigest,
        controllerBindingDigest: bindingDigest,
        controllerInstanceId,
        leaseSeconds,
      });
    },
  });
  return Object.freeze({
    state,
    authorization,
    activation,
    initialState,
    operation: published,
    activeIndex: activatedIndex,
    controllerInstanceId,
  });
}

function takeoverSliceLease({
  repositoryPath,
  sliceAuthorization,
  expectedPriorIndexDigest,
  priorLeaseOwnerClaimDigest,
  replacementControllerInstanceId = createControllerInstanceId(),
  leaseSeconds = 300,
  packageRoot,
}) {
  const state = resolveRepositoryStateRoot(repositoryPath);
  const owner = loadOwnerPin(repositoryPath);
  const authorization = validateSliceAuthorization(sliceAuthorization, owner.pin, {
    repositoryId: state.repositoryIdentityDigest,
  });
  const binding = assertInstalledBinding(authorization, packageRoot);
  const current = readActiveSliceIndex(state.stateRoot);
  if (!current) throw contractError("ACTIVE_SLICE_REQUIRED", "no active slice exists for lease takeover");
  const next = takeoverExpiredLease({
    stateRoot: state.stateRoot,
    expectedPriorIndexDigest,
    sliceId: current.activeSliceId,
    generation: current.activeGeneration,
    stateDigest: current.activeStateDigest,
    operationEventHead: current.operationEventHead,
    priorLeaseOwnerClaimDigest,
    controllerBindingDigest: controllerBindingDigest(binding),
    replacementControllerInstanceId,
    leaseSeconds,
  });
  return Object.freeze({ activeIndex: next, controllerInstanceId: replacementControllerInstanceId });
}

function reserveExecutionAttempt({
  repositoryPath,
  sliceAuthorization,
  controllerInstanceId,
  packageRoot,
}) {
  const context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  return reserveCounter({
    stateRoot: context.state.stateRoot,
    expectedPriorIndexDigest: context.activeIndex.indexDigest,
    controllerInstanceId,
    counter: "attemptCount",
    maximum: context.authorization.executionLimits.maxAttempts,
  });
}

function appendNonStateObject({ context, controllerInstanceId, capability, objectType, objectId, objectRelativePath, objectBody }) {
  const currentOperation = loadCommittedOperation(context.state.stateRoot, context.activeIndex.operationEventHead);
  const bundle = buildOperationBundle({
    repositoryId: context.state.repositoryIdentityDigest,
    sliceId: context.authorization.sliceId,
    generation: context.activeIndex.activeGeneration,
    sequence: currentOperation.event.sequence + 1,
    priorEventDigest: context.activeIndex.operationEventHead,
    capability,
    objectType,
    objectId,
    objectRelativePath,
    authoritativeObjectBody: objectBody,
    custodyClaimDigest: custodyClaimDigest({ state: context.state, binding: context.binding, controllerInstanceId }),
    controllerInstanceId,
  });
  let nextIndex;
  const published = publishOperationBundle({
    stateRoot: context.state.stateRoot,
    bundle,
    compareAndSwapHead({ expectedPriorEventDigest, nextEventDigest }) {
      nextIndex = advanceActiveSliceIndex({
        stateRoot: context.state.stateRoot,
        expectedPriorIndexDigest: context.activeIndex.indexDigest,
        controllerInstanceId,
        expectedPriorEventDigest,
        nextEventDigest,
        nextStateDigest: context.currentState.stateDigest,
        nextStage: context.currentState.stage,
      });
    },
  });
  return Object.freeze({ published, activeIndex: nextIndex });
}

function sealRunSpec({
  repositoryPath,
  sliceAuthorization,
  runSpec,
  controllerInstanceId,
  packageRoot,
}) {
  let context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  if (context.currentState.stage !== "ACTIVE") {
    throw contractError("RUN_SPEC_SLICE_STAGE", "RunSpec may be sealed only while the current generation is ACTIVE");
  }
  const validated = validateRunSpec(runSpec, context.authorization, {
    expectedParentRevision: context.head,
    generation: context.activeIndex.activeGeneration,
    nowUtc: exactUtcNow(),
  });
  const reserved = reserveCounter({
    stateRoot: context.state.stateRoot,
    expectedPriorIndexDigest: context.activeIndex.indexDigest,
    controllerInstanceId,
    counter: "runSpecCount",
    maximum: context.authorization.executionLimits.maxRunSpecs,
  });
  context = Object.freeze({ ...context, activeIndex: reserved });
  const appended = appendNonStateObject({
    context,
    controllerInstanceId,
    capability: "RUN_SPEC_SEAL",
    objectType: "run-spec/v2",
    objectId: validated.runSpecDigest,
    objectRelativePath: `runs/${validated.runId}.json`,
    objectBody: validated,
  });
  return Object.freeze({ runSpec: validated, operation: appended.published, activeIndex: appended.activeIndex });
}

function recordMechanicsAssessment({
  repositoryPath,
  sliceAuthorization,
  runSpec,
  mechanicsAssessment,
  controllerInstanceId,
  packageRoot,
}) {
  const context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const validatedRunSpec = validateRunSpec(runSpec, context.authorization, {
    expectedParentRevision: mechanicsAssessment.parentRevision,
    generation: context.activeIndex.activeGeneration,
  });
  if (context.head !== mechanicsAssessment.contributedRevision) {
    throw contractError("MECHANICS_HEAD_MISMATCH", "target HEAD does not equal the claimed contributed revision");
  }
  const parents = gitValue(repositoryPath, ["rev-list", "--parents", "-n", "1", context.head]).split(/\s+/);
  if (parents.length !== 2 || parents[1] !== mechanicsAssessment.parentRevision) {
    throw contractError("MECHANICS_PARENT_MISMATCH", "mechanics contribution must be one non-merge commit on the exact RunSpec parent");
  }
  const observedTree = gitValue(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
  if (observedTree !== mechanicsAssessment.resultingTree) {
    throw contractError("MECHANICS_TREE_MISMATCH", "observed target tree differs from MechanicsAssessment");
  }
  const observedPaths = gitValue(repositoryPath, [
    "diff",
    "--name-only",
    "--no-renames",
    `${mechanicsAssessment.parentRevision}..${mechanicsAssessment.contributedRevision}`,
  ]).split(/\r?\n/).filter(Boolean).sort();
  if (JSON.stringify(observedPaths) !== JSON.stringify(mechanicsAssessment.changedPaths)) {
    throw contractError("MECHANICS_CHANGED_PATH_MISMATCH", "observed Git changed paths differ from MechanicsAssessment");
  }
  if (gitValue(repositoryPath, ["status", "--porcelain"]) !== "") {
    throw contractError("MECHANICS_TARGET_DIRTY", "target worktree must be clean before mechanics assessment is recorded");
  }
  const validatedAssessment = validateMechanicsAssessment(
    mechanicsAssessment,
    validatedRunSpec,
    context.authorization,
    {
      expectedContributedRevision: mechanicsAssessment.contributedRevision,
      expectedTree: mechanicsAssessment.resultingTree,
    },
  );
  const appended = appendNonStateObject({
    context,
    controllerInstanceId,
    capability: "MECHANICS_ASSESS",
    objectType: "mechanics-assessment/v1",
    objectId: validatedAssessment.assessmentDigest,
    objectRelativePath: `mechanics/${validatedRunSpec.runId}.json`,
    objectBody: validatedAssessment,
  });
  return Object.freeze({
    mechanicsAssessment: validatedAssessment,
    operation: appended.published,
    activeIndex: appended.activeIndex,
  });
}

function transitionSliceState({
  repositoryPath,
  sliceAuthorization,
  nextState,
  controllerInstanceId,
  capability,
  packageRoot,
}) {
  const context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const validatedNext = validateSliceStateTransition(context.currentState, nextState);
  const currentOperation = loadCommittedOperation(context.state.stateRoot, context.activeIndex.operationEventHead);
  const bundle = buildOperationBundle({
    repositoryId: context.state.repositoryIdentityDigest,
    sliceId: context.authorization.sliceId,
    generation: validatedNext.generation,
    sequence: currentOperation.event.sequence + 1,
    priorEventDigest: context.activeIndex.operationEventHead,
    capability,
    objectType: "slice-state/v1",
    objectId: validatedNext.stateDigest,
    objectRelativePath: `active/slice-state-generation-${validatedNext.generation}.json`,
    authoritativeObjectBody: validatedNext,
    custodyClaimDigest: custodyClaimDigest({ state: context.state, binding: context.binding, controllerInstanceId }),
    controllerInstanceId,
  });
  let nextIndex;
  const published = publishOperationBundle({
    stateRoot: context.state.stateRoot,
    bundle,
    compareAndSwapHead({ expectedPriorEventDigest, nextEventDigest }) {
      nextIndex = advanceActiveSliceIndex({
        stateRoot: context.state.stateRoot,
        expectedPriorIndexDigest: context.activeIndex.indexDigest,
        controllerInstanceId,
        expectedPriorEventDigest,
        nextEventDigest,
        nextStateDigest: validatedNext.stateDigest,
        nextStateEventDigest: nextEventDigest,
        nextStage: validatedNext.stage,
        nextGeneration: validatedNext.generation,
      });
    },
  });
  return Object.freeze({ state: validatedNext, operation: published, activeIndex: nextIndex });
}

function nextSliceState(currentState, stage, changes = {}) {
  const body = {
    schemaVersion: "slice-state/v1",
    repositoryId: currentState.repositoryId,
    sliceId: currentState.sliceId,
    generation: currentState.generation,
    stage,
    sliceAuthorizationDigest: currentState.sliceAuthorizationDigest,
    acceptanceDigest: currentState.acceptanceDigest,
    activationDigest: currentState.activationDigest,
    terminalCandidateDigest: currentState.terminalCandidateDigest,
    releaseCandidateDigest: currentState.releaseCandidateDigest,
    terminalAssessmentDigest: currentState.terminalAssessmentDigest,
    publicationObservationDigest: currentState.publicationObservationDigest,
    priorStateDigest: currentState.stateDigest,
    supersedesGenerationDigest: currentState.supersedesGenerationDigest,
    ...changes,
    stateDigest: "pending",
  };
  body.stateDigest = computeSliceStateDigest(body);
  return validateSliceStateTransition(currentState, body);
}

function recordTerminalCandidate({
  repositoryPath,
  sliceAuthorization,
  integratedCandidate,
  mechanicsByDigest,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  reviewerAssessments,
  controllerInstanceId,
  implementationProcessId,
  packageRoot,
}) {
  let context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  if (context.currentState.stage !== "ACTIVE") {
    throw contractError("TERMINAL_CANDIDATE_STAGE", "terminal candidate may be recorded only from ACTIVE");
  }
  const integrated = validateIntegratedCandidate(
    integratedCandidate,
    context.authorization,
    mechanicsByDigest,
    { generation: context.currentState.generation },
  );
  const packaged = validatePackageCandidate(packageCandidate, integrated, context.authorization);
  const release = validateReleaseCandidate(releaseCandidate, packaged, integrated, context.authorization);
  const proof = validateBlackBoxProof(blackBoxProof, {
    sliceAuthorization: context.authorization,
    integratedCandidate: integrated,
    packageCandidate: packaged,
    releaseCandidate: release,
    observedEvaluatorDigest: context.authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
  });
  if (!Array.isArray(reviewerAssessments) || reviewerAssessments.length !== 3) {
    throw contractError("TERMINAL_REVIEW_COUNT", "terminal candidate requires exactly three reviewer assessments");
  }
  const reviews = reviewerAssessments.map((review) => validateReviewerAssessment(review, {
    sliceAuthorization: context.authorization,
    integratedCandidate: integrated,
    packageCandidate: packaged,
    releaseCandidate: release,
    blackBoxProof: proof,
    observedExecutableDigest: review.processExecutableDigest,
    implementationProcessId,
  }));
  const roles = reviews.map((review) => review.role).sort();
  if (JSON.stringify(roles) !== JSON.stringify(["CUSTODY", "DOMAIN", "PRODUCT"])) {
    throw contractError("TERMINAL_REVIEW_ROLES", "terminal candidate requires PRODUCT, DOMAIN, and CUSTODY roles");
  }

  const evidence = [
    ["INTEGRATE", "integrated-candidate/v1", integrated.candidateDigest, `candidates/integrated-generation-${integrated.generation}.json`, integrated],
    ["PACKAGE_FREEZE", "package-candidate/v1", packaged.packageCandidateDigest, `release/package-generation-${integrated.generation}.json`, packaged],
    ["PACKAGE_FREEZE", "release-candidate/v1", release.releaseCandidateDigest, `release/release-generation-${integrated.generation}.json`, release],
    ["PROOF_EXECUTE", "black-box-proof/v1", proof.proofDigest, `proof/black-box-generation-${integrated.generation}.json`, proof],
    ...reviews.map((review) => [
      "REVIEW_ORCHESTRATE",
      "reviewer-assessment/v1",
      review.assessmentDigest,
      `reviews/${review.role.toLowerCase()}-generation-${integrated.generation}.json`,
      review,
    ]),
  ];
  const operations = [];
  for (const [capability, objectType, objectId, relativePath, object] of evidence) {
    context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
    const appended = appendNonStateObject({
      context,
      controllerInstanceId,
      capability,
      objectType,
      objectId,
      objectRelativePath: relativePath,
      objectBody: object,
    });
    operations.push(appended.published);
  }
  context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const terminalCandidateDigest = domainDigest("meta-harness-terminal-candidate/v1", {
    generation: integrated.generation,
    integratedCandidateDigest: integrated.candidateDigest,
    packageCandidateDigest: packaged.packageCandidateDigest,
    releaseCandidateDigest: release.releaseCandidateDigest,
    blackBoxProofDigest: proof.proofDigest,
    reviewerAssessmentDigests: reviews
      .map((review) => ({ role: review.role, digest: review.assessmentDigest }))
      .sort((left, right) => left.role.localeCompare(right.role)),
  });
  const state = nextSliceState(context.currentState, "TERMINAL_CANDIDATE", {
    terminalCandidateDigest,
    releaseCandidateDigest: release.releaseCandidateDigest,
  });
  const transition = transitionSliceState({
    repositoryPath,
    sliceAuthorization,
    nextState: state,
    controllerInstanceId,
    capability: "REVIEW_ORCHESTRATE",
    packageRoot,
  });
  return Object.freeze({ integrated, packageCandidate: packaged, releaseCandidate: release, proof, reviews, operations, transition });
}

function recordTerminalAssessment({
  repositoryPath,
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  reviewerAssessments,
  terminalAssessment,
  controllerInstanceId,
  packageRoot,
}) {
  let context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  if (context.currentState.stage !== "TERMINAL_CANDIDATE") {
    throw contractError("TERMINAL_ASSESSMENT_STAGE", "terminal assessment requires TERMINAL_CANDIDATE state");
  }
  const terminal = validateTerminalSliceAssessment(terminalAssessment, {
    sliceAuthorization: context.authorization,
    integratedCandidate,
    packageCandidate,
    releaseCandidate,
    blackBoxProof,
    reviewerAssessments,
  });
  const appended = appendNonStateObject({
    context,
    controllerInstanceId,
    capability: "TERMINAL_ASSESS",
    objectType: "terminal-slice-assessment/v1",
    objectId: terminal.terminalAssessmentDigest,
    objectRelativePath: `terminal/assessment-generation-${terminal.generation}.json`,
    objectBody: terminal,
  });
  context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const state = nextSliceState(context.currentState, "TERMINAL_VERIFIED", {
    terminalAssessmentDigest: terminal.terminalAssessmentDigest,
  });
  const transition = transitionSliceState({
    repositoryPath,
    sliceAuthorization,
    nextState: state,
    controllerInstanceId,
    capability: "TERMINAL_ASSESS",
    packageRoot,
  });
  return Object.freeze({ terminalAssessment: terminal, operation: appended.published, transition });
}

function recordPublicationObservation({
  repositoryPath,
  sliceAuthorization,
  releaseCandidate,
  publicationObservation,
  controllerInstanceId,
  packageRoot,
}) {
  let context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  if (context.currentState.stage !== "TERMINAL_VERIFIED") {
    throw contractError("PUBLICATION_OBSERVATION_STAGE", "publication observation requires TERMINAL_VERIFIED state");
  }
  const observation = validatePublicationObservation(publicationObservation, releaseCandidate, context.authorization);
  if (observation.disposition !== "PUBLISHED_EXACT") {
    throw contractError("PUBLICATION_NOT_EXACT", "only PUBLISHED_EXACT may advance the active slice");
  }
  const appended = appendNonStateObject({
    context,
    controllerInstanceId,
    capability: "PUBLICATION_OBSERVE",
    objectType: "publication-observation/v1",
    objectId: observation.observationDigest,
    objectRelativePath: `publication/observation-generation-${observation.generation}.json`,
    objectBody: observation,
  });
  context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const state = nextSliceState(context.currentState, "PUBLISHED", {
    publicationObservationDigest: observation.observationDigest,
  });
  const transition = transitionSliceState({
    repositoryPath,
    sliceAuthorization,
    nextState: state,
    controllerInstanceId,
    capability: "PUBLICATION_OBSERVE",
    packageRoot,
  });
  return Object.freeze({ publicationObservation: observation, operation: appended.published, transition });
}

function closeSlice({
  repositoryPath,
  sliceAuthorization,
  integratedCandidate,
  releaseCandidate,
  terminalAssessment,
  publicationObservation,
  canonicalClosureProjection,
  controllerInstanceId,
  packageRoot,
}) {
  let context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  if (context.currentState.stage !== "PUBLISHED") {
    throw contractError("SLICE_CLOSE_STAGE", "canonical closure requires PUBLISHED state");
  }
  const projection = validateCanonicalClosureProjection(canonicalClosureProjection, {
    sliceAuthorization: context.authorization,
    integratedCandidate,
    releaseCandidate,
    terminalAssessment,
    publicationObservation,
  });
  const appended = appendNonStateObject({
    context,
    controllerInstanceId,
    capability: "SLICE_CLOSE",
    objectType: "canonical-closure-projection/v1",
    objectId: projection.projectionDigest,
    objectRelativePath: `closure/projection-generation-${projection.generation}.json`,
    objectBody: projection,
  });
  context = validateActiveContext({ repositoryPath, sliceAuthorization, controllerInstanceId, packageRoot });
  const state = nextSliceState(context.currentState, "CLOSED");
  const transition = transitionSliceState({
    repositoryPath,
    sliceAuthorization,
    nextState: state,
    controllerInstanceId,
    capability: "SLICE_CLOSE",
    packageRoot,
  });
  return Object.freeze({ canonicalClosureProjection: projection, operation: appended.published, transition });
}

module.exports = {
  ACTIVATION_COMMIT_DOMAIN,
  ACTIVATION_COMMIT_SCHEMA,
  CONTROLLER_BINDING_DOMAIN,
  CUSTODY_CLAIM_DOMAIN,
  OPERATION_GENESIS_DOMAIN,
  activateSlice,
  activationCommitBody,
  assertInstalledBinding,
  controllerBindingDigest,
  custodyClaimDigest,
  closeSlice,
  loadCurrentState,
  nextSliceState,
  operationGenesisDigest,
  recordMechanicsAssessment,
  recordPublicationObservation,
  recordTerminalAssessment,
  recordTerminalCandidate,
  reserveExecutionAttempt,
  sealRunSpec,
  takeoverSliceLease,
  transitionSliceState,
  validateActiveContext,
  validateActivationCommit,
};
