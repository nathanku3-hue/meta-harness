"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const REQUEST_PATH = path.join(ROOT, "request-v2.json");
const RUNTIME_PATH = require.resolve("../lib/execution-custody/execute");
const COMMAND_PATH = require.resolve("../lib/commands/execute");

function captureContext() {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd: ROOT,
      stdout: { write(value) { stdout += String(value); } },
      stderr: { write(value) { stderr += String(value); } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function withStubbedRuntime(runtime, operation) {
  const previousRuntime = require.cache[RUNTIME_PATH];
  const previousCommand = require.cache[COMMAND_PATH];
  require.cache[RUNTIME_PATH] = {
    id: RUNTIME_PATH,
    filename: RUNTIME_PATH,
    loaded: true,
    exports: runtime,
    children: [],
    paths: [],
  };
  delete require.cache[COMMAND_PATH];
  try {
    return await operation(require(COMMAND_PATH));
  } finally {
    delete require.cache[COMMAND_PATH];
    if (previousRuntime) require.cache[RUNTIME_PATH] = previousRuntime;
    else delete require.cache[RUNTIME_PATH];
    if (previousCommand) require.cache[COMMAND_PATH] = previousCommand;
  }
}

function mechanicsResult() {
  return {
    schemaVersion: "meta-harness-execute-result/v2",
    action: "RECORD_MECHANICS",
    disposition: "MECHANICS_VERIFIED",
    productAcceptance: "NOT_EVALUATED",
    sliceId: "S-SEMANTIC-KERNEL-1",
    generation: 1,
    mechanicsAssessmentDigest: `sha256:${"b".repeat(64)}`,
    contributedRevision: "a".repeat(40),
    operationEventDigest: `sha256:${"c".repeat(64)}`,
  };
}

test("execute renders mechanics-only language and never a product verdict", { concurrency: false }, async () => {
  const capture = captureContext();
  let observedRequestPath = null;
  let observedRepositoryPath = null;
  const request = {
    schemaVersion: "meta-harness-execution-request/v2",
    action: "RECORD_MECHANICS",
    sliceAuthorization: {},
    payload: {},
  };

  await withStubbedRuntime({
    loadExecutionRequestEnvelope(requestPath) {
      observedRequestPath = requestPath;
      return request;
    },
    async executeRequest(received, options) {
      assert.equal(received, request);
      observedRepositoryPath = options.repositoryPath;
      return mechanicsResult();
    },
  }, async (commandExecute) => {
    const result = await commandExecute(["--request", REQUEST_PATH], capture.context);
    assert.deepEqual(result, { exitCode: 0 });
  });

  assert.equal(observedRequestPath, REQUEST_PATH);
  assert.equal(observedRepositoryPath, ROOT);
  assert.equal(capture.stderr(), "");
  assert.match(capture.stdout(), /^MECHANICS VERIFIED$/m);
  assert.match(capture.stdout(), /^PRODUCT ACCEPTANCE: NOT EVALUATED$/m);
  assert.match(capture.stdout(), /^mechanicsAssessmentDigest: sha256:/m);
  assert.doesNotMatch(capture.stdout(), /^VERIFIED$/m);
  assert.doesNotMatch(capture.stdout(), /IMPLEMENTATION_VERIFIED|\bSHIP\b/);
});

test("execute JSON output preserves v2 result identity", { concurrency: false }, async () => {
  const capture = captureContext();
  const expected = mechanicsResult();
  await withStubbedRuntime({
    loadExecutionRequestEnvelope() {
      return { schemaVersion: "meta-harness-execution-request/v2" };
    },
    async executeRequest() {
      return expected;
    },
  }, async (commandExecute) => {
    const result = await commandExecute(["--request", REQUEST_PATH, "--json"], capture.context);
    assert.deepEqual(result, { exitCode: 0 });
  });
  assert.deepEqual(JSON.parse(capture.stdout()), expected);
  assert.equal(capture.stderr(), "");
});

test("terminal and closure are the only product-authority renderings", { concurrency: false }, async () => {
  for (const [runtimeResult, expectedLines] of [
    [{
      schemaVersion: "meta-harness-execute-result/v2",
      action: "RECORD_TERMINAL_ASSESSMENT",
      disposition: "TERMINAL_SLICE_VERIFIED",
      productAcceptance: "NOT_EVALUATED",
      terminalAssessmentDigest: `sha256:${"d".repeat(64)}`,
    }, ["TERMINAL SLICE VERIFIED"]],
    [{
      schemaVersion: "meta-harness-execute-result/v2",
      action: "CLOSE_SLICE",
      disposition: "SLICE_CLOSED",
      productAcceptance: "TERMINAL_SLICE_VERIFIED",
      projectionDigest: `sha256:${"e".repeat(64)}`,
      nextSliceState: "AWAITING_OWNER_AUTHORIZATION",
    }, ["SLICE CLOSED", "PRODUCT ACCEPTANCE: TERMINAL SLICE VERIFIED"]],
  ]) {
    const capture = captureContext();
    await withStubbedRuntime({
      loadExecutionRequestEnvelope() { return {}; },
      async executeRequest() { return runtimeResult; },
    }, async (commandExecute) => {
      await commandExecute(["--request", REQUEST_PATH], capture.context);
    });
    for (const line of expectedLines) assert.match(capture.stdout(), new RegExp(`^${line}$`, "m"));
  }
});

test("execute rejects positional arguments, missing request, and unknown options", { concurrency: false }, async () => {
  await withStubbedRuntime({
    loadExecutionRequestEnvelope() { throw new Error("should not load"); },
    async executeRequest() { throw new Error("should not execute"); },
  }, async (commandExecute) => {
    for (const argv of [
      ["unexpected"],
      [],
      ["--request", REQUEST_PATH, "--state-root", ROOT],
    ]) {
      const capture = captureContext();
      await assert.rejects(
        () => commandExecute(argv, capture.context),
        (error) => error && error.name === "UsageError",
      );
    }
  });
});
