"use strict";

const PROTECTED_CONTROL_PATHS = new Set([
  ".meta-harness/repo-charter.json",
  ".meta-harness/repo-world.json",
  ".meta-harness/world-attestation.json",
  ".meta-harness/world-transition.json",
  ".meta-harness/repo-interpretation.json",
  ".meta-harness/repo-decision.json",
  ".meta-harness/repo-proposals.json",
  ".meta-harness/closure-interpreter.js",
  ".meta-harness/owner-directive.md",
]);

function normalizedControlPath(relativePath) {
  return String(relativePath || "")
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .toLowerCase();
}

function isProtectedRepoDecisionPlanePath(relativePath) {
  return PROTECTED_CONTROL_PATHS.has(normalizedControlPath(relativePath));
}

module.exports = {
  isProtectedRepoDecisionPlanePath,
};
