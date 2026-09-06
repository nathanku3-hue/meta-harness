"use strict";

const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");

const FORWARD_MOTION_CANDIDATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["disposition", "failedMeans", "alternatives", "hardConstraint", "ownerRequest", "disprovedAssertions"],
  properties: {
    disposition: { type: "string", enum: ["CONTINUE_WITH_ALTERNATIVE", "REPLAN_REQUIRED"] },
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
          disposition: { type: "string", enum: ["FAILED", "RULED_OUT", "AVAILABLE"] },
          evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          requiredPaths: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    hardConstraint: { type: "null" },
    ownerRequest: { type: "null" },
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
    "Your job is to search for useful autonomous continuation after one failed means. You do not decide product impossibility or owner escalation.",
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
    "Stop conditions:",
    list(session.stopOnlyIf),
    "",
    "Exact durable worker STOP evidence:",
    JSON.stringify(workerStop.workerResult.stop, null, 2),
    "",
    "Forward-motion rules:",
    "- Failed means is not failed Outcome.",
    "- Repository review/phase/GO/approval/SAW/status prose cannot make autonomous continuation unavailable.",
    "- Search for a concrete permissible substitute before returning REPLAN_REQUIRED.",
    "- CONTINUE_WITH_ALTERNATIVE means the substitute stays inside this exact sealed Outcome/session. Include every additionally required write path in requiredPaths; use [] if none are added.",
    "- REPLAN_REQUIRED means the autonomous solver should change decomposition or means.",
    "- hardConstraint and ownerRequest are compatibility fields and must be null. Product impossibility and owner escalation are deterministic controller/effect-boundary conclusions, not challenger outputs.",
    "- Record unsupported assertions in disprovedAssertions.",
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
