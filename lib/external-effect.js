"use strict";

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { appendRunEvent, readRunJournal } = require("./run-journal");

const EFFECT_INPUT_DOMAIN = "meta-harness-external-effect-input/v1";
const EFFECT_ID_DOMAIN = "meta-harness-external-effect-id/v1";
const REPLAY_CLASSES = Object.freeze([
  "PURE",
  "IDEMPOTENT",
  "KEYED_IDEMPOTENT",
  "CONDITIONAL",
  "OBSERVABLE",
  "NON_REPLAYABLE",
]);
const REPLAY_CLASS_SET = new Set(REPLAY_CLASSES);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function descriptor({ kind, exactInput, replayClass, idempotencyKey = null }) {
  if (typeof kind !== "string" || kind.trim() === "") fail("MH_EXTERNAL_EFFECT_KIND", "external effect kind is required");
  if (exactInput === undefined) fail("MH_EXTERNAL_EFFECT_INPUT", "external effect exactInput is required");
  if (!REPLAY_CLASS_SET.has(replayClass)) fail("MH_EXTERNAL_EFFECT_REPLAY", `unsupported external effect replay class: ${replayClass}`);
  if (idempotencyKey !== null && (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "")) {
    fail("MH_EXTERNAL_EFFECT_IDEMPOTENCY", "external effect idempotencyKey must be null or a non-empty string");
  }
  if (replayClass === "KEYED_IDEMPOTENT" && idempotencyKey === null) {
    fail("MH_EXTERNAL_EFFECT_IDEMPOTENCY", "KEYED_IDEMPOTENT external effects require an idempotencyKey");
  }
  const input = JSON.parse(JSON.stringify(exactInput));
  const exactInputDigest = domainDigest(EFFECT_INPUT_DOMAIN, input);
  const identity = {
    kind: kind.trim(),
    exactInputDigest,
    replayClass,
    idempotencyKey,
  };
  return Object.freeze({
    ...identity,
    exactInput: input,
    effectId: domainDigest(EFFECT_ID_DOMAIN, identity),
  });
}

function effectState({ gitCommonDirectory, runId, effect }) {
  const current = effect?.effectId ? effect : descriptor(effect || {});
  const events = readRunJournal({ gitCommonDirectory, runId });
  const intended = events.find((event) => event.type === "effect/intended" && event.data?.effectId === current.effectId) || null;
  const observed = events.find((event) => event.type === "effect/observed" && event.data?.effectId === current.effectId) || null;
  if (intended && (intended.data.exactInputDigest !== current.exactInputDigest
      || intended.data.replayClass !== current.replayClass
      || (intended.data.idempotencyKey ?? null) !== (current.idempotencyKey ?? null))) {
    fail("MH_EXTERNAL_EFFECT_BINDING", "durable external-effect intent disagrees with requested effect identity");
  }
  return Object.freeze({ effect: current, intended, observed, pending: Boolean(intended && !observed) });
}

function persistEffectIntent({ gitCommonDirectory, runId, effect }) {
  const state = effectState({ gitCommonDirectory, runId, effect });
  if (state.intended) return state;
  appendRunEvent({
    gitCommonDirectory,
    runId,
    type: "effect/intended",
    data: state.effect,
  });
  return effectState({ gitCommonDirectory, runId, effect: state.effect });
}

function persistEffectObservation({ gitCommonDirectory, runId, effect, result }) {
  const state = persistEffectIntent({ gitCommonDirectory, runId, effect });
  if (state.observed) return state;
  appendRunEvent({
    gitCommonDirectory,
    runId,
    type: "effect/observed",
    data: {
      effectId: state.effect.effectId,
      exactInputDigest: state.effect.exactInputDigest,
      replayClass: state.effect.replayClass,
      idempotencyKey: state.effect.idempotencyKey,
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  return effectState({ gitCommonDirectory, runId, effect: state.effect });
}

function replayDecision(state) {
  const current = state?.effectId ? { effect: state, intended: null, observed: null, pending: false } : state;
  if (!current?.effect || !isDigest(current.effect.effectId)) fail("MH_EXTERNAL_EFFECT_STATE", "external effect state is invalid");
  if (current.observed) return Object.freeze({ action: "USE_OBSERVED", ownerRequired: false });
  if (!current.intended) return Object.freeze({ action: "START", ownerRequired: false });
  switch (current.effect.replayClass) {
    case "PURE":
    case "IDEMPOTENT":
    case "KEYED_IDEMPOTENT":
    case "CONDITIONAL":
      return Object.freeze({ action: "RETRY_EXACT", ownerRequired: false });
    case "OBSERVABLE":
      return Object.freeze({ action: "RECONCILE_REMOTE", ownerRequired: false });
    case "NON_REPLAYABLE":
      return Object.freeze({ action: "RECONCILE_OR_ESCALATE", ownerRequired: true });
    default:
      fail("MH_EXTERNAL_EFFECT_REPLAY", `unsupported external effect replay class: ${current.effect.replayClass}`);
  }
}

module.exports = {
  EFFECT_ID_DOMAIN,
  EFFECT_INPUT_DOMAIN,
  REPLAY_CLASSES,
  descriptor,
  effectState,
  persistEffectIntent,
  persistEffectObservation,
  replayDecision,
};
