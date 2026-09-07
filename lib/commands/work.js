"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { throwIfDrainRequested } = require("../ephemeral-structured-model");
const { DRAIN_COMPLETE, isDrainCompleteResult, runWork } = require("../work-loop");
const {
  clearOwnerGoalIngress,
  createImmutableSourceSnapshot,
  loadLatestWorkSession,
  persistOwnerGoalIngress,
  repositoryRoot,
} = require("../work-git");
const { resolveAutomaticBase, resolveDefaultRemoteBase, resolveExplicitLocalBase } = require("../work-base");
const { readOwnerObjectiveState, replaceOwnerObjectiveState } = require("../owner-objective-state");
const { parseExplicitGoalChange } = require("../owner-turn");
const { readSourceBearingOwnerIngress } = require("../source-bearing-owner-ingress");
const { pinProductDirection } = require("../product-direction");
const {
  bindWorkSessionToRepository,
  createGoalWorkSession,
  loadWorkSession,
} = require("../work-session");
const { resolveGoalValidation } = require("../work-validation");
const { compileProductProofSpec } = require("../work-proof-compiler");
const { gapProductProofSpec, productProofContract } = require("../work-product-proof-spec");
const { repoPlannerEnabled } = require("../repo-planner-input");
const { runReadOnlyInteraction } = require("../read-only-interaction");
const { assertRepositoryEntryValid, resolveRepositoryEntry } = require("../repository-entry");
const { recoverRepositoryCommitments, runRepoWorkWave } = require("../repo-work-wave");
const { terminalEndgameCoverage } = require("../terminal-endgame");
const { ensureProjectHooks } = require("../project-init");

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

const INTERNAL_HOST_RESULT_ENV = "META_HARNESS_INTERNAL_HOST_RESULT";

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

function isContinuationCommand(rawTurn) {
  const command = typeof rawTurn === "string" ? rawTurn.trim().toLowerCase() : "";
  return command === "go"
    || command === "go:"
    || command === "go："
    || command === "go next"
    || command === "continue";
}

function continuityBase(repositoryPath, allowedPaths, fallback, env) {
  const snapshot = createImmutableSourceSnapshot({ repositoryPath, allowedPaths, env });
  if (snapshot) return { type: "EXACT_COMMIT", commit: snapshot.snapshotOid };
  return fallback(repositoryPath);
}

function proofSpecForGoal({ repositoryPath, productDirection, base, goal, validation, model, env, signal }) {
  const productResult = String(goal).trim();
  const newlyTrueBehavior = productResult;
  const doneWhen = "The requested behavior works in the repository and relevant validation passes.";
  if (!Array.isArray(validation) || validation.length === 0) {
    const contract = productProofContract({ productDirection, base, productResult, newlyTrueBehavior, doneWhen });
    return gapProductProofSpec(contract, "Controller-owned regression validation is unavailable, so semantic proof compilation was not attempted.");
  }
  return compileProductProofSpec({
    repositoryPath,
    productDirection,
    base,
    productResult,
    newlyTrueBehavior,
    doneWhen,
    model,
    env,
    signal,
  });
}

async function resolveWorkRequest(context, repositoryPath, options) {
  if (repoPlannerEnabled(repositoryPath)) {
    if (options.goal !== undefined || options.session !== undefined || options.allow !== undefined || options.base !== undefined) {
      fail(
        "this repository has opted into planner-mediated repo work; normal material work is derived from current durable repository truth",
      );
    }
    if (options.dryRun !== undefined) {
      fail("repo-owned parallel work does not expose a dry-run lifecycle; use current World/Claim diagnostics instead");
    }
    return { type: "REPO_WAVE" };
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
      ? continuityBase(repositoryPath, validationScope, resolveDefaultRemoteBase, context.env)
      : resolveExplicitLocalBase(repositoryPath, String(baseValue));
    const resolved = resolveGoalValidation(repositoryPath, base.commit, validationScope);
    const productProofSpec = await Promise.resolve(proofSpecForGoal({
      repositoryPath,
      productDirection,
      base,
      goal: String(goal),
      validation: resolved.validation,
      model: optionValue(options.model),
      env: context.env,
      signal: context.signal,
    }));
    return dispatch(createGoalWorkSession({
      goal: String(goal),
      repositoryPath,
      productDirection,
      base,
      allowedPaths: validationScope,
      validation: resolved.validation,
      productProofSpec,
    }));
  }

  const conventional = path.join(repositoryPath, ".meta-harness", "work-session.json");
  if (fs.existsSync(conventional)) {
    return dispatch(bindWorkSessionToRepository(loadWorkSession(conventional), repositoryPath));
  }
  fail("provide --goal, --session, or --resume; no .meta-harness/work-session.json was found");
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

function renderDrainComplete(context, { json = false } = {}) {
  if (json) {
    writeOut(context, `${JSON.stringify({ ok: true, stopped: true }, null, 2)}\n`);
    return;
  }
  writeLine(context, "Stopped safely — continuation is automatic next time.");
}

const OWNER_EFFECT_KINDS = new Set([
  "SCOPE_EXPANSION",
  "MATERIAL_PRODUCT_CHOICE",
  "CREDENTIAL_INPUT",
  "PROTECTED_ACCESS",
  "EXTERNAL_PUBLICATION",
  "DESTRUCTIVE_EXTERNAL_EFFECT",
  "ACCEPT_MATERIAL_RISK",
  "AMBIGUOUS_NON_REPLAYABLE_EFFECT",
]);

function ownerAttention(result) {
  if (!result || typeof result !== "object") return null;
  const effect = result.ownerEffect;
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) return null;
  if (!OWNER_EFFECT_KINDS.has(effect.kind)) return null;
  const question = String(effect.question || "").trim();
  if (!question) return null;
  return Object.freeze({ kind: effect.kind, question });
}

function joinedDesiredStates(entries) {
  return entries
    .map((entry) => String(entry.desiredState || "").trim())
    .filter(Boolean)
    .join("; ");
}

function writeProductState(context, prefix, entries) {
  const value = joinedDesiredStates(entries);
  if (!value) return false;
  writeLine(context, `${prefix}${sentence(value)}`);
  return true;
}

function renderRepoHuman(context, result) {
  if (result.outcome === "USE_PRODUCT") {
    renderStop(context);
    return;
  }

  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  const landed = outcomes.filter((entry) => entry.state === "LANDED");
  const running = outcomes.filter((entry) => ["RUNNING_ELSEWHERE", "EXTERNAL_OPEN"].includes(entry.state));
  const blocked = outcomes.filter((entry) => entry.state === "BLOCKED");
  const noUsefulContinuation = outcomes.filter((entry) => ["REPLAN_REQUIRED", "EXECUTION_ABORTED"].includes(entry.state));
  const attention = ownerAttention(result);
  let wrote = false;

  wrote = writeProductState(context, "Done — ", landed) || wrote;
  wrote = writeProductState(context, "Working — ", running) || wrote;
  wrote = writeProductState(context, "Could not complete — ", blocked) || wrote;
  wrote = writeProductState(context, "No further useful action was available for — ", noUsefulContinuation) || wrote;

  if (attention) {
    writeLine(context, `Need you: ${attention.question}`);
    return;
  }
  if (wrote) return;
  if (result.outcome === "REPLAN_REQUIRED") {
    writeLine(context, "I couldn't find another useful action from the current product state.");
    return;
  }
  if (result.outcome === "BLOCKED") {
    writeLine(context, "The requested work could not continue.");
    return;
  }
  writeLine(context, "No product change completed in this pass.");
}

function renderDirectContinuation(context, value) {
  const nextAction = String(value || "").trim();
  if (!nextAction
      || /start a new session|provide exact controller validation|review and bank|replan the outcome autonomously|durable forward-motion|owner authority/iu.test(nextAction)
      || /^use the .*result\b/iu.test(nextAction)
      || /^retain the banked candidate\b/iu.test(nextAction)) {
    return;
  }
  const label = /^(?:gh|git|npm|pnpm|yarn|node|python3?|cargo|go|dotnet|docker|kubectl|aws|az|gcloud)\b/u.test(nextAction)
    ? "Run"
    : "Next";
  writeLine(context, `${label}: ${nextAction}`);
}

function renderHuman(context, result) {
  if (isDrainCompleteResult(result)) {
    renderDrainComplete(context);
    return;
  }
  if (result.schemaVersion === "repo-work-wave-result/v1") {
    renderRepoHuman(context, result);
    return;
  }
  if (result.outcome === "DONE") {
    const observable = sentence(result.observableResult || result.productResult || "Requested result works");
    writeLine(context, `Done — ${observable}`);
    return;
  }
  if (result.outcome === "BANKED_UNPROVEN") {
    const observable = sentence(result.observableResult || result.productResult || "A validated result was produced");
    writeLine(context, `Progress — ${observable}`);
    writeLine(context, "The requested result is not yet proven.");
    return;
  }
  if (result.outcome === "READY") {
    writeLine(context, "Nothing changed yet. The requested work can run.");
    renderDirectContinuation(context, result.nextAction);
    return;
  }
  const attention = ownerAttention(result);
  if (attention) {
    writeLine(context, `Need you: ${attention.question}`);
    return;
  }
  const blocker = sentence(result.blocker || result.observableResult || "The requested result could not continue");
  writeLine(context, blocker);
  renderDirectContinuation(context, result.nextAction);
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

function internalHostResultRequested(context) {
  return context?.env?.[INTERNAL_HOST_RESULT_ENV] === "1";
}

function captureHumanText(render) {
  let text = "";
  render({ stdout: { write: (chunk) => { text += String(chunk); } } });
  return text.trimEnd();
}

function externalPacketDigests(repositoryPath, result) {
  const digests = new Set();
  if (result?.control === "EXTERNAL_OPEN" && /^sha256:[a-f0-9]{64}$/u.test(String(result.packetDigest || ""))) {
    digests.add(result.packetDigest);
  }
  if (result?.schemaVersion === "repo-work-wave-result/v1") {
    for (const recovered of recoverRepositoryCommitments(repositoryPath)) {
      if (recovered.type === "EXTERNAL_OPEN") digests.add(recovered.intent.request.packet.packetDigest);
    }
  }
  return [...digests].sort();
}

function hostKind(result, packets) {
  if (packets.length > 0) return "EXTERNAL_OPEN";
  if (isDrainCompleteResult(result)) return "WORKING";
  if (ownerAttention(result)) return "OWNER_REQUIRED";
  if (result?.outcome === "DONE") return "DONE";
  if (result?.outcome === "USE_PRODUCT") return "USE_PRODUCT";
  if (result?.outcome === "BLOCKED") return "BLOCKED";
  if (result?.outcome === "REPLAN_REQUIRED") return "REPLAN_REQUIRED";
  return "WORKING";
}

function writeHostProjection(context, repositoryPath, result, text) {
  const packets = externalPacketDigests(repositoryPath, result);
  writeOut(context, `${JSON.stringify({
    schemaVersion: "meta-host-result/v1",
    kind: hostKind(result, packets),
    externalPacketDigests: packets,
    text,
  })}\n`);
}

function automaticRequest(repositoryPath, productResult = null, { env, model, signal, ownerIngressDigest = null } = {}) {
  throwIfDrainRequested(signal);
  const entry = assertRepositoryEntryValid(resolveRepositoryEntry(repositoryPath));
  const activeSession = entry.kind === "DIRECT_SESSION" ? entry.session : null;
  if (activeSession) {
    clearOwnerGoalIngress(repositoryPath, { expectedContent: activeSession.productResult });
    const explicitActiveTurn = typeof productResult === "string" && productResult.trim() !== ""
      ? productResult.trim()
      : null;
    if (explicitActiveTurn === null
        || isContinuationCommand(explicitActiveTurn)
        || explicitActiveTurn === activeSession.productResult) {
      return dispatch(activeSession);
    }
    return {
      type: "OWNER_INPUT",
      activeProductResult: activeSession.productResult,
      requestedProductResult: explicitActiveTurn,
    };
  }

  const explicitResult = typeof productResult === "string" && productResult.trim() !== ""
    ? productResult.trim()
    : null;
  const sourceBearingIngress = ownerIngressDigest === null
    ? null
    : readSourceBearingOwnerIngress(repositoryPath, ownerIngressDigest);
  if (sourceBearingIngress && sourceBearingIngress.rawText !== productResult) {
    fail("source-bearing owner ingress does not match the exact submitted product text");
  }
  const advanceRetainedGoal = entry.kind === "OWNER_GOAL_INGRESS" && isContinuationCommand(explicitResult);
  if (entry.kind === "OWNER_GOAL_INGRESS" && explicitResult && !advanceRetainedGoal && explicitResult !== entry.ingress.content) {
    return {
      type: "OWNER_INPUT",
      activeProductResult: entry.ingress.content,
      requestedProductResult: explicitResult,
    };
  }
  if (entry.kind === "REPO_WAVE") {
    throwIfDrainRequested(signal);

    if (sourceBearingIngress && explicitResult) {
      replaceOwnerObjectiveState(repositoryPath, explicitResult, {
        ingressDigest: sourceBearingIngress.ingressDigest,
      });
      return { type: "REPO_WAVE" };
    }

    if (explicitResult === null) return { type: "REPO_WAVE" };

    const existingObjective = readOwnerObjectiveState(repositoryPath, { optional: true });
    if (isContinuationCommand(explicitResult)) {
      return existingObjective ? { type: "REPO_WAVE" } : { type: "NO_DISPATCH" };
    }

    const goalChange = parseExplicitGoalChange(explicitResult);
    if (goalChange) {
      replaceOwnerObjectiveState(repositoryPath, goalChange.replacementObjective);
      return goalChange.advance ? { type: "REPO_WAVE" } : { type: "NO_DISPATCH" };
    }

    if (!existingObjective) {
      replaceOwnerObjectiveState(repositoryPath, explicitResult);
      return { type: "REPO_WAVE" };
    }

    return { type: "READ_ONLY_INTERACTION", turn: String(productResult) };
  }

  const ingressResult = entry.kind === "OWNER_GOAL_INGRESS" ? entry.ingress.content : null;
  const requestedResult = advanceRetainedGoal ? ingressResult : (explicitResult || ingressResult || null);
  if (requestedResult === null) {
    const endgameCoverage = terminalEndgameCoverage(repositoryPath);
    if (!endgameCoverage.complete) return { type: "ENDGAME_INCOMPLETE", endgameCoverage };
    return { type: "STOP", endgameCoverage };
  }
  persistOwnerGoalIngress(repositoryPath, requestedResult);
  throwIfDrainRequested(signal);
  const base = continuityBase(repositoryPath, ["."], resolveAutomaticBase, env);
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, ["."]);
  const productDirection = pinProductDirection(repositoryPath);
  const productProofSpec = proofSpecForGoal({
    repositoryPath,
    productDirection,
    base,
    goal: requestedResult,
    validation: resolvedValidation.validation,
    model,
    env,
    signal,
  });
  const finish = (resolvedProofSpec) => dispatch(createGoalWorkSession({
    goal: requestedResult,
    repositoryPath,
    productDirection,
    base,
    allowedPaths: ["."],
    validation: resolvedValidation.validation,
    delivery: { push: false },
    productProofSpec: resolvedProofSpec,
  }));
  return productProofSpec && typeof productProofSpec.then === "function"
    ? productProofSpec.then(finish)
    : finish(productProofSpec);
}

async function runAutomaticProductResult(productResult, context) {
  const root = repositoryRoot(context.cwd);
  ensureProjectHooks({ ...context, cwd: root });
  const hostProjection = internalHostResultRequested(context);
  let request;
  try {
    request = await Promise.resolve(automaticRequest(root, productResult, {
      env: context.env,
      signal: context.signal,
      ownerIngressDigest: context.ownerIngressDigest || null,
    }));
  } catch (error) {
    if (error?.code !== "MH_DRAIN_REQUESTED") throw error;
    const text = captureHumanText((capture) => renderDrainComplete(capture));
    if (hostProjection) writeHostProjection(context, root, DRAIN_COMPLETE, text);
    else renderDrainComplete(context);
    return { exitCode: 0 };
  }
  if (request.type === "STOP") {
    const text = captureHumanText((capture) => renderStop(capture));
    if (hostProjection) writeHostProjection(context, root, { outcome: "USE_PRODUCT" }, text);
    else renderStop(context);
    return { exitCode: 0 };
  }
  if (request.type === "ENDGAME_INCOMPLETE") {
    const missing = request.endgameCoverage.missingDestinationRefs;
    const text = `Replan: ${missing.length} owner-required product destination${missing.length === 1 ? "" : "s"} remain without durable PROVEN coverage.`;
    if (hostProjection) writeHostProjection(context, root, { outcome: "REPLAN_REQUIRED" }, text);
    else writeLine(context, text);
    return { exitCode: 1 };
  }
  if (request.type === "OWNER_INPUT") {
    const text = "Need you: a different result is already active. Finish the active result first, then state the new result.";
    const ownerEffect = {
      kind: "MATERIAL_PRODUCT_CHOICE",
      question: "A different result is already active. Finish it first, or explicitly replace the active product result.",
    };
    if (hostProjection) writeHostProjection(context, root, { outcome: "WORKING", ownerEffect }, text);
    else writeLine(context, text);
    return { exitCode: 1 };
  }
  if (request.type === "READ_ONLY_INTERACTION") {
    const responder = context.readOnlyInteractionRunner || runReadOnlyInteraction;
    const response = await responder({
      repositoryPath: root,
      turn: request.turn,
      model: context.model,
      env: context.env,
      signal: context.signal,
    });
    const text = String(response?.answer || "").trim();
    if (!text) fail("read-only interaction produced no answer");
    if (hostProjection) writeHostProjection(context, root, { outcome: "WORKING" }, text);
    else writeLine(context, text);
    return { exitCode: 0 };
  }
  if (request.type === "NO_DISPATCH") {
    const text = "No new execution started.";
    if (hostProjection) writeHostProjection(context, root, { outcome: "WORKING" }, text);
    else writeLine(context, text);
    return { exitCode: 0 };
  }
  const onProgress = hostProjection ? () => {} : progressWriter(context);
  const result = request.type === "REPO_WAVE"
    ? await runRepoWorkWave({
        repositoryPath: root,
        env: context.env,
        delegationRound3: context.delegationRound3,
        onProgress,
        signal: context.signal,
      })
    : await runWork({
        repositoryPath: root,
        session: request.session,
        env: context.env,
        onProgress,
        signal: context.signal,
      });
  if (hostProjection) {
    const text = captureHumanText((capture) => renderHuman(capture, result));
    writeHostProjection(context, root, result, text);
  } else {
    renderHuman(context, result);
  }
  if (isDrainCompleteResult(result)) return { exitCode: 0 };
  return { exitCode: ["DONE", "USE_PRODUCT"].includes(result.outcome) ? 0 : 1 };
}

async function runAutomatic(argv, context) {
  if (argv.some((token) => String(token).startsWith("--"))) {
    fail("normal work accepts only a product result; use diagnostics for internal controls");
  }
  return runAutomaticProductResult(argv.length > 0 ? argv.join(" ").trim() : null, context);
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
  let request;
  try {
    request = await resolveWorkRequest(context, repositoryPath, options);
  } catch (error) {
    if (error?.code !== "MH_DRAIN_REQUESTED") throw error;
    renderDrainComplete(context, { json: options.json !== undefined });
    return { exitCode: 0 };
  }
  const result = request.type === "REPO_WAVE"
    ? await runRepoWorkWave({
        repositoryPath,
        timeoutSeconds: parseTimeout(options.timeout),
        model: optionValue(options.model),
        env: context.env,
        delegationRound3: context.delegationRound3,
        onProgress: options.json === undefined ? progressWriter(context) : () => {},
        signal: context.signal,
      })
    : await runWork({
        repositoryPath,
        session: request.session,
        dryRun: options.dryRun !== undefined,
        timeoutSeconds: parseTimeout(options.timeout),
        model: optionValue(options.model),
        env: context.env,
        onProgress: options.json === undefined ? progressWriter(context) : () => {},
        signal: context.signal,
      });
  if (isDrainCompleteResult(result)) {
    renderDrainComplete(context, { json: options.json !== undefined });
    return { exitCode: 0 };
  }
  if (options.json !== undefined) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else renderHuman(context, result);
  return { exitCode: ["DONE", "READY", "USE_PRODUCT"].includes(result.outcome) ? 0 : 1 };
}

module.exports = commandWork;
module.exports.automaticRequest = automaticRequest;
module.exports.hostKind = hostKind;
module.exports.renderHuman = renderHuman;
module.exports.runAutomatic = runAutomatic;
module.exports.runAutomaticProductResult = runAutomaticProductResult;
