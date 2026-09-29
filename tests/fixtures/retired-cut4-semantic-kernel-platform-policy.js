"use strict";

const { contractError } = require("./contract-utils");

const AUTHORITY_EXECUTION_PLATFORM = "linux";
const AUTHORITY_EXECUTION_UNSUPPORTED_CODE = "AUTHORITY_EXECUTION_PLATFORM_UNSUPPORTED";

function assertAuthorityExecutionPlatform(sliceAuthorization, operation) {
  const authorizedPlatform = sliceAuthorization?.authorityExecutionPlatform;
  if (authorizedPlatform !== AUTHORITY_EXECUTION_PLATFORM) {
    throw contractError(
      "AUTHORITY_EXECUTION_PLATFORM_INVALID",
      `SliceAuthorization.authorityExecutionPlatform must be ${AUTHORITY_EXECUTION_PLATFORM}`,
      { authorizedPlatform: authorizedPlatform ?? null },
    );
  }
  if (process.platform !== authorizedPlatform) {
    throw contractError(
      AUTHORITY_EXECUTION_UNSUPPORTED_CODE,
      `authoritative evidence production is supported only on ${authorizedPlatform}; current platform is ${process.platform}`,
      {
        operation,
        authorityExecutionPlatform: authorizedPlatform,
        currentPlatform: process.platform,
        sideEffects: {
          processSpawned: false,
          attemptOrRunCounterChanged: false,
          operationBundlePublished: false,
          stateTransitioned: false,
          repositoryMutated: false,
        },
      },
    );
  }
  return authorizedPlatform;
}

module.exports = {
  AUTHORITY_EXECUTION_PLATFORM,
  AUTHORITY_EXECUTION_UNSUPPORTED_CODE,
  assertAuthorityExecutionPlatform,
};
