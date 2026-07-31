"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { exactKeys, isOrdinaryPlainObject } = require("../contracts/canonical-json");
const { domainDigest } = require("../contracts/digest");
const { gitExecutableForWorkspace } = require("../git-command");
const { contractError, immutable } = require("./contract-utils");
const { exactUtcNow } = require("./clock");
const { assertAuthorityExecutionPlatform } = require("./platform-policy");
const {
  computeMechanicsAssessmentDigest,
  validateMechanicsAssessment,
} = require("./mechanics-assessment");
const { computeSliceAcceptanceDigest } = require("./slice-authorization");
const {
  computeBlackBoxProofDigest,
  computeProofOracleDigest,
  validateBlackBoxProof,
} = require("./black-box-proof");
const {
  computeReviewInputManifestDigest,
  computeReviewerAssessmentDigest,
  validateReviewerAssessment,
} = require("./reviewer-assessment");
const {
  computeTerminalSliceAssessmentDigest,
  expectedVerdict,
  validateTerminalSliceAssessment,
} = require("./terminal-slice-assessment");
const {
  computeCertificationAssessmentDigest,
  computeCertificationCandidateDigest,
  computeCertificationProofDigest,
  computeCertificationReviewInputManifestDigest,
  computeCertificationReviewerAssessmentDigest,
  expectedCertificationVerdict,
  validateCertificationAssessment,
  validateCertificationCandidate,
  validateCertificationProof,
  validateCertificationReviewerAssessment,
} = require("./certification");

function sha256Bytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function observedGit(repositoryPath, args) {
  const executable = gitExecutableForWorkspace({ cwd: repositoryPath, fs });
  const result = spawnSync(executable, ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30000,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw contractError(
      "EVIDENCE_GIT_FAILED",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return String(result.stdout || "").replace(/\r\n?/g, "\n").trimEnd();
}

function sanitizedCommandEnv(home) {
  const env = {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot,
    SYSTEMROOT: process.env.SYSTEMROOT,
    windir: process.env.windir,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, "xdg"),
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PIP_NO_INDEX: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }
  return env;
}

function assertContainedCommandCwd(repositoryPath, relativeCwd) {
  const candidate = path.resolve(repositoryPath, relativeCwd);
  let rootReal;
  let candidateReal;
  try {
    rootReal = fs.realpathSync(repositoryPath);
    candidateReal = fs.realpathSync(candidate);
  } catch (error) {
    throw contractError("EVIDENCE_COMMAND_CWD_INVALID", `validation cwd is unavailable: ${error.message}`);
  }
  const relative = path.relative(rootReal, candidateReal);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw contractError("EVIDENCE_COMMAND_CWD_ESCAPE", "validation cwd escapes the trusted repository");
  }
  if (!fs.statSync(candidateReal).isDirectory()) {
    throw contractError("EVIDENCE_COMMAND_CWD_INVALID", "validation cwd must be a directory");
  }
  return candidateReal;
}

function linuxNetworkIsolatorAvailable() {
  if (process.platform !== "linux") return false;
  const probe = spawnSync("unshare", ["--net", "--map-root-user", "true"], {
    encoding: "utf8",
    shell: false,
    timeout: 10000,
  });
  return !probe.error && probe.status === 0;
}

function runNetworkIsolatedCommand(command, repositoryPath) {
  if (command.network !== "none") {
    throw contractError(
      "EVIDENCE_NETWORK_POLICY_UNSUPPORTED",
      "controller-observed mechanics currently supports only sealed network:none commands",
    );
  }
  if (!linuxNetworkIsolatorAvailable()) {
    throw contractError(
      "EVIDENCE_NETWORK_ISOLATOR_UNAVAILABLE",
      "fail-closed network isolation is unavailable on this host; mechanics evidence was not produced",
    );
  }
  const cwd = assertContainedCommandCwd(repositoryPath, command.cwd);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-validation-home-"));
  fs.mkdirSync(path.join(home, "xdg"), { recursive: true });
  const startedAt = exactUtcNow();
  let result;
  try {
    result = spawnSync("unshare", [
      "--net",
      "--map-root-user",
      "--",
      ...command.argv,
    ], {
      cwd,
      encoding: null,
      shell: false,
      timeout: command.timeoutSeconds * 1000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: sanitizedCommandEnv(home),
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  const finishedAt = exactUtcNow();
  const stdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.from(result?.stdout || "");
  const stderr = Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.from(result?.stderr || "");
  const timedOut = Boolean(result?.error && result.error.code === "ETIMEDOUT");
  const exitStatus = Number.isInteger(result?.status) ? result.status : 255;
  return immutable({
    commandId: command.commandId,
    exitStatus,
    timedOut,
    networkUsed: false,
    stdoutDigest: sha256Bytes(stdout),
    stderrDigest: sha256Bytes(stderr),
    startedAt,
    finishedAt,
  });
}

function constructMechanicsAssessment({
  repositoryPath,
  runSpec,
  sliceAuthorization,
  expectedContributedRevision,
}) {
  assertAuthorityExecutionPlatform(sliceAuthorization, "MECHANICS_ASSESS");
  const contributedRevision = observedGit(repositoryPath, ["rev-parse", "HEAD"]);
  if (contributedRevision !== expectedContributedRevision) {
    throw contractError(
      "MECHANICS_EXPECTED_REVISION_MISMATCH",
      "trusted target HEAD differs from the caller's expected contributed revision",
    );
  }
  const parents = observedGit(repositoryPath, ["rev-list", "--parents", "-n", "1", contributedRevision]).split(/\s+/);
  if (parents.length !== 2 || parents[1] !== runSpec.repository.expectedParentRevision) {
    throw contractError("MECHANICS_PARENT_MISMATCH", "mechanics contribution must be one non-merge commit on the sealed parent");
  }
  const resultingTree = observedGit(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
  const changedPaths = observedGit(repositoryPath, [
    "diff",
    "--name-only",
    "--no-renames",
    `${runSpec.repository.expectedParentRevision}..${contributedRevision}`,
  ]).split(/\n/).filter(Boolean).sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify(runSpec.mechanicalTask.targetPaths)) {
    throw contractError("MECHANICS_CHANGED_PATH_MISMATCH", "observed changed paths differ from the exact sealed target paths");
  }
  const statusBefore = observedGit(repositoryPath, ["status", "--porcelain"]);
  if (statusBefore !== "") {
    throw contractError("MECHANICS_TARGET_DIRTY", "target worktree must be clean before validation commands run");
  }

  const validationResults = runSpec.validation.commands.map((command) => (
    runNetworkIsolatedCommand(command, repositoryPath)
  ));

  const statusAfterBytes = Buffer.from(observedGit(repositoryPath, ["status", "--porcelain"]), "utf8");
  const checkedAt = exactUtcNow();
  if (statusAfterBytes.length !== 0) {
    throw contractError("MECHANICS_TARGET_DIRTY", "validation commands changed the target worktree");
  }
  const assessedAt = exactUtcNow();
  const draft = {
    schemaVersion: "mechanics-assessment/v1",
    sliceId: sliceAuthorization.sliceId,
    generation: runSpec.generation,
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
    runSpecDigest: runSpec.runSpecDigest,
    repositoryId: runSpec.repository.repositoryId,
    parentRevision: runSpec.repository.expectedParentRevision,
    contributedRevision,
    resultingTree,
    changedPaths,
    validationResults,
    cleanStateProof: {
      statusPorcelainDigest: sha256Bytes(statusAfterBytes),
      statusPorcelainBytes: statusAfterBytes.length,
      isClean: true,
      checkedAt,
    },
    assessedAt,
    verdict: "MECHANICS_VERIFIED",
    assessmentDigest: "pending",
  };
  draft.assessmentDigest = computeMechanicsAssessmentDigest(draft);
  return validateMechanicsAssessment(draft, runSpec, sliceAuthorization, {
    expectedContributedRevision: contributedRevision,
    expectedTree: resultingTree,
  });
}

function readRegularFile(filePath, label) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || path.normalize(filePath) !== filePath) {
    throw contractError("EVIDENCE_INPUT_PATH_INVALID", `${label} must be an absolute normalized path`);
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw contractError("EVIDENCE_INPUT_UNREADABLE", `${label} is unreadable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw contractError("EVIDENCE_INPUT_NOT_FILE", `${label} must be a regular non-symlink file`);
  }
  return fs.readFileSync(filePath);
}

function gitBuffer(repositoryPath, args) {
  const executable = gitExecutableForWorkspace({ cwd: repositoryPath, fs });
  const result = spawnSync(executable, ["-C", repositoryPath, ...args], {
    encoding: null,
    shell: false,
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 128 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw contractError(
      "EVIDENCE_GIT_FAILED",
      `git ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || "");
}

function observedGitArtifactDigest({ repositoryPath, revision, identity }) {
  if (typeof identity !== "string" || identity.length === 0) {
    throw contractError("EVIDENCE_EXECUTABLE_IDENTITY_INVALID", "authorized artifact identity must be non-empty");
  }
  return sha256Bytes(gitBuffer(repositoryPath, ["show", `${revision}:${identity}`]));
}

function materializeAuthorizedProgram({
  repositoryPath,
  revision,
  identity,
  expectedDigest,
  destinationRoot,
  label,
}) {
  const bytes = gitBuffer(repositoryPath, ["show", `${revision}:${identity}`]);
  const observedDigest = sha256Bytes(bytes);
  if (observedDigest !== expectedDigest) {
    throw contractError(
      "EVIDENCE_EXECUTABLE_DIGEST_MISMATCH",
      `${label} bytes differ from the owner-authorized digest`,
      { expectedDigest, observedDigest, identity },
    );
  }
  const extension = path.extname(identity).toLowerCase();
  const programPath = path.join(destinationRoot, `${label}${extension || ".bin"}`);
  fs.writeFileSync(programPath, bytes, { mode: 0o555 });
  fs.chmodSync(programPath, 0o555);
  return Object.freeze({ programPath, observedDigest, identity });
}

function programCommand(programPath) {
  const extension = path.extname(programPath).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) return [process.execPath, programPath];
  return [programPath];
}

function assertLinuxEvidenceSandbox() {
  if (process.platform !== "linux") {
    throw contractError(
      "EVIDENCE_SANDBOX_UNAVAILABLE",
      "controller proof and reviewer execution requires the Linux user, mount, and network namespace sandbox",
    );
  }
  const probe = spawnSync("unshare", ["--user", "--map-root-user", "--mount", "--net", "true"], {
    encoding: "utf8",
    shell: false,
    timeout: 10000,
  });
  if (probe.error || probe.status !== 0) {
    throw contractError("EVIDENCE_SANDBOX_UNAVAILABLE", "required user, mount, and network namespaces are unavailable");
  }
}

function runReadOnlySandboxedProgram({
  programPath,
  readOnlyRoot,
  readOnlyRoots,
  input,
  timeoutSeconds,
  writableHome,
}) {
  assertLinuxEvidenceSandbox();
  const roots = readOnlyRoots || [readOnlyRoot];
  if (!Array.isArray(roots) || roots.length === 0) {
    throw contractError("EVIDENCE_READ_ONLY_ROOT_REQUIRED", "at least one read-only root is required");
  }
  const canonicalRoots = roots.map((root, index) => {
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw contractError("EVIDENCE_READ_ONLY_ROOT_INVALID", `read-only root ${index} must be absolute`);
    }
    const real = fs.realpathSync(root);
    if (!fs.statSync(real).isDirectory()) {
      throw contractError("EVIDENCE_READ_ONLY_ROOT_INVALID", `read-only root ${index} must be a directory`);
    }
    return real;
  });
  const script = [
    "set -eu",
    "root_count=$1",
    "shift",
    "i=0",
    "while [ \"$i\" -lt \"$root_count\" ]; do",
    "  readonly_root=$1",
    "  shift",
    "  mount --bind \"$readonly_root\" \"$readonly_root\"",
    "  mount -o remount,bind,ro \"$readonly_root\"",
    "  i=$((i + 1))",
    "done",
    "exec \"$@\"",
  ].join("\n");
  const startedAt = exactUtcNow();
  const result = spawnSync("unshare", [
    "--user",
    "--map-root-user",
    "--mount",
    "--net",
    "--",
    "sh",
    "-ceu",
    script,
    "meta-harness-evidence-sandbox",
    String(canonicalRoots.length),
    ...canonicalRoots,
    ...programCommand(programPath),
  ], {
    cwd: canonicalRoots[0],
    input,
    encoding: null,
    shell: false,
    timeout: timeoutSeconds * 1000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: sanitizedCommandEnv(writableHome),
  });
  const finishedAt = exactUtcNow();
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || "");
  if (result.error || result.status !== 0) {
    throw contractError(
      "EVIDENCE_PROCESS_FAILED",
      `evidence process failed with status ${String(result.status)}: ${stderr.toString("utf8").trim()}`,
      {
        status: result.status,
        errorCode: result.error?.code || null,
        stdoutDigest: sha256Bytes(stdout),
        stderrDigest: sha256Bytes(stderr),
      },
    );
  }
  return Object.freeze({
    pid: result.pid,
    stdout,
    stderr,
    startedAt,
    finishedAt,
    stdoutDigest: sha256Bytes(stdout),
    stderrDigest: sha256Bytes(stderr),
  });
}

function parseExactJsonOutput(bytes, keys, schemaVersion, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw contractError("EVIDENCE_OUTPUT_JSON_INVALID", `${label} output is not JSON: ${error.message}`);
  }
  if (!isOrdinaryPlainObject(value) || !exactKeys(value, keys)) {
    throw contractError("EVIDENCE_OUTPUT_SHAPE_INVALID", `${label} output has missing or unexpected fields`);
  }
  if (value.schemaVersion !== schemaVersion) {
    throw contractError("EVIDENCE_OUTPUT_SCHEMA_INVALID", `${label} output schema must be ${schemaVersion}`);
  }
  return value;
}

function directoryManifestDigest(root) {
  const entries = [];
  function visit(current, relative) {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw contractError("EVIDENCE_DIRECTORY_SYMLINK", `staged evidence contains a symlink: ${childRelative}`);
      }
      if (stat.isDirectory()) visit(absolute, childRelative);
      else if (stat.isFile()) entries.push({ path: childRelative, digest: sha256Bytes(fs.readFileSync(absolute)), bytes: stat.size });
      else throw contractError("EVIDENCE_DIRECTORY_SPECIAL_FILE", `staged evidence contains a special file: ${childRelative}`);
    }
  }
  visit(root, "");
  return domainDigest("meta-harness-evidence-directory/v1", entries);
}

function stageCandidateSnapshot(repositoryPath, revision, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const archive = gitBuffer(repositoryPath, ["archive", "--format=tar", revision]);
  const extracted = spawnSync("tar", ["-xf", "-", "-C", destination], {
    input: archive,
    encoding: null,
    shell: false,
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (extracted.error || extracted.status !== 0) {
    throw contractError("EVIDENCE_CANDIDATE_STAGE_FAILED", "failed to extract the exact integrated candidate snapshot");
  }
  return directoryManifestDigest(destination);
}

function installExactPackage({ tarballPath, packageCandidate, evidenceRoot }) {
  const tarballBytes = readRegularFile(tarballPath, "proofRequest.tarballPath");
  const observedTarballDigest = sha256Bytes(tarballBytes);
  if (observedTarballDigest !== packageCandidate.tarballDigest) {
    throw contractError("EVIDENCE_TARBALL_DIGEST_MISMATCH", "proof tarball bytes differ from PackageCandidate");
  }
  const installRoot = path.join(evidenceRoot, "installed");
  fs.mkdirSync(installRoot, { recursive: true });
  const packageJson = Buffer.from(`${JSON.stringify({ private: true, name: "meta-harness-evidence-install", version: "0.0.0" })}\n`);
  fs.writeFileSync(path.join(installRoot, "package.json"), packageJson);
  if (!linuxNetworkIsolatorAvailable()) {
    throw contractError("EVIDENCE_NETWORK_ISOLATOR_UNAVAILABLE", "isolated local package installation is unavailable");
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-install-home-"));
  fs.mkdirSync(path.join(home, "xdg"), { recursive: true });
  let result;
  try {
    result = spawnSync("unshare", [
      "--net",
      "--map-root-user",
      "--",
      "npm",
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--package-lock=true",
      tarballPath,
    ], {
      cwd: installRoot,
      encoding: null,
      shell: false,
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
      env: sanitizedCommandEnv(home),
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  if (result.error || result.status !== 0) {
    throw contractError(
      "EVIDENCE_PACKAGE_INSTALL_FAILED",
      `isolated package installation failed: ${Buffer.from(result.stderr || "").toString("utf8").trim()}`,
    );
  }
  const installedManifestDigest = directoryManifestDigest(installRoot);
  const installTranscriptDigest = sha256Bytes(Buffer.concat([
    Buffer.from(result.stdout || ""),
    Buffer.from(result.stderr || ""),
  ]));
  const freshEnvironmentProofDigest = domainDigest("meta-harness-fresh-install/v1", {
    initialPackageJsonDigest: sha256Bytes(packageJson),
    tarballDigest: observedTarballDigest,
    installedManifestDigest,
    installTranscriptDigest,
  });
  return Object.freeze({
    installRoot,
    observedTarballDigest,
    installedManifestDigest,
    freshEnvironmentProofDigest,
    installationIdentity: domainDigest("meta-harness-installation-identity/v1", {
      tarballDigest: observedTarballDigest,
      installedManifestDigest,
    }),
  });
}

function produceDeliveryTerminalEvidence({
  repositoryPath,
  sliceAuthorization,
  integratedCandidate,
  packageCandidate,
  releaseCandidate,
  proofRequest,
}) {
  assertAuthorityExecutionPlatform(sliceAuthorization, "DELIVERY_EVIDENCE");
  if (sliceAuthorization.sliceMode !== "DELIVERY") {
    throw contractError("DELIVERY_MODE_REQUIRED", "npm terminal evidence is valid only for DELIVERY slices");
  }
  if (!isOrdinaryPlainObject(proofRequest) || !exactKeys(proofRequest, ["tarballPath", "inputPath", "fixturePath"])) {
    throw contractError("PROOF_REQUEST_SHAPE", "proofRequest must contain only tarballPath, inputPath, and fixturePath");
  }
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-terminal-evidence-"));
  const writableHome = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-evidence-home-"));
  fs.mkdirSync(path.join(writableHome, "xdg"), { recursive: true });
  try {
    const candidateRoot = path.join(evidenceRoot, "candidate");
    const candidateManifestDigest = stageCandidateSnapshot(
      repositoryPath,
      integratedCandidate.finalHeadRevision,
      candidateRoot,
    );
    const inputBytes = readRegularFile(proofRequest.inputPath, "proofRequest.inputPath");
    const fixtureBytes = readRegularFile(proofRequest.fixturePath, "proofRequest.fixturePath");
    const inputsRoot = path.join(evidenceRoot, "inputs");
    fs.mkdirSync(inputsRoot, { recursive: true });
    const stagedInputPath = path.join(inputsRoot, "input.bin");
    const stagedFixturePath = path.join(inputsRoot, "fixture.bin");
    fs.writeFileSync(stagedInputPath, inputBytes);
    fs.writeFileSync(stagedFixturePath, fixtureBytes);
    const installation = installExactPackage({
      tarballPath: proofRequest.tarballPath,
      packageCandidate,
      evidenceRoot,
    });
    const programsRoot = path.join(evidenceRoot, "programs");
    fs.mkdirSync(programsRoot, { recursive: true });
    const oracle = sliceAuthorization.sliceAcceptance.proofOracle;
    const evaluator = materializeAuthorizedProgram({
      repositoryPath,
      revision: sliceAuthorization.initialBaseRevision,
      identity: oracle.evaluatorArtifactIdentity,
      expectedDigest: oracle.evaluatorArtifactDigest,
      destinationRoot: programsRoot,
      label: "proof-evaluator",
    });
    const evaluatorManifest = immutable({
      schemaVersion: "proof-evaluator-input/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAcceptance: sliceAuthorization.sliceAcceptance,
      integratedCandidate,
      packageCandidate,
      releaseCandidate,
      candidateRoot,
      candidateManifestDigest,
      installedRoot: installation.installRoot,
      inputPath: stagedInputPath,
      fixturePath: stagedFixturePath,
    });
    const evaluatorResult = runReadOnlySandboxedProgram({
      programPath: evaluator.programPath,
      readOnlyRoot: evidenceRoot,
      input: Buffer.from(`${JSON.stringify(evaluatorManifest)}\n`, "utf8"),
      timeoutSeconds: 600,
      writableHome,
    });
    const evaluatorOutput = parseExactJsonOutput(
      evaluatorResult.stdout,
      ["schemaVersion", "operatorActions", "quantitativeEvaluations"],
      "proof-evaluator-output/v1",
      "proof evaluator",
    );
    const executedAt = evaluatorResult.finishedAt;
    const proofDraft = {
      schemaVersion: "black-box-proof/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
      integratedCandidateDigest: integratedCandidate.candidateDigest,
      packageCandidateDigest: packageCandidate.packageCandidateDigest,
      releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
      executionSurface: {
        type: "installed-package",
        tarballDigest: installation.observedTarballDigest,
        installationIdentity: installation.installationIdentity,
        freshEnvironmentProofDigest: installation.freshEnvironmentProofDigest,
      },
      operatorActions: evaluatorOutput.operatorActions,
      inputIdentityDigest: sha256Bytes(inputBytes),
      fixtureIdentityDigest: sha256Bytes(fixtureBytes),
      observationTranscriptDigest: evaluatorResult.stdoutDigest,
      exitStatus: 0,
      quantitativeEvaluations: evaluatorOutput.quantitativeEvaluations,
      proofOracleDigest: computeProofOracleDigest(oracle),
      evaluatorExecutableDigest: evaluator.observedDigest,
      evaluatorPackageDigest: oracle.evaluatorPackageDigest,
      noImplementationWorkerExpectedOutput: true,
      executedAt,
      proofDigest: "pending",
    };
    proofDraft.proofDigest = computeBlackBoxProofDigest(proofDraft);
    const proof = validateBlackBoxProof(proofDraft, {
      sliceAuthorization,
      integratedCandidate,
      packageCandidate,
      releaseCandidate,
      observedEvaluatorDigest: evaluator.observedDigest,
    });

    const reviewerOutputsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-reviewer-outputs-"));
    const reviews = [];
    try {
      for (const role of ["PRODUCT", "DOMAIN", "CUSTODY"]) {
        const policyKey = role.toLowerCase();
        const policy = sliceAuthorization.reviewPolicy[policyKey];
        if (policy.networkPolicy !== "none") {
          throw contractError("REVIEW_NETWORK_POLICY_UNSUPPORTED", "controller-launched reviewers currently require networkPolicy none");
        }
        const reviewer = materializeAuthorizedProgram({
          repositoryPath,
          revision: sliceAuthorization.initialBaseRevision,
          identity: policy.executableIdentity,
          expectedDigest: policy.executableDigest,
          destinationRoot: programsRoot,
          label: `reviewer-${policyKey}`,
        });
        const inputManifestDigest = computeReviewInputManifestDigest({
          role,
          sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
          integratedCandidateDigest: integratedCandidate.candidateDigest,
          packageCandidateDigest: packageCandidate.packageCandidateDigest,
          releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
          blackBoxProofDigest: proof.proofDigest,
          executableDigest: reviewer.observedDigest,
          policyDigest: policy.policyDigest,
          environmentPolicyDigest: policy.environmentPolicyDigest,
          networkPolicy: policy.networkPolicy,
        });
        const reviewManifest = immutable({
          schemaVersion: "reviewer-input/v1",
          role,
          sliceAcceptance: sliceAuthorization.sliceAcceptance,
          integratedCandidate,
          packageCandidate,
          releaseCandidate,
          blackBoxProof: proof,
          candidateRoot,
          candidateManifestDigest,
          installedRoot: installation.installRoot,
          inputManifestDigest,
        });
        const reviewResult = runReadOnlySandboxedProgram({
          programPath: reviewer.programPath,
          readOnlyRoot: evidenceRoot,
          input: Buffer.from(`${JSON.stringify(reviewManifest)}\n`, "utf8"),
          timeoutSeconds: 600,
          writableHome,
        });
        const output = parseExactJsonOutput(
          reviewResult.stdout,
          ["schemaVersion", "result", "findings"],
          "reviewer-output/v1",
          `${role} reviewer`,
        );
        if (!new Set(["PASS", "FAIL"]).has(output.result) || typeof output.findings !== "string" || !output.findings.trim()) {
          throw contractError("REVIEW_OUTPUT_INVALID", `${role} reviewer must emit PASS or FAIL with non-empty findings`);
        }
        fs.writeFileSync(path.join(reviewerOutputsRoot, `${policyKey}.stdout.json`), reviewResult.stdout);
        fs.writeFileSync(path.join(reviewerOutputsRoot, `${policyKey}.stderr.bin`), reviewResult.stderr);
        const assessmentDraft = {
          schemaVersion: "reviewer-assessment/v1",
          sliceId: sliceAuthorization.sliceId,
          generation: integratedCandidate.generation,
          role,
          sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
          integratedCandidateDigest: integratedCandidate.candidateDigest,
          packageCandidateDigest: packageCandidate.packageCandidateDigest,
          releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
          blackBoxProofDigest: proof.proofDigest,
          processId: `controller-process-${reviewResult.pid}`,
          processExecutableDigest: reviewer.observedDigest,
          rolePolicyDigest: policy.policyDigest,
          environmentPolicyDigest: policy.environmentPolicyDigest,
          networkPolicy: policy.networkPolicy,
          inputManifestDigest,
          readOnlyCandidateAccess: true,
          implementationProcessReuse: false,
          previousReviewerOutputsVisible: false,
          result: output.result,
          findingsDigest: sha256Bytes(Buffer.from(output.findings, "utf8")),
          reviewedAt: reviewResult.finishedAt,
          assessmentDigest: "pending",
        };
        assessmentDraft.assessmentDigest = computeReviewerAssessmentDigest(assessmentDraft);
        reviews.push(validateReviewerAssessment(assessmentDraft, {
          sliceAuthorization,
          integratedCandidate,
          packageCandidate,
          releaseCandidate,
          blackBoxProof: proof,
          observedExecutableDigest: reviewer.observedDigest,
        }));
      }
    } finally {
      fs.rmSync(reviewerOutputsRoot, { recursive: true, force: true });
    }

    const byRole = Object.fromEntries(reviews.map((review) => [review.role, review]));
    const terminalDraft = {
      schemaVersion: "terminal-slice-assessment/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
      sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
      integratedCandidateDigest: integratedCandidate.candidateDigest,
      packageCandidateDigest: packageCandidate.packageCandidateDigest,
      releaseCandidateDigest: releaseCandidate.releaseCandidateDigest,
      blackBoxProofDigest: proof.proofDigest,
      productReviewDigest: byRole.PRODUCT.assessmentDigest,
      domainReviewDigest: byRole.DOMAIN.assessmentDigest,
      custodyReviewDigest: byRole.CUSTODY.assessmentDigest,
      controllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", sliceAuthorization.controllerBinding),
      assessedAt: exactUtcNow(),
      verdict: expectedVerdict(byRole),
      terminalAssessmentDigest: "pending",
    };
    terminalDraft.terminalAssessmentDigest = computeTerminalSliceAssessmentDigest(terminalDraft);
    const terminalAssessment = validateTerminalSliceAssessment(terminalDraft, {
      sliceAuthorization,
      integratedCandidate,
      packageCandidate,
      releaseCandidate,
      blackBoxProof: proof,
      reviewerAssessments: reviews,
    });
    return Object.freeze({ proof, reviews, terminalAssessment });
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.rmSync(writableHome, { recursive: true, force: true });
  }
}

function resolveCandidateFile(candidateRoot, relativePath, label) {
  if (typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw contractError("CERTIFICATION_PATH_INVALID", `${label} must be normalized and repository-relative`);
  }
  const candidateReal = fs.realpathSync(candidateRoot);
  const absolute = path.resolve(candidateRoot, relativePath);
  let stat;
  let real;
  try {
    stat = fs.lstatSync(absolute);
    real = fs.realpathSync(absolute);
  } catch (error) {
    throw contractError("CERTIFICATION_FILE_UNREADABLE", `${label} is unavailable: ${error.message}`);
  }
  const contained = path.relative(candidateReal, real);
  if (contained === ".." || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained)) {
    throw contractError("CERTIFICATION_PATH_ESCAPE", `${label} resolves outside the exact candidate snapshot`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw contractError("CERTIFICATION_FILE_INVALID", `${label} must be a regular non-symlink candidate file`);
  }
  return real;
}

function observePythonEnvironment(environmentRoot) {
  if (typeof environmentRoot !== "string"
    || !path.isAbsolute(environmentRoot)
    || path.normalize(environmentRoot) !== environmentRoot) {
    throw contractError("CERTIFICATION_ENVIRONMENT_PATH", "environmentRoot must be absolute and normalized");
  }
  let rootStat;
  let rootReal;
  try {
    rootStat = fs.lstatSync(environmentRoot);
    rootReal = fs.realpathSync(environmentRoot);
  } catch (error) {
    throw contractError("CERTIFICATION_ENVIRONMENT_UNREADABLE", `environmentRoot is unavailable: ${error.message}`);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw contractError("CERTIFICATION_ENVIRONMENT_INVALID", "environmentRoot must be a non-symlink directory");
  }
  const candidates = process.platform === "win32"
    ? [path.join(rootReal, "Scripts", "python.exe")]
    : [path.join(rootReal, "bin", "python"), path.join(rootReal, "bin", "python3")];
  const launcherPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!launcherPath) {
    throw contractError("CERTIFICATION_PYTHON_MISSING", "installed Python environment has no recognized interpreter");
  }
  const launcherStat = fs.lstatSync(launcherPath);
  if (!launcherStat.isFile() && !launcherStat.isSymbolicLink()) {
    throw contractError("CERTIFICATION_PYTHON_INVALID", "Python launcher must be a regular file or symlink");
  }
  const executablePath = fs.realpathSync(launcherPath);
  if (!fs.statSync(executablePath).isFile()) {
    throw contractError("CERTIFICATION_PYTHON_INVALID", "resolved Python executable is not a regular file");
  }
  if (!linuxNetworkIsolatorAvailable()) {
    throw contractError("EVIDENCE_NETWORK_ISOLATOR_UNAVAILABLE", "Python environment observation requires fail-closed network isolation");
  }
  const probeSource = [
    "import importlib.metadata as m, json, platform, sys",
    "d=sorted((x.metadata.get('Name') or x.metadata.get('Summary') or '', x.version) for x in m.distributions())",
    "print(json.dumps({'version':sys.version,'implementation':platform.python_implementation(),'prefix':sys.prefix,'base_prefix':sys.base_prefix,'executable':sys.executable,'distributions':d},sort_keys=True,separators=(',',':')))"
  ].join(";");
  const result = spawnSync("unshare", [
    "--net",
    "--map-root-user",
    "--",
    executablePath,
    "-I",
    "-c",
    probeSource,
  ], {
    cwd: rootReal,
    encoding: null,
    shell: false,
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
    env: sanitizedCommandEnv(rootReal),
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || "");
  if (result.error || result.status !== 0) {
    throw contractError(
      "CERTIFICATION_ENVIRONMENT_PROBE_FAILED",
      `Python environment probe failed: ${stderr.toString("utf8").trim()}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(stdout.toString("utf8"));
  } catch (error) {
    throw contractError("CERTIFICATION_ENVIRONMENT_PROBE_JSON", `Python environment probe output is invalid: ${error.message}`);
  }
  const observed = {
    environmentRoot: rootReal,
    launcherRelativePath: path.relative(rootReal, launcherPath).split(path.sep).join("/"),
    launcherIsSymlink: launcherStat.isSymbolicLink(),
    launcherTarget: executablePath,
    executableDigest: sha256Bytes(fs.readFileSync(executablePath)),
    probeOutputDigest: sha256Bytes(stdout),
    manifest,
  };
  return Object.freeze({
    ...observed,
    environmentManifestDigest: domainDigest("meta-harness-python-environment-manifest/v1", observed),
    installedEnvironmentIdentityDigest: domainDigest("meta-harness-python-environment-identity/v1", {
      environmentManifestDigest: domainDigest("meta-harness-python-environment-manifest/v1", observed),
      executableDigest: observed.executableDigest,
      probeOutputDigest: observed.probeOutputDigest,
    }),
    executableRoot: path.dirname(executablePath),
  });
}

function produceCertificationEvidence({
  repositoryPath,
  sliceAuthorization,
  integratedCandidate,
  certificationRequest,
}) {
  assertAuthorityExecutionPlatform(sliceAuthorization, "CERTIFICATION_EVIDENCE");
  if (sliceAuthorization.sliceMode !== "CERTIFICATION") {
    throw contractError("CERTIFICATION_MODE_REQUIRED", "repository application evidence requires a CERTIFICATION authorization");
  }
  if (!isOrdinaryPlainObject(certificationRequest) || !exactKeys(certificationRequest, [
    "environmentRoot",
    "dependencyLockPath",
    "applicationEntryPoint",
    "inputPath",
    "fixturePath",
  ])) {
    throw contractError(
      "CERTIFICATION_REQUEST_SHAPE",
      "certificationRequest must contain only environmentRoot, dependencyLockPath, applicationEntryPoint, inputPath, and fixturePath",
    );
  }
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-certification-evidence-"));
  const writableHome = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-certification-home-"));
  fs.mkdirSync(path.join(writableHome, "xdg"), { recursive: true });
  try {
    const candidateRoot = path.join(evidenceRoot, "candidate");
    const candidateManifestDigest = stageCandidateSnapshot(
      repositoryPath,
      integratedCandidate.finalHeadRevision,
      candidateRoot,
    );
    const dependencyLockFile = resolveCandidateFile(
      candidateRoot,
      certificationRequest.dependencyLockPath,
      "certificationRequest.dependencyLockPath",
    );
    const applicationFile = resolveCandidateFile(
      candidateRoot,
      certificationRequest.applicationEntryPoint,
      "certificationRequest.applicationEntryPoint",
    );
    const dependencyLockDigest = sha256Bytes(fs.readFileSync(dependencyLockFile));
    const applicationEntryPointDigest = sha256Bytes(fs.readFileSync(applicationFile));
    const environment = observePythonEnvironment(certificationRequest.environmentRoot);
    const inputBytes = readRegularFile(certificationRequest.inputPath, "certificationRequest.inputPath");
    const fixtureBytes = readRegularFile(certificationRequest.fixturePath, "certificationRequest.fixturePath");
    const inputsRoot = path.join(evidenceRoot, "inputs");
    fs.mkdirSync(inputsRoot, { recursive: true });
    const stagedInputPath = path.join(inputsRoot, "input.bin");
    const stagedFixturePath = path.join(inputsRoot, "fixture.bin");
    fs.writeFileSync(stagedInputPath, inputBytes);
    fs.writeFileSync(stagedFixturePath, fixtureBytes);
    const certificationCandidateDraft = {
      schemaVersion: "certification-candidate/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      integratedCandidateDigest: integratedCandidate.candidateDigest,
      candidateHead: integratedCandidate.finalHeadRevision,
      candidateTree: integratedCandidate.finalTreeDigest,
      installedEnvironmentIdentityDigest: environment.installedEnvironmentIdentityDigest,
      dependencyLockDigest,
      applicationEntryPoint: certificationRequest.applicationEntryPoint,
      environmentManifestDigest: environment.environmentManifestDigest,
      preparedAt: exactUtcNow(),
      certificationCandidateDigest: "pending",
    };
    certificationCandidateDraft.certificationCandidateDigest = computeCertificationCandidateDigest(certificationCandidateDraft);
    const certificationCandidate = validateCertificationCandidate(
      certificationCandidateDraft,
      integratedCandidate,
      sliceAuthorization,
    );
    const programsRoot = path.join(evidenceRoot, "programs");
    fs.mkdirSync(programsRoot, { recursive: true });
    const oracle = sliceAuthorization.sliceAcceptance.proofOracle;
    const evaluator = materializeAuthorizedProgram({
      repositoryPath,
      revision: sliceAuthorization.initialBaseRevision,
      identity: oracle.evaluatorArtifactIdentity,
      expectedDigest: oracle.evaluatorArtifactDigest,
      destinationRoot: programsRoot,
      label: "certification-evaluator",
    });
    const evaluatorManifest = immutable({
      schemaVersion: "certification-evaluator-input/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAcceptance: sliceAuthorization.sliceAcceptance,
      integratedCandidate,
      certificationCandidate,
      candidateRoot,
      candidateManifestDigest,
      environmentRoot: environment.environmentRoot,
      pythonExecutablePath: environment.launcherTarget,
      applicationEntryPoint: certificationRequest.applicationEntryPoint,
      applicationEntryPointDigest,
      dependencyLockPath: certificationRequest.dependencyLockPath,
      inputPath: stagedInputPath,
      fixturePath: stagedFixturePath,
    });
    const readOnlyRoots = [...new Set([
      evidenceRoot,
      environment.environmentRoot,
    ])];
    const evaluatorResult = runReadOnlySandboxedProgram({
      programPath: evaluator.programPath,
      readOnlyRoots,
      input: Buffer.from(`${JSON.stringify(evaluatorManifest)}\n`, "utf8"),
      timeoutSeconds: 900,
      writableHome,
    });
    const evaluatorOutput = parseExactJsonOutput(
      evaluatorResult.stdout,
      ["schemaVersion", "operatorActions", "quantitativeEvaluations"],
      "certification-evaluator-output/v1",
      "certification evaluator",
    );
    const proofDraft = {
      schemaVersion: "certification-proof/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
      integratedCandidateDigest: integratedCandidate.candidateDigest,
      certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
      executionSurface: {
        type: "repository-application",
        candidateHead: certificationCandidate.candidateHead,
        candidateTree: certificationCandidate.candidateTree,
        installedEnvironmentIdentityDigest: certificationCandidate.installedEnvironmentIdentityDigest,
        dependencyLockDigest: certificationCandidate.dependencyLockDigest,
        applicationEntryPoint: certificationCandidate.applicationEntryPoint,
      },
      operatorActions: evaluatorOutput.operatorActions,
      inputIdentityDigest: sha256Bytes(inputBytes),
      fixtureIdentityDigest: sha256Bytes(fixtureBytes),
      observationTranscriptDigest: evaluatorResult.stdoutDigest,
      quantitativeEvaluations: evaluatorOutput.quantitativeEvaluations,
      proofOracleDigest: computeProofOracleDigest(oracle),
      evaluatorExecutableDigest: evaluator.observedDigest,
      noImplementationWorkerExpectedOutput: true,
      executedAt: evaluatorResult.finishedAt,
      proofDigest: "pending",
    };
    proofDraft.proofDigest = computeCertificationProofDigest(proofDraft);
    const proof = validateCertificationProof(proofDraft, {
      sliceAuthorization,
      integratedCandidate,
      certificationCandidate,
      observedEvaluatorDigest: evaluator.observedDigest,
    });
    const reviews = [];
    for (const role of ["PRODUCT", "DOMAIN", "CUSTODY"]) {
      const policyKey = role.toLowerCase();
      const policy = sliceAuthorization.reviewPolicy[policyKey];
      if (policy.networkPolicy !== "none") {
        throw contractError("REVIEW_NETWORK_POLICY_UNSUPPORTED", "controller-launched certification reviewers require networkPolicy none");
      }
      const reviewer = materializeAuthorizedProgram({
        repositoryPath,
        revision: sliceAuthorization.initialBaseRevision,
        identity: policy.executableIdentity,
        expectedDigest: policy.executableDigest,
        destinationRoot: programsRoot,
        label: `certification-reviewer-${policyKey}`,
      });
      const inputManifestDigest = computeCertificationReviewInputManifestDigest({
        role,
        sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
        integratedCandidateDigest: integratedCandidate.candidateDigest,
        certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
        proofDigest: proof.proofDigest,
        executableDigest: reviewer.observedDigest,
        policyDigest: policy.policyDigest,
        environmentPolicyDigest: policy.environmentPolicyDigest,
        networkPolicy: policy.networkPolicy,
      });
      const reviewManifest = immutable({
        schemaVersion: "certification-reviewer-input/v1",
        role,
        sliceAcceptance: sliceAuthorization.sliceAcceptance,
        integratedCandidate,
        certificationCandidate,
        certificationProof: proof,
        candidateRoot,
        candidateManifestDigest,
        environmentRoot: environment.environmentRoot,
        pythonExecutablePath: environment.launcherTarget,
        inputManifestDigest,
      });
      const reviewResult = runReadOnlySandboxedProgram({
        programPath: reviewer.programPath,
        readOnlyRoots,
        input: Buffer.from(`${JSON.stringify(reviewManifest)}\n`, "utf8"),
        timeoutSeconds: 900,
        writableHome,
      });
      const output = parseExactJsonOutput(
        reviewResult.stdout,
        ["schemaVersion", "result", "findings"],
        "certification-reviewer-output/v1",
        `${role} certification reviewer`,
      );
      if (!new Set(["PASS", "FAIL"]).has(output.result)
        || typeof output.findings !== "string"
        || !output.findings.trim()) {
        throw contractError("CERTIFICATION_REVIEW_OUTPUT_INVALID", `${role} reviewer must emit PASS or FAIL with findings`);
      }
      const assessmentDraft = {
        schemaVersion: "certification-reviewer-assessment/v1",
        sliceId: sliceAuthorization.sliceId,
        generation: integratedCandidate.generation,
        role,
        sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
        integratedCandidateDigest: integratedCandidate.candidateDigest,
        certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
        certificationProofDigest: proof.proofDigest,
        processId: `controller-process-${reviewResult.pid}`,
        processExecutableDigest: reviewer.observedDigest,
        rolePolicyDigest: policy.policyDigest,
        environmentPolicyDigest: policy.environmentPolicyDigest,
        networkPolicy: policy.networkPolicy,
        inputManifestDigest,
        readOnlyCandidateAccess: true,
        implementationProcessReuse: false,
        previousReviewerOutputsVisible: false,
        result: output.result,
        findingsDigest: sha256Bytes(Buffer.from(output.findings, "utf8")),
        reviewedAt: reviewResult.finishedAt,
        assessmentDigest: "pending",
      };
      assessmentDraft.assessmentDigest = computeCertificationReviewerAssessmentDigest(assessmentDraft);
      reviews.push(validateCertificationReviewerAssessment(assessmentDraft, {
        sliceAuthorization,
        integratedCandidate,
        certificationCandidate,
        certificationProof: proof,
        observedExecutableDigest: reviewer.observedDigest,
      }));
    }
    const byRole = Object.fromEntries(reviews.map((review) => [review.role, review]));
    const assessmentDraft = {
      schemaVersion: "certification-assessment/v1",
      sliceId: sliceAuthorization.sliceId,
      generation: integratedCandidate.generation,
      sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
      sliceAcceptanceDigest: computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance),
      integratedCandidateDigest: integratedCandidate.candidateDigest,
      certificationCandidateDigest: certificationCandidate.certificationCandidateDigest,
      certificationProofDigest: proof.proofDigest,
      productReviewDigest: byRole.PRODUCT.assessmentDigest,
      domainReviewDigest: byRole.DOMAIN.assessmentDigest,
      custodyReviewDigest: byRole.CUSTODY.assessmentDigest,
      controllerBindingDigest: domainDigest("meta-harness-controller-binding/v1", sliceAuthorization.controllerBinding),
      assessedAt: exactUtcNow(),
      verdict: expectedCertificationVerdict(byRole),
      assessmentDigest: "pending",
    };
    assessmentDraft.assessmentDigest = computeCertificationAssessmentDigest(assessmentDraft);
    const assessment = validateCertificationAssessment(assessmentDraft, {
      sliceAuthorization,
      integratedCandidate,
      certificationCandidate,
      certificationProof: proof,
      reviewerAssessments: reviews,
    });
    const environmentAfter = observePythonEnvironment(certificationRequest.environmentRoot);
    if (environmentAfter.installedEnvironmentIdentityDigest !== environment.installedEnvironmentIdentityDigest
      || environmentAfter.environmentManifestDigest !== environment.environmentManifestDigest) {
      throw contractError(
        "CERTIFICATION_ENVIRONMENT_CHANGED",
        "installed Python environment changed while certification evidence was being produced",
      );
    }
    return Object.freeze({ certificationCandidate, proof, reviews, assessment });
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.rmSync(writableHome, { recursive: true, force: true });
  }
}

module.exports = {
  constructMechanicsAssessment,
  linuxNetworkIsolatorAvailable,
  materializeAuthorizedProgram,
  observePythonEnvironment,
  observedGit,
  observedGitArtifactDigest,
  produceCertificationEvidence,
  produceDeliveryTerminalEvidence,
  runNetworkIsolatedCommand,
  runReadOnlySandboxedProgram,
  sha256Bytes,
};
