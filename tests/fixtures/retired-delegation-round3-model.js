"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");
const { renderRuntimeSkill } = require("./runtime-skills");
const {
  FRONTIER_CANDIDATE_JSON_SCHEMA,
  GRILL_CANDIDATE_JSON_SCHEMA,
  MAX_FRONTIER_LANES,
  validateDelegationFrontierCandidate,
  validateDelegationGrillCandidate,
} = require("./delegation-round3-frontier");

function buildDelegationFrontierPrompt(input) {
  return renderRuntimeSkill("delegation/frontier", {
    ENDGAME: input.endgame,
    WORLD: JSON.stringify(input.world, null, 2),
    CURRENT_GATE: input.currentGate,
    LIVE_LANES: JSON.stringify(input.liveLanes, null, 2),
    EVIDENCE_INDEX: JSON.stringify(input.evidenceIndex, null, 2),
    MAX_FRONTIER_LANES,
  });
}

function buildDelegationGrillPrompt(input, frontier) {
  return renderRuntimeSkill("delegation/review", {
    ENDGAME: input.endgame,
    WORLD: JSON.stringify(input.world, null, 2),
    EVIDENCE_INDEX: JSON.stringify(input.evidenceIndex, null, 2),
    FRONTIER: JSON.stringify(frontier, null, 2),
  });
}

async function runStructured({ repositoryPath, prompt, schema, label, prefix, model, timeoutSeconds, env, signal, validate }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix.toLowerCase()}-`));
  try {
    const produced = await runEphemeralStructuredModel({
      cwd: repositoryPath,
      prompt,
      outputSchema: schema,
      schemaPath: path.join(temp, "schema.json"),
      outputPath: path.join(temp, "output.json"),
      timeoutSeconds,
      model,
      env,
      signal,
      outputCapBytes: 2 * 1024 * 1024,
      codePrefix: prefix,
      label,
      validate,
    });
    return Object.freeze({ model: produced.model, result: produced.result });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validationOptions(input) {
  return {
    liveLanes: input.liveLanes,
    knownEvidenceRefs: new Set(input.evidenceIndex.map((entry) => entry.ref)),
  };
}

async function runDelegationFrontierPlanner({ repositoryPath, input, model, timeoutSeconds = 300, env = process.env, signal }) {
  const options = validationOptions(input);
  return runStructured({
    repositoryPath,
    prompt: buildDelegationFrontierPrompt(input),
    schema: FRONTIER_CANDIDATE_JSON_SCHEMA,
    label: "delegation frontier planner",
    prefix: "MH_DELEGATION_R3_FRONTIER",
    model,
    timeoutSeconds,
    env,
    signal,
    validate: (value) => validateDelegationFrontierCandidate(value, options),
  });
}

async function runDelegationGrill({ repositoryPath, input, frontier, model, timeoutSeconds = 300, env = process.env, signal }) {
  const options = validationOptions(input);
  return runStructured({
    repositoryPath,
    prompt: buildDelegationGrillPrompt(input, frontier),
    schema: GRILL_CANDIDATE_JSON_SCHEMA,
    label: "delegation Grill",
    prefix: "MH_DELEGATION_R3_GRILL",
    model,
    timeoutSeconds,
    env,
    signal,
    validate: (value) => validateDelegationGrillCandidate(value, options),
  });
}

module.exports = {
  buildDelegationFrontierPrompt,
  buildDelegationGrillPrompt,
  runDelegationFrontierPlanner,
  runDelegationGrill,
};
