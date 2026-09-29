"use strict";

const Module = require("node:module");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const blocked = new Set([
  "lib/repo-work-wave.js",
  "lib/repo-planner-input.js",
  "lib/read-only-interaction.js",
  "lib/terminal-endgame.js",
  "lib/repo-research-promotion.js",
  "lib/world-transition.js",
].map((relativePath) => path.join(ROOT, ...relativePath.split("/"))));
const originalLoad = Module._load;

Module._load = function blockOptionalRepoIntelligence(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (_) {
    // Preserve Node's normal resolution error below.
  }
  if (resolved && blocked.has(path.resolve(resolved))) {
    const error = new Error(`optional repo intelligence is unavailable in this test: ${path.relative(ROOT, resolved)}`);
    error.code = "MH_TEST_OPTIONAL_REPO_INTELLIGENCE_UNAVAILABLE";
    throw error;
  }
  return originalLoad.apply(this, arguments);
};
