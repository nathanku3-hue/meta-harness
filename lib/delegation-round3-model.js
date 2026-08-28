"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");
const {
  FRONTIER_CANDIDATE_JSON_SCHEMA,
  GRILL_CANDIDATE_JSON_SCHEMA,
  MAX_FRONTIER_LANES,
  validateDelegationFrontierCandidate,
  validateDelegationGrillCandidate,
} = require("./delegation-round3-frontier");
const { OWNER_AUTHORITY_KINDS } = require("./work-forward-motion-record");

function buildDelegationFrontierPrompt(input) {
  return [
    "DELEGATION_FRONTIER_V1",
    "You are one fresh read-only Meta-Harness delegation frontier planner. You hold no execution, owner, Git, publication, browser, or scheduling authority.",
    "",
    "ENDGAME",
    input.endgame,
    "",
    "CURRENT ACCEPTED WORLD",
    JSON.stringify(input.world, null, 2),
    "",
    "CURRENT GATE",
    input.currentGate,
    "",
    "LIVE LANES",
    JSON.stringify(input.liveLanes, null, 2),
    "",
    "BOUNDED EVIDENCE INDEX",
    JSON.stringify(input.evidenceIndex, null, 2),
    "",
    `Retained live-lane bound: ${MAX_FRONTIER_LANES}.`,
    "",
    "FRONTIER LAWS",
    "- Decide every currently live lane exactly once: CONTINUE, HOLD, or OBSOLETE.",
    "- CONTINUE only when the lane remains positive-value on the current decision frontier.",
    "- HOLD only when the lane remains relevant but current evidence says it should checkpoint and stop consuming live capacity.",
    "- OBSOLETE only when current accepted World makes the lane no longer decision-relevant.",
    "- Failed means is not failed Outcome. Do not obsolete a lane merely because one implementation/research route failed.",
    "- Round 3 owns retained delegation lifecycle only. newOutcomes must always be an empty array.",
    "- Do not propose fresh product work, write footprints, validation, Claims, sessions, workspaces, or dispatch. Fresh coding work belongs exclusively to the repository logical planner and durable Claim admission path.",
    "- A released retained lane does not create Round-3 execution authority. Capacity for fresh coding is repository Claim capacity, evaluated outside this lifecycle frontier.",
    "- Do not invent queues, daemons, swarms, persistent workers, provider routers, dashboards, or generic schedulers.",
    "- Gate kind CONTINUE means autonomous useful work remains and the owner should see no gate.",
    "- FORWARD_GATE is permitted only when no live or newly proposed autonomous lane remains and a genuinely new semantic forward gate follows from evidence.",
    `- OWNER_DECISION may use only owner-exclusive kinds: ${OWNER_AUTHORITY_KINDS.join(", ")}.`,
    "- Every decision, blocker, new Outcome, and gate must cite only refs from the bounded evidence index.",
    "- Return only delegation-frontier-candidate/v1.",
  ].join("\n");
}

function buildDelegationGrillPrompt(input, frontier) {
  return [
    "DELEGATION_GRILL_V1",
    "You are one fresh read-only challenger. You get exactly one challenge pass; there is no review loop.",
    "Your job is to falsify a bad decomposition or unjustified next gate before it becomes lifecycle action.",
    "",
    "ENDGAME",
    input.endgame,
    "",
    "CURRENT ACCEPTED WORLD",
    JSON.stringify(input.world, null, 2),
    "",
    "BOUNDED EVIDENCE INDEX",
    JSON.stringify(input.evidenceIndex, null, 2),
    "",
    "PROPOSED FRONTIER",
    JSON.stringify(frontier, null, 2),
    "",
    "CHALLENGE LAWS",
    "- Reject unnecessary decomposition, duplicate work, stale lanes, owner gates that autonomous evidence can resolve, and any attempt to mint fresh Outcomes from Round 3.",
    "- Failed means is not failed Outcome.",
    "- Capacity is a ceiling, not a quota.",
    "- Preserve still-useful admitted/live lanes unless current accepted evidence makes HOLD or OBSOLETE correct.",
    "- A forward gate must follow from Endgame + accepted World + named evidence, not from round boundaries or convenience.",
    "- Do not add governance, a scheduler, queue, daemon, swarm, provider framework, or dashboard.",
    "- ACCEPT leaves the frontier unchanged. REPLACE must provide the complete corrected frontier now; there is no second Grill pass.",
    "- Return only delegation-grill-candidate/v1.",
  ].join("\n");
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
