"use strict";

function unsupportedContract(contractName) {
  const error = new Error(`${contractName} was retired by the Meta-Harness 0.4 hard cut`);
  error.code = "UNSUPPORTED_SCHEMA";
  error.details = { contractName };
  throw error;
}

function rejectedValidation(contractName) {
  return Object.freeze({
    ok: false,
    reasons: Object.freeze([Object.freeze({
      code: "UNSUPPORTED_SCHEMA",
      path: "schemaVersion",
      message: `${contractName} was retired by the Meta-Harness 0.4 hard cut`,
    })]),
  });
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) freezeDeep(entry);
  }
  return value;
}

function cloneStrict(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  cloneStrict,
  freezeDeep,
  rejectedValidation,
  unsupportedContract,
};
