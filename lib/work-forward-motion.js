"use strict";

const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");
const { OWNER_AUTHORITY_KINDS } = require("./work-forward-motion-record");

const FORWARD_MOTION_CANDIDATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["disposition", "failedMeans", "alternatives", "hardConstraint", "ownerRequest", "disprovedAssertions"],
  properties: {
    disposition: { enum: ["CONTINUE_WITH_ALTERNATIVE", "REPLAN_REQUIRED", "HARD_BLOCKED", "OWNER_REQUIRED"] },
    failedMeans: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["means", "evidence"],
        properties: {
          means: { type: "string", minLength: 1 },
          evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        },
      },
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["means", "disposition", "evidence", "requiredPaths"],
        properties: {
          means: { type: "string", minLength: 1 },
          disposition: { enum: ["FAILED", "RULED_OUT", "AVAILABLE"] },
          evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          requiredPaths: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    hardConstraint: { type: ["string", "null"] },
    ownerRequest: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "question", "evidence"],
          properties: {
            kind: { enum: OWNER_AUTHORITY_KINDS },
            question: { type: "string", minLength: 1 },
            evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          },
        },
      ],
    },
    disprovedAssertions: { type: "array", items: { type: "string", minLength: 1 } },
  },
});

function list(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildForwardMotionPrompt(session, workerStop) {
  return [
    "FORWARD_MOTION_CHALLENGE_V1",
    "Evaluate one durable worker STOP. You are a fresh read-only challenger, not a planner, worker, manager, or owner.",
    "Your job is to falsify the claim that autonomous forward motion is exhausted before allowing a hard stop or owner request.",
    "",
    "Owner-authored product direction:",
    session.productDirection.content,
    "",
    `Product result: ${session.productResult}`,
    `Journey state: ${session.journeyState}`,
    `Do now: ${session.doNow}`,
    `Done when: ${session.doneWhen}`,
    "Allowed paths:",
    list(session.allowedPaths),
    "Authorized reversible actions:",
    list(session.authorizedReversibleActions),
    "Owner-only actions:",
    list(session.ownerOnlyActions),
    "Stop conditions:",
    list(session.stopOnlyIf),
    "",
    "Exact durable worker STOP evidence:",
    JSON.stringify(workerStop.workerResult.stop, null, 2),
    "",
    "Constitutional laws:",
    "- Failed means is not failed Outcome.",
    "- Search for a concrete permissible substitute before confirming a terminal stop.",
    "- Arbitrary roles such as librarian, manager, review board, approver, or another model-invented authority are not owner authority.",
    `- OWNER_REQUIRED may use only: ${OWNER_AUTHORITY_KINDS.join(", ")}.`,
    "- CONTINUE_WITH_ALTERNATIVE means the substitute stays inside this exact sealed Outcome/session. Include every additionally required write path in requiredPaths; use [] if none are added.",
    "- REPLAN_REQUIRED means autonomous work should change decomposition; it is not an owner question.",
    "- HARD_BLOCKED requires current evidence of an Outcome-level constraint and no available substitute.",
    "- OWNER_REQUIRED requires a genuine owner-exclusive capability and no available substitute.",
    "- Record unsupported assertions in disprovedAssertions.",
    "- You have no execution permit, mutation authority, Git authority, publication authority, or owner authority.",
    "",
    "Return only the structured forward-motion candidate.",
  ].join("\n");
}

async function runForwardMotionChallenger({
  workspacePath,
  session,
  workerStop,
  schemaPath,
  outputPath,
  timeoutSeconds = 300,
  model,
  env = process.env,
  signal,
}) {
  const produced = await runEphemeralStructuredModel({
    cwd: workspacePath,
    prompt: buildForwardMotionPrompt(session, workerStop),
    outputSchema: FORWARD_MOTION_CANDIDATE_SCHEMA,
    schemaPath,
    outputPath,
    timeoutSeconds,
    model,
    env,
    outputCapBytes: 4 * 1024 * 1024,
    codePrefix: "MH_FORWARD_MOTION",
    label: "forward-motion challenger",
    signal,
  });
  return {
    challenger: produced.model,
    candidate: produced.result,
    stdout: produced.stdout,
    stderr: produced.stderr,
  };
}

module.exports = {
  FORWARD_MOTION_CANDIDATE_SCHEMA,
  buildForwardMotionPrompt,
  runForwardMotionChallenger,
};
