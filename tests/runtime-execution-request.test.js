"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXECUTION_REQUEST_SCHEMA,
  loadExecutionRequestEnvelope,
  validateExecutionRequest,
  validateLocalBindings,
} = require("../lib/execution-custody/execute");
const { absNorm, sha256File } = require("../lib/execution-custody/support");
const {
  createFixtureLayout,
  buildRunRequest,
  buildControllerConfig,
} = require("./helpers/execution-custody-fixture");

function publicRequest(layout, options = {}) {
  const config = buildControllerConfig(layout);
  const parent = options.custodyParent || fs.mkdtempSync(path.join(os.tmpdir(), "execution-request-parent-"));
  return {
    schemaVersion: EXECUTION_REQUEST_SCHEMA,
    executionId: options.executionId || "public-request-001",
    sourceRepositoryPath: layout.repositoryPath,
    custodyRoot: options.custodyRoot || absNorm(path.join(parent, "custody")),
    expectedBaseTree: layout.expectedBaseTree,
    runRequest: buildRunRequest(layout, {
      approvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }),
    agentProgram: {
      nodeExecutablePath: config.agentProgram.nodeExecutablePath,
      expectedNodeSha256: config.agentProgram.expectedNodeSha256,
      launcherScriptPath: config.agentProgram.launcherScriptPath,
      expectedLauncherSha256: config.agentProgram.expectedLauncherSha256,
      nativeExecutablePath: config.agentProgram.nativeExecutablePath,
      expectedNativeSha256: config.agentProgram.expectedNativeSha256,
      expectedVersion: config.agentProgram.expectedVersion,
      codexHome: config.agentProgram.codexHome,
    },
    validationProgram: {
      commandName: config.validationProgram.commandName,
      executablePath: config.validationProgram.executablePath,
      expectedExecutableSha256: config.validationProgram.expectedExecutableSha256,
      hostEnv: config.validationProgram.hostEnv,
      sensitiveValues: [],
    },
  };
}

function writeRequest(root, value) {
  const requestPath = absNorm(path.join(root, "request.json"));
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(requestPath, bytes);
  return { requestPath, bytes };
}

test("public execution request has one exact sealed shape and exact-byte digest", () => {
  const layout = createFixtureLayout({ label: "public-request-shape" });
  const requestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "public-request-file-"));
  try {
    const request = publicRequest(layout);
    assert.equal(validateExecutionRequest(request).schemaVersion, EXECUTION_REQUEST_SCHEMA);
    const { requestPath, bytes } = writeRequest(requestRoot, request);
    const envelope = loadExecutionRequestEnvelope(requestPath);
    assert.equal(
      envelope.requestDigest,
      `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    );
    assert.deepEqual(envelope.request, request);
  } finally {
    layout.cleanup();
    fs.rmSync(requestRoot, { recursive: true, force: true });
  }
});

test("public request rejects the private schema and all extra or missing fields", () => {
  const layout = createFixtureLayout({ label: "public-request-reject" });
  try {
    const oldSchema = publicRequest(layout);
    oldSchema.schemaVersion = "execution-custody-operator-request/v1";
    assert.throws(() => validateExecutionRequest(oldSchema), /schemaVersion must be meta-harness-execution-request\/v1/);

    const extra = publicRequest(layout);
    extra.compatibility = true;
    assert.throws(() => validateExecutionRequest(extra), /top-level shape invalid/);

    const missing = publicRequest(layout);
    delete missing.agentProgram.expectedNodeSha256;
    assert.throws(() => validateExecutionRequest(missing), /agentProgram shape invalid/);

    const nestedExtra = publicRequest(layout);
    nestedExtra.runRequest.authorizationRequest.retry = true;
    assert.throws(() => validateExecutionRequest(nestedExtra), /authorizationRequest must be exactly/);
  } finally {
    layout.cleanup();
  }
});

test("public request binds Node, launcher, native agent, and validation bytes before custody creation", () => {
  const layout = createFixtureLayout({ label: "public-request-hashes" });
  const requestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "public-request-hash-file-"));
  try {
    const request = publicRequest(layout);
    const { requestPath } = writeRequest(requestRoot, request);
    const envelope = loadExecutionRequestEnvelope(requestPath);
    const bindings = validateLocalBindings(envelope);
    assert.equal(bindings.tools.node.observedSha256, request.agentProgram.expectedNodeSha256);
    assert.equal(bindings.tools.launcher.observedSha256, request.agentProgram.expectedLauncherSha256);
    assert.equal(bindings.tools.native.observedSha256, request.agentProgram.expectedNativeSha256);
    assert.equal(bindings.tools.validation.observedSha256, request.validationProgram.expectedExecutableSha256);
    assert.equal(fs.existsSync(request.custodyRoot), false);

    const mismatch = publicRequest(layout);
    mismatch.agentProgram.expectedNodeSha256 = "0".repeat(64);
    const bad = writeRequest(requestRoot, mismatch);
    const badEnvelope = loadExecutionRequestEnvelope(bad.requestPath);
    assert.throws(() => validateLocalBindings(badEnvelope), /nodeExecutablePath sha256 mismatch/);
    assert.equal(fs.existsSync(mismatch.custodyRoot), false);
  } finally {
    layout.cleanup();
    fs.rmSync(requestRoot, { recursive: true, force: true });
  }
});

test("custody root requires one absent final directory under an existing non-symlink parent", () => {
  const layout = createFixtureLayout({ label: "public-request-root" });
  const requestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "public-request-root-file-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "public-request-root-parent-"));
  try {
    const existingRoot = absNorm(path.join(parent, "existing"));
    fs.mkdirSync(existingRoot);
    const existing = publicRequest(layout, { custodyRoot: existingRoot });
    assert.throws(
      () => validateLocalBindings(loadExecutionRequestEnvelope(writeRequest(requestRoot, existing).requestPath)),
      /create-only custody root already exists/,
    );

    const missingParentRoot = absNorm(path.join(parent, "missing-parent", "custody"));
    const missingParent = publicRequest(layout, { custodyRoot: missingParentRoot });
    assert.throws(
      () => validateLocalBindings(loadExecutionRequestEnvelope(writeRequest(requestRoot, missingParent).requestPath)),
      /realpath failed|ENOENT/,
    );

    const overlap = publicRequest(layout, {
      custodyRoot: absNorm(path.join(layout.repositoryPath, "custody")),
    });
    assert.throws(
      () => validateLocalBindings(loadExecutionRequestEnvelope(writeRequest(requestRoot, overlap).requestPath)),
      /must be separated/,
    );
  } finally {
    layout.cleanup();
    fs.rmSync(requestRoot, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("request file must itself be a regular non-symlink file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-request-not-file-"));
  try {
    assert.throws(() => loadExecutionRequestEnvelope(absNorm(directory)), /regular non-symlink file/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("declared executable hashes are lowercase sha256 values", () => {
  const layout = createFixtureLayout({ label: "public-request-hash-shape" });
  try {
    const request = publicRequest(layout);
    assert.equal(request.agentProgram.expectedNodeSha256, sha256File(process.execPath));
    request.validationProgram.expectedExecutableSha256 = "A".repeat(64);
    assert.throws(() => validateExecutionRequest(request), /64 lowercase hex chars/);
  } finally {
    layout.cleanup();
  }
});
