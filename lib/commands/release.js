"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { loadOwnerPin, validateOwnerPin } = require("../semantic-kernel/owner-pin");
const { validateSliceAuthorization } = require("../semantic-kernel/slice-authorization");
const { validateRunSpec } = require("../semantic-kernel/run-spec-v2");
const { validateMechanicsAssessment } = require("../semantic-kernel/mechanics-assessment");
const { validateIntegratedCandidate } = require("../semantic-kernel/integrated-candidate");
const { validatePackageCandidate, validateReleaseCandidate } = require("../semantic-kernel/release-candidate");
const { validateBlackBoxProof } = require("../semantic-kernel/black-box-proof");
const { validateReviewerAssessment } = require("../semantic-kernel/reviewer-assessment");
const { validateTerminalSliceAssessment } = require("../semantic-kernel/terminal-slice-assessment");
const {
  createReleaseCandidate,
  verifyPreterminal,
  verifyPublication,
  verifyPublicationIntent,
} = require("../semantic-kernel/release-verification");
const {
  githubTransportFromEnvironment,
  publishAndReconcile,
} = require("../semantic-kernel/publication-runtime");
const {
  createPublicationAssetManifest,
  validatePublicationAssets,
  validatePublicationIntent,
  verifyPublicationAssetFiles,
} = require("../semantic-kernel/publication-intent");
const {
  createCanonicalClosureProjection,
  validatePublicationObservation,
} = require("../semantic-kernel/publication");
const {
  readActiveSliceIndex,
} = require("../semantic-kernel/active-slice-index");
const {
  closeSlice,
  recordPublicationIntent,
  recordPublicationObservation,
  takeoverSliceLease,
} = require("../semantic-kernel/semantic-controller");
const { resolveRepositoryStateRoot } = require("../semantic-kernel/repository-state");
const { canonicalize } = require("../contracts/canonical-json");
const { domainDigest } = require("../contracts/digest");
const { observedGitArtifactDigest } = require("../semantic-kernel/evidence-runtime");
const { loadCommittedObjectById } = require("../semantic-kernel/operation-bundle");

const ENV = Object.freeze({
  authorization: "META_HARNESS_SLICE_AUTHORIZATION",
  integrated: "META_HARNESS_INTEGRATED_CANDIDATE",
  runSpecs: "META_HARNESS_RUN_SPECS",
  mechanics: "META_HARNESS_MECHANICS_ASSESSMENTS",
  packageCandidate: "META_HARNESS_PACKAGE_CANDIDATE",
  releaseCandidate: "META_HARNESS_RELEASE_CANDIDATE",
  tarball: "META_HARNESS_TARBALL",
  proof: "META_HARNESS_BLACK_BOX_PROOF",
  reviewers: "META_HARNESS_REVIEWER_ASSESSMENTS",
  terminal: "META_HARNESS_TERMINAL_ASSESSMENT",
  controllerInstanceId: "META_HARNESS_CONTROLLER_INSTANCE_ID",
  publicationIntent: "META_HARNESS_PUBLICATION_INTENT",
  publicationAssetRoot: "META_HARNESS_PUBLICATION_ASSET_ROOT",
  publicationObservation: "META_HARNESS_PUBLICATION_OBSERVATION",
  publicationObservationOutput: "META_HARNESS_PUBLICATION_OBSERVATION_OUTPUT",
  canonicalClosureOutput: "META_HARNESS_CANONICAL_CLOSURE_OUTPUT",
});

const TERMINAL_EVIDENCE_OPTIONS = Object.freeze(new Set([
  "sliceAuthorization",
  "integratedCandidate",
  "runSpec",
  "mechanicsAssessment",
  "packageCandidate",
  "releaseCandidate",
  "tarball",
  "blackBoxProof",
  "reviewerAssessment",
  "terminalAssessment",
]));

function resolvePath(context, value, label) {
  if (!value || value === true || Array.isArray(value)) fail(`${label} requires exactly one path`);
  return path.resolve(context.cwd, String(value));
}

function readRegularJsonPath(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} is unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular non-symlink JSON file`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function readRegularJson(context, value, label) {
  const filePath = resolvePath(context, value, label);
  return { filePath, value: readRegularJsonPath(filePath, label) };
}

function optionOrEnv(options, key, envName, fromEnv) {
  if (fromEnv) {
    const value = process.env[envName];
    if (!value) fail(`${envName} is required with --from-env`);
    return value;
  }
  return optionValue(options[key]);
}

function repeatedPaths(options, key, envName, fromEnv) {
  if (fromEnv) {
    const value = process.env[envName];
    if (!value) fail(`${envName} is required with --from-env`);
    return value.split(path.delimiter).filter(Boolean);
  }
  const values = optionValues(options[key]);
  if (values.length === 0) fail(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required at least once`);
  return values;
}

function validateCoreEvidence({
  context,
  owner,
  authorizationRaw,
  integratedRaw,
  runSpecsRaw,
  mechanicsRaw,
}) {
  const authorization = validateSliceAuthorization(authorizationRaw, owner.pin, {
    repositoryId: owner.pin.repositoryId,
  });
  const runSpecByDigest = new Map(runSpecsRaw.map((value) => [value.runSpecDigest, value]));
  const mechanicsByDigest = new Map();

  for (const contribution of integratedRaw.contributions || []) {
    const runSpecRaw = runSpecByDigest.get(contribution.runSpecDigest);
    if (!runSpecRaw) fail(`RunSpec evidence missing for ${contribution.runSpecDigest}`);
    const runSpec = validateRunSpec(runSpecRaw, authorization, {
      expectedParentRevision: contribution.parentRevision,
      generation: integratedRaw.generation,
    });
    const mechanicsCandidate = mechanicsRaw.find((item) => item.assessmentDigest === contribution.mechanicsAssessmentDigest);
    if (!mechanicsCandidate) fail(`MechanicsAssessment evidence missing for ${contribution.mechanicsAssessmentDigest}`);
    const mechanics = validateMechanicsAssessment(mechanicsCandidate, runSpec, authorization, {
      expectedContributedRevision: contribution.contributedRevision,
      expectedTree: contribution.resultingTree,
    });
    mechanicsByDigest.set(mechanics.assessmentDigest, mechanics);
  }
  if (mechanicsByDigest.size !== mechanicsRaw.length || runSpecByDigest.size !== runSpecsRaw.length) {
    fail("release evidence contains unreferenced RunSpec or MechanicsAssessment objects");
  }
  const integrated = validateIntegratedCandidate(integratedRaw, authorization, mechanicsByDigest, {
    generation: integratedRaw.generation,
  });
  return { owner, authorization, integrated, mechanicsByDigest };
}

function loadCoreEvidence(context, options, fromEnv) {
  const owner = loadOwnerPin(context.cwd);
  const authorizationRaw = readRegularJson(
    context,
    optionOrEnv(options, "sliceAuthorization", ENV.authorization, fromEnv),
    "SliceAuthorization",
  ).value;
  const integratedRaw = readRegularJson(
    context,
    optionOrEnv(options, "integratedCandidate", ENV.integrated, fromEnv),
    "IntegratedCandidate",
  ).value;
  const runSpecsRaw = repeatedPaths(options, "runSpec", ENV.runSpecs, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "RunSpec").value);
  const mechanicsRaw = repeatedPaths(options, "mechanicsAssessment", ENV.mechanics, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "MechanicsAssessment").value);
  return validateCoreEvidence({ context, owner, authorizationRaw, integratedRaw, runSpecsRaw, mechanicsRaw });
}

function loadFrozenRelease(context, options, fromEnv) {
  const core = loadCoreEvidence(context, options, fromEnv);
  const packageCandidate = validatePackageCandidate(
    readRegularJson(
      context,
      optionOrEnv(options, "packageCandidate", ENV.packageCandidate, fromEnv),
      "PackageCandidate",
    ).value,
    core.integrated,
    core.authorization,
  );
  const releaseCandidate = validateReleaseCandidate(
    readRegularJson(
      context,
      optionOrEnv(options, "releaseCandidate", ENV.releaseCandidate, fromEnv),
      "ReleaseCandidate",
    ).value,
    packageCandidate,
    core.integrated,
    core.authorization,
  );
  const tarballPath = resolvePath(
    context,
    optionOrEnv(options, "tarball", ENV.tarball, fromEnv),
    "tarball",
  );
  return { ...core, packageCandidate, releaseCandidate, tarballPath };
}

function validateTerminalEvidence(context, frozen, proofRaw, reviewRaw, terminalRaw) {
  const observedEvaluatorDigest = observedGitArtifactDigest({
    repositoryPath: context.cwd,
    revision: frozen.authorization.initialBaseRevision,
    identity: frozen.authorization.sliceAcceptance.proofOracle.evaluatorArtifactIdentity,
  });
  const proof = validateBlackBoxProof(proofRaw, {
    sliceAuthorization: frozen.authorization,
    integratedCandidate: frozen.integrated,
    packageCandidate: frozen.packageCandidate,
    releaseCandidate: frozen.releaseCandidate,
    observedEvaluatorDigest,
  });
  if (reviewRaw.length !== 3) fail("exactly three ReviewerAssessment files are required");
  const reviewerAssessments = reviewRaw.map((review) => {
    const policy = frozen.authorization.reviewPolicy[review.role.toLowerCase()];
    if (!policy) fail(`review policy is missing for role ${review.role}`);
    const observedExecutableDigest = observedGitArtifactDigest({
      repositoryPath: context.cwd,
      revision: frozen.authorization.initialBaseRevision,
      identity: policy.executableIdentity,
    });
    return validateReviewerAssessment(review, {
      sliceAuthorization: frozen.authorization,
      integratedCandidate: frozen.integrated,
      packageCandidate: frozen.packageCandidate,
      releaseCandidate: frozen.releaseCandidate,
      blackBoxProof: proof,
      observedExecutableDigest,
    });
  });
  const terminalAssessment = validateTerminalSliceAssessment(terminalRaw, {
    sliceAuthorization: frozen.authorization,
    integratedCandidate: frozen.integrated,
    packageCandidate: frozen.packageCandidate,
    releaseCandidate: frozen.releaseCandidate,
    blackBoxProof: proof,
    reviewerAssessments,
  });
  return { ...frozen, proof, reviewerAssessments, terminalAssessment };
}

function assertControllerCommitted(stateRoot, objectType, objectId, value) {
  const committed = loadCommittedObjectById(stateRoot, objectType, objectId);
  if (canonicalize(committed.authoritativeObject.objectBody) !== canonicalize(value)) {
    fail(`controller-committed ${objectType} bytes differ from supplied evidence ${objectId}`);
  }
  return committed.authoritativeObject.objectBody;
}

function loadTerminalRelease(context, options, fromEnv) {
  const frozen = loadFrozenRelease(context, options, fromEnv);
  const proofRaw = readRegularJson(
    context,
    optionOrEnv(options, "blackBoxProof", ENV.proof, fromEnv),
    "BlackBoxProof",
  ).value;
  const reviewRaw = repeatedPaths(options, "reviewerAssessment", ENV.reviewers, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "ReviewerAssessment").value);
  const terminalRaw = readRegularJson(
    context,
    optionOrEnv(options, "terminalAssessment", ENV.terminal, fromEnv),
    "TerminalSliceAssessment",
  ).value;
  const terminal = validateTerminalEvidence(context, frozen, proofRaw, reviewRaw, terminalRaw);
  const state = resolveRepositoryStateRoot(context.cwd);
  assertControllerCommitted(state.stateRoot, "integrated-candidate/v1", terminal.integrated.candidateDigest, terminal.integrated);
  assertControllerCommitted(state.stateRoot, "package-candidate/v1", terminal.packageCandidate.packageCandidateDigest, terminal.packageCandidate);
  assertControllerCommitted(state.stateRoot, "release-candidate/v1", terminal.releaseCandidate.releaseCandidateDigest, terminal.releaseCandidate);
  assertControllerCommitted(state.stateRoot, "black-box-proof/v1", terminal.proof.proofDigest, terminal.proof);
  for (const review of terminal.reviewerAssessments) {
    assertControllerCommitted(state.stateRoot, "reviewer-assessment/v1", review.assessmentDigest, review);
  }
  assertControllerCommitted(
    state.stateRoot,
    "terminal-slice-assessment/v1",
    terminal.terminalAssessment.terminalAssessmentDigest,
    terminal.terminalAssessment,
  );
  return terminal;
}

function assetMap(observedAssets) {
  const byRole = new Map();
  for (const asset of observedAssets) {
    if (!byRole.has(asset.role)) byRole.set(asset.role, []);
    byRole.get(asset.role).push(asset.filePath);
  }
  return byRole;
}

function oneAsset(byRole, role) {
  const values = byRole.get(role) || [];
  if (values.length !== 1) fail(`PublicationIntent role ${role} must resolve to exactly one file`);
  return values[0];
}

function loadPortableTerminalRelease(context, intentPath, assetRoot) {
  const intentRaw = readRegularJsonPath(intentPath, "PublicationIntent");
  validatePublicationAssets(intentRaw.assets);
  const observedAssets = verifyPublicationAssetFiles({ assetRoot, publicationIntent: intentRaw });
  const expectedFiles = new Set([
    path.basename(intentPath),
    ...observedAssets.map((asset) => asset.filename),
  ]);
  const actualFiles = fs.readdirSync(assetRoot).filter((entry) => {
    const stat = fs.lstatSync(path.join(assetRoot, entry));
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`publication asset root contains a non-regular entry: ${entry}`);
    }
    return true;
  });
  const extras = actualFiles.filter((entry) => !expectedFiles.has(entry));
  const missing = [...expectedFiles].filter((entry) => !actualFiles.includes(entry));
  if (extras.length > 0 || missing.length > 0) {
    fail(`publication asset root differs from PublicationIntent; extras=${extras.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
  }
  const byRole = assetMap(observedAssets);
  const ownerPinRaw = readRegularJsonPath(oneAsset(byRole, "owner-pin"), "owner pin");
  const owner = {
    pin: validateOwnerPin(ownerPinRaw, intentRaw.repositoryId),
    pinPath: oneAsset(byRole, "owner-pin"),
    stateRoot: null,
  };
  const authorizationRaw = readRegularJsonPath(oneAsset(byRole, "slice-authorization"), "SliceAuthorization");
  const integratedRaw = readRegularJsonPath(oneAsset(byRole, "integrated-candidate"), "IntegratedCandidate");
  const runSpecsRaw = (byRole.get("run-spec") || []).map((filePath) => readRegularJsonPath(filePath, "RunSpec"));
  const mechanicsRaw = (byRole.get("mechanics-assessment") || [])
    .map((filePath) => readRegularJsonPath(filePath, "MechanicsAssessment"));
  const core = validateCoreEvidence({ context, owner, authorizationRaw, integratedRaw, runSpecsRaw, mechanicsRaw });
  const packageCandidate = validatePackageCandidate(
    readRegularJsonPath(oneAsset(byRole, "package-candidate"), "PackageCandidate"),
    core.integrated,
    core.authorization,
  );
  const releaseCandidate = validateReleaseCandidate(
    readRegularJsonPath(oneAsset(byRole, "release-candidate"), "ReleaseCandidate"),
    packageCandidate,
    core.integrated,
    core.authorization,
  );
  const frozen = {
    ...core,
    packageCandidate,
    releaseCandidate,
    tarballPath: oneAsset(byRole, "tarball"),
  };
  const terminal = validateTerminalEvidence(
    context,
    frozen,
    readRegularJsonPath(oneAsset(byRole, "black-box-proof"), "BlackBoxProof"),
    (byRole.get("reviewer-assessment") || []).map((filePath) => readRegularJsonPath(filePath, "ReviewerAssessment")),
    readRegularJsonPath(oneAsset(byRole, "terminal-assessment"), "TerminalSliceAssessment"),
  );
  const publicationIntent = validatePublicationIntent(intentRaw, {
    sliceAuthorization: terminal.authorization,
    packageCandidate: terminal.packageCandidate,
    releaseCandidate: terminal.releaseCandidate,
    terminalAssessment: terminal.terminalAssessment,
  });
  return { ...terminal, publicationIntent, assetRoot, observedAssets };
}

function writeCreateOnlyJson(filePath, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function prepareCreateOnlyOutput(context, value, label) {
  const outputPath = resolvePath(context, value, label);
  if (fs.existsSync(outputPath)) fail(`${label} must not already exist`);
  let parent;
  try {
    parent = fs.lstatSync(path.dirname(outputPath));
  } catch (error) {
    fail(`${label} parent is unavailable: ${error.message}`);
  }
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    fail(`${label} parent must be an existing non-symlink directory`);
  }
  return outputPath;
}

function printResult(context, result, json) {
  if (json) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else {
    writeLine(context, `${result.schemaVersion}: PASS`);
    if (result.releaseCandidateDigest) writeLine(context, `Release candidate: ${result.releaseCandidateDigest}`);
    if (result.publicationIntentDigest) writeLine(context, `Publication intent: ${result.publicationIntentDigest}`);
    if (result.tarballDigest) writeLine(context, `Tarball: ${result.tarballDigest}`);
    if (result.npmPackInvocationCount !== undefined) writeLine(context, `npm pack invocations: ${result.npmPackInvocationCount}`);
  }
}

function assertAllowedOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`unknown release option: --${key}`);
  }
}

function evidenceAssetEntries(context, options, ownerPinPath) {
  const entries = [
    { role: "owner-pin", filePath: ownerPinPath },
    { role: "slice-authorization", filePath: resolvePath(context, optionValue(options.sliceAuthorization), "SliceAuthorization") },
    { role: "integrated-candidate", filePath: resolvePath(context, optionValue(options.integratedCandidate), "IntegratedCandidate") },
    ...optionValues(options.runSpec).map((value) => ({ role: "run-spec", filePath: resolvePath(context, value, "RunSpec") })),
    ...optionValues(options.mechanicsAssessment).map((value) => ({ role: "mechanics-assessment", filePath: resolvePath(context, value, "MechanicsAssessment") })),
    { role: "package-candidate", filePath: resolvePath(context, optionValue(options.packageCandidate), "PackageCandidate") },
    { role: "release-candidate", filePath: resolvePath(context, optionValue(options.releaseCandidate), "ReleaseCandidate") },
    { role: "tarball", filePath: resolvePath(context, optionValue(options.tarball), "tarball") },
    { role: "black-box-proof", filePath: resolvePath(context, optionValue(options.blackBoxProof), "BlackBoxProof") },
    ...optionValues(options.reviewerAssessment).map((value) => ({ role: "reviewer-assessment", filePath: resolvePath(context, value, "ReviewerAssessment") })),
    { role: "terminal-assessment", filePath: resolvePath(context, optionValue(options.terminalAssessment), "TerminalSliceAssessment") },
    ...optionValues(options.supplementalAsset).map((value) => ({ role: "supplemental-evidence", filePath: resolvePath(context, value, "supplemental asset") })),
  ];
  return entries;
}

function controllerInstance(options, fromEnv) {
  const value = fromEnv ? process.env[ENV.controllerInstanceId] : optionValue(options.controllerInstanceId);
  if (!value || value === true || Array.isArray(value)) {
    fail(`${fromEnv ? ENV.controllerInstanceId : "--controller-instance-id"} is required`);
  }
  return String(value);
}

function ensureReconcileLease(context, terminal, requestedControllerId) {
  const state = resolveRepositoryStateRoot(context.cwd);
  const active = readActiveSliceIndex(state.stateRoot);
  if (!active) fail("repository-global active-slice index is required for reconciliation");
  if (active.activeSliceId !== terminal.releaseCandidate.sliceId
    || active.activeGeneration !== terminal.releaseCandidate.generation
    || active.stage !== "PUBLICATION_AUTHORIZED") {
    fail("repository-global active slice is not the exact publication-authorized generation");
  }
  if (active.leaseControllerInstanceId === requestedControllerId && Date.parse(active.leaseExpiresAt) > Date.now()) {
    return requestedControllerId;
  }
  if (Date.parse(active.leaseExpiresAt) > Date.now()) {
    fail(`publication-authorized lease remains held by ${active.leaseControllerInstanceId} until ${active.leaseExpiresAt}`);
  }
  return takeoverSliceLease({
    repositoryPath: context.cwd,
    sliceAuthorization: terminal.authorization,
    expectedPriorIndexDigest: active.indexDigest,
    priorLeaseOwnerClaimDigest: active.leaseOwnerClaimDigest,
    replacementControllerInstanceId: requestedControllerId,
  }).controllerInstanceId;
}

async function handleCandidateCreate(context, options) {
  assertAllowedOptions(options, new Set([
    "sliceAuthorization",
    "integratedCandidate",
    "runSpec",
    "mechanicsAssessment",
    "output",
    "builderProgramDigest",
    "json",
  ]));
  const core = loadCoreEvidence(context, options, false);
  const outputDirectory = resolvePath(context, optionValue(options.output), "--output");
  const builderProgramDigest = optionValue(options.builderProgramDigest)
    || domainDigest("meta-harness-release-builder-program/v1", { module: "lib/semantic-kernel/release-verification.js" });
  const result = createReleaseCandidate({
    targetRoot: context.cwd,
    outputDirectory,
    sliceAuthorization: core.authorization,
    integratedCandidate: core.integrated,
    builderProgramDigest,
  });
  writeCreateOnlyJson(path.join(outputDirectory, "package-candidate.json"), result.packageCandidate);
  writeCreateOnlyJson(path.join(outputDirectory, "release-candidate.json"), result.releaseCandidate);
  printResult(context, {
    schemaVersion: "release-candidate-create-result/v1",
    ok: true,
    releaseCandidateDigest: result.releaseCandidate.releaseCandidateDigest,
    packageCandidateDigest: result.packageCandidate.packageCandidateDigest,
    tarballPath: result.tarballPath,
    tarballDigest: result.packageCandidate.tarballDigest,
    npmPackInvocationCount: result.npmPackInvocationCount,
  }, options.json !== undefined);
  return { exitCode: 0 };
}

async function handleVerifyPreterminal(context, options) {
  const allowed = new Set([...TERMINAL_EVIDENCE_OPTIONS, "fromEnv", "json"]);
  allowed.delete("blackBoxProof");
  allowed.delete("reviewerAssessment");
  allowed.delete("terminalAssessment");
  assertAllowedOptions(options, allowed);
  const fromEnv = options.fromEnv !== undefined;
  const frozen = loadFrozenRelease(context, options, fromEnv);
  const result = verifyPreterminal({
    targetRoot: context.cwd,
    tarballPath: frozen.tarballPath,
    sliceAuthorization: frozen.authorization,
    integratedCandidate: frozen.integrated,
    packageCandidate: frozen.packageCandidate,
    releaseCandidate: frozen.releaseCandidate,
  });
  printResult(context, { ...result, ok: true }, options.json !== undefined);
  return { exitCode: 0 };
}

async function handleVerifyPublication(context, options) {
  assertAllowedOptions(options, new Set([...TERMINAL_EVIDENCE_OPTIONS, "fromEnv", "json"]));
  const fromEnv = options.fromEnv !== undefined;
  const terminal = loadTerminalRelease(context, options, fromEnv);
  const result = verifyPublication({
    targetRoot: context.cwd,
    tarballPath: terminal.tarballPath,
    sliceAuthorization: terminal.authorization,
    integratedCandidate: terminal.integrated,
    packageCandidate: terminal.packageCandidate,
    releaseCandidate: terminal.releaseCandidate,
    blackBoxProof: terminal.proof,
    reviewerAssessments: terminal.reviewerAssessments,
    terminalAssessment: terminal.terminalAssessment,
  });
  printResult(context, { ...result, ok: true }, options.json !== undefined);
  return { exitCode: 0 };
}

async function handleIntentCreate(context, options) {
  assertAllowedOptions(options, new Set([
    ...TERMINAL_EVIDENCE_OPTIONS,
    "controllerInstanceId",
    "output",
    "supplementalAsset",
    "json",
  ]));
  const outputPath = prepareCreateOnlyOutput(context, optionValue(options.output), "publication intent output");
  if (path.basename(outputPath) !== "publication-intent.json") {
    fail("publication intent output filename must be publication-intent.json");
  }
  const terminal = loadTerminalRelease(context, options, false);
  const assetManifest = createPublicationAssetManifest(evidenceAssetEntries(context, options, terminal.owner.pinPath));
  const recorded = recordPublicationIntent({
    repositoryPath: context.cwd,
    sliceAuthorization: terminal.authorization,
    packageCandidate: terminal.packageCandidate,
    releaseCandidate: terminal.releaseCandidate,
    terminalAssessment: terminal.terminalAssessment,
    assetManifest,
    controllerInstanceId: controllerInstance(options, false),
  });
  writeCreateOnlyJson(outputPath, recorded.publicationIntent);
  printResult(context, {
    schemaVersion: "release-publication-intent-create-result/v1",
    ok: true,
    publicationIntentDigest: recorded.publicationIntent.intentDigest,
    releaseCandidateDigest: recorded.publicationIntent.releaseCandidateDigest,
    assetManifestDigest: recorded.publicationIntent.assetManifestDigest,
    assetCount: recorded.publicationIntent.assets.length,
    activeStateDigest: recorded.transition.state.stateDigest,
    npmPackInvocationCount: 0,
  }, options.json !== undefined);
  return { exitCode: 0 };
}

function portableInputs(context, options, fromEnv) {
  const intentPath = resolvePath(
    context,
    optionOrEnv(options, "publicationIntent", ENV.publicationIntent, fromEnv),
    "PublicationIntent",
  );
  const assetRoot = resolvePath(
    context,
    optionOrEnv(options, "assetRoot", ENV.publicationAssetRoot, fromEnv),
    "publication asset root",
  );
  return { intentPath, assetRoot, portable: loadPortableTerminalRelease(context, intentPath, assetRoot) };
}

async function handleIntentVerify(context, options) {
  assertAllowedOptions(options, new Set(["publicationIntent", "assetRoot", "fromEnv", "json"]));
  const fromEnv = options.fromEnv !== undefined;
  const { portable } = portableInputs(context, options, fromEnv);
  const result = verifyPublicationIntent({
    targetRoot: context.cwd,
    assetRoot: portable.assetRoot,
    tarballPath: portable.tarballPath,
    sliceAuthorization: portable.authorization,
    integratedCandidate: portable.integrated,
    packageCandidate: portable.packageCandidate,
    releaseCandidate: portable.releaseCandidate,
    blackBoxProof: portable.proof,
    reviewerAssessments: portable.reviewerAssessments,
    terminalAssessment: portable.terminalAssessment,
    publicationIntent: portable.publicationIntent,
  });
  printResult(context, { ...result, ok: true }, options.json !== undefined);
  return { exitCode: 0 };
}

async function handlePublish(context, options) {
  assertAllowedOptions(options, new Set([
    "publicationIntent",
    "assetRoot",
    "observationOutput",
    "fromEnv",
    "json",
  ]));
  const fromEnv = options.fromEnv !== undefined;
  const outputPath = prepareCreateOnlyOutput(
    context,
    fromEnv ? process.env[ENV.publicationObservationOutput] : optionValue(options.observationOutput),
    "publication observation output",
  );
  const { portable } = portableInputs(context, options, fromEnv);
  const publicationVerification = verifyPublicationIntent({
    targetRoot: context.cwd,
    assetRoot: portable.assetRoot,
    tarballPath: portable.tarballPath,
    sliceAuthorization: portable.authorization,
    integratedCandidate: portable.integrated,
    packageCandidate: portable.packageCandidate,
    releaseCandidate: portable.releaseCandidate,
    blackBoxProof: portable.proof,
    reviewerAssessments: portable.reviewerAssessments,
    terminalAssessment: portable.terminalAssessment,
    publicationIntent: portable.publicationIntent,
  });
  const transport = githubTransportFromEnvironment(portable.publicationIntent, context.env || process.env);
  const result = publishAndReconcile({
    targetRoot: context.cwd,
    tarballPath: portable.tarballPath,
    sliceAuthorization: portable.authorization,
    packageCandidate: portable.packageCandidate,
    releaseCandidate: portable.releaseCandidate,
    terminalAssessment: portable.terminalAssessment,
    publicationIntent: portable.publicationIntent,
    publicationVerification,
    transport,
  });
  writeCreateOnlyJson(outputPath, result.observation);
  const response = {
    schemaVersion: "release-publish-result/v2",
    ok: result.observation.disposition === "PUBLISHED_EXACT",
    disposition: result.observation.disposition,
    publicationIntentDigest: portable.publicationIntent.intentDigest,
    observationDigest: result.observation.observationDigest,
    publishInvocationCount: result.publishInvocationCount,
    registryObservationCount: result.registryObservationCount,
    npmPackInvocationCount: 0,
  };
  printResult(context, response, options.json !== undefined);
  return { exitCode: response.ok ? 0 : 1 };
}

async function handleReconcile(context, options) {
  assertAllowedOptions(options, new Set([
    ...TERMINAL_EVIDENCE_OPTIONS,
    "publicationIntent",
    "publicationObservation",
    "controllerInstanceId",
    "closureOutput",
    "fromEnv",
    "json",
  ]));
  const fromEnv = options.fromEnv !== undefined;
  const closureOutput = prepareCreateOnlyOutput(
    context,
    fromEnv ? process.env[ENV.canonicalClosureOutput] : optionValue(options.closureOutput),
    "canonical closure output",
  );
  const terminal = loadTerminalRelease(context, options, fromEnv);
  const publicationIntent = validatePublicationIntent(
    readRegularJson(
      context,
      optionOrEnv(options, "publicationIntent", ENV.publicationIntent, fromEnv),
      "PublicationIntent",
    ).value,
    {
      sliceAuthorization: terminal.authorization,
      packageCandidate: terminal.packageCandidate,
      releaseCandidate: terminal.releaseCandidate,
      terminalAssessment: terminal.terminalAssessment,
    },
  );
  const publicationObservation = validatePublicationObservation(
    readRegularJson(
      context,
      optionOrEnv(options, "publicationObservation", ENV.publicationObservation, fromEnv),
      "PublicationObservation",
    ).value,
    publicationIntent,
    terminal.releaseCandidate,
    terminal.authorization,
    terminal.packageCandidate,
    terminal.terminalAssessment,
  );
  if (publicationObservation.disposition !== "PUBLISHED_EXACT") {
    fail("canonical reconciliation requires PUBLISHED_EXACT");
  }
  const activeController = ensureReconcileLease(context, terminal, controllerInstance(options, fromEnv));
  recordPublicationObservation({
    repositoryPath: context.cwd,
    sliceAuthorization: terminal.authorization,
    packageCandidate: terminal.packageCandidate,
    releaseCandidate: terminal.releaseCandidate,
    terminalAssessment: terminal.terminalAssessment,
    publicationIntent,
    publicationObservation,
    controllerInstanceId: activeController,
  });
  const projection = createCanonicalClosureProjection({
    sliceAuthorization: terminal.authorization,
    integratedCandidate: terminal.integrated,
    releaseCandidate: terminal.releaseCandidate,
    terminalAssessment: terminal.terminalAssessment,
    publicationIntent,
    publicationObservation,
  });
  const closed = closeSlice({
    repositoryPath: context.cwd,
    sliceAuthorization: terminal.authorization,
    integratedCandidate: terminal.integrated,
    packageCandidate: terminal.packageCandidate,
    releaseCandidate: terminal.releaseCandidate,
    terminalAssessment: terminal.terminalAssessment,
    publicationIntent,
    publicationObservation,
    canonicalClosureProjection: projection,
    controllerInstanceId: activeController,
  });
  writeCreateOnlyJson(closureOutput, closed.canonicalClosureProjection);
  printResult(context, {
    schemaVersion: "release-reconcile-result/v1",
    ok: true,
    disposition: publicationObservation.disposition,
    publicationIntentDigest: publicationIntent.intentDigest,
    publicationObservationDigest: publicationObservation.observationDigest,
    canonicalClosureProjectionDigest: closed.canonicalClosureProjection.projectionDigest,
    publicationState: closed.canonicalClosureProjection.publicationState,
    nextSliceState: closed.canonicalClosureProjection.nextSliceState,
    npmPackInvocationCount: 0,
  }, options.json !== undefined);
  return { exitCode: 0 };
}

module.exports = async function commandRelease(argv, context) {
  const { positional, options } = parseArgs(argv);
  const [action, subaction, ...extra] = positional;
  if (extra.length > 0) {
    fail("usage: meta-harness release candidate <create|verify-preterminal|verify-publication> | release intent <create|verify> | release publish | release reconcile");
  }
  if (action === "publish" && subaction === undefined) return handlePublish(context, options);
  if (action === "reconcile" && subaction === undefined) return handleReconcile(context, options);
  if (action === "intent") {
    if (subaction === "create") return handleIntentCreate(context, options);
    if (subaction === "verify") return handleIntentVerify(context, options);
    fail(`unknown release intent action: ${subaction || "missing"}`);
  }
  if (action !== "candidate") {
    fail("usage: meta-harness release candidate <create|verify-preterminal|verify-publication> | release intent <create|verify> | release publish | release reconcile");
  }
  if (subaction === "create") return handleCandidateCreate(context, options);
  if (subaction === "verify-preterminal") return handleVerifyPreterminal(context, options);
  if (subaction === "verify-publication") return handleVerifyPublication(context, options);
  fail(`unknown release candidate action: ${subaction || "missing"}`);
};

module.exports._test = {
  ENV,
  loadCoreEvidence,
  loadFrozenRelease,
  loadPortableTerminalRelease,
  loadTerminalRelease,
};
