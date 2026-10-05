"use strict";

const ACCESS_FAILURE = /\b(?:permission denied|operation not permitted|access denied|unauthorized|forbidden|http\s*40[13]|\b40[13]\b|EACCES|EPERM)\b/iu;
const FILESYSTEM_CAPABILITY = /\b(?:permission denied|operation not permitted|access denied|EACCES|EPERM)\b/iu;
const AUTHENTICATED_CAPABILITY = /\b(?:unauthorized|forbidden|http\s*40[13]|\b40[13]\b)\b/iu;

function capabilityObservation(output) {
  const text = String(output || "");
  if (!ACCESS_FAILURE.test(text)) return null;
  if (FILESYSTEM_CAPABILITY.test(text)) {
    return "CAPABILITY_ABSENT(filesystem): the validator could not exercise a required filesystem capability inside the execution envelope. Treat this as a physical runtime boundary; choose another in-scope means or remove the dependency on that capability.";
  }
  if (AUTHENTICATED_CAPABILITY.test(text)) {
    return "CAPABILITY_ABSENT(authenticated-external): the validator could not exercise a required authenticated external capability inside the execution envelope. Treat this as a capability observation; continue with an in-scope alternative. Any non-replayable external effect boundary is resolved by the controller outside the worker loop.";
  }
  return "CAPABILITY_ABSENT(runtime): the attempted means depends on a capability that is not present in the current execution envelope. Choose another in-scope means.";
}

function modelFacingFailureOutput(output) {
  const observation = capabilityObservation(output);
  return observation || String(output || "").trim() || "no output";
}

function validationFailureObservation(results) {
  return (results || [])
    .filter((result) => !result.passed)
    .map((result) => `${JSON.stringify(result.argv)} exited ${result.exitCode}: ${modelFacingFailureOutput(result.output)}`)
    .join("\n");
}

module.exports = {
  ACCESS_FAILURE,
  capabilityObservation,
  modelFacingFailureOutput,
  validationFailureObservation,
};
