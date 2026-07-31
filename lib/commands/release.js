"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { loadOwnerPin } = require("../semantic-kernel/owner-pin");
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
} = require("../semantic-kernel/release-verification");
const { publishAndReconcile } = require("../semantic-kernel/publication-runtime");
const {
  readActiveSliceIndex,
  reserveCounter,
} = require("../semantic-kernel/active-slice-index");
const { resolveRepositoryStateRoot } = require("../semantic-kernel/repository-state");
const { domainDigest } = require("../contracts/digest");

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
  publicationObservationOutput: "META_HARNESS_PUBLICATION_OBSERVATION_OUTPUT",
});

function resolvePath(context, value, label) {
  if (!value || value === true || Array.isArray(value)) fail(`${label} requires exactly one path`);
  return path.resolve(context.cwd, String(value));
}

function readRegularJson(context, value, label) {
  const filePath = resolvePath(context, value, label);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} is unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular non-symlink JSON file`);
  try {
    return { filePath, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
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

function loadCoreEvidence(context, options, fromEnv) {
  const owner = loadOwnerPin(context.cwd);
  const authorizationRaw = readRegularJson(
    context,
    optionOrEnv(options, "sliceAuthorization", ENV.authorization, fromEnv),
    "SliceAuthorization",
  ).value;
  const authorization = validateSliceAuthorization(authorizationRaw, owner.pin, {
    repositoryId: owner.pin.repositoryId,
  });
  const integratedRaw = readRegularJson(
    context,
    optionOrEnv(options, "integratedCandidate", ENV.integrated, fromEnv),
    "IntegratedCandidate",
  ).value;

  const runSpecsRaw = repeatedPaths(options, "runSpec", ENV.runSpecs, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "RunSpec").value);
  const mechanicsRaw = repeatedPaths(options, "mechanicsAssessment", ENV.mechanics, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "MechanicsAssessment").value);
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

function loadTerminalRelease(context, options, fromEnv) {
  const frozen = loadFrozenRelease(context, options, fromEnv);
  const proofRaw = readRegularJson(
    context,
    optionOrEnv(options, "blackBoxProof", ENV.proof, fromEnv),
    "BlackBoxProof",
  ).value;
  const proof = validateBlackBoxProof(proofRaw, {
    sliceAuthorization: frozen.authorization,
    integratedCandidate: frozen.integrated,
    packageCandidate: frozen.packageCandidate,
    releaseCandidate: frozen.releaseCandidate,
    observedEvaluatorDigest: frozen.authorization.sliceAcceptance.proofOracle.evaluatorArtifactDigest,
  });
  const reviewRaw = repeatedPaths(options, "reviewerAssessment", ENV.reviewers, fromEnv)
    .map((filePath) => readRegularJson(context, filePath, "ReviewerAssessment").value);
  if (reviewRaw.length !== 3) fail("exactly three ReviewerAssessment files are required");
  const reviewerAssessments = reviewRaw.map((review) => validateReviewerAssessment(review, {
    sliceAuthorization: frozen.authorization,
    integratedCandidate: frozen.integrated,
    packageCandidate: frozen.packageCandidate,
    releaseCandidate: frozen.releaseCandidate,
    blackBoxProof: proof,
    observedExecutableDigest: review.processExecutableDigest,
  }));
  const terminalRaw = readRegularJson(
    context,
    optionOrEnv(options, "terminalAssessment", ENV.terminal, fromEnv),
    "TerminalSliceAssessment",
  ).value;
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

function printResult(context, result, json) {
  if (json) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else {
    writeLine(context, `${result.schemaVersion}: PASS`);
    if (result.releaseCandidateDigest) writeLine(context, `Release candidate: ${result.releaseCandidateDigest}`);
    if (result.tarballDigest) writeLine(context, `Tarball: ${result.tarballDigest}`);
    writeLine(context, `npm pack invocations: ${result.npmPackInvocationCount}`);
  }
}

function assertAllowedOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`unknown release option: --${key}`);
  }
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
  const allowed = new Set([
    "sliceAuthorization",
    "integratedCandidate",
    "runSpec",
    "mechanicsAssessment",
    "packageCandidate",
    "releaseCandidate",
    "tarball",
    "fromEnv",
    "json",
  ]);
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
  const allowed = new Set([
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
    "fromEnv",
    "json",
  ]);
  assertAllowedOptions(options, allowed);
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

async function handlePublish(context, options) {
  const allowed = new Set([
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
    "controllerInstanceId",
    "observationOutput",
    "fromEnv",
    "json",
  ]);
  assertAllowedOptions(options, allowed);
  const fromEnv = options.fromEnv !== undefined;
  const terminal = loadTerminalRelease(context, options, fromEnv);
  const publicationVerification = verifyPublication({
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
  const controllerInstanceId = fromEnv
    ? process.env[ENV.controllerInstanceId]
    : optionValue(options.controllerInstanceId);
  if (!controllerInstanceId || controllerInstanceId === true) {
    fail(`${fromEnv ? ENV.controllerInstanceId : "--controller-instance-id"} is required`);
  }
  const outputValue = fromEnv
    ? process.env[ENV.publicationObservationOutput]
    : optionValue(options.observationOutput);
  if (!outputValue || outputValue === true) {
    fail(`${fromEnv ? ENV.publicationObservationOutput : "--observation-output"} is required`);
  }
  const outputPath = resolvePath(context, outputValue, "publication observation output");
  if (fs.existsSync(outputPath)) fail("publication observation output must not already exist");
  let outputParent;
  try {
    outputParent = fs.lstatSync(path.dirname(outputPath));
  } catch (error) {
    fail(`publication observation output parent is unavailable: ${error.message}`);
  }
  if (!outputParent.isDirectory() || outputParent.isSymbolicLink()) {
    fail("publication observation output parent must be an existing non-symlink directory");
  }

  const state = resolveRepositoryStateRoot(context.cwd);
  const active = readActiveSliceIndex(state.stateRoot);
  if (!active) fail("repository-global active-slice index is required before publication");
  if (active.activeSliceId !== terminal.releaseCandidate.sliceId
    || active.activeGeneration !== terminal.releaseCandidate.generation
    || active.stage !== "TERMINAL_VERIFIED") {
    fail("repository-global active slice is not the exact terminal-verified release generation");
  }
  const reserved = reserveCounter({
    stateRoot: state.stateRoot,
    expectedPriorIndexDigest: active.indexDigest,
    controllerInstanceId: String(controllerInstanceId),
    counter: "publicationAttemptCount",
    maximum: terminal.authorization.publicationPolicy.maxPublicationAttempts,
  });
  const result = publishAndReconcile({
    targetRoot: context.cwd,
    tarballPath: terminal.tarballPath,
    sliceAuthorization: terminal.authorization,
    releaseCandidate: terminal.releaseCandidate,
    publicationVerification,
  });
  writeCreateOnlyJson(outputPath, result.observation);
  const response = {
    schemaVersion: "release-publish-result/v1",
    ok: result.observation.disposition === "PUBLISHED_EXACT",
    disposition: result.observation.disposition,
    observationDigest: result.observation.observationDigest,
    activeIndexDigest: reserved.indexDigest,
    publishInvocationCount: result.publishInvocationCount,
    registryObservationCount: result.registryObservationCount,
    npmPackInvocationCount: 0,
  };
  printResult(context, response, options.json !== undefined);
  return { exitCode: response.ok ? 0 : 1 };
}

module.exports = async function commandRelease(argv, context) {
  const { positional, options } = parseArgs(argv);
  const [action, subaction, ...extra] = positional;
  if (action === "publish" && subaction === undefined && extra.length === 0) {
    return handlePublish(context, options);
  }
  if (action !== "candidate" || extra.length > 0) {
    fail("usage: meta-harness release candidate <create|verify-preterminal|verify-publication> | release publish");
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
  loadTerminalRelease,
};
