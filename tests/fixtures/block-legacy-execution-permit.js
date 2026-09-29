"use strict";

const Module = require("node:module");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const blocked = path.join(ROOT, "lib", "execution-permit.js");
const originalLoad = Module._load;

Module._load = function blockLegacyExecutionPermit(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (_) {
    // Preserve Node's normal resolution error below.
  }
  if (resolved && path.resolve(resolved) === blocked) {
    const error = new Error("legacy execution permit compatibility is unavailable in this test");
    error.code = "MH_TEST_LEGACY_EXECUTION_PERMIT_UNAVAILABLE";
    throw error;
  }
  return originalLoad.apply(this, arguments);
};
