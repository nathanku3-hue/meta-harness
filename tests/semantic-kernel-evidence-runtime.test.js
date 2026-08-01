"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const evidenceRuntime = require("../lib/semantic-kernel/evidence-runtime");
const {
  constructMechanicsAssessment,
  produceDeliveryTerminalEvidence,
  sha256Bytes,
} = evidenceRuntime;
const semanticController = require("../lib/semantic-kernel/semantic-controller");
const {
  recordMechanicsAssessment,
  recordTerminalCandidate,
  reserveExecutionAttempt,
} = require("../lib/semantic-kernel/semantic-controller");
const { computeRunSpecDigest } = require("../lib/semantic-kernel/run-spec-v2");
const { computeSliceAcceptanceDigest } = require("../lib/semantic-kernel/slice-authorization");
const {
  computePackageCandidateDigest,
  computeReleaseCandidateDigest,
} = require("../lib/semantic-kernel/release-candidate");

function digest(label) {
  return domainDigest("semantic-kernel-evidence-runtime-test/v1", { label });
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return String(result.stdout || "").trim();
}

function write(root, relativePath, content, mode) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  if (mode !== undefined) fs.chmodSync(absolute, mode);
  return absolute;
}

function initRepository(root) {
  run(root, "git", ["init", "-q"]);
  run(root, "git", ["config", "user.email", "evidence@example.invalid"]);
  run(root, "git", ["config", "user.name", "Evidence Runtime Test"]);
}

function commitAll(root, message) {
  run(root, "git", ["add", "-A"]);
  run(root, "git", ["commit", "-q", "-m", message]);
  return run(root, "git", ["rev-parse", "HEAD"]);
}

function createPythonEnvironmentRoot(root) {
  const environmentRoot = path.join(root, ".test-python-environment");
  const binRoot = path.join(environmentRoot, "bin");
  fs.mkdirSync(binRoot, { recursive: true });
  const python = run(root, "which", ["python3"]);
  fs.symlinkSync(python, path.join(binRoot, "python"));
  return environmentRoot;
}

function reviewerSource(role, extraCheck) {
  return `"use strict";
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const manifest = JSON.parse(input);
  let readonly = false;
  try {
    fs.writeFileSync(manifest.candidateRoot + "/reviewer-write-probe", "forbidden");
  } catch {
    readonly = true;
  }
  const extra = (${extraCheck})(manifest);
  const pass = readonly && extra;
  process.stdout.write(JSON.stringify({
    schemaVersion: "certification-reviewer-output/v1",
    result: pass ? "PASS" : "FAIL",
    findings: "${role} reviewer observed readonly=" + readonly + " extra=" + extra
  }));
});
`;
}

function evaluatorSource() {
  return `"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const manifest = JSON.parse(input);
  const app = path.join(manifest.candidateRoot, manifest.applicationEntryPoint);
  const observed = spawnSync(manifest.pythonExecutablePath, ["-I", app], {
    encoding: "utf8",
    shell: false,
    timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" }
  });
  if (observed.error || observed.status !== 0) {
    process.stderr.write(observed.stderr || observed.error.message);
    process.exit(2);
  }
  const product = JSON.parse(observed.stdout);
  const actions = ["review", "confirm", "persist", "reopen"].map((action, index) => ({
    sequence: index + 1,
    actionId: "action-" + (index + 1),
    action,
    observationId: "observation-" + (index + 1)
  }));
  process.stdout.write(JSON.stringify({
    schemaVersion: "certification-evaluator-output/v1",
    operatorActions: actions,
    quantitativeEvaluations: [{
      predicateId: "Q-DISTINCT",
      actual: product.distinct_instruments,
      passed: product.distinct_instruments >= 25 && product.distinct_instruments <= 50 && product.one_run && product.reopened_matches,
      evidenceDigest: "sha256:" + "a".repeat(64)
    }]
  }));
});
`;
}

function deliveryEvaluatorSource() {
  return `"use strict";
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const manifest = JSON.parse(input);
  const installed = require(path.join(manifest.installedRoot, "node_modules", manifest.packageCandidate.packageName));
  process.stdout.write(JSON.stringify({
    schemaVersion: "proof-evaluator-output/v1",
    operatorActions: [{ sequence: 1, actionId: "action-1", action: "open", observationId: "observation-1" }],
    quantitativeEvaluations: [{
      predicateId: "Q-VALUE",
      actual: installed.value,
      passed: installed.value === 42,
      evidenceDigest: "sha256:" + "b".repeat(64)
    }]
  }));
});
`;
}

function deliveryReviewerSource(role, checkSource) {
  return `"use strict";
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const manifest = JSON.parse(input);
  let readonly = false;
  try { fs.writeFileSync(manifest.candidateRoot + "/delivery-review-write-probe", "forbidden"); } catch { readonly = true; }
  const extra = (${checkSource})(manifest);
  process.stdout.write(JSON.stringify({
    schemaVersion: "reviewer-output/v1",
    result: readonly && extra ? "PASS" : "FAIL",
    findings: "${role} delivery reviewer observed readonly=" + readonly + " extra=" + extra
  }));
});
`;
}

function deliveryFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-delivery-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  const evaluator = deliveryEvaluatorSource();
  const productReviewer = deliveryReviewerSource("product", "(manifest) => manifest.blackBoxProof.quantitativeEvaluations[0].passed === true");
  const domainReviewer = deliveryReviewerSource("domain", "(manifest) => manifest.packageCandidate.packageName === 'delivery-fixture'");
  const custodyReviewer = deliveryReviewerSource("custody", "(manifest) => !Object.prototype.hasOwnProperty.call(manifest, 'previousReviewerOutputs')");
  write(root, "tools/delivery-evaluator.js", evaluator, 0o755);
  write(root, "tools/delivery-product-reviewer.js", productReviewer, 0o755);
  write(root, "tools/delivery-domain-reviewer.js", domainReviewer, 0o755);
  write(root, "tools/delivery-custody-reviewer.js", custodyReviewer, 0o755);
  write(root, "package.json", `${JSON.stringify({ name: "delivery-fixture", version: "0.4.0", main: "index.js", files: ["index.js"] }, null, 2)}\n`);
  write(root, "index.js", "module.exports = { value: 41 };\n");
  write(root, "README.md", "# delivery fixture\n");
  const base = commitAll(root, "base delivery evaluator and package");
  write(root, "index.js", "module.exports = { value: 42 };\n");
  const candidate = commitAll(root, "delivery candidate");
  const tree = run(root, "git", ["rev-parse", "HEAD^{tree}"]);
  const packed = JSON.parse(run(root, "npm", ["pack", "--ignore-scripts", "--json"]))[0];
  const tarballPath = path.join(root, packed.filename);
  const tarballDigest = sha256Bytes(fs.readFileSync(tarballPath));

  const acceptance = {
    intent: { version: "intent-v1", digest: digest("delivery-intent") },
    acceptanceSource: { revision: base, path: "README.md", contentDigest: sha256Bytes(Buffer.from("# delivery fixture\n")) },
    acceptanceClauses: [{ clauseId: "D-VALUE", verbatimText: "Installed package exposes value 42." }],
    quantitativeBounds: [{
      boundId: "Q-VALUE",
      clauseId: "D-VALUE",
      subject: "installed package value",
      measure: "value",
      distinctBy: null,
      min: 42,
      max: 42,
      coherenceKey: null,
    }],
    productResult: "The exact installed tarball exposes value 42.",
    operatorUserFlow: ["open"],
    shippingTarget: "installed-package",
    proofOracle: {
      evaluatorKind: "initial-base-artifact",
      evaluatorArtifactIdentity: "tools/delivery-evaluator.js",
      evaluatorArtifactDigest: sha256Bytes(Buffer.from(evaluator)),
      evaluatorPackageDigest: null,
      predicateIds: ["Q-VALUE"],
      inputPolicyDigest: digest("delivery-input-policy"),
      observationSchemaDigest: digest("delivery-observation-schema"),
    },
  };
  const publicationPolicy = {
    packageName: "delivery-fixture",
    version: "0.4.0",
    registry: "https://registry.npmjs.org/",
    access: "public",
    distTag: "latest",
    gitTag: "v0.4.0",
    provenanceRequired: true,
    publishExactTerminalTarballOnly: true,
    maxPublicationAttempts: 1,
    publishBy: "2099-01-02T00:00:00.000Z",
    canonicalUpdatePolicyDigest: digest("delivery-canonical-policy"),
  };
  const authorization = {
    schemaVersion: "slice-authorization/v1",
    repositoryId: digest("delivery-repository"),
    sliceId: "S-DELIVERY-TEST",
    initialBaseRevision: base,
    sliceMode: "DELIVERY",
    authorityExecutionPlatform: "linux",
    sliceAcceptance: acceptance,
    controllerBinding: {
      controllerProgramDigest: digest("delivery-controller-program"),
      controllerPolicyDigest: digest("delivery-controller-policy"),
      launcherDigest: digest("delivery-launcher"),
      custodyRootPolicyDigest: digest("delivery-custody-root"),
      clockPolicyDigest: digest("delivery-clock"),
      allowedCapabilities: ["INTEGRATE", "MECHANICS_ASSESS", "PACKAGE_FREEZE", "PROOF_EXECUTE", "REVIEW_ORCHESTRATE", "RUN_SPEC_SEAL", "SLICE_ACTIVATE", "TERMINAL_ASSESS"],
    },
    reviewPolicy: {
      product: {
        executableIdentity: "tools/delivery-product-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(productReviewer)),
        policyDigest: digest("delivery-product-policy"),
        environmentPolicyDigest: digest("delivery-product-environment"),
        networkPolicy: "none",
      },
      domain: {
        executableIdentity: "tools/delivery-domain-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(domainReviewer)),
        policyDigest: digest("delivery-domain-policy"),
        environmentPolicyDigest: digest("delivery-domain-environment"),
        networkPolicy: "none",
      },
      custody: {
        executableIdentity: "tools/delivery-custody-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(custodyReviewer)),
        policyDigest: digest("delivery-custody-policy"),
        environmentPolicyDigest: digest("delivery-custody-environment"),
        networkPolicy: "none",
      },
    },
    executionLimits: {
      issuedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      mustCompleteBy: "2099-01-01T00:00:00.000Z",
      maxAttempts: 2,
      maxRunSpecs: 2,
      aggregatePathBoundary: ["index.js"],
      allowedWorkerProfiles: ["worker-a"],
    },
    publicationPolicy,
    ownerKeyId: digest("delivery-owner-key"),
    authorizationDigest: digest("delivery-authorization"),
    ownerSignature: "not-used-by-delivery-evidence-runtime-test",
  };
  const integratedCandidate = {
    schemaVersion: "integrated-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(acceptance),
    repositoryId: authorization.repositoryId,
    initialBaseRevision: base,
    contributions: [],
    integrationControllerBindingDigest: digest("delivery-integration-controller"),
    changedPathUnion: ["index.js"],
    rejectedAttempts: [],
    supersededAttempts: [],
    finalHeadRevision: candidate,
    finalTreeDigest: tree,
    cleanStateProof: {
      statusPorcelainDigest: sha256Bytes(Buffer.alloc(0)),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-07-31T01:00:00.000Z",
    },
    integratedAt: "2026-07-31T01:00:01.000Z",
    candidateDigest: digest("delivery-integrated-candidate"),
  };
  const packageCandidate = {
    schemaVersion: "package-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    candidateHead: candidate,
    candidateTree: tree,
    tarballDigest,
    tarballIntegrity: packed.integrity,
    tarballByteLength: packed.size,
    packlistDigest: domainDigest("delivery-packlist-test/v1", packed.files),
    packageMetadataDigest: domainDigest("delivery-package-metadata-test/v1", { name: packed.name, version: packed.version }),
    packageName: "delivery-fixture",
    version: "0.4.0",
    builtAt: "2026-07-31T01:10:00.000Z",
    builderProgramDigest: digest("delivery-package-builder"),
    packageCandidateDigest: "pending",
  };
  packageCandidate.packageCandidateDigest = computePackageCandidateDigest(packageCandidate);
  const releaseCandidate = {
    schemaVersion: "release-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(acceptance),
    integratedCandidateDigest: integratedCandidate.candidateDigest,
    packageCandidateDigest: packageCandidate.packageCandidateDigest,
    tarballDigest,
    tarballIntegrity: packed.integrity,
    packageName: publicationPolicy.packageName,
    version: publicationPolicy.version,
    registry: publicationPolicy.registry,
    access: publicationPolicy.access,
    distTag: publicationPolicy.distTag,
    gitTag: publicationPolicy.gitTag,
    gitTagTargetRevision: candidate,
    provenanceRequired: publicationPolicy.provenanceRequired,
    canonicalUpdatePolicyDigest: publicationPolicy.canonicalUpdatePolicyDigest,
    releaseCandidateDigest: "pending",
  };
  releaseCandidate.releaseCandidateDigest = computeReleaseCandidateDigest(releaseCandidate);
  const inputPath = write(root, "delivery-input.json", "{}\n");
  const fixturePath = write(root, "delivery-fixture.json", "{}\n");
  return {
    root,
    authorization,
    integratedCandidate,
    packageCandidate,
    releaseCandidate,
    proofRequest: { tarballPath, inputPath, fixturePath },
  };
}

function certificationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-certification-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initRepository(root);

  const evaluator = evaluatorSource();
  const productReviewer = reviewerSource("product", "(manifest) => manifest.certificationProof.quantitativeEvaluations[0].passed === true");
  const domainReviewer = reviewerSource("domain", "(manifest) => manifest.certificationCandidate.applicationEntryPoint === 'app.py'");
  const custodyReviewer = reviewerSource("custody", "(manifest) => !Object.prototype.hasOwnProperty.call(manifest, 'previousReviewerOutputs')");
  write(root, "tools/evaluator.js", evaluator, 0o755);
  write(root, "tools/product-reviewer.js", productReviewer, 0o755);
  write(root, "tools/domain-reviewer.js", domainReviewer, 0o755);
  write(root, "tools/custody-reviewer.js", custodyReviewer, 0o755);
  write(root, "README.md", "# certification fixture\n");
  const base = commitAll(root, "base evaluator and reviewers");

  write(root, "app.py", [
    "import json",
    "print(json.dumps({",
    "    'distinct_instruments': 30,",
    "    'one_run': True,",
    "    'reopened_matches': True,",
    "}, sort_keys=True))",
    "",
  ].join("\n"));
  write(root, "pyproject.toml", "[project]\nname = 'quant-certification-fixture'\nversion = '0.0.0'\n");
  const candidate = commitAll(root, "candidate application");
  const tree = run(root, "git", ["rev-parse", "HEAD^{tree}"]);

  const acceptance = {
    intent: { version: "intent-v1", digest: digest("intent") },
    acceptanceSource: { revision: base, path: "README.md", contentDigest: sha256Bytes(Buffer.from("# certification fixture\n")) },
    acceptanceClauses: [{ clauseId: "Q-BREADTH", verbatimText: "One portfolio run contains 25 to 50 distinct securities." }],
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
    shippingTarget: "repository-application",
    proofOracle: {
      evaluatorKind: "initial-base-artifact",
      evaluatorArtifactIdentity: "tools/evaluator.js",
      evaluatorArtifactDigest: sha256Bytes(Buffer.from(evaluator)),
      evaluatorPackageDigest: null,
      predicateIds: ["Q-DISTINCT"],
      inputPolicyDigest: digest("input-policy"),
      observationSchemaDigest: digest("observation-schema"),
    },
  };
  const authorization = {
    schemaVersion: "slice-authorization/v1",
    repositoryId: digest("repository"),
    sliceId: "S-CERTIFICATION-TEST",
    initialBaseRevision: base,
    sliceMode: "CERTIFICATION",
    authorityExecutionPlatform: "linux",
    sliceAcceptance: acceptance,
    controllerBinding: {
      controllerProgramDigest: digest("controller-program"),
      controllerPolicyDigest: digest("controller-policy"),
      launcherDigest: digest("launcher"),
      custodyRootPolicyDigest: digest("custody-root"),
      clockPolicyDigest: digest("clock"),
      allowedCapabilities: [
        "CERTIFICATION_ASSESS",
        "CERTIFICATION_PREPARE",
        "INTEGRATE",
        "MECHANICS_ASSESS",
        "PROOF_EXECUTE",
        "REVIEW_ORCHESTRATE",
        "RUN_SPEC_SEAL",
        "SLICE_ACTIVATE",
      ],
    },
    reviewPolicy: {
      product: {
        executableIdentity: "tools/product-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(productReviewer)),
        policyDigest: digest("product-policy"),
        environmentPolicyDigest: digest("product-environment"),
        networkPolicy: "none",
      },
      domain: {
        executableIdentity: "tools/domain-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(domainReviewer)),
        policyDigest: digest("domain-policy"),
        environmentPolicyDigest: digest("domain-environment"),
        networkPolicy: "none",
      },
      custody: {
        executableIdentity: "tools/custody-reviewer.js",
        executableDigest: sha256Bytes(Buffer.from(custodyReviewer)),
        policyDigest: digest("custody-policy"),
        environmentPolicyDigest: digest("custody-environment"),
        networkPolicy: "none",
      },
    },
    executionLimits: {
      issuedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      mustCompleteBy: "2099-01-01T00:00:00.000Z",
      maxAttempts: 2,
      maxRunSpecs: 2,
      aggregatePathBoundary: ["app.py", "pyproject.toml"],
      allowedWorkerProfiles: ["worker-a"],
    },
    publicationPolicy: null,
    ownerKeyId: digest("owner-key"),
    authorizationDigest: digest("authorization"),
    ownerSignature: "not-used-by-evidence-runtime-test",
  };
  const integratedCandidate = {
    schemaVersion: "integrated-candidate/v1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(acceptance),
    repositoryId: authorization.repositoryId,
    initialBaseRevision: base,
    contributions: [],
    integrationControllerBindingDigest: digest("integration-controller"),
    changedPathUnion: ["app.py", "pyproject.toml"],
    rejectedAttempts: [],
    supersededAttempts: [],
    finalHeadRevision: candidate,
    finalTreeDigest: tree,
    cleanStateProof: {
      statusPorcelainDigest: sha256Bytes(Buffer.alloc(0)),
      statusPorcelainBytes: 0,
      isClean: true,
      checkedAt: "2026-07-31T01:00:00.000Z",
    },
    integratedAt: "2026-07-31T01:00:01.000Z",
    candidateDigest: digest("integrated-candidate"),
  };
  const environmentRoot = createPythonEnvironmentRoot(root);
  const inputPath = write(root, "input.json", "{}\n");
  const fixturePath = write(root, "fixture.json", "{}\n");
  return {
    root,
    authorization,
    integratedCandidate,
    request: {
      environmentRoot,
      dependencyLockPath: "pyproject.toml",
      applicationEntryPoint: "app.py",
      inputPath,
      fixturePath,
    },
  };
}

test("controller constructs mechanics from observed Git and sealed command execution", { skip: process.platform !== "linux" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-mechanics-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  write(root, "lib/value.js", "module.exports = 1;\n");
  const base = commitAll(root, "base");
  write(root, "lib/value.js", "module.exports = 2;\n");
  const candidate = commitAll(root, "candidate");

  const acceptance = {
    acceptanceClauses: [{ clauseId: "M-1", verbatimText: "Value changes." }],
  };
  const authorization = {
    sliceId: "S-MECHANICS-TEST",
    authorityExecutionPlatform: "linux",
    authorizationDigest: digest("mechanics-authorization"),
    sliceAcceptance: acceptance,
    executionLimits: { mustCompleteBy: "2099-01-01T00:00:00.000Z" },
  };
  const commandBody = {
    argv: [process.execPath, "-e", "process.stdout.write('validated')"],
    cwd: ".",
    timeoutSeconds: 30,
    network: "none",
  };
  const commandId = domainDigest("meta-harness-run-spec-command/v2", commandBody);
  const runSpec = {
    schemaVersion: "run-spec/v2",
    runId: "RUN-MECHANICS-1",
    sliceId: authorization.sliceId,
    generation: 1,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(acceptance),
    repository: { repositoryId: digest("mechanics-repository"), expectedParentRevision: base, objectFormat: "sha1" },
    workerProfile: "worker-a",
    mechanicalTask: {
      acceptanceClauseIds: ["M-1"],
      targetPaths: ["lib/value.js"],
      operation: "modify",
      expectedArtifactKind: "source",
      validationIds: [commandId],
    },
    validation: { commands: [{ commandId, ...commandBody }] },
    changePolicy: { maxFiles: 1, allowDeletes: false, allowRenames: false },
    workerGuidance: null,
    runSpecDigest: "pending",
  };
  runSpec.runSpecDigest = computeRunSpecDigest(runSpec);

  const mechanics = constructMechanicsAssessment({
    repositoryPath: root,
    runSpec,
    sliceAuthorization: authorization,
    expectedContributedRevision: candidate,
  });
  assert.equal(mechanics.verdict, "MECHANICS_VERIFIED");
  assert.equal(mechanics.contributedRevision, candidate);
  assert.deepEqual(mechanics.changedPaths, ["lib/value.js"]);
  assert.equal(mechanics.validationResults[0].exitStatus, 0);
  assert.equal(mechanics.validationResults[0].networkUsed, false);
  assert.equal(mechanics.cleanStateProof.isClean, true);
});

test("controller installs exact delivery tarball and launches proof plus three read-only reviewers", { skip: process.platform !== "linux" }, (t) => {
  const fixture = deliveryFixture(t);
  const evidence = produceDeliveryTerminalEvidence({
    repositoryPath: fixture.root,
    sliceAuthorization: fixture.authorization,
    integratedCandidate: fixture.integratedCandidate,
    packageCandidate: fixture.packageCandidate,
    releaseCandidate: fixture.releaseCandidate,
    proofRequest: fixture.proofRequest,
  });
  assert.equal(evidence.terminalAssessment.verdict, "TERMINAL_SLICE_VERIFIED");
  assert.equal(evidence.proof.executionSurface.type, "installed-package");
  assert.equal(evidence.proof.quantitativeEvaluations[0].actual, 42);
  assert.equal(evidence.proof.executionSurface.tarballDigest, fixture.packageCandidate.tarballDigest);
  assert.deepEqual(evidence.reviews.map((review) => review.role).sort(), ["CUSTODY", "DOMAIN", "PRODUCT"]);
  assert.equal(new Set(evidence.reviews.map((review) => review.processId)).size, 3);
});

test("alternate execution authority is absent from the evidence runtime and controller", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(evidenceRuntime, "produceCertificationEvidence"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(evidenceRuntime, "observePythonEnvironment"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(semanticController, "certifyCandidate"), false);
  const executableSource = [
    fs.readFileSync(path.join(__dirname, "..", "lib", "semantic-kernel", "evidence-runtime.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "lib", "semantic-kernel", "semantic-controller.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "lib", "execution-custody", "execute.js"), "utf8"),
  ].join("\n");
  for (const token of [
    "CERTIFICATION_PREPARE",
    "CERTIFICATION_ASSESS",
    "CERTIFICATION_VERIFIED",
    "certification-candidate/v1",
    "certification-proof/v1",
    "produceCertificationEvidence",
    "repository-application",
  ]) assert.doesNotMatch(executableSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Windows authoritative evidence operations fail before spawn, counters, bundles, state, or repository mutation", { skip: process.platform !== "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-windows-fail-closed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const authorization = { authorityExecutionPlatform: "linux" };
  const before = fs.readdirSync(root);
  const operations = [
    () => constructMechanicsAssessment({ repositoryPath: root, runSpec: null, sliceAuthorization: authorization, expectedContributedRevision: "0".repeat(40) }),
    () => produceDeliveryTerminalEvidence({ repositoryPath: root, sliceAuthorization: authorization }),
    () => reserveExecutionAttempt({ repositoryPath: root, sliceAuthorization: authorization }),
    () => recordMechanicsAssessment({ repositoryPath: root, sliceAuthorization: authorization }),
    () => recordTerminalCandidate({ repositoryPath: root, sliceAuthorization: authorization }),
  ];
  for (const operation of operations) {
    assert.throws(operation, (error) => {
      assert.equal(error.code, "AUTHORITY_EXECUTION_PLATFORM_UNSUPPORTED");
      assert.equal(error.details.authorityExecutionPlatform, "linux");
      assert.equal(error.details.currentPlatform, "win32");
      assert.deepEqual(error.details.sideEffects, {
        processSpawned: false,
        attemptOrRunCounterChanged: false,
        operationBundlePublished: false,
        stateTransitioned: false,
        repositoryMutated: false,
      });
      return true;
    });
  }
  assert.deepEqual(fs.readdirSync(root), before);
});
