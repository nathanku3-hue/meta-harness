"use strict";

function retiredRuntime(component) {
  const error = new Error(`${component} is unavailable after the Meta-Harness 0.4 authority hard cut`);
  error.code = "UNSUPPORTED_SCHEMA";
  error.details = { component };
  throw error;
}

module.exports = { retiredRuntime };
