"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { domainDigest } = require("../contracts/digest");
const { contractError, immutable, requireExactUtc } = require("./contract-utils");
const { exactUtcNow } = require("./clock");
const {
  computePackageCandidateDigest,
  computeReleaseCandidateDigest,
  validatePackageCandidate,
  validateReleaseCandidate,
} = require("./release-candidate");
const { validateTerminalSliceAssessment } = require("./terminal-slice-assessment");
const {
  validatePublicationIntent,
  verifyPublicationAssetFiles,
} = require("./publication-intent");

const PACKAGE_METADATA_DOMAIN = "meta-harness-package-metadata/v1";
const PACKLIST_DOMAIN = "meta-harness-package-packlist/v1";
const PRETERMINAL_VERIFICATION_SCHEMA = "release-preterminal-verification/v1";
const PUBLICATION_VERIFICATION_SCHEMA = "release-publication-verification/v1";
const PUBLICATION_INTENT_VERIFICATION_SCHEMA = "release-publication-intent-verification/v1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 120000,
    env: options.env || process.env,
  });
  if (result.error || result.status !== 0) {
    throw contractError(
      "RELEASE_COMMAND_FAILED",
      `${command} ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
      { command, args, status: result.status },
    );
  }
  return result;
}

function fileBytes(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw contractError("RELEASE_FILE_INVALID", `release artifact must be a regular non-symlink file: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function sha512Integrity(bytes) {
  return `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
}

function gitValue(targetRoot, args, runner = run) {
  return String(runner("git", args, { cwd: targetRoot, timeout: 30000 }).stdout || "").trim();
}

function tarEntries(tarballPath, runner = run) {
  const output = String(runner("tar", ["-tf", tarballPath], { timeout: 30000 }).stdout || "");
  return output.split(/\r?\n/).filter(Boolean).sort();
}

function tarPackageJson(tarballPath, runner = run) {
  const output = String(runner("tar", ["-xOf", tarballPath, "package/package.json"], { timeout: 30000 }).stdout || "");
  try {
    return JSON.parse(output);
  } catch (error) {
    throw contractError("RELEASE_TARBALL_PACKAGE_JSON", `tarball package.json is invalid: ${error.message}`);
  }
}

function computePacklistDigest(entries) {
  return domainDigest(PACKLIST_DOMAIN, [...entries].sort());
}

function computePackageMetadataDigest(packageJson) {
  return domainDigest(PACKAGE_METADATA_DOMAIN, packageJson);
}

function inspectExistingTarball(tarballPath, runner = run) {
  const bytes = fileBytes(tarballPath);
  const entries = tarEntries(tarballPath, runner);
  const packageJson = tarPackageJson(tarballPath, runner);
  return Object.freeze({
    tarballPath,
    tarballDigest: sha256(bytes),
    tarballIntegrity: sha512Integrity(bytes),
    tarballByteLength: bytes.length,
    packlistDigest: computePacklistDigest(entries),
    packageMetadataDigest: computePackageMetadataDigest(packageJson),
    packageJson: immutable(packageJson),
    entries: Object.freeze(entries),
  });
}

function createReleaseCandidate({
  targetRoot,
  outputDirectory,
  sliceAuthorization,
  integratedCandidate,
  builderProgramDigest,
  runner = run,
  builtAt = exactUtcNow(),
}) {
  requireExactUtc(builtAt, "builtAt");
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const existingTarballs = fs.readdirSync(outputDirectory).filter((entry) => entry.endsWith(".tgz"));
  if (existingTarballs.length > 0) {
    throw contractError("RELEASE_OUTPUT_NOT_EMPTY", "release candidate output directory already contains a tarball");
  }
  const head = gitValue(targetRoot, ["rev-parse", "HEAD"], runner);
  const tree = gitValue(targetRoot, ["rev-parse", "HEAD^{tree}"], runner);
  if (head !== integratedCandidate.finalHeadRevision || tree !== integratedCandidate.finalTreeDigest) {
    throw contractError("RELEASE_CANDIDATE_GIT_MISMATCH", "working checkout does not match frozen IntegratedCandidate");
  }
  const status = gitValue(targetRoot, ["status", "--porcelain"], runner);
  if (status !== "") {
    throw contractError("RELEASE_CANDIDATE_DIRTY", "release candidate checkout must be clean");
  }

  const packResult = runner(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", outputDirectory],
    { cwd: targetRoot, timeout: 180000 },
  );
  let packJson;
  try {
    packJson = JSON.parse(String(packResult.stdout || ""));
  } catch (error) {
    throw contractError("RELEASE_PACK_OUTPUT_INVALID", `npm pack JSON output is invalid: ${error.message}`);
  }
  if (!Array.isArray(packJson) || packJson.length !== 1 || typeof packJson[0].filename !== "string") {
    throw contractError("RELEASE_PACK_OUTPUT_INVALID", "npm pack must create exactly one reported tarball");
  }
  const tarballPath = path.join(outputDirectory, path.basename(packJson[0].filename));
  const observed = inspectExistingTarball(tarballPath, runner);
  const packageCandidate = {
    schemaVersion: "package-candidate/v1",
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    candidateHead: integratedCandidate.finalHeadRevision,
    candidateTree: integratedCandidate.finalTreeDigest,
    tarballDigest: observed.tarballDigest,
    tarballIntegrity: observed.tarballIntegrity,
    tarballByteLength: observed.tarballByteLength,
    packlistDigest: observed.packlistDigest,
    packageMetadataDigest: observed.packageMetadataDigest,
    packageName: observed.packageJson.name,
    version: observed.packageJson.version,
    builtAt,
    builderProgramDigest,
    packageCandidateDigest: "pending",
  };
  packageCandidate.packageCandidateDigest = computePackageCandidateDigest(packageCandidate);
  validatePackageCandidate(packageCandidate, integratedCandidate, sliceAuthorization, {
    observedTarballDigest: observed.tarballDigest,
    observedTarballByteLength: observed.tarballByteLength,
  });
  const policy = sliceAuthorization.publicationPolicy;
  const releaseCandidate = {
    schemaVersion: "release-candidate/v1",
    sliceId: sliceAuthorization.sliceId,
    generation: integratedCandidate.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: integratedCandidate.sliceAcceptanceDigest,
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    tarballDigest: packageCandidate.tarballDigest,
    tarballIntegrity: packageCandidate.tarballIntegrity,
    packageName: policy.packageName,
    version: policy.version,
    registry: policy.registry,
    access: policy.access,
    distTag: policy.distTag,
    gitTag: policy.gitTag,
    gitTagTargetRevision: integratedCandidate.finalHeadRevision,
    provenanceRequired: policy.provenanceRequired,
    canonicalUpdatePolicyDigest: policy.canonicalUpdatePolicyDigest,
    releaseCandidateDigest: "pending",
  };
  releaseCandidate.releaseCandidateDigest = computeReleaseCandidateDigest(releaseCandidate);
  validateReleaseCandidate(releaseCandidate, packageCandidate, integratedCandidate, sliceAuthorization);
  return Object.freeze({
    packageCandidate: immutable(packageCandidate),
    releaseCandidate: immutable(releaseCandidate),
    tarballPath,
    npmPackInvocationCount: 1,
  });
}

function verifyPreterminal({
  targetRoot,
  tarballPath,
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  runner = run,
  verifiedAt = exactUtcNow(),
}) {
  requireExactUtc(verifiedAt, "verifiedAt");
  const observed = inspectExistingTarball(tarballPath, runner);
  const head = gitValue(targetRoot, ["rev-parse", "HEAD"], runner);
  const tree = gitValue(targetRoot, ["rev-parse", "HEAD^{tree}"], runner);
  if (head !== integratedCandidate.finalHeadRevision || tree !== integratedCandidate.finalTreeDigest) {
    throw contractError("RELEASE_PRETERMINAL_GIT_MISMATCH", "candidate commit or tree changed before terminal review");
  }
  const validatedPackage = validatePackageCandidate(packageCandidate, integratedCandidate, sliceAuthorization, {
    observedTarballDigest: observed.tarballDigest,
    observedTarballByteLength: observed.tarballByteLength,
  });
  if (observed.tarballIntegrity !== validatedPackage.tarballIntegrity
    || observed.packlistDigest !== validatedPackage.packlistDigest
    || observed.packageMetadataDigest !== validatedPackage.packageMetadataDigest) {
    throw contractError("RELEASE_PRETERMINAL_TARBALL_MISMATCH", "existing tarball packlist, metadata, or integrity differs from PackageCandidate");
  }
  const validatedRelease = validateReleaseCandidate(releaseCandidate, validatedPackage, integratedCandidate, sliceAuthorization);
  const result = {
    schemaVersion: PRETERMINAL_VERIFICATION_SCHEMA,
    releaseCandidateDigest: validatedRelease.releaseCandidateDigest,
    candidateHead: head,
    candidateTree: tree,
    tarballDigest: observed.tarballDigest,
    tarballIntegrity: observed.tarballIntegrity,
    intendedGitTag: validatedRelease.gitTag,
    intendedGitTagTargetRevision: validatedRelease.gitTagTargetRevision,
    verifiedAt,
    npmPackInvocationCount: 0,
  };
  return immutable({
    ...result,
    verificationDigest: domainDigest("meta-harness-release-preterminal-verification/v1", result),
  });
}

function verifyPublication({
  targetRoot,
  tarballPath,
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  reviewerAssessments,
  terminalAssessment,
  runner = run,
  verifiedAt = exactUtcNow(),
}) {
  requireExactUtc(verifiedAt, "verifiedAt");
  const preterminal = verifyPreterminal({
    targetRoot,
    tarballPath,
    sliceAuthorization,
    integratedCandidate,
    packageCandidate,
    releaseCandidate,
    runner,
    verifiedAt,
  });
  const terminal = validateTerminalSliceAssessment(terminalAssessment, {
    sliceAuthorization,
    integratedCandidate,
    packageCandidate,
    releaseCandidate,
    blackBoxProof,
    reviewerAssessments,
  });
  if (terminal.verdict !== "TERMINAL_SLICE_VERIFIED") {
    throw contractError("RELEASE_TERMINAL_NOT_VERIFIED", "publication requires TERMINAL_SLICE_VERIFIED");
  }
  if (Date.parse(verifiedAt) > Date.parse(sliceAuthorization.publicationPolicy.publishBy)) {
    throw contractError("PUBLICATION_DEADLINE", "publication verification occurred after publishBy");
  }
  const head = gitValue(targetRoot, ["rev-parse", "HEAD"], runner);
  if (head !== releaseCandidate.gitTagTargetRevision) {
    throw contractError("RELEASE_PUBLICATION_HEAD_MISMATCH", "current head differs from exact reviewed fast-forward target");
  }
  const tagTarget = gitValue(targetRoot, ["rev-list", "-n", "1", releaseCandidate.gitTag], runner);
  if (tagTarget !== releaseCandidate.gitTagTargetRevision) {
    throw contractError("RELEASE_PUBLICATION_TAG_MISMATCH", "actual Git tag does not point to pre-bound reviewed revision");
  }
  const result = {
    schemaVersion: PUBLICATION_VERIFICATION_SCHEMA,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    terminalAssessmentDigest: terminal.terminalAssessmentDigest,
    preterminalVerificationDigest: preterminal.verificationDigest,
    actualHead: head,
    actualGitTag: releaseCandidate.gitTag,
    actualGitTagTargetRevision: tagTarget,
    tarballDigest: preterminal.tarballDigest,
    tarballIntegrity: preterminal.tarballIntegrity,
    registry: releaseCandidate.registry,
    access: releaseCandidate.access,
    distTag: releaseCandidate.distTag,
    provenanceRequired: releaseCandidate.provenanceRequired,
    verifiedAt,
    npmPackInvocationCount: 0,
  };
  return immutable({
    ...result,
    verificationDigest: domainDigest("meta-harness-release-publication-verification/v1", result),
  });
}

function verifyPublicationIntent({
  targetRoot,
  assetRoot,
  tarballPath,
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  blackBoxProof,
  reviewerAssessments,
  terminalAssessment,
  publicationIntent,
  runner = run,
  verifiedAt = exactUtcNow(),
}) {
  const publication = verifyPublication({
    targetRoot,
    tarballPath,
    sliceAuthorization,
    integratedCandidate,
    packageCandidate,
    releaseCandidate,
    blackBoxProof,
    reviewerAssessments,
    terminalAssessment,
    runner,
    verifiedAt,
  });
  const intent = validatePublicationIntent(publicationIntent, {
    sliceAuthorization,
    packageCandidate,
    releaseCandidate,
    terminalAssessment,
  });
  const observedAssets = verifyPublicationAssetFiles({ assetRoot, publicationIntent: intent });
  const tarballAsset = observedAssets.find((asset) => asset.role === "tarball");
  if (!tarballAsset || path.resolve(tarballAsset.filePath) !== path.resolve(tarballPath)) {
    throw contractError("PUBLICATION_INTENT_TARBALL_PATH", "verified tarball path is not the intent-bound tarball asset");
  }
  const result = {
    schemaVersion: PUBLICATION_INTENT_VERIFICATION_SCHEMA,
    publicationIntentDigest: intent.intentDigest,
    releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
    terminalAssessmentDigest: terminalAssessment.terminalAssessmentDigest,
    assetManifestDigest: intent.assetManifestDigest,
    verifiedAssetCount: observedAssets.length,
    actualHead: publication.actualHead,
    actualGitTag: publication.actualGitTag,
    actualGitTagTargetRevision: publication.actualGitTagTargetRevision,
    tarballDigest: publication.tarballDigest,
    tarballIntegrity: publication.tarballIntegrity,
    registry: publication.registry,
    access: publication.access,
    distTag: publication.distTag,
    provenanceRequired: publication.provenanceRequired,
    verifiedAt,
    npmPackInvocationCount: 0,
  };
  return immutable({
    ...result,
    verificationDigest: domainDigest("meta-harness-release-publication-intent-verification/v1", result),
  });
}

module.exports = {
  PACKAGE_METADATA_DOMAIN,
  PACKLIST_DOMAIN,
  PRETERMINAL_VERIFICATION_SCHEMA,
  PUBLICATION_INTENT_VERIFICATION_SCHEMA,
  PUBLICATION_VERIFICATION_SCHEMA,
  computePackageMetadataDigest,
  computePacklistDigest,
  createReleaseCandidate,
  inspectExistingTarball,
  verifyPreterminal,
  verifyPublication,
  verifyPublicationIntent,
};
