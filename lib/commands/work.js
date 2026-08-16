"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { runWork } = require("../work-loop");
const { latestWorkSessionState, loadLatestWorkSession, repositoryRoot } = require("../work-git");
const { resolveAutomaticBase, resolveDefaultRemoteBase, resolveExplicitLocalBase } = require("../work-base");
const { pinProductDirection } = require("../product-direction");
const {
  bindWorkSessionToRepository,
  createGoalWorkSession,
  loadWorkSession,
  reduceJourneyState,
} = require("../work-session");
const { resolveGoalValidation } = require("../work-validation");
const {
  assertRepoDecisionSessionCurrent,
  compileRepoDecisionWork,
  decisionPlaneEnabled,
  requireRepoDecisionPlaneWork,
} = require("../repo-decision-plane");

const OPTIONS = new Set([
  "session",
  "goal",
  "resume",
  "allow",
  "base",
  "dryRun",
  "timeout",
  "model",
  "json",
]);

const PROGRESS_LABELS = Object.freeze({
  working: "Working…",
  validating: "Validating…",
  repairing: "Repairing validation…",
});

function targetRepository(context, value) {
  const target = path.resolve(context.cwd, value);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    fail(`repository is unreadable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("repository must be an existing non-symlink directory");
  }
  return target;
}

function parseTimeout(value) {
  if (value === undefined) return undefined;
  const parsed = Number(optionValue(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) {
    fail("--timeout must be an integer from 1 to 3600 seconds");
  }
  return parsed;
}

function uniqueAllowedPaths(value, platform) {
  const rawValues = Array.isArray(value) ? value : [value];
  if (rawValues.includes(true)) fail("--allow requires a path");
  const allowedPaths = optionValues(value).map(String);
  const seen = new Set();
  for (const allowedPath of allowedPaths) {
    const normalized = path.normalize(allowedPath).replace(/[\\/]+$/u, "") || ".";
    const key = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) {
      fail(`duplicate --allow path after normalization: ${allowedPath}`);
    }
    seen.add(key);
  }
  return allowedPaths;
}

function dispatch(session) {
  return { type: "DISPATCH", session };
}

function resolveWorkRequest(context, repositoryPath, options) {
  const decisionPlaneMode = requireRepoDecisionPlaneWork(repositoryPath, options);
  if (decisionPlaneMode === "resume") {
    return dispatch(assertRepoDecisionSessionCurrent(repositoryPath, loadLatestWorkSession(repositoryPath)));
  }
  if (decisionPlaneMode === "decision") {
    return compileRepoDecisionWork(repositoryPath);
  }

  const selected = [options.session !== undefined, options.goal !== undefined, options.resume !== undefined]
    .filter(Boolean).length;
  if (selected > 1) {
    fail("choose exactly one of --session, --goal, or --resume");
  }
  if (options.base !== undefined && options.goal === undefined) {
    fail("--base is valid only with --goal");
  }
  if (options.resume !== undefined) {
    return dispatch(loadLatestWorkSession(repositoryPath));
  }
  if (options.session !== undefined) {
    const value = optionValue(options.session);
    if (!value || value === true) fail("--session requires a JSON file");
    return dispatch(bindWorkSessionToRepository(
      loadWorkSession(path.resolve(context.cwd, String(value))),
      repositoryPath,
    ));
  }
  if (options.goal !== undefined) {
    const goal = optionValue(options.goal);
    if (!goal || goal === true) fail("--goal requires the product result");
    const allowedPaths = uniqueAllowedPaths(options.allow, context.platform);
    const validationScope = allowedPaths.length > 0 ? allowedPaths.map(String) : ["."];
    const productDirection = pinProductDirection(repositoryPath);
    const baseValue = optionValue(options.base);
    if (baseValue === true) fail("--base requires HEAD, a local ref, or an exact commit OID");
    const base = options.base === undefined
      ? resolveDefaultRemoteBase(repositoryPath)
      : resolveExplicitLocalBase(repositoryPath, String(baseValue));
    const resolved = resolveGoalValidation(repositoryPath, base.commit, validationScope);
    return dispatch(createGoalWorkSession({
      goal: String(goal),
      repositoryPath,
      productDirection,
      base,
      allowedPaths: validationScope,
      validation: resolved.validation,
    }));
  }

  const conventional = path.join(repositoryPath, ".meta-harness", "work-session.json");
  if (fs.existsSync(conventional)) {
    return dispatch(bindWorkSessionToRepository(loadWorkSession(conventional), repositoryPath));
  }
  fail("provide --goal, --session, or --resume; no .meta-harness/work-session.json was found");
}

function noDispatchResult(compiled) {
  return {
    schemaVersion: "work-no-dispatch/v1",
    outcome: "NO_DISPATCH",
    reason: compiled.reason,
    decisionDigest: compiled.decisionDigest,
    worldHeadDigest: compiled.worldHeadDigest,
    productResult: "No material work dispatched.",
    currentState: `Repo Decision is NO_DISPATCH: ${compiled.reason}.`,
    observableResult: "No work session or workspace was created.",
    blocker: "none",
    nextAction: "Use the product and wait for observed real-use friction.",
  };
}

function renderStop(context) {
  writeLine(context, "No active slice.");
  writeLine(context, "Use the product.");
  writeLine(context, "Wait for observed real-use friction.");
}

function sentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function renderHuman(context, result) {
  if (result.outcome === "NO_DISPATCH") {
    renderStop(context);
    return;
  }
  if (result.outcome === "DONE") {
    const observable = sentence(result.observableResult || result.productResult || "Requested result works");
    const committed = result.delivery?.commit?.status === "committed" || result.delivery?.commit?.status === "no_changes";
    writeLine(context, `Done — ${observable}${committed ? " Validation and product proof passed; the result is banked locally." : " Validation and product proof passed."}`);
    return;
  }
  if (result.outcome === "BANKED_UNPROVEN") {
    writeLine(context, "Banked — repository validation passed, but independent product proof is unavailable.");
    return;
  }
  if (result.outcome === "READY") {
    writeLine(context, "Ready — the result can execute without an owner workflow decision.");
    return;
  }
  const nextAction = String(result.nextAction || "").trim();
  if (nextAction.endsWith("?")) {
    writeLine(context, `Need you: ${nextAction}`);
    return;
  }
  const blocker = sentence(result.blocker || "The requested result could not continue");
  writeLine(context, `Blocked: ${blocker}`);
  if (nextAction && !/start a new session|provide exact controller validation|review and bank/iu.test(nextAction)) {
    const label = /^(?:gh|git|npm|pnpm|yarn|node|python3?|cargo|go|dotnet|docker|kubectl|aws|az|gcloud)\b/u.test(nextAction)
      ? "Run"
      : "Next";
    writeLine(context, `${label}: ${nextAction}`);
  }
}

function progressWriter(context) {
  let last = null;
  return (stage) => {
    const label = PROGRESS_LABELS[stage];
    if (!label || label === last) return;
    last = label;
    writeLine(context, label);
  };
}

function automaticRequest(repositoryPath, productResult = null) {
  const latest = latestWorkSessionState(repositoryPath);
  const activeSession = latest.state === "ACTIVE" ? latest.session : null;
  let compiledDecision = null;
  if (!productResult && !activeSession && decisionPlaneEnabled(repositoryPath)) {
    compiledDecision = compileRepoDecisionWork(repositoryPath);
  }
  const journey = reduceJourneyState({ ownerResult: productResult, activeSession, compiledDecision });

  if (journey.next.kind === "OWNER_INPUT") {
    return { type: "OWNER_INPUT", journey };
  }
  if (journey.next.operation === "RESUME") {
    return dispatch(assertRepoDecisionSessionCurrent(repositoryPath, activeSession));
  }
  if (journey.next.operation === "STOP") {
    return { type: "STOP", journey };
  }
  if (compiledDecision?.type === "DISPATCH") {
    return dispatch(compiledDecision.session);
  }

  const base = resolveAutomaticBase(repositoryPath);
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, ["."]);
  const session = createGoalWorkSession({
    goal: journey.productResult,
    repositoryPath,
    productDirection: pinProductDirection(repositoryPath),
    base,
    allowedPaths: ["."],
    validation: resolvedValidation.validation,
    delivery: { commit: true, push: false },
  });
  return dispatch(session);
}

async function runAutomatic(argv, context) {
  if (argv.some((token) => String(token).startsWith("--"))) {
    fail("normal work accepts only a product result; use diagnostics for internal controls");
  }
  const productResult = argv.length > 0 ? argv.join(" ").trim() : null;
  const root = repositoryRoot(context.cwd);
  const request = automaticRequest(root, productResult);
  if (request.type === "STOP") {
    renderStop(context);
    return { exitCode: 0 };
  }
  if (request.type === "OWNER_INPUT") {
    writeLine(context, "Need you: a different result is already active. Finish the active result first, then state the new result.");
    return { exitCode: 1 };
  }
  const result = await runWork({
    repositoryPath: root,
    session: request.session,
    env: context.env,
    onProgress: progressWriter(context),
  });
  renderHuman(context, result);
  return { exitCode: result.outcome === "DONE" ? 0 : 1 };
}

async function commandWork(argv, context) {
  const { positional, options } = parseArgs(argv);
  if (positional.length !== 1) {
    fail("usage: meta-harness work <repository> [--goal <result> [--base <HEAD|ref|oid>] | --session <file> | --resume]");
  }
  for (const key of Object.keys(options)) {
    if (!OPTIONS.has(key)) fail(`unknown work option: --${key}`);
  }
  const repositoryPath = targetRepository(context, positional[0]);
  const request = resolveWorkRequest(context, repositoryPath, options);
  const result = request.type === "NO_DISPATCH"
    ? noDispatchResult(request)
    : await runWork({
      repositoryPath,
      session: request.session,
      dryRun: options.dryRun !== undefined,
      timeoutSeconds: parseTimeout(options.timeout),
      model: optionValue(options.model),
      env: context.env,
      onProgress: options.json === undefined ? progressWriter(context) : () => {},
    });
  if (options.json !== undefined) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else renderHuman(context, result);
  return { exitCode: ["DONE", "READY", "NO_DISPATCH"].includes(result.outcome) ? 0 : 1 };
}

module.exports = commandWork;
module.exports.automaticRequest = automaticRequest;
module.exports.renderHuman = renderHuman;
module.exports.runAutomatic = runAutomatic;
