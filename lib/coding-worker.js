"use strict";

const fs = require("node:fs");

const { ConfigError } = require("./errors");
const {
  modelCommandDigest,
  modelRequestKey,
  toolSurfaceDigest,
} = require("./execution-identity");
const {
  DEFAULT_OUTPUT_CAP_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  modelPath,
  resolveStructuredModel,
  runEphemeralStructuredModel,
  structuredModelArgs,
  structuredModelInvocationDescriptor,
  windowsPathToWsl,
  wslPathToWindows,
} = require("./ephemeral-structured-model");
const { renderRuntimeSkill } = require("./runtime-skills");
const { WORKER_RESULT_SCHEMA, validateWorkerResult } = require("./worker-result");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function listText(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildCodingPrompt(session, {
  attempt,
  priorFailure,
  workspaceMode,
  operationProjection = null,
  repositoryContractsProjection = null,
}) {
  const failureBlock = priorFailure
    ? `Previous coding evidence requires a different in-scope attempt. Address it before repeating the failed means:\n${priorFailure}\n\n`
    : "";
  const operationSection = operationProjection
    ? `Available external operation (controller-scoped):\n${operationProjection}\n\n`
    : "";
  const repositoryContractsSection = repositoryContractsProjection
    ? `${repositoryContractsProjection}\n\n`
    : "";
  return renderRuntimeSkill("coding-worker", {
    PRODUCT_DIRECTION: session.productDirection.content,
    OPERATION_SECTION: operationSection,
    REPOSITORY_CONTRACTS_SECTION: repositoryContractsSection,
    PRODUCT_RESULT: session.productResult,
    JOURNEY_STATE: session.journeyState,
    DO_NOW: session.doNow,
    NEWLY_TRUE_BEHAVIOR: session.newlyTrueBehavior,
    DONE_WHEN: session.doneWhen,
    STOP_ONLY_IF: listText(session.stopOnlyIf),
    ALLOWED_PATHS: listText(session.allowedPaths),
    VALIDATION: listText(session.validation.map((command) => JSON.stringify(command))),
    WORKSPACE_MODE: workspaceMode,
    ATTEMPT: attempt,
    PRIOR_FAILURE_BLOCK: failureBlock,
  });

}

function resolveCodingWorker(env = process.env, platform = process.platform, spawnImpl) {
  return resolveStructuredModel(env, platform, spawnImpl);
}

function workerPath(value, pathStyle) {
  return modelPath(value, pathStyle);
}

function codingArgs({ workspacePath, ...options }) {
  return structuredModelArgs({ cwd: workspacePath, ...options });
}

function prepareCodingModelRequest({
  session,
  attempt,
  priorFailure = "",
  workspaceMode,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  model,
  env = process.env,
  runtimeCapabilityDigest,
  snapshotTreeOid,
  repositoryContractsProjection = null,
}) {
  const prompt = buildCodingPrompt(session, {
    attempt,
    priorFailure,
    workspaceMode,
    repositoryContractsProjection,
  });
  const adapter = resolveCodingWorker(env);
  const invocation = structuredModelInvocationDescriptor({ model, skipGitRepoCheck: false });
  const capabilityProjectionDigest = toolSurfaceDigest(session, workspaceMode);
  const commandDigest = modelCommandDigest({
    prompt,
    outputSchema: WORKER_RESULT_SCHEMA,
    adapter,
    invocation,
    timeoutSeconds,
    outputCapBytes: DEFAULT_OUTPUT_CAP_BYTES,
    capabilityProjectionDigest,
    runtimeCapabilityDigest,
  });
  const requestKey = modelRequestKey({
    modelCommandDigest: commandDigest,
    snapshotTreeOid,
  });
  return Object.freeze({
    prompt,
    adapter: Object.freeze({ ...adapter, prefixArgs: Object.freeze([...(adapter.prefixArgs || [])]) }),
    invocation,
    capabilityProjectionDigest,
    modelCommandDigest: commandDigest,
    modelRequestKey: requestKey,
  });
}

function parseAgentResult(outputPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail("MH_WORKER_RESULT", `coding worker did not produce valid structured output: ${error.message}`);
  }
  return validateWorkerResult(parsed);
}

async function runCodingWorker({
  workspacePath,
  session,
  schemaPath,
  outputPath,
  attempt,
  priorFailure = "",
  workspaceMode,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  model,
  env = process.env,
  signal,
  preparedModelRequest = null,
  repositoryContractsProjection = null,
}) {
  const prompt = preparedModelRequest?.prompt
    || buildCodingPrompt(session, {
      attempt,
      priorFailure,
      workspaceMode,
      repositoryContractsProjection,
    });
  const produced = await runEphemeralStructuredModel({
    cwd: workspacePath,
    prompt,
    outputSchema: WORKER_RESULT_SCHEMA,
    schemaPath,
    outputPath,
    timeoutSeconds,
    model,
    env,
    codePrefix: "MH_WORKER",
    label: "coding worker",
    validate: validateWorkerResult,
    signal,
    resolvedCommand: preparedModelRequest?.adapter || null,
  });
  return {
    worker: produced.model,
    modelRequest: preparedModelRequest ? {
      capabilityProjectionDigest: preparedModelRequest.capabilityProjectionDigest,
      modelCommandDigest: preparedModelRequest.modelCommandDigest,
      modelRequestKey: preparedModelRequest.modelRequestKey,
      invocation: preparedModelRequest.invocation,
    } : null,
    result: produced.result,
    stdout: produced.stdout,
    stderr: produced.stderr,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  WORKER_RESULT_SCHEMA,
  buildCodingPrompt,
  codingArgs,
  parseAgentResult,
  prepareCodingModelRequest,
  resolveCodingWorker,
  runCodingWorker,
  windowsPathToWsl,
  wslPathToWindows,
  workerPath,
};
