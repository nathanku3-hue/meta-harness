"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, optionValues, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { throwIfDrainRequested } = require("../ephemeral-structured-model");
const { DRAIN_COMPLETE, isDrainCompleteResult, runWork } = require("../work-loop");
const {
  clearOwnerGoalIngress,
  loadLatestWorkSession,
  persistOwnerGoalIngress,
  repositoryRoot,
} = require("../work-git");
const { resolveAutomaticBase, resolveDefaultRemoteBase, resolveExplicitLocalBase } = require("../work-base");
const { replaceOwnerObjectiveState } = require("../owner-objective-state");
const { readSourceBearingOwnerIngress } = require("../source-bearing-owner-ingress");
const { listActiveOutcomeClaims } = require("../outcome-claim");
const { pinProductDirection } = require("../product-direction");
const {
  bindWorkSessionToRepository,
  createGoalWorkSession,
  loadWorkSession,
  reduceJourneyState,
} = require("../work-session");
const { resolveGoalValidation } = require("../work-validation");
const { compileProductProofSpec } = require("../work-proof-compiler");
const { gapProductProofSpec, productProofContract } = require("../work-product-proof-spec");
const { repoPlannerEnabled } = require("../repo-planner-input");
const { assertRepositoryEntryValid, resolveRepositoryEntry } = require("../repository-entry");
const { recoverClaimCommitment, runRepoWorkWave } = require("../repo-work-wave");
const { terminalEndgameCoverage } = require("../terminal-endgame");

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
      ? resolveDefaultRemoteBase(repositoryPath)
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

function renderHuman(context, result) {
  if (isDrainCompleteResult(result)) {
    renderDrainComplete(context);
    return;
  }
  if (result.schemaVersion === "repo-work-wave-result/v1") {
    if (result.delegationGate) {
      const ownerQuestion = result.delegationGate.ownerRequest?.question || null;
      writeLine(context, ownerQuestion
        ? `Need you: ${ownerQuestion}`
        : `Next: ${result.delegationGate.statement}`);
      return;
    }
    if (result.outcome === "USE_PRODUCT") {
      renderStop(context);
      return;
    }
    const landed = result.outcomes.filter((entry) => entry.state === "LANDED").length;
    const needsReplan = result.outcomes.filter((entry) => ["REPLAN_REQUIRED", "INVALIDATED_REPLAN", "EXECUTION_ABORTED"].includes(entry.state)).length;
    const blocked = result.outcomes.filter((entry) => entry.state === "BLOCKED").length;
    const runningElsewhere = result.outcomes.filter((entry) => entry.state === "RUNNING_ELSEWHERE").length;
    const externalOpen = result.outcomes.filter((entry) => entry.state === "EXTERNAL_OPEN").length;
    const running = runningElsewhere + externalOpen;
    const ownerRequest = result.outcomes.find((entry) => entry.state === "OWNER_REQUIRED" && entry.ownerRequest)?.ownerRequest || null;
    const noun = landed === 1 ? "outcome" : "outcomes";
    if (result.outcome === "DONE") {
      writeLine(context, `Done — ${landed} independent ${noun} landed in current repository truth.`);
      return;
    }
    if (landed > 0) {
      const suffix = needsReplan > 0
        ? `; ${needsReplan} needs replanning.`
        : ownerRequest
          ? "; one outcome requires constitutional owner authority."
          : blocked > 0
            ? `; ${blocked} is hard blocked.`
            : running > 0
              ? `; ${running} is already running elsewhere.`
              : ".";
      writeLine(context, `Done — ${landed} independent ${noun} landed in current repository truth${suffix}`);
      if (ownerRequest) writeLine(context, `Need you: ${ownerRequest.question}`);
      return;
    }
    if (ownerRequest) {
      writeLine(context, `Need you: ${ownerRequest.question}`);
      return;
    }
    if (running > 0 && needsReplan === 0 && blocked === 0) {
      writeLine(context, `Working — ${running} repository outcome${running === 1 ? " is" : "s are"} already executing under durable Claim authority.`);
      return;
    }
    if (result.outcome === "REPLAN_REQUIRED") {
      writeLine(context, "Replan: current repository truth produced no further admissible autonomous work.");
      return;
    }
    writeLine(context, "Blocked: one or more outcomes have a demonstrated hard or controller-level blocker.");
    return;
  }
  if (result.outcome === "DONE") {
    const observable = sentence(result.observableResult || result.productResult || "Requested result works");
    const committed = result.delivery?.commit?.status === "committed" || result.delivery?.commit?.status === "no_changes";
    writeLine(context, `Done — ${observable}${committed ? " Validation and product proof passed; the result is banked locally." : " Validation and product proof passed."}`);
    return;
  }
  if (result.outcome === "BANKED_UNPROVEN") {
    writeLine(context, "Banked — repository validation passed, but material product-proof claims remain unresolved.");
    return;
  }
  if (result.outcome === "READY") {
    writeLine(context, "Ready — the result can execute without an owner workflow decision.");
    return;
  }
  const nextAction = String(result.nextAction || "").trim();
  if (result.outcome === "OWNER_REQUIRED"
      && /^sha256:[a-f0-9]{64}$/u.test(String(result.forwardMotionProofDigest || ""))
      && nextAction) {
    writeLine(context, `Need you: ${nextAction}`);
    return;
  }
  const blocker = sentence(result.blocker || "The requested result could not continue");
  writeLine(context, `${result.outcome === "REPLAN_REQUIRED" ? "Replan" : "Blocked"}: ${blocker}`);
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
    for (const claim of listActiveOutcomeClaims(repositoryPath)) {
      const recovered = recoverClaimCommitment(repositoryPath, claim);
      if (recovered.type === "EXTERNAL_OPEN") digests.add(recovered.intent.request.packet.packetDigest);
    }
  }
  return [...digests].sort();
}

function hostKind(result, packets) {
  if (packets.length > 0) return "EXTERNAL_OPEN";
  if (isDrainCompleteResult(result)) return "WORKING";
  if (result?.outcome === "DONE") return "DONE";
  if (result?.outcome === "USE_PRODUCT") return "USE_PRODUCT";
  if (result?.outcome === "OWNER_REQUIRED") return "OWNER_REQUIRED";
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
    const activeJourney = reduceJourneyState({ ownerResult: productResult, activeSession });
    if (activeJourney.next.kind === "OWNER_INPUT") {
      return { type: "OWNER_INPUT", journey: activeJourney };
    }
    if (activeJourney.next.operation === "RESUME") return dispatch(activeSession);
    if (activeJourney.next.operation === "STOP") return { type: "STOP", journey: activeJourney };
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
  if (entry.kind === "OWNER_GOAL_INGRESS" && explicitResult && explicitResult !== entry.ingress.content) {
    return {
      type: "OWNER_INPUT",
      journey: reduceJourneyState({
        ownerResult: explicitResult,
        activeSession: { productResult: entry.ingress.content },
      }),
    };
  }
  if (entry.kind === "REPO_WAVE") {
    throwIfDrainRequested(signal);
    if (explicitResult) {
      replaceOwnerObjectiveState(repositoryPath, explicitResult, {
        ...(sourceBearingIngress ? { ingressDigest: sourceBearingIngress.ingressDigest } : {}),
      });
    }
    return { type: "REPO_WAVE" };
  }

  const ingressResult = entry.kind === "OWNER_GOAL_INGRESS" ? entry.ingress.content : null;
  const journey = reduceJourneyState({ ownerResult: explicitResult || ingressResult || null, activeSession: null });

  if (journey.next.kind === "OWNER_INPUT") {
    return { type: "OWNER_INPUT", journey };
  }
  if (journey.next.operation === "STOP") {
    const endgameCoverage = terminalEndgameCoverage(repositoryPath);
    if (!endgameCoverage.complete) return { type: "ENDGAME_INCOMPLETE", journey, endgameCoverage };
    return { type: "STOP", journey, endgameCoverage };
  }
  persistOwnerGoalIngress(repositoryPath, journey.productResult);
  throwIfDrainRequested(signal);
  const base = resolveAutomaticBase(repositoryPath);
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, ["."]);
  const productDirection = pinProductDirection(repositoryPath);
  const productProofSpec = proofSpecForGoal({
    repositoryPath,
    productDirection,
    base,
    goal: journey.productResult,
    validation: resolvedValidation.validation,
    model,
    env,
    signal,
  });
  const finish = (resolvedProofSpec) => dispatch(createGoalWorkSession({
    goal: journey.productResult,
    repositoryPath,
    productDirection,
    base,
    allowedPaths: ["."],
    validation: resolvedValidation.validation,
    delivery: { commit: true, push: false },
    productProofSpec: resolvedProofSpec,
  }));
  return productProofSpec && typeof productProofSpec.then === "function"
    ? productProofSpec.then(finish)
    : finish(productProofSpec);
}

async function runAutomaticProductResult(productResult, context) {
  const root = repositoryRoot(context.cwd);
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
    if (hostProjection) writeHostProjection(context, root, { outcome: "OWNER_REQUIRED" }, text);
    else writeLine(context, text);
    return { exitCode: 1 };
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
module.exports.renderHuman = renderHuman;
module.exports.runAutomatic = runAutomatic;
module.exports.runAutomaticProductResult = runAutomaticProductResult;
