"use strict";

const fs = require("node:fs");

const { ConfigError } = require("./errors");
const {
  DEFAULT_TIMEOUT_SECONDS,
  modelPath,
  resolveStructuredModel,
  runEphemeralStructuredModel,
  structuredModelArgs,
  windowsPathToWsl,
  wslPathToWindows,
} = require("./ephemeral-structured-model");
const { executionPermitProjection, validateExecutionPermit } = require("./execution-permit");
const { WORKER_RESULT_SCHEMA, validateWorkerResult } = require("./worker-result");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function listText(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildCodingPrompt(session, { attempt, priorFailure, workspaceMode, executionPermit }) {
  const failureBlock = priorFailure
    ? `\nPrevious attempt did not pass validation. Repair this exact failure before doing anything else:\n${priorFailure}\n`
    : "";
  const direction = session.productDirection;
  return [
    "Execute this concrete accepted coding task now. Do not reopen product planning.",
    "Your sandbox is intentionally read-only. That is not a blocker: implement by returning typed WRITE, DELETE, or MOVE operations for controller materialization.",
    "Do not ask for a writable workspace, another task specification, or routine approval when the fields below define in-scope work.",
    "",
    "Product direction (owner-authored; immutable for this session):",
    direction.content,
    "",
    ...(executionPermit ? [
      "Execution authority (compiled by the controller; valid for this attempt only):",
      executionPermitProjection(executionPermit),
      "",
    ] : []),
    `Semantic authority state: ${session.semanticState}`,
    `Semantic projection: ${JSON.stringify(session.semanticProjection)}`,
    `Endgame projection: ${JSON.stringify(session.endgameProjection)}`,
    ...(session.semanticState === "UNBOUND" ? [
      "Semantic authority is UNBOUND. Do not infer, substitute, or invent typed research objects, hypotheses, metric roles, or required destinations. This does not prevent the sealed local Outcome from completing when its own product proof passes.",
    ] : []),
    `Product result: ${session.productResult}`,
    `Journey state: ${session.journeyState}`,
    `Do now: ${session.doNow}`,
    `Newly true behavior: ${session.newlyTrueBehavior}`,
    `Done when: ${session.doneWhen}`,
    "Stop only if:",
    listText(session.stopOnlyIf),
    "Authorized reversible actions:",
    listText(session.authorizedReversibleActions),
    "Owner-only actions:",
    listText(session.ownerOnlyActions),
    "Allowed paths:",
    listText(session.allowedPaths),
    "Controller-owned validation:",
    listText(session.validation.map((command) => JSON.stringify(command))),
    "",
    `Workspace mode: ${workspaceMode}`,
    `Attempt: ${attempt} of ${session.maxAttempts}`,
    failureBlock,
    "Working rules:",
    "- Obey the product direction above before local engineering context. Do not rewrite taste, endgame, or shipping definition.",
    "- Treat the ExecutionPermit as the complete authority for material actions in this attempt. Never infer or expand capabilities from prose.",
    "- Never reuse an ExecutionPermit or assume a previous attempt still authorizes this one.",
    "- Never propose changes to PRODUCT.md; only the owner may change product direction.",
    "- Read repository instructions and only the files needed for this result.",
    "- Do not reconstruct or override this sealed execution brief from planner/status prose or repository Decision Plane control files; those may be historical copies in the immutable workspace base.",
    "- Begin implementation immediately; do not produce another broad plan or ask approval for reversible in-scope work.",
    "- Preserve existing coherent work. Never reset, clean, stash, or revert unrelated changes.",
    "- The worker is read-only by design. Never report read-only access as a blocker; do not attempt filesystem or Git mutation.",
    "- Implement the accepted task with typed operations: WRITE { type, path, content }, DELETE { type, path }, or MOVE { type, from, to }; Meta-Harness owns materialization.",
    "- Your status field is advisory. The controller decides completion from sealed evidence and isolated verification.",
    "- Include only allowed paths. Do not propose staging, commits, pushes, tags, branch/worktree changes, publication, credentials, or filesystem actions outside WRITE/DELETE/MOVE.",
    "- Reason against the declared validation and repair the prior failure inside the returned file contents.",
    "- Use STOP only when a stated stop condition is actually met after seeking permissible alternative means. STOP must contain zero operations and structured evidence of the unsatisfied requirement, failed means, alternatives considered, and any observed constraint.",
    "- A worker may stop executing; it may not declare the Outcome blocked, nominate an owner/manager/librarian/approver, invent an approval gate, or formulate an owner question. Organizational routing belongs to the controller.",
    "- For DONE or PARTIAL, set stop to null. For STOP, provide the structured stop object.",
    "- Stop at the stated product result. Do not add compatibility paths or downstream architecture unless required by doneWhen.",
    "- Return worker-result/v2 with the product result first and process evidence second.",
  ].join("\n");
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
  executionPermit,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  model,
  env = process.env,
  signal,
}) {
  if (!executionPermit) fail("MH_WORKER_PERMIT", "coding worker requires a current ExecutionPermit");
  validateExecutionPermit(executionPermit);
  const prompt = buildCodingPrompt(session, { attempt, priorFailure, workspaceMode, executionPermit });
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
  });
  return {
    worker: produced.model,
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
  resolveCodingWorker,
  runCodingWorker,
  windowsPathToWsl,
  wslPathToWindows,
  workerPath,
};
