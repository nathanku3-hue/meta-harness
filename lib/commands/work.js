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
const { parseExplicitGoalChange, resolveMissionWrite } = require("../owner-turn");
const { readSourceBearingOwnerIngress } = require("../source-bearing-owner-ingress");
const { pinProductDirection } = require("../product-direction");
const {
  bindWorkSessionToRepository,
  createGoalWorkSession,
  loadWorkSession,
} = require("../work-session");
const { resolveGoalValidation } = require("../work-validation");
const { normalizeEnvelope } = require("../human-handoff");
const { projectHumanHandoff } = require("../presentation-router");
const { compileTextPresentation } = require("../text-presentation");
const { repoPlannerEnabled } = require("../repo-control-paths");
const { assertRepositoryEntryValid, resolveRepositoryEntry } = require("../repository-entry");

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

function repoWorkWave() {
  return require("../repo-work-wave");
}

function readOnlyInteraction() {
  return require("../read-only-interaction");
}

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

function isCloseCommand(rawTurn) {
  return typeof rawTurn === "string" && rawTurn.trim().toLowerCase() === "close";
}

function continuityBase(repositoryPath, allowedPaths, fallback, env) {
  const snapshot = createImmutableSourceSnapshot({ repositoryPath, allowedPaths, env });
  if (snapshot) return { type: "EXACT_COMMIT", commit: snapshot.snapshotOid };
  return fallback(repositoryPath);
}

async function resolveWorkRequest(context, repositoryPath, options) {
  if (repoPlannerEnabled(repositoryPath)) {
    if (options.goal !== undefined || options.session !== undefined || options.allow !== undefined || options.base !== undefined) {
      fail(
        "this repository has opted into planner-mediated repo work; normal material work is derived from current durable repository truth",
      );
    }
    if (options.dryRun !== undefined) {
      fail("repo-owned parallel work does not expose a dry-run lifecycle; inspect current PRODUCT, Git, and run facts instead");
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

function quiescentHumanEnvelope({ source = "NORMAL_COMPLETION" } = {}) {
  return {
    status: "No product gap is currently observed.",
    why: "The current product result is usable, and no evidence-backed in-scope action would improve it right now.",
    next: null,
    humanStopRequired: false,
    humanStopReason: null,
    decisionQuestion: null,
    egressSource: source,
    presentation: {
      kind: "TEXT",
      shape: "LINEAR",
      itemCount: 0,
      hasBranches: false,
      hasEvidence: false,
      textMode: "QUIESCENT",
    },
  };
}

function renderQuiescentObservation(context, { source = "NORMAL_COMPLETION" } = {}) {
  writeOut(context, compileTextPresentation(quiescentHumanEnvelope({ source })).text);
}

function sentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function drainHumanEnvelope({ source = "NORMAL_COMPLETION" } = {}) {
  return {
    status: "Execution stopped safely; the current durable product state is preserved.",
    why: "The stop changed execution activity, not the accepted product objective or previously landed result.",
    next: null,
    humanStopRequired: false,
    humanStopReason: null,
    decisionQuestion: null,
    egressSource: source,
    presentation: {
      kind: "TEXT",
      shape: "LINEAR",
      itemCount: 0,
      hasBranches: false,
      hasEvidence: false,
      textMode: "SAFE_STOP",
    },
  };
}

function renderDrainComplete(context, { json = false, source = "NORMAL_COMPLETION" } = {}) {
  if (json) {
    writeOut(context, `${JSON.stringify({ ok: true, stopped: true }, null, 2)}\n`);
    return;
  }
  writeOut(context, compileTextPresentation(drainHumanEnvelope({ source })).text);
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
    .map((entry) => String(entry.observableResult || entry.desiredState || "").trim())
    .filter(Boolean)
    .join("; ");
}

function safeNextAction(value, fallback) {
  const nextAction = String(value || "").trim();
  if (!nextAction
      || /start a new session|provide exact controller validation|review and bank|durable forward-motion|owner decision|decision needed|choose (?:a )?lane|select (?:a )?lane|which lane|sibling lane|lane handoff/iu.test(nextAction)) {
    return fallback;
  }
  return nextAction;
}

function repoHumanEnvelope(result, egressSource) {
  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  const landed = outcomes.filter((entry) => entry.state === "LANDED");
  const running = outcomes.filter((entry) => ["RUNNING_ELSEWHERE", "EXTERNAL_OPEN"].includes(entry.state));
  const blocked = outcomes.filter((entry) => entry.state === "BLOCKED");
  const unresolved = outcomes.filter((entry) => ["REPLAN_REQUIRED", "EXECUTION_ABORTED"].includes(entry.state));
  const attention = ownerAttention(result);

  const statusParts = [];
  if (landed.length > 0) statusParts.push(`Completed: ${joinedDesiredStates(landed)}`);
  if (running.length > 0) statusParts.push(`Still progressing: ${joinedDesiredStates(running)}`);
  if (blocked.length > 0) statusParts.push(`Could not complete: ${joinedDesiredStates(blocked)}`);
  if (unresolved.length > 0) statusParts.push(`Still unresolved: ${joinedDesiredStates(unresolved)}`);
  if (statusParts.length === 0) statusParts.push("No product change completed in this pass.");

  const terminal = !attention
    && landed.length > 0
    && running.length === 0
    && blocked.length === 0
    && unresolved.length === 0;
  const defaultAction = running.length > 0
    ? "Continue the remaining in-scope work automatically."
    : "Continue the unresolved product work automatically with a different approach.";

  return {
    status: terminal ? joinedDesiredStates(landed) : statusParts.join(" "),
    why: attention
      ? "The remaining work reached a mechanically identified owner-exclusive boundary; internal scheduling or review state is not the reason for the stop."
      : "This handoff reports product consequences after execution fan-in without exposing worker, resume, or review lifecycle details.",
    next: terminal ? null : {
      action: attention
        ? "Resolve the owner-exclusive boundary, then continue the same product objective."
        : defaultAction,
      where: "This is the aggregate handoff after execution fan-in and before the next product-state transition.",
      whyNow: attention
        ? "All reversible in-scope work has advanced to the exact effect or product-choice boundary that requires human input."
        : "The aggregate result now makes the remaining product gap explicit, so another audit or worker-status recap would not add useful information.",
      locks: [
        "the current product objective",
        "the already-landed product results",
        "the exact unresolved boundary",
      ],
      doneWhen: attention
        ? "The concrete owner-exclusive question is answered."
        : "The remaining product gap is completed or reduced by a materially different reversible action.",
      unlocks: attention
        ? "Execution can resume from the same objective without reopening prior completed work."
        : "The next handoff can report a new observable product state rather than worker lifecycle.",
      whyNotOthers: [
        "Replaying completed worker or validation detail does not reduce the product gap.",
        "Internal lane, resume, and reviewer mechanics are execution details rather than owner decisions.",
      ],
    },
    humanStopRequired: Boolean(attention),
    humanStopReason: attention ? attention.kind : null,
    decisionQuestion: attention ? attention.question : null,
    egressSource,
    presentation: {
      kind: "TEXT",
      shape: outcomes.length > 1 ? "COMPARISON" : "LINEAR",
      itemCount: outcomes.length,
      hasBranches: [landed, running, blocked, unresolved].filter((group) => group.length > 0).length > 1,
      hasEvidence: false,
      textMode: attention ? "OWNER_REQUIRED" : (terminal ? "COMPLETION" : "AGGREGATE"),
    },
  };
}

function directHumanEnvelope(result, egressSource) {
  const attention = ownerAttention(result);

  if (result.outcome === "DONE") {
    const observation = String(result.observableResult || "").trim();
    if (!observation) {
      return directHumanEnvelope({
        ...result,
        outcome: "REPLAN_REQUIRED",
        blocker: "Completion was reported without an observable product result.",
        nextAction: "Continue the same product objective until an observable result is verified.",
      }, egressSource);
    }
    const observable = sentence(observation);
    return {
      status: observable,
      why: "The requested product gap has been implemented and validated, so the handoff should describe the usable result rather than the worker lifecycle.",
      next: null,
      humanStopRequired: false,
      humanStopReason: null,
      decisionQuestion: null,
      egressSource,
      presentation: {
        kind: "TEXT",
        shape: "LINEAR",
        itemCount: 1,
        hasBranches: false,
        hasEvidence: false,
        textMode: "COMPLETION",
      },
    };
  }

  if (result.outcome === "READY") {
    return {
      status: "Nothing changed yet; the requested work has a reversible execution path.",
      why: "Preflight resolved how to execute the work, so the next useful step is execution rather than another planning cycle.",
      next: {
        action: safeNextAction(result.nextAction, "Execute the requested work."),
        where: "This is the execution step after preflight and before product verification.",
        whyNow: "The required path and validation route are already known.",
        locks: ["the current product result", "the bounded write scope", "the validation route"],
        doneWhen: "The work executes and its observable result passes the declared validation.",
        unlocks: "The result can move to a completion handoff.",
        whyNotOthers: ["More planning would repeat a resolved preflight question."],
      },
      humanStopRequired: false,
      humanStopReason: null,
      decisionQuestion: null,
      egressSource,
      presentation: {
        kind: "TEXT",
        shape: "LINEAR",
        itemCount: 1,
        hasBranches: false,
        hasEvidence: false,
        textMode: "CONTINUATION",
      },
    };
  }

  const blocker = sentence(result.blocker || result.observableResult || "The requested result could not continue");
  return {
    status: blocker,
    why: attention
      ? "The next physical action is a mechanically identified owner-exclusive effect or material product choice."
      : "The current means did not produce a verifiable product result; that is failed-means evidence, not a reason to expose internal lifecycle or invent a human-only decision point.",
    next: {
      action: attention
        ? "Resolve the owner-exclusive boundary, then continue the same product objective."
        : safeNextAction(result.nextAction, "Continue the same product outcome with a different approach."),
      where: attention
        ? "This is the exact owner-exclusive boundary after all currently lawful reversible work."
        : "This remains inside the same product objective, between the failed means and the next reversible attempt.",
      whyNow: attention
        ? "Further progress would cross the concrete effect or product-choice boundary identified by the controller."
        : "The prior means is exhausted, but the product outcome is still the target and no human-only decision has been established.",
      locks: attention
        ? ["the current product objective", "the exact requested external or product-choice effect"]
        : ["the current product objective", "the observed failed-means evidence", "the existing safety invariants"],
      doneWhen: attention
        ? "The concrete owner-exclusive question is answered."
        : "A materially different reversible action produces a valid candidate or yields new evidence about the product gap.",
      unlocks: attention
        ? "Execution can resume without reopening completed reversible work."
        : "The system can complete the product result or choose the next evidence-backed approach.",
      whyNotOthers: [
        attention
          ? "Internal scheduling, review, or resume state cannot substitute for the required human choice."
          : "Repeating the same failed means or dumping its audit trail would not reduce the product gap.",
      ],
    },
    humanStopRequired: Boolean(attention),
    humanStopReason: attention ? attention.kind : null,
    decisionQuestion: attention ? attention.question : null,
    egressSource,
    presentation: {
      kind: "TEXT",
      shape: "LINEAR",
      itemCount: 1,
      hasBranches: false,
      hasEvidence: false,
      textMode: attention ? "OWNER_REQUIRED" : (result.outcome === "BLOCKED" ? "BLOCKER" : "CONTINUATION"),
    },
  };
}

function humanEnvelopeForResult(result, { source = null } = {}) {
  const egressSource = source || (result?.schemaVersion === "repo-work-wave-result/v2"
    ? "SUBAGENT_AGGREGATION"
    : "NORMAL_COMPLETION");
  if (isDrainCompleteResult(result)) return drainHumanEnvelope({ source: egressSource });
  if (result?.outcome === "USE_PRODUCT") return quiescentHumanEnvelope({ source: egressSource });
  return result?.schemaVersion === "repo-work-wave-result/v2"
    ? repoHumanEnvelope(result, egressSource)
    : directHumanEnvelope(result, egressSource);
}

function renderHuman(context, result, { source = null } = {}) {
  writeOut(context, compileTextPresentation(humanEnvelopeForResult(result, { source })).text);
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
  return text;
}

function externalPacketDigests(repositoryPath, result) {
  const digests = new Set();
  if (result?.control === "EXTERNAL_OPEN" && /^sha256:[a-f0-9]{64}$/u.test(String(result.packetDigest || ""))) {
    digests.add(result.packetDigest);
  }
  if (result?.schemaVersion === "repo-work-wave-result/v2") {
    for (const recovered of repoWorkWave().recoverRepositoryCommitments(repositoryPath)) {
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

function hostHumanEnvelope(result) {
  if (isDrainCompleteResult(result)) return humanEnvelopeForResult(result);
  if (result?.schemaVersion === "repo-work-wave-result/v2") return humanEnvelopeForResult(result);
  if (result?.outcome && result.outcome !== "WORKING") return humanEnvelopeForResult(result);
  return null;
}

function writeHostProjection(context, repositoryPath, result, text) {
  const packets = externalPacketDigests(repositoryPath, result);
  const envelope = hostHumanEnvelope(result);
  const normalized = envelope ? normalizeEnvelope(envelope) : null;
  const presentation = normalized ? projectHumanHandoff(normalized) : null;
  if (presentation && presentation.text !== String(text)) {
    fail("host presentation projection diverged from validated human handoff text");
  }
  writeOut(context, `${JSON.stringify({
    schemaVersion: "meta-host-result/v2",
    kind: hostKind(result, packets),
    externalPacketDigests: packets,
    handoff: normalized,
    presentation,
    text,
  })}\n`);
}

function automaticRequest(repositoryPath, productResult = null, { env, model, signal, ownerIngressDigest = null } = {}) {
  throwIfDrainRequested(signal);
  if (isCloseCommand(productResult)) return { type: "CLOSE" };
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
  const continuation = isContinuationCommand(explicitResult);
  const sourceBearingIngress = continuation || ownerIngressDigest === null
    ? null
    : readSourceBearingOwnerIngress(repositoryPath, ownerIngressDigest);
  if (sourceBearingIngress && sourceBearingIngress.rawText !== productResult) {
    fail("source-bearing owner ingress does not match the exact submitted product text");
  }
  const advanceRetainedGoal = entry.kind === "OWNER_GOAL_INGRESS" && continuation;
  if (entry.kind === "OWNER_GOAL_INGRESS" && explicitResult && !advanceRetainedGoal && explicitResult !== entry.ingress.content) {
    return {
      type: "OWNER_INPUT",
      activeProductResult: entry.ingress.content,
      requestedProductResult: explicitResult,
    };
  }
  const plannerConfigured = repoPlannerEnabled(repositoryPath);
  if (entry.kind === "IDLE" && continuation) return { type: "STOP" };
  if (entry.kind === "REPO_WAVE"
      || (entry.kind === "IDLE" && plannerConfigured && explicitResult !== null && !continuation)) {
    throwIfDrainRequested(signal);

    const existingObjective = readOwnerObjectiveState(repositoryPath, { optional: true });
    const missionWrite = resolveMissionWrite({
      currentMission: existingObjective,
      rawTurn: explicitResult,
    });

    if (sourceBearingIngress && explicitResult) {
      if (missionWrite.type === "PRESERVE") {
        return { type: "REPO_WAVE" };
      }
      const objective = missionWrite.type === "REPLACE"
        ? missionWrite.replacementObjective
        : explicitResult;
      replaceOwnerObjectiveState(repositoryPath, objective, {
        ingressDigest: sourceBearingIngress.ingressDigest,
      });
      return { type: "REPO_WAVE" };
    }

    if (explicitResult === null) return { type: "REPO_WAVE" };
    if (continuation) return { type: "REPO_WAVE" };

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

  if (continuation && entry.kind !== "OWNER_GOAL_INGRESS") {
    return { type: "NO_DISPATCH" };
  }

  const ingressResult = entry.kind === "OWNER_GOAL_INGRESS" ? entry.ingress.content : null;
  const requestedResult = advanceRetainedGoal ? ingressResult : (explicitResult || ingressResult || null);
  if (requestedResult === null) return { type: "STOP" };
  persistOwnerGoalIngress(repositoryPath, requestedResult);
  throwIfDrainRequested(signal);
  const base = continuityBase(repositoryPath, ["."], resolveAutomaticBase, env);
  const resolvedValidation = resolveGoalValidation(repositoryPath, base.commit, ["."]);
  const productDirection = pinProductDirection(repositoryPath);
  return dispatch(createGoalWorkSession({
    goal: requestedResult,
    repositoryPath,
    productDirection,
    base,
    allowedPaths: ["."],
    validation: resolvedValidation.validation,
    delivery: { push: false },
  }));
}

async function runAutomaticProductResult(productResult, context) {
  const root = repositoryRoot(context.cwd);
  const hostProjection = internalHostResultRequested(context);
  if (isCloseCommand(productResult)) {
    const text = captureHumanText((capture) => renderDrainComplete(capture));
    if (hostProjection) writeHostProjection(context, root, DRAIN_COMPLETE, text);
    else renderDrainComplete(context);
    return { exitCode: 0 };
  }
  const explicitText = typeof productResult === "string" ? productResult.trim() : "";
  if (explicitText === "" || isContinuationCommand(explicitText)) {
    const entry = assertRepositoryEntryValid(resolveRepositoryEntry(root));
    if (entry.action === "IDLE" && !entry.error) {
      const text = captureHumanText((capture) => renderQuiescentObservation(capture));
      if (hostProjection) writeHostProjection(context, root, { outcome: "USE_PRODUCT" }, text);
      else renderQuiescentObservation(context);
      return { exitCode: 0 };
    }
  }
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
  if (request.type === "CLOSE") {
    const text = captureHumanText((capture) => renderDrainComplete(capture));
    if (hostProjection) writeHostProjection(context, root, DRAIN_COMPLETE, text);
    else renderDrainComplete(context);
    return { exitCode: 0 };
  }
  if (request.type === "STOP") {
    const text = captureHumanText((capture) => renderQuiescentObservation(capture));
    if (hostProjection) writeHostProjection(context, root, { outcome: "USE_PRODUCT" }, text);
    else renderQuiescentObservation(context);
    return { exitCode: 0 };
  }
  if (request.type === "ENDGAME_INCOMPLETE") {
    const missing = request.endgameCoverage.missingDestinationRefs;
    const result = {
      outcome: "REPLAN_REQUIRED",
      blocker: `${missing.length} owner-required product destination${missing.length === 1 ? "" : "s"} remain without durable proven coverage.`,
      nextAction: "Continue the same product objective with the next reversible action that can close one uncovered destination.",
    };
    const text = captureHumanText((capture) => renderHuman(capture, result, { source: "NORMAL_COMPLETION" }));
    if (hostProjection) writeHostProjection(context, root, result, text);
    else renderHuman(context, result, { source: "NORMAL_COMPLETION" });
    return { exitCode: 1 };
  }
  if (request.type === "OWNER_INPUT") {
    const result = {
      outcome: "BLOCKED",
      blocker: "A different product result is already active.",
      ownerEffect: {
        kind: "MATERIAL_PRODUCT_CHOICE",
        question: "Finish the active result first, or explicitly replace the active product result?",
      },
    };
    const text = captureHumanText((capture) => renderHuman(capture, result, { source: "NORMAL_COMPLETION" }));
    if (hostProjection) writeHostProjection(context, root, result, text);
    else renderHuman(context, result, { source: "NORMAL_COMPLETION" });
    return { exitCode: 1 };
  }
  if (request.type === "READ_ONLY_INTERACTION") {
    const responder = context.readOnlyInteractionRunner || readOnlyInteraction().runReadOnlyInteraction;
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
    const result = {
      outcome: "DONE",
      observableResult: "No new execution started because the current request did not open a new product gap.",
      nextAction: "Use the current product state and continue only when a new executable gap appears.",
    };
    const text = captureHumanText((capture) => renderHuman(capture, result, { source: "NORMAL_COMPLETION" }));
    if (hostProjection) writeHostProjection(context, root, result, text);
    else renderHuman(context, result, { source: "NORMAL_COMPLETION" });
    return { exitCode: 0 };
  }
  const onProgress = hostProjection ? () => {} : progressWriter(context);
  const result = request.type === "REPO_WAVE"
    ? await repoWorkWave().runRepoWorkWave({
        repositoryPath: root,
        env: context.env,
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
  const source = result.schemaVersion === "repo-work-wave-result/v2"
    ? "SUBAGENT_AGGREGATION"
    : "NORMAL_COMPLETION";
  if (hostProjection) {
    const text = captureHumanText((capture) => renderHuman(capture, result, { source }));
    writeHostProjection(context, root, result, text);
  } else {
    renderHuman(context, result, { source });
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
    renderDrainComplete(context, {
      json: options.json !== undefined,
      source: options.resume !== undefined ? "RESUME_COMPLETION" : "NORMAL_COMPLETION",
    });
    return { exitCode: 0 };
  }
  const result = request.type === "REPO_WAVE"
    ? await repoWorkWave().runRepoWorkWave({
        repositoryPath,
        timeoutSeconds: parseTimeout(options.timeout),
        model: optionValue(options.model),
        env: context.env,
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
    renderDrainComplete(context, {
      json: options.json !== undefined,
      source: options.resume !== undefined ? "RESUME_COMPLETION" : "NORMAL_COMPLETION",
    });
    return { exitCode: 0 };
  }
  if (options.json !== undefined) writeOut(context, `${JSON.stringify(result, null, 2)}\n`);
  else {
    const source = result.schemaVersion === "repo-work-wave-result/v2"
      ? "SUBAGENT_AGGREGATION"
      : options.resume !== undefined
        ? "RESUME_COMPLETION"
        : "NORMAL_COMPLETION";
    renderHuman(context, result, { source });
  }
  return { exitCode: ["DONE", "READY", "USE_PRODUCT"].includes(result.outcome) ? 0 : 1 };
}

module.exports = commandWork;
module.exports.automaticRequest = automaticRequest;
module.exports.hostKind = hostKind;
module.exports.humanEnvelopeForResult = humanEnvelopeForResult;
module.exports.renderHuman = renderHuman;
module.exports.runAutomatic = runAutomatic;
module.exports.runAutomaticProductResult = runAutomaticProductResult;
