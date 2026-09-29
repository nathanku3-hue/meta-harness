"use strict";

const { runEphemeralStructuredModel } = require("./ephemeral-structured-model");
const { renderRuntimeSkill } = require("./runtime-skills");

const FORWARD_MOTION_CANDIDATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["disposition", "failedMeans", "alternatives", "disprovedAssertions"],
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
    disprovedAssertions: { type: "array", items: { type: "string", minLength: 1 } },
  },
});

function list(items) {
  return items.map((entry) => `- ${entry}`).join("\n");
}

function buildForwardMotionPrompt(session, workerStop) {
  return renderRuntimeSkill("forward-motion", {
    PRODUCT_DIRECTION: session.productDirection.content,
    PRODUCT_RESULT: session.productResult,
    JOURNEY_STATE: session.journeyState,
    DO_NOW: session.doNow,
    DONE_WHEN: session.doneWhen,
    ALLOWED_PATHS: list(session.allowedPaths),
    STOP_ONLY_IF: list(session.stopOnlyIf),
    STOP_EVIDENCE: JSON.stringify(workerStop.workerResult.stop, null, 2),
  });

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
