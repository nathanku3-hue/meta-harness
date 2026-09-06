"use strict";

const crypto = require("node:crypto");

const { PLANNER_CANDIDATE_BATCH_SCHEMA, validatePlannerCandidateBatch } = require("../repo-planner-admission");
const { buildVariantPrompt } = require("./prompts");
const { scorePlannerBatch } = require("./scorer");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function digestJson(value) {
  return sha256Text(canonicalJson(value));
}

function assertSurface(surface) {
  for (const field of ["requestedModel", "reasoningEffort", "host", "harness", "toolSurface", "contextPolicy", "runnerConfig"]) {
    if (surface?.[field] === undefined || surface?.[field] === null || surface?.[field] === "") {
      throw new Error(`model eval surface requires ${field}`);
    }
  }
}

function compileElicitationSurface(surface, { promptDigest, outputSchemaDigest }) {
  assertSurface(surface);
  return Object.freeze({
    requestedModel: surface.requestedModel,
    reasoningEffort: surface.reasoningEffort,
    host: surface.host,
    harness: surface.harness,
    promptDigest,
    outputSchemaDigest,
    toolSurface: stableValue(surface.toolSurface),
    contextPolicy: stableValue(surface.contextPolicy),
    runnerConfig: stableValue(surface.runnerConfig),
  });
}

function prepareTrial({ fixture, variant, trial, surface }) {
  if (!fixture?.id || !fixture?.plannerInput || !fixture?.expected) throw new Error("model eval trial requires a fixture");
  if (!Number.isInteger(trial) || trial < 1) throw new Error("model eval trial must be a positive integer");
  const prompt = buildVariantPrompt(fixture.plannerInput, variant);
  const promptDigest = sha256Text(prompt);
  const outputSchemaDigest = digestJson(PLANNER_CANDIDATE_BATCH_SCHEMA);
  const elicitationSurface = compileElicitationSurface(surface, { promptDigest, outputSchemaDigest });
  return Object.freeze({
    requestedModel: surface.requestedModel,
    reasoningEffort: surface.reasoningEffort,
    host: surface.host,
    harness: surface.harness,
    fixtureId: fixture.id,
    fixtureSet: fixture.set,
    fixtureDigest: digestJson(fixture),
    promptVariant: variant,
    prompt,
    promptDigest,
    promptBytes: Buffer.byteLength(prompt, "utf8"),
    outputSchema: PLANNER_CANDIDATE_BATCH_SCHEMA,
    outputSchemaDigest,
    elicitationSurface,
    elicitationSurfaceDigest: digestJson(elicitationSurface),
    trial,
  });
}

function parseCapturedResult(captured) {
  if (typeof captured === "string") {
    const trimmed = captured.trim();
    if (!trimmed) throw new Error("captured model result is empty");
    return validatePlannerCandidateBatch(JSON.parse(trimmed));
  }
  return validatePlannerCandidateBatch(captured);
}

function makeReceipt({ request, fixture, capturedResult, latencyMs = 0, inputBytesOrTokens = null, outputBytesOrTokens = null, launcherIdentity = "chatgpt-web" }) {
  if (!request || request.fixtureId !== fixture.id) throw new Error("receipt request does not match fixture");
  let parsed;
  let parseError = null;
  try {
    parsed = parseCapturedResult(capturedResult);
  } catch (error) {
    parseError = error;
    parsed = capturedResult;
  }
  const scored = scorePlannerBatch(fixture, parsed);
  const hardFailures = parseError
    ? [...scored.hardFailures, `CAPTURE_INVALID:${parseError.message}`]
    : [...scored.hardFailures];
  const resultDigest = digestJson(parsed);
  return Object.freeze({
    schemaVersion: "model-eval-receipt/v1",
    requestedModel: request.requestedModel,
    launcherIdentity,
    fixtureId: request.fixtureId,
    fixtureDigest: request.fixtureDigest,
    fixtureSet: request.fixtureSet,
    promptVariant: request.promptVariant,
    promptDigest: request.promptDigest,
    elicitationSurfaceDigest: request.elicitationSurfaceDigest,
    trial: request.trial,
    resultDigest,
    scores: scored.scores,
    hardFailures: Object.freeze([...new Set(hardFailures)]),
    latencyMs: Number(latencyMs) || 0,
    inputBytesOrTokens,
    outputBytesOrTokens,
    promptBytes: request.promptBytes,
  });
}

function corpusDigest(fixtures) {
  return digestJson(fixtures.map((fixture) => ({ id: fixture.id, digest: digestJson(fixture), set: fixture.set })));
}

function runSummary({ receipts, fixtures, decision }) {
  return Object.freeze({
    schemaVersion: "model-eval-run-summary/v1",
    requestedModel: receipts[0]?.requestedModel || null,
    fixtureCorpusDigest: corpusDigest(fixtures),
    receiptDigests: Object.freeze(receipts.map(digestJson)),
    decision,
  });
}

module.exports = {
  canonicalJson,
  compileElicitationSurface,
  corpusDigest,
  digestJson,
  makeReceipt,
  parseCapturedResult,
  prepareTrial,
  runSummary,
  sha256Text,
};
